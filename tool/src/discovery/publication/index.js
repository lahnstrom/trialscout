import {
  fetchRegistrationLiveCache,
  writePublicationsLiveCache,
} from "../../utils/server_utils.js";
import { removeDuplicatePublications } from "../../utils/utils.js";
import { fetchPubmedRefs } from "../../utils/pubmed_utils.js";
import config from "config";

// Import constants and schemas for re-export
import { PUB_SOURCE } from "./strategies/constants.js";

// Import all strategies
import {
  searchLinkedAtRegistration,
  searchLinkedAtRegistrationCached,
} from "./strategies/linked-at-registration.js";

import {
  searchPubmedNaive,
  searchPubmedNaiveCached,
} from "./strategies/pubmed-naive.js";

import {
  searchGoogleScholar,
  searchGoogleScholarCached,
} from "./strategies/google-scholar.js";

import {
  PubmedGptQueryOutput,
  searchPubmedGptQuery,
  searchPubmedGptQueryCached,
} from "./strategies/pubmed-gpt-v1-live.js";

import {
  PubmedGptQueryOutputV2,
  searchPubmedGptQueryV2,
  searchPubmedGptQueryV2Cached,
} from "./strategies/pubmed-gpt-v2-live.js";

import {
  searchPubmedGptQueryBatch,
  searchPubmedGptQueryBatchCached,
} from "./strategies/pubmed-gpt-v1-batch.js";

import {
  searchPubmedGptQueryBatchV2,
  searchPubmedGptQueryBatchV2Cached,
} from "./strategies/pubmed-gpt-v2-batch.js";

// Re-export schemas and constants for backward compatibility
export { PUB_SOURCE, PubmedGptQueryOutput, PubmedGptQueryOutputV2 };

// Strategy registry - maps PUB_SOURCE constants to strategy functions
const SEARCH_FUNCTIONS = {
  [PUB_SOURCE.LINKED_AT_REGISTRATION]: searchLinkedAtRegistration,
  [PUB_SOURCE.LINKED_AT_REGISTRATION_CACHED]: searchLinkedAtRegistrationCached,
  [PUB_SOURCE.PUBMED_NAIVE]: searchPubmedNaive,
  [PUB_SOURCE.PUBMED_NAIVE_CACHED]: searchPubmedNaiveCached,
  [PUB_SOURCE.GOOGLE_SCHOLAR]: searchGoogleScholar,
  [PUB_SOURCE.GOOGLE_SCHOLAR_CACHED]: searchGoogleScholarCached,
  [PUB_SOURCE.PUBMED_GPT_V1_LIVE]: searchPubmedGptQuery,
  [PUB_SOURCE.PUBMED_GPT_V1_LIVE_CACHED]: searchPubmedGptQueryCached,
  [PUB_SOURCE.PUBMED_GPT_V1_BATCH]: searchPubmedGptQueryBatch,
  [PUB_SOURCE.PUBMED_GPT_V1_BATCH_CACHED]: searchPubmedGptQueryBatchCached,
  [PUB_SOURCE.PUBMED_GPT_V2_LIVE]: searchPubmedGptQueryV2,
  [PUB_SOURCE.PUBMED_GPT_V2_LIVE_CACHED]: searchPubmedGptQueryV2Cached,
  [PUB_SOURCE.PUBMED_GPT_V2_BATCH]: searchPubmedGptQueryBatchV2,
  [PUB_SOURCE.PUBMED_GPT_V2_BATCH_CACHED]: searchPubmedGptQueryBatchV2Cached,
};

/**
 * Main function to discover publications for a clinical trial registration
 * @param {Object} registration - Trial registration data
 * @param {Array<string>} strategies - Array of strategy names to use
 * @returns {Promise<{discoveredPublications: Array, errors: Array}>}
 */
export const discoverPublications = async (
  registration,
  strategies = [],
  overrides = {}
) => {
  // Validate and map strategy names to functions, keeping track of strategy name
  const searchFunctionsWithNames = strategies.map((strategyName) => {
    if (!SEARCH_FUNCTIONS[strategyName]) {
      throw new Error(
        `Unknown strategy: "${strategyName}". Valid strategies: ${Object.keys(
          SEARCH_FUNCTIONS
        ).join(", ")}`
      );
    }
    return { fn: SEARCH_FUNCTIONS[strategyName], strategyName };
  });

  // Wrap functions with error handling and source tagging
  const searchFunctionsWithWrappers = searchFunctionsWithNames.map(
    ({ fn, strategyName }) => {
      return async (registration) => {
        try {
          const { results, error } = await fn(registration, overrides);
          // Add source tags to each result
          const resultsWithSource = results.map((pub) => ({
            ...pub,
            sources: [strategyName],
          }));
          return { results: resultsWithSource, fn: fn.name, error };
        } catch (error) {
          console.error(`Error in ${fn.name}:`, error);
          return { results: [], fn: fn.name, error: error.message };
        }
      };
    }
  );

  const searchResults = await Promise.all(
    searchFunctionsWithWrappers.map((fn) => fn(registration))
  );

  const discoveredPublications = searchResults.map((s) => s.results).flat();
  const errors = searchResults.filter((s) => s.error).flat();

  return { discoveredPublications, errors };
};

const addBackSource = (pubs, pubsWithSource) => {
  return pubs.map((pub) => {
    const sourcesPmid = pubsWithSource
      .filter((p) => p.pmid === pub.pmid)
      .map((p) => p.sources)
      .flat();

    const sourcesDoi = pubsWithSource
      .filter((p) => p.doi === pub.doi)
      .map((p) => p.sources)
      .flat();

    const sources = [...new Set([...sourcesPmid, ...sourcesDoi])];

    return { ...pub, sources };
  });
};

/**
 * Main publication discovery function with caching and post-processing
 * @param {string} trialId - Trial ID
 * @param {Array<string>} strategies - Optional array of strategy names (defaults to config.live.strategies)
 * @returns {Promise<[Array, Array]>} Tuple of [publications, errors]
 */
export async function publicationDiscovery(
  trialId,
  strategies,
  overrides = {}
) {
  const registration = fetchRegistrationLiveCache(trialId);

  // Use provided strategies or default to live config
  const effectiveStrategies = strategies || config.get("live.strategies");

  const { discoveredPublications, errors } = await discoverPublications(
    registration,
    effectiveStrategies,
    overrides
  );

  const uniquePublications = removeDuplicatePublications(
    discoveredPublications
  );

  // Extract the pmids
  const discoveredPmids = uniquePublications
    .map((pub) => pub.pmid)
    .filter(Boolean);

  // Fetch the abstracts from PubMed
  const pubsWithAbstracts = await fetchPubmedRefs(discoveredPmids);

  const pubsWithSource = addBackSource(
    pubsWithAbstracts,
    discoveredPublications
  );

  writePublicationsLiveCache(pubsWithSource);

  return [pubsWithSource, errors];
}
