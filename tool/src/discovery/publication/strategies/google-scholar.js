import {
  log,
  retryAsync,
  rateLimitedPubmedCall,
} from "../../../utils/utils.js";
import { cacheResultToFile } from "../../../utils/cache.js";
import { citationMatch } from "../../../utils/pubmed_utils.js";
import axios from "axios";
import ncbi from "node-ncbi";
import Fuse from "fuse.js";

const SERPER_API_KEY = process.env.SERPER_API_KEY;

const fuseOptions = {
  keys: ["title"],
};

const serperSearch = async (trialId) => {
  const config = {
    method: "post",
    maxBodyLength: Infinity,
    url: "https://google.serper.dev/scholar",
    timeout: 10000,
    headers: {
      "X-API-KEY": SERPER_API_KEY,
      "Content-Type": "application/json",
    },

    data: JSON.stringify({
      q: trialId,
      autocorrect: false,
    }),
  };
  const response = await axios.request(config);
  return response.data;
};

const parseSerperTitle = (response) => {
  return response?.organic?.map((item) => item.title)?.filter(Boolean) || [];
};

/**
 * Find publication by title using multiple methods
 * @param {string} title - Publication title
 */
const findWithTitle = async (title) => {
  try {
    console.log("Searching for article with title ", title);

    const citationPmids = await rateLimitedPubmedCall(
      () => citationMatch(title),
      `citationMatch: "${title.slice(0, 40)}..."`
    );
    if (citationPmids && citationPmids.length > 0) {
      console.log("Found article in citation match with title ", title);
      return citationPmids.map((pmid) => {
        return {
          pmid: pmid + "",
        };
      });
    }

    const searchHits = await retryAsync(
      () =>
        rateLimitedPubmedCall(
          () => ncbi.pubmed.search(title, undefined, 100),
          `title search: "${title.slice(0, 40)}..."`
        ),
      { retries: 3, minTimeout: 1000, label: `PubMed title search` }
    );
    if (searchHits?.papers && searchHits?.papers.length > 0) {
      const papers = searchHits.papers;

      // Fuzzy search of pubmed results
      const fuse = new Fuse(papers, fuseOptions);
      const results = fuse.search(title);
      const bestMatch = results[0]?.item;

      console.log("Found article in pubmed with title ", title);
      if (bestMatch) {
        return [
          {
            pmid: bestMatch.pmid + "",
          },
        ];
      }
    }
    console.log("No article found with title ", title);
    return null;
  } catch (error) {
    console.error(`Failed to search for article with title ${title}:`);
    console.error(error);
    return null;
  }
};

export const searchGoogleScholar = async (registration) => {
  try {
    log(`Attempting google scholar search for ${registration.trialId}`);

    const response = await cacheResultToFile(
      () => serperSearch(registration.trialId),
      `serper-${registration?.trialId}`,
      "google_scholar"
    );

    const titles = parseSerperTitle(response);

    if (titles.length === 0) {
      return { results: [] };
    }

    const promises = titles.map((title) => findWithTitle(title));

    const pubs = await Promise.all(promises);

    const results = pubs.filter(Boolean).flat();

    return {
      results: results,
    };
  } catch (error) {
    console.error(error);
    console.error(`Failed to search Google Scholar: ${error}`);
    return { results: [] };
  }
};

export const searchGoogleScholarCached = async (registration) => {
  return await cacheResultToFile(
    () => searchGoogleScholar(registration),
    `google-scholar-no-scrape-${registration?.trialId}`,
    "google_scholar"
  );
};
