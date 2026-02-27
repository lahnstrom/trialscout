import commandLineArgs from "command-line-args";
import pRetry, { AbortError } from "p-retry";
import seedrandom from "seedrandom";
import axios from "axios";
import fs from "fs";
import config from "config";
import _ from "lodash";
import path from "path";
import { fileURLToPath } from "url";
import PQueue from "p-queue";

const optionDefinitions = [
  { name: "nct", alias: "n", type: String },
  { name: "real", alias: "r", type: Boolean, default: false },
  { name: "silent", alias: "s", type: Boolean, default: false },
];

const options = commandLineArgs(optionDefinitions, { partial: true });

export const log = (msg) => {
  if (!options.silent) {
    console.log(msg);
  }
};

export const roundNumber = (num) => {
  return +(Math.round(num + "e+4") + "e-4");
};

/**
 * Retry an async function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Options
 * @param {number} options.retries - Number of retries (default: 3)
 * @param {number} options.minTimeout - Initial delay in ms (default: 1000)
 * @param {string} options.label - Label for logging (default: "operation")
 * @returns {Promise} - Result of the function or throws after all retries
 */
export const retryAsync = async (fn, options = {}) => {
  const { retries = 3, minTimeout = 1000, label = "operation" } = options;
  return pRetry(fn, {
    retries,
    minTimeout,
    onFailedAttempt: (error) => {
      log(
        `[RETRY ${label}] Attempt ${error.attemptNumber} failed: ${error.message}. ${error.retriesLeft} retries left.`
      );
    },
  });
};

// Rate limiting for PubMed API using p-queue
// Handles both concurrency limiting and rate limiting automatically
const pubmedQueue = new PQueue({
  concurrency: 4, // Max 4 concurrent requests
  intervalCap: 8, // Max 8 requests per second (safe margin under 10 rps)
  interval: 1000, // Per 1 second window
  timeout: 30000, // 30 second timeout per request
});

let pubmedQueueCounter = 0;

const timestamp = () => new Date().toISOString();

/**
 * Rate-limited wrapper for any PubMed API call
 * Uses p-queue to manage both concurrency and rate limits
 * @param {Function} fn - Async function to execute
 * @param {string} label - Optional label for logging
 * @returns {Promise} - Result of the function
 */
export const rateLimitedPubmedCall = async (fn, label = "PubMed call") => {
  const callId = ++pubmedQueueCounter;
  console.log(`[${timestamp()}] [PUBMED-QUEUE] #${callId} Enqueued: ${label}`);

  return pubmedQueue.add(async () => {
    console.log(
      `[${timestamp()}] [PUBMED-QUEUE] #${callId} Starting: ${label}`
    );

    try {
      const result = await fn();
      console.log(
        `[${timestamp()}] [PUBMED-QUEUE] #${callId} Finished: ${label}`
      );
      return result;
    } catch (error) {
      const errorMessage = `[${timestamp()}] [PUBMED-QUEUE] #${callId} Failed: ${label} - ${
        error.message
      }`;
      console.log(errorMessage);
      throw new Error(errorMessage);
    }
  });
};

export const logTimeAndCost = ({ t1, t2, tokens, nCases }) => {
  const elapsedSeconds = t2 - t1;

  log(
    `Trials queried = ${nCases}. Time elapsed: ${roundNumber(
      elapsedSeconds / 60
    )} minutes. Time per request = ${
      elapsedSeconds / nCases
    } seconds. Total tokens used = ${tokens}. Total cost on GPT 4o mini: ${roundNumber(
      (tokens / 1000000) * 0.15
    )}$`
  );
};

export const removeDuplicatePublications = (publications) => {
  // Remove duplicates based on pmid
  const uniquePubSet = publications.reduce((prev, cur) => {
    const curPmid = cur?.pmid;
    if (!curPmid) {
      throw new Error(`No pmid found in publication ${JSON.stringify(cur)}`);
    }
    if (prev[curPmid]) {
      prev[curPmid].sources = [
        ...new Set([...cur?.sources, ...prev[curPmid]?.sources]),
      ];
      return prev;
    }
    prev[curPmid] = _.cloneDeep(cur);
    return prev;
  }, {});
  return Object.values(uniquePubSet);
};

export const processFinalOutput = (output) => {
  const finalOutput = output.map(
    ({ trial, registration, results, error, truncated }) => {
      if (!results) {
        results = [];
      }
      const totalTokens = results.reduce(
        (acc, res) => acc + (res?.tokens || 0),
        0
      );
      const toolResults = results.some((res) => res?.gptRes?.hasResults);
      const hasError = !!error;
      const toolPromptedPmids = results.map((res) => res?.pmid).join(",");

      // Determine the unique identification steps from the tool results
      const toolIdentStepsSet = new Set();
      results?.forEach((res) => {
        if (res?.gptRes?.hasResults) {
          res.sources.forEach((source) => {
            toolIdentStepsSet.add(source);
          });
        }
      });

      const toolIdentSteps = [...toolIdentStepsSet].join(",");
      const toolResultPmids = results
        .filter((res) => res?.gptRes?.hasResults)
        .map((res) => res.pmid)
        .join(",");
      const toolSuccess = results.every((res) => res.success);

      return {
        nct_id: registration.nctId,
        tool_tokens: totalTokens,
        tool_results: toolResults,
        has_error: hasError,
        tool_prompted_pmids: toolPromptedPmids,
        tool_result_pmids: toolResultPmids,
        tool_success: toolSuccess,
        tool_ident_steps: toolIdentSteps,
        tool_truncated: truncated,
      };
    }
  );

  return finalOutput;
};

/**
 * Filters a list of publications to only include those published before a given date
 * @param {Array<Object>} publications - Array of publication objects with publicationDate property
 * @param {string|Date} maxDate - The cutoff date to filter against
 * @returns {Object} Object with eligible and filtered arrays: { eligible: [], filtered: [] }
 * @throws {Error} If dates are invalid or publications array is not properly formatted
 */
export const maxDateFilter = (publications, maxDate) => {
  // Input validation
  if (!Array.isArray(publications)) {
    throw new Error("Publications must be an array");
  }

  if (!maxDate) {
    throw new Error("Max date is required");
  }

  // Convert trial date to Date object if it's a string
  const cutoffDate = maxDate instanceof Date ? maxDate : new Date(maxDate);

  // Validate trial date
  if (isNaN(cutoffDate.getTime())) {
    throw new Error("Invalid trial date format");
  }

  const eligible = [];
  const filtered = [];

  for (const publication of publications) {
    // Keep publications without dates in eligible (we can't filter them)
    if (!publication || !publication.publicationDate) {
      eligible.push(publication);
      continue;
    }

    // Convert publication date to Date object if it's a string
    const pubDate =
      publication.publicationDate instanceof Date
        ? publication.publicationDate
        : new Date(publication.publicationDate);

    // Skip publications with invalid dates
    if (isNaN(pubDate.getTime())) {
      continue;
    }

    if (pubDate < cutoffDate) {
      eligible.push(publication);
    } else {
      filtered.push(publication);
    }
  }

  return { eligible, filtered };
};

/**
 * Filters a list of publications to only include those published on or after a given date
 * @param {Array<Object>} publications - Array of publication objects with publicationDate property
 * @param {string|Date} minDate - The cutoff date to filter against
 * @returns {Object} Object with eligible and filtered arrays: { eligible: [], filtered: [] }
 * @throws {Error} If dates are invalid or publications array is not properly formatted
 */
export const minDateFilter = (publications, minDate) => {
  // Input validation
  if (!Array.isArray(publications)) {
    throw new Error("Publications must be an array");
  }

  if (!minDate) {
    throw new Error("Min date is required");
  }

  // Convert trial date to Date object if it's a string
  const cutoffDate = minDate instanceof Date ? minDate : new Date(minDate);

  // Validate trial date
  if (isNaN(cutoffDate.getTime())) {
    throw new Error("Invalid trial date format");
  }

  const eligible = [];
  const filtered = [];

  for (const publication of publications) {
    // Keep publications without dates in eligible (we can't filter them)
    if (!publication || !publication.publicationDate) {
      eligible.push(publication);
      continue;
    }

    // Convert publication date to Date object if it's a string
    const pubDate =
      publication.publicationDate instanceof Date
        ? publication.publicationDate
        : new Date(publication.publicationDate);

    // Skip publications with invalid dates
    if (isNaN(pubDate.getTime())) {
      continue;
    }

    if (pubDate >= cutoffDate) {
      eligible.push(publication);
    } else {
      filtered.push(publication);
    }
  }

  return { eligible, filtered };
};
