import { log, retryAsync, rateLimitedPubmedCall } from "../../../utils/utils.js";
import { cacheResultToFile } from "../../../utils/cache.js";
import fs from "fs";
import ncbi from "node-ncbi";
import { parsePubDate } from "./utils.js";

const ENHANCED_V2_SEARCH_LIMIT_PER_QUERY = 5;

export const searchPubmedGptQueryBatchV2 = async (registration) => {
  log(`Retrieving batch job gpt query V2 for ${registration.trialId}`);
  // Retrieve result of batch job from V2 directory
  const raw = fs
    .readFileSync(`./batch_results/queries_v2/${registration?.trialId}.json`)
    .toString();

  const res = JSON.parse(raw);

  const searchStrings = res?.search_strings || [];
  const extra_queries = res?.extra_queries || [];
  const allSearchStrings = [...searchStrings, ...extra_queries];

  log(
    `Batch V2 has ${allSearchStrings.length} search strings for ${registration.trialId}`
  );

  // For each search string, query pubmed and return the top results
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
          `batch V2 search: "${labelStr}..."`
        ),
      { retries: 3, minTimeout: 1000, label: `PubMed batch V2: ${labelStr}` }
    );
  });

  const pubmedRes = await Promise.all(promises);

  const papers = pubmedRes
    .map((res) => res?.papers || [])
    .flat()
    .filter(Boolean);

  log(`Received ${papers.length} papers from batch job query V2`);

  return {
    results: papers.map((paper) => {
      return {
        pmid: paper.pmid + "",
        publicationDate: parsePubDate(paper.pubDate),
      };
    }),
  };
};

export const searchPubmedGptQueryBatchV2Cached = async (registration) => {
  return await cacheResultToFile(
    () => searchPubmedGptQueryBatchV2(registration),
    `gpt-pubmed-batch-v2-${registration?.trialId}`,
    "batch_queries_v2"
  );
};
