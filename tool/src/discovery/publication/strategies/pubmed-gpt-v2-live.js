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

const ENHANCED_V2_SEARCH_LIMIT_PER_QUERY = 5;

export const PubmedGptQueryOutputV2 = z.object({
  registration_nct_id: z.string().describe("The NCT ID of the registration"),
  keywords: z
    .array(z.string())
    .describe("The keywords used in the search, maximum of 4"),
  investigators: z
    .array(z.string())
    .describe("The investigators used in the search, maximum of 3"),
  search_strings: z
    .array(z.string())
    .describe("The search strings used in the search, maximum of 6"),
  extra_queries: z
    .array(z.string())
    .describe("Extra queries used in the search, maximum of 3"),
});

export const searchPubmedGptQueryV2 = async (registration, overrides = {}) => {
  log(`Attempting GPT query V2 generation for ${registration.trialId}`);
  const openai = new OpenAI();

  // Load V2 system prompt from config
  let systemPromptV2;
  try {
    systemPromptV2 = fs
      .readFileSync(config.get("live.systemPromptQueriesV2"))
      .toString();
  } catch (error) {
    log(`Failed to load V2 system prompt, falling back to V1`);
    throw error;
  }

  // Do not want GPT getting confused here
  const filteredRegistration = { ...registration };
  delete filteredRegistration.hasResults;
  delete filteredRegistration.publicationPmid;

  const maxTokens = config.get("live.maxTokensQueryV2") || 10000;
  const modelV2 = overrides.model || config.get("live.modelQueryV2");
  const reasoningEffort =
    overrides.reasoning || config.get("live.reasoningEffortQueryV2");
  const res = await openai.responses.parse({
    model: modelV2,
    max_output_tokens: maxTokens,
    reasoning: { effort: reasoningEffort },
    input: [
      {
        role: "developer",
        content: systemPromptV2,
      },
      {
        role: "user",
        content: JSON.stringify(filteredRegistration),
      },
    ],
    text: {
      format: zodTextFormat(
        PubmedGptQueryOutputV2,
        "pubmed_search_format_v2"
      ),
    },
  });

  log(`GPT V2 generated pubmed search string for ${registration?.trialId}`);
  const tokens = res?.usage?.total_tokens || 0;
  global.pubmedTokens += tokens;

  const searchStrings = res.output_parsed.search_strings || [];
  const extra_queries = res.output_parsed.extra_queries || [];

  const allSearchStrings = [...searchStrings, ...extra_queries];

  // For each search string, query pubmed and return the top results (with retries)
  const promises = allSearchStrings.map((searchString) => {
    const labelStr = String(searchString || "").slice(0, 50);
    return retryAsync(
      () =>
        rateLimitedPubmedCall(
          () =>
            ncbi.pubmed.search(
              searchString,
              undefined,
              ENHANCED_V2_SEARCH_LIMIT_PER_QUERY
            ),
          `V2 search: "${labelStr}..."`
        ),
      { retries: 3, minTimeout: 1000, label: `PubMed V2: ${labelStr}` }
    );
  });

  const pubmedRes = await Promise.all(promises);

  const papers = pubmedRes
    .map((res) => res?.papers || [])
    .flat()
    .filter(Boolean);

  return {
    results: papers.map((paper) => {
      return {
        pmid: paper.pmid + "",
        publicationDate: parsePubDate(paper.pubDate),
      };
    }),
  };
};

export const searchPubmedGptQueryV2Cached = async (
  registration,
  overrides = {}
) => {
  if (overrides.model || overrides.reasoning) {
    return await searchPubmedGptQueryV2(registration, overrides);
  }
  return await cacheResultToFile(
    () => searchPubmedGptQueryV2(registration),
    `gpt-pubmed-v2-${registration?.trialId}`,
    "gpt_queries_v2"
  );
};
