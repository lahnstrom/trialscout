import {
  log,
  retryAsync,
  rateLimitedPubmedCall,
} from "../../../utils/utils.js";
import { cacheResultToFile } from "../../../utils/cache.js";
import { DateTime } from "luxon";
import ncbi from "node-ncbi";
import { parsePubDate } from "./utils.js";

const NAIVE_SEARCH_LIMIT = 5;

export const searchPubmedNaive = async (registration) => {
  if (!registration) {
    throw new Error(`searchPubmedNaive failed, null registration`);
  }

  log(`Attempting naive search of pubmed for ${registration.trialId}`);

  const formattedStartDate = DateTime.fromISO(registration.startDate).toFormat(
    "yyyy/MM/dd"
  );

  const query = `(
    ${
      registration.investigatorFullName
        ? `(${registration.investigatorFullName}[au]) OR `
        : ""
    }
    (${registration.trialId}[tiab]) ) OR
    (${registration.briefTitle}[tiab]) OR
    (${registration.trialId}[si]})
    )
    AND
    ("${
      formattedStartDate || "1970"
    }"[Date - Publication] : "3000"[Date - Publication])`;

  // Remove extra spaces
  const cleanedQuery = query.replace(/\s+/g, " ");
  const pubmedRes = await retryAsync(
    () =>
      rateLimitedPubmedCall(
        () => ncbi.pubmed.search(cleanedQuery, undefined, NAIVE_SEARCH_LIMIT),
        `naive search: ${registration.trialId}`
      ),
    { retries: 3, minTimeout: 1000, label: `PubMed naive search` }
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

export const searchPubmedNaiveCached = async (registration) => {
  return await cacheResultToFile(
    () => searchPubmedNaive(registration),
    `pubmed-naive-${registration?.trialId}`,
    "pubmed_naive"
  );
};
