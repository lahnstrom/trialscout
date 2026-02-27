import { retryAsync, rateLimitedPubmedCall } from "../../../utils/utils.js";
import { cacheResultToFile } from "../../../utils/cache.js";
import fs from "fs";
import ncbi from "node-ncbi";
import { parsePubDate } from "./utils.js";

const ENHANCED_SEARCH_LIMIT = 5;

export const searchPubmedGptQueryBatch = async (registration) => {
  console.log("Retrieving batch job gpt query (V1)");
  // Retrieve result of batch job in some way
  const raw = fs
    .readFileSync(`./batch_results/queries/${registration?.trialId}.json`)
    .toString();

  const res = JSON.parse(raw);

  const searchString = res?.search_string;
  const pubmedRes = await retryAsync(
    () =>
      rateLimitedPubmedCall(
        () =>
          ncbi.pubmed.search(searchString, undefined, ENHANCED_SEARCH_LIMIT),
        `batch V1 search: ${registration.trialId}`
      ),
    { retries: 3, minTimeout: 1000, label: `PubMed batch V1 search` }
  );

  const papers = pubmedRes?.papers || [];
  console.log("Received papers from batch job query (V1):", papers.length);

  return {
    results: papers.map((paper) => {
      return {
        pmid: paper.pmid + "",
        publicationDate: parsePubDate(paper.pubDate),
      };
    }),
  };
};

export const searchPubmedGptQueryBatchCached = async (registration) => {
  return await cacheResultToFile(
    () => searchPubmedGptQueryBatch(registration),
    `gpt-pubmed-batch-${registration?.trialId}`,
    "batch_queries_v1"
  );
};
