import {
  log,
  retryAsync,
  rateLimitedPubmedCall,
} from "../../../utils/utils.js";
import { cacheResultToFile } from "../../../utils/cache.js";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import OpenAI from "openai";
import fs from "fs";
import config from "config";
import ncbi from "node-ncbi";
import { parsePubDate } from "./utils.js";

const ENHANCED_SEARCH_LIMIT = 5;

export const PubmedGptQueryOutput = z.object({
  search_string: z
    .string()
    .describe(
      "Your generated search string. This is the string that we will use to search for publications in PubMed relating to the trial registration."
    ),
});

const systemPromptPubmedSearchGeneration = fs
  .readFileSync(config.get("live.systemPromptQueriesV1"))
  .toString();

export const searchPubmedGptQuery = async (registration, overrides = {}) => {
  log(`Attempting GPT query generation for ${registration.trialId}`);
  const openai = new OpenAI();

  // Do not want GPT getting confused here
  const filteredRegistration = { ...registration };
  delete filteredRegistration.hasResults;
  delete filteredRegistration.publicationPmid;

  const modelV1 = overrides.model || config.get("live.modelQueryV1");
  const reasoningEffort =
    overrides.reasoning || config.get("live.reasoningEffortQueryV1");
  const res = await openai.responses.parse({
    model: modelV1,
    reasoning: { effort: reasoningEffort },
    input: [
      {
        role: "developer",
        content: systemPromptPubmedSearchGeneration,
      },
      {
        role: "user",
        content: JSON.stringify(filteredRegistration),
      },
    ],
    text: {
      format: zodTextFormat(PubmedGptQueryOutput, "pubmed_search_format"),
    },
  });

  log(
    `GPT generated pubmed search string for ${registration?.trialId}`
  );

  const tokens = res?.usage?.total_tokens || 0;
  global.pubmedTokens += tokens;

  const searchString = res.output_parsed.search_string;
  const pubmedRes = await retryAsync(
    () =>
      rateLimitedPubmedCall(
        () =>
          ncbi.pubmed.search(searchString, undefined, ENHANCED_SEARCH_LIMIT),
        `GPT-enhanced search: ${registration.trialId}`
      ),
    { retries: 3, minTimeout: 1000, label: `PubMed enhanced search` }
  );
  const papers = pubmedRes?.papers || [];

  return {
    results: papers.map((paper) => {
      return {
        pmid: paper.pmid + "",
        publicationDate: parsePubDate(paper.pubDate),
      };
    }),
  };
};

export const searchPubmedGptQueryCached = async (
  registration,
  overrides = {}
) => {
  if (overrides.model || overrides.reasoning) {
    return await searchPubmedGptQuery(registration, overrides);
  }
  return await cacheResultToFile(
    () => searchPubmedGptQuery(registration),
    `gpt-pubmed-${registration?.trialId}`,
    "gpt_queries"
  );
};
