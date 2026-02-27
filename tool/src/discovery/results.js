import {
  fetchPublicationLiveCache,
  fetchRegistrationLiveCache,
  fetchResultsLiveCache,
  writeResultsLiveCache,
} from "../utils/server_utils.js";
import fs from "fs";
import { zodTextFormat } from "openai/helpers/zod";
import config from "config";
import OpenAI from "openai";
import { z } from "zod";
import { log } from "../utils/utils.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Zod schema for GPT response
export const SinglePublicationOutput = z.object({
  hasResults: z
    .boolean()
    .describe(
      "Your JUDGMENT whether or not this Publication contains results. THIS judgment is formed by comparing the registration description, enrollment, study design, and more, with the publication title and abstract."
    ),
  reason: z
    .string()
    .describe(
      "Maximum of two sentences describing your reasoning as to why this publication contains results of the trial."
    ),
});

// Configuration
const MAX_TOKENS_PER_QUERY = config.get("live.maxTokensResults");
const systemPrompt = fs
  .readFileSync(config.get("live.systemPromptResults"))
  .toString();

// Alternative system prompt (from results/discovery.js) - kept for backwards compatibility
const systemPromptSingle = fs
  .readFileSync(
    path.resolve(__dirname, "../../prompts/systemPromptSingleAbstract.txt")
  )
  .toString();

const openai = new OpenAI();

/**
 * Main discovery function - uses caching and config-based prompts
 * @param {string} trialId - Trial ID
 * @param {string} pmid - Publication PMID
 * @returns {Promise<object>} Results with content, success, and tokens
 */
export async function resultsDiscovery(trialId, pmid, overrides = {}) {
  const hasOverrides = overrides.model || overrides.reasoning;

  if (!hasOverrides) {
    const cacheHit = fetchResultsLiveCache(trialId, pmid);
    if (cacheHit) {
      return cacheHit;
    }
  }

  const registration = fetchRegistrationLiveCache(trialId);
  const publication = fetchPublicationLiveCache(pmid);
  const userPrompt = buildUserPrompt(registration, publication);

  const results = await promptGpt(userPrompt, overrides);

  if (!hasOverrides) {
    writeResultsLiveCache(trialId, pmid, results);
  }

  return results;
}

/**
 * Build user prompt from registration and publication objects
 * Used by resultsDiscovery (config-based flow)
 * @param {object} registration - Registration object
 * @param {object} publication - Publication object with title, authors, abstract
 * @returns {string} Formatted prompt string
 */
export const buildUserPrompt = (registration, publication) => {
  if (!publication) {
    throw new Error(
      `buildUserPrompt expecting non-null publication, got ${publication}`
    );
  }

  const prompt = `REGISTRATION:
  Brief Title: ${registration.briefTitle}
  Official Title: ${registration.officialTitle}
  Organization: ${registration.organization?.fullName}
  Trial Registry ID: ${registration.trialId}
  Study Type: ${registration.studyType}
  Summary: ${registration.briefSummary}
  Description: ${registration.detailedDescription}
  -----

  PUBLICATION:
  Title: ${publication.title}
  Author: ${publication.authors}
  Abstract: ${publication.abstract}
  -----`;

  return prompt;
};

/**
 * Build user prompt from publication object with nested registration
 * Used by detectResults (batch flow with alternative prompt)
 * @param {object} publication - Publication object with abstract and registration nested
 * @returns {string} Formatted prompt string
 */
export const buildUserPromptFromPublication = (publication) => {
  if (!publication) {
    throw new Error(
      `buildUserPromptFromPublication expecting non-null publication, got ${publication}`
    );
  }

  const abstract = publication.abstract;
  const registration = publication.registration;
  const prompt = `REGISTRATION:
Brief Title: ${registration.briefTitle}
Official Title: ${registration.officialTitle}
Organization: ${registration.organization?.fullName}
Trial Registry ID: ${registration.trialId}
Study Type: ${registration.studyType}
Summary: ${registration.briefSummary}
Description: ${registration.detailedDescription}
-----

PUBLICATION:
Title: ${abstract.title}
Author: ${abstract.authors}
Abstract: ${abstract.text}
-----`;

  return prompt;
};

/**
 * Prompt GPT with a single user prompt (uses config-based settings)
 * @param {string} userPrompt - The user prompt string
 * @returns {Promise<object>} Results with content, success, and tokens
 */
export const promptGpt = async (userPrompt, overrides = {}) => {
  const model = overrides.model || config.get("live.modelResults");
  const reasoningEffort =
    overrides.reasoning || config.get("live.reasoningEffortResults");
  const response = await openai.responses.create({
    model,
    max_output_tokens: MAX_TOKENS_PER_QUERY,
    reasoning: { effort: reasoningEffort },
    input: [
      {
        role: "developer",
        content: systemPrompt,
      },
      {
        role: "user",
        content: userPrompt,
      },
    ],
    text: {
      format: zodTextFormat(
        SinglePublicationOutput,
        "single_publication_format"
      ),
    },
  });

  const success = response.output && response.output.length > 0;
  const parsed = success ? JSON.parse(response.output_text) : null;

  return {
    content: parsed,
    success,
    tokens: response?.usage?.total_tokens || 0,
  };
};

/**
 * Helper function to log GPT responses to file
 * @param {object} params - Parameters object
 * @param {array} params.responses - Array of responses
 * @param {array} params.publications - Array of publications
 */
const logGptResToFile = ({ responses, publications }) => {
  const location = `./out/gpt-res-raw/${publications?.[0]?.registration?.trialId}.json`;
  log(`Writing GPT response to file ${location}`);
  fs.writeFileSync(location, JSON.stringify(responses));
};

/**
 * Prompt GPT individually for each publication (uses alternative prompt from file)
 * Used by detectResults for batch processing
 * @param {array} pubsWithPrompts - Array of publication objects with userPrompt property
 * @returns {Promise<array>} Array of results with gptRes, success, and tokens
 */
export const promptGptIndividually = async (pubsWithPrompts) => {
  const registration = pubsWithPrompts?.[0]?.registration;
  fs.writeFileSync(
    `./out/prompts/${registration?.trialId}.txt`,
    pubsWithPrompts?.map((pub) => pub?.userPrompt).join("\n")
  );

  log(
    `Prompting chatGPT with prompt found in ./out/prompts/${registration?.trialId}.txt`
  );

  const model = config.get("live.modelResults");
  const reasoningEffort = config.get("live.reasoningEffortResults");
  const requests = pubsWithPrompts.map((pub) =>
    openai.responses.create({
      model: model,
      reasoning: { effort: reasoningEffort },
      input: [
        {
          role: "developer",
          content: systemPromptSingle,
        },
        {
          role: "user",
          content: pub?.userPrompt,
        },
      ],
      text: {
        format: zodTextFormat(
          SinglePublicationOutput,
          "single_publication_format"
        ),
      },
    })
  );

  const responses = await Promise.all(requests);

  const parsed = responses.map((res, i) => {
    const success = res.output && res.output.length > 0;
    const gptRes = success ? JSON.parse(res.output_text) : null;

    return {
      ...pubsWithPrompts[i],
      gptRes,
      success,
      tokens: res?.usage?.total_tokens || 0,
    };
  });

  logGptResToFile({ responses, publications: pubsWithPrompts });

  return parsed;
};

/**
 * Detect results for multiple publications (batch processing)
 * @param {array} publications - Array of publication objects with abstract and registration nested
 * @returns {Promise<array>} Array of publications with gptRes, success, and tokens
 */
export const detectResults = async (publications) => {
  const pubsWithPrompts = publications.map((pub) => {
    return { ...pub, userPrompt: buildUserPromptFromPublication(pub) };
  });

  const pubsWithResults = await promptGptIndividually(pubsWithPrompts);

  return pubsWithResults;
};
