import convert from "xml-js";
import { log, retryAsync, rateLimitedPubmedCall } from "./utils.js";
import ncbi from "node-ncbi";

const PUBMED_API_KEY = process.env.PUBMED_API_KEY;

export const regIsAfterPublication = (reg, publ) => {
  // TODO: Implement
  return reg.publicationDate < publ.publicationDate;
};

export const abstractListToString = (abstractList) =>
  abstractList
    ?.map((abs) => {
      // For each part of the abstract list:
      if (abs?.name === "AbstractText") {
        const labelText = abs?.attributes?.Label
          ? abs?.attributes?.Label + ":\r\n"
          : "";
        const abstractText = abs?.elements?.reduce((prev, cur) => {
          if (cur?.type === "text") {
            return prev + cur?.text;
          }
          return prev;
        }, "");
        // Return the text elements it contains
        return labelText + abstractText;
      }
      // Else return empty string
      return "";
    })
    ?.join("");

export const authorListToString = (authorList) => {
  if (!authorList) {
    return null;
  }

  if (!Array.isArray(authorList)) {
    authorList = [authorList];
  }

  return authorList
    ?.map((author) => {
      // For each part of the abstract list:
      const firstName = author?.ForeName?._text;
      const lastName = author?.LastName?._text;

      if (firstName && lastName) {
        return `${firstName} ${lastName}`;
      }

      if (firstName && !lastName) {
        return firstName;
      }

      if (lastName) {
        return lastName;
      }

      return false;
    })
    ?.filter(Boolean)
    ?.join(", ");
};

export const parsePubmedAbstractXML = (xml) => {
  // TODO: NOW FAILS SILENTLY, MUST BE FIXED
  const articleSet = childWithName(xml, "PubmedArticleSet");
  if (!articleSet) {
    throw new Error(
      `No article set found in pubmed request ${JSON.stringify(xml)}`
    );
  }
  const pubs = articleSet?.elements?.map((pub) => {
    const medlineCitation = childWithName(pub, "MedlineCitation");
    const pubmedData = childWithName(pub, "PubmedData");
    const pmid = childWithName(medlineCitation, "PMID")?.elements?.[0]?.text;
    const article = childWithName(medlineCitation, "Article");
    const abstractList = childWithName(article, "Abstract")?.elements;
    const text = abstractListToString(abstractList);
    const authorList = childWithName(article, "AuthorList")?.elements;
    const authors = authorListToString(authorList);
    const title = childWithName(article, "ArticleTitle")?.elements[0]?.text;

    return {
      pmid,
      text,
      title,
      authors,
    };
  });

  return pubs || [];
};

export const fetchPubmedRefs = async (pmids) => {
  if (!pmids.length) {
    log(`No PMIDs to fetch abstracts for.`);
    return [];
  }
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${pmids.join(
    ","
  )}&api_key=${PUBMED_API_KEY}`;

  log(`Fetching pubmed refs at url: ${url}.`);

  // Wrap fetch + XML parse in retry logic with rate limiting
  const data = await retryAsync(
    () =>
      rateLimitedPubmedCall(async () => {
        const req = await fetch(url);
        const raw = await req.text();
        const parsed = convert.xml2js(raw, { compact: true });
        const error = xmlHasError(parsed);
        if (error) {
          throw new Error(`Pubmed fetch returned error response`);
        }
        return parsed;
      }, `fetchPubmedRefs (${pmids.length} PMIDs)`),
    { retries: 3, minTimeout: 1000, label: `PubMed refs fetch` }
  );

  let articles = data?.PubmedArticleSet?.PubmedArticle || [];

  if (!Array.isArray(articles)) {
    articles = [articles];
  }

  const refs = articles?.map((article) => parsePubmedRecord(article, false));

  return refs;
};

export const citationMatch = async (title) => {
  const url = `https://pubmed.ncbi.nlm.nih.gov/api/citmatch/`;
  // const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${searchString}&field=title&api_key=${PUBMED_API_KEY}`;
  const req = await fetch(url, {
    method: "POST",
    body: JSON.stringify({
      citmatch: {
        method: "heuristic",
        "raw-text": {
          text: title,
        },
      },
    }),
    headers: {
      "User-Agent": "ResultsDetector/0.1.0",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });
  const raw = await req.json();
  if (!raw?.success) {
    console.log("Failed to fetch citation match for ", title);
    return [];
  }
  const uids = raw?.result?.uids || [];
  const pmids = uids.map((uid) => uid?.pubmed);

  return pmids;
};

export const convertDoiToPmid = async (doi) => {
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${doi}[DOI]&retmode=json&api_key=${PUBMED_API_KEY}`;
  const res = await fetch(url, {
    method: "GET",
    accept: "application/json",
  });
  const resJson = await res.json();

  const pmid = resJson?.esearchresult?.idlist?.[0] || null;

  return pmid;
};

const extractMetadata = (data) => {
  let pubs = data?.PubmedArticleSet?.PubmedArticle;
  if (!pubs) {
    throw new Error(`No PubmedArticleSet found in ${JSON.stringify(data)}`);
  }

  // Dirty but works, pubs is sometimes just a single pub
  if (!Array.isArray(pubs)) {
    pubs = [pubs];
  }

  return pubs.map((pub) => {
    const medlineCitation = pub?.MedlineCitation;
    const pmid = medlineCitation?.PMID?._text;
    let dateHistory = pub?.PubmedData?.History?.PubMedPubDate || [];

    const dateCompleted = medlineCitation?.DateCompleted;
    const dateRevised = medlineCitation?.DateRevised;

    if (!Array.isArray(dateHistory)) {
      dateHistory = [dateHistory];
    }

    const acceptedDate = dateHistory?.find(
      (date) => date?._attributes?.PubStatus === "accepted"
    );

    const date = acceptedDate || dateCompleted || dateRevised;

    const year = date?.Year?._text;
    const month = date?.Month?._text;
    const day = date?.Day?._text;

    const publicationDate = `${year ? year : ""}${month ? `-${month}` : ""}${
      day && month ? `-${day}` : ""
    }`;

    return {
      pmidFromMetadata: pmid,
      publicationDate,
    };
  });
};

export const convertDoisToPmids = async (dois) => {
  const url = `https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/?tool=results-detector&email=love.ahnstrom%40ki.se&ids=${dois?.join(
    ","
  )}&idtype=doi&format=json`;
  const req = await fetch(url);
  const data = await req.json();
  if (data?.status !== "ok") {
    throw new Error(
      `'Failed to convert DOIs to PMIDs', status: ${data?.status}`
    );
  }
  const records = data?.records;

  const result = records?.map((record) => {
    return {
      doi: record?.doi,
      pmid: record?.pmid,
    };
  });
  return result;
};

export const convertDoisToPmidsSearch = async (dois) => {
  const searchString = dois.map((doi) => `${doi}[doi]`).join(" OR ");

  const pubmedRes = await retryAsync(
    () =>
      rateLimitedPubmedCall(
        () => ncbi.pubmed.search(searchString),
        `DOI-to-PMID search (${dois.length} DOIs)`
      ),
    { retries: 3, minTimeout: 1000, label: `PubMed DOI search` }
  );
  const result = pubmedRes?.papers?.map((paper) => {
    return {
      pmid: paper.pmid + "",
      doi: paper.doi,
    };
  });

  return result || [];
};

const childWithName = (parent, str) => {
  return parent?.elements?.find((child) => child?.name == str);
};

export const xmlHasError = (xml) => {
  const fetchResult = childWithName(xml, "eFetchResult");
  const error = childWithName(fetchResult, "ERROR");
  return !!error;
};

export const mergePubsAbstracts = (publications, abstracts, refs) => {
  if (!publications || !abstracts) {
    throw new Error(
      `mergePubsAbstracts attempted to merge ${publications} with ${abstracts}. Missing value.`
    );
  }
  if (publications.length !== abstracts.length) {
    throw new Error(
      `mergePubsAbstracts attempted to merge publications with length ${publications.length} with abstracts with length ${abstracts.length}. Length mismatch.`
    );
  }
  if (!refs) {
    throw new Error(
      `mergePubsAbstracts attempted to merge publications with abstracts but missing pubmed refs.`
    );
  }

  return publications.map((pub, i) => {
    const abstract = abstracts[i];
    const ref = refs.find((ref) => ref.pmidFromMetadata === pub.pmid);
    return { ...pub, ...ref, abstract };
  });
};

export const authorListToStringShort = (authorList) =>
  authorList
    ?.map((author) => {
      // For each part of the abstract list:
      if (author?.name === "Author") {
        const firstNameRaw = childWithName(author, "ForeName");
        const lastNameRaw = childWithName(author, "LastName");
        const firstName = firstNameRaw?.elements?.[0]?.text;
        const lastName = lastNameRaw?.elements?.[0]?.text;
        if (firstName && lastName) {
          return `${firstName} ${lastName}`;
        }
        if (firstName && !lastName) {
          return firstName;
        }
        if (lastName) {
          return lastName;
        }
        return "Unknown";
      }

      return "Unknown";
    })
    ?.join(", ");

const parseAbstract = (abstractText) => {
  if (!abstractText) {
    return null;
  }

  // Format 3: AbstractText._text is an array (may have interleaved i elements)
  if (!Array.isArray(abstractText) && Array.isArray(abstractText._text)) {
    const textArray = abstractText._text;
    const iArray = abstractText.i;

    if (iArray && Array.isArray(iArray)) {
      // Interleave text fragments with i elements
      return textArray
        .map((text, index) => {
          if (index < iArray.length && iArray[index]?._text) {
            return text + iArray[index]._text;
          }
          return text;
        })
        .join("");
    } else {
      // No i array, just join the text array
      return textArray.join("");
    }
  }
  // Format 1: AbstractText._text is a single string
  else if (!Array.isArray(abstractText)) {
    return abstractText?._text;
  }
  // Format 2: AbstractText is an array of objects (may have optional labels)
  else if (Array.isArray(abstractText)) {
    return abstractText
      .map((abs) => {
        const label = abs?._attributes?.Label;
        const text = abs?._text;

        if (label && text) {
          return `${label}:\r\n${text}`;
        }
        return text || "";
      })
      .join("");
  }

  return null;
};

export const parsePubmedRecord = (raw, includeRaw = true) => {
  const medlineCitation = raw?.MedlineCitation;
  const pubmedData = raw?.PubmedData;

  let articleIds = pubmedData?.ArticleIdList?.ArticleId;

  if (!articleIds) {
    articleIds = [];
  } else if (!Array.isArray(articleIds)) {
    articleIds = [articleIds];
  }

  // Extract DOI
  const doi =
    articleIds.find((id) => id._attributes?.IdType === "doi")?._text || null;

  // Extract PMID
  const pmid =
    articleIds.find((id) => id._attributes?.IdType === "pubmed")?._text ||
    medlineCitation?.PMID?._text ||
    null;

  // Extract Abstract
  const abstract = parseAbstract(
    medlineCitation?.Article?.Abstract?.AbstractText
  );

  if (!abstract) {
    console.warn(`Failed to parse abstract for publication with pmid ${pmid}`);
  }

  // Extract publicationDate
  const dateCompleted = medlineCitation?.DateCompleted;
  const dateRevised = medlineCitation?.DateRevised;

  let dateHistory = pubmedData?.History?.PubMedPubDate || [];

  if (!Array.isArray(dateHistory)) {
    dateHistory = [dateHistory];
  }

  const acceptedDate = dateHistory?.find(
    (date) => date?._attributes?.PubStatus === "accepted"
  );

  const date = acceptedDate || dateCompleted || dateRevised;

  if (pmid == "36009946") {
    console.log("Break here");
  }

  const year = date?.Year?._text;
  const month = date?.Month?._text;
  const day = date?.Day?._text;

  const publicationDate = `${year ? year : ""}${
    month ? `-${month?.length > 1 ? month : "0" + month}` : ""
  }${day && month ? `-${day?.length > 1 ? day : "0" + month}` : ""}`;

  // Extract Authors
  const authorList = medlineCitation?.Article?.AuthorList?.Author;
  const authors = authorListToString(authorList);

  // Extract Title
  let title = medlineCitation?.Article?.ArticleTitle?._text;
  if (Array.isArray(title)) {
    let iArr = medlineCitation?.Article?.ArticleTitle?.i;

    if (iArr && iArr.length > 0) {
      title = title
        .map((title, i) => {
          if (iArr[i]) {
            return `${title}${iArr[i]._text}`;
          }
          return title;
        })
        .join("");
    } else {
      title = title.join("");
    }
  }

  // Extract NCTID-regexp
  // For testing purposes:
  const rawText = JSON.stringify(raw);
  const nctIdsRegexp = rawText?.matchAll(/NCT.?\d{8}/gi) || [];
  const nctIdMatches = Array.from(nctIdsRegexp, (match) => match[0]) || [];
  const uniqueIds = [...new Set(nctIdMatches)];
  const cleanedIds = uniqueIds.map((id) => `NCT` + id.replace(/\D/g, ""));

  const nctId =
    cleanedIds && Array.isArray(cleanedIds) && cleanedIds.length === 1
      ? cleanedIds[0]
      : null;

  const nctIds = cleanedIds?.join("|");

  const parsed = {
    doi,
    pmid,
    abstract,
    publicationDate,
    title,
    authors,
    nctIds,
    nctId,
    raw: includeRaw ? raw : null,
  };

  return parsed;
};
