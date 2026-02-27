/**
 * Utilities for fetching and parsing German Clinical Trials Register (DRKS) data
 * DRKS ID format: DRKS00025107 (DRKS followed by 8 digits)
 * Uses HTML scraping of the details page
 */

import * as cheerio from "cheerio";
import { REGISTRY_TYPES } from "./utils.js";
import { log } from "../utils/utils.js";

const DRKS_BASE_URL = "https://drks.de";

/**
 * Fetch the HTML details page from DRKS
 * @param {string} trialId - DRKS ID (e.g., DRKS00025107)
 * @returns {Promise<string>} Raw HTML content
 */
export const fetchRegistration = async (trialId) => {
  const url = `${DRKS_BASE_URL}/search/en/trial/${trialId}/details`;
  log(`Fetching DRKS registration from ${url}`);

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "text/html",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
  });

  if (!res.ok) {
    throw new Error(
      `Failed to fetch DRKS registration: ${res.status} ${res.statusText}`
    );
  }

  return await res.text();
};

/**
 * Helper to extract value from dt/dd pairs
 * @param {cheerio.CheerioAPI} $ - Cheerio instance
 * @param {string} labelText - The dt label text to search for
 * @returns {string|null} The dd value
 */
const extractDtDd = ($, labelText) => {
  let result = null;
  $("dt").each((_, el) => {
    const dtText = $(el).text().trim().replace(":", "");
    if (dtText.toLowerCase().includes(labelText.toLowerCase())) {
      const dd = $(el).next("dd");
      if (dd.length) {
        const text = dd.text().trim();
        if (text && text !== "No Entry") {
          result = text;
        }
      }
      return false; // break
    }
  });
  return result;
};

/**
 * Helper to extract content from a section by h3/h4 header, then find dt/dd or p content
 * @param {cheerio.CheerioAPI} $ - Cheerio instance
 * @param {string} headerText - The header text to search for
 * @returns {string|null} The content
 */
const extractSectionContent = ($, headerText) => {
  let result = null;
  $("h3, h4").each((_, el) => {
    const text = $(el).text().trim();
    if (text.toLowerCase().includes(headerText.toLowerCase())) {
      // Look for the next p element or card-body content
      const nextP = $(el).next("p");
      if (nextP.length) {
        const pText = nextP.text().trim();
        if (pText && pText !== "No Entry") {
          result = pText;
          return false;
        }
      }
      // Look within parent card-body
      const cardBody = $(el).closest(".card").find(".card-body");
      if (cardBody.length) {
        const bodyText = cardBody
          .find("p, .withLineBreak")
          .first()
          .text()
          .trim();
        if (bodyText && bodyText !== "No Entry") {
          result = bodyText;
          return false;
        }
      }
      return false;
    }
  });
  return result;
};

/**
 * Helper to extract address block from card with specific h4 header
 * @param {cheerio.CheerioAPI} $ - Cheerio instance
 * @param {string} headerText - The h4 header text
 * @returns {object} Address info
 */
const extractAddressCard = ($, headerText) => {
  const info = {
    name: null,
    affiliation: null,
    email: null,
  };

  $("h4").each((_, el) => {
    const text = $(el).text().trim();
    if (text.toLowerCase().includes(headerText.toLowerCase())) {
      const card = $(el).closest(".card");
      const cardBody = card.find(".card-body");

      // Get address lines from dd div elements
      const addressDd = cardBody.find("dt.visually-hidden").next("dd");
      if (addressDd.length) {
        const divs = addressDd.find("div");
        const lines = [];
        divs.each((_, div) => {
          const lineText = $(div).text().trim();
          if (lineText) lines.push(lineText);
        });

        // First line is usually affiliation/institution
        if (lines.length > 0) {
          info.affiliation = lines[0];
        }
        // Look for a person's name in remaining lines
        // Skip lines that look like addresses (postal codes, countries, etc.)
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i];
          // Skip if it looks like a postal code, country, or address
          if (/^\d{4,}/.test(line)) continue; // Postal codes
          if (
            /^(Germany|Deutschland|France|UK|USA|Austria|Switzerland)/i.test(
              line
            )
          )
            continue;
          // Accept line if it contains letters and looks like a name
          if (/[A-Za-z]{2,}/.test(line) && !info.name) {
            info.name = line;
            break;
          }
        }
      }

      // Get email from mailto link
      const emailLink = cardBody.find('a[href^="mailto:"]');
      if (emailLink.length) {
        info.email = emailLink.attr("href").replace("mailto:", "");
      }

      return false;
    }
  });

  return info;
};

/**
 * Parse DRKS HTML into normalized registration object
 * @param {string} html - Raw HTML from DRKS details page
 * @param {string} trialId - The DRKS ID
 * @returns {object} Normalized registration object
 */
export const parseRegistration = (html, trialId) => {
  if (!html) {
    throw new Error("Cannot parse empty DRKS HTML");
  }

  const $ = cheerio.load(html);

  // === Trial ID ===
  const drksId = extractDtDd($, "DRKS-ID") || trialId;

  // === Title (from h2.title-bold) ===
  let briefTitle = $("h2.title-bold").first().text().trim();
  if (!briefTitle) {
    briefTitle = `DRKS Trial ${trialId}`;
  }

  // === Acronym (from section after h3) ===
  const acronym = extractSectionContent($, "Acronym/abbreviation") || null;

  // === Status ===
  const recruitmentStatus = extractDtDd($, "Recruitment Status") || "Unknown";

  // === Registration date ===
  const registrationDateStr = extractDtDd($, "Date of registration in DRKS");
  const lastUpdateStr = extractDtDd($, "Last update in DRKS");

  // === Study Type ===
  const studyTypeRaw = extractDtDd($, "Study type");
  let studyType = "Interventional";
  if (studyTypeRaw) {
    if (studyTypeRaw.toLowerCase().includes("non-interventional")) {
      studyType = "Non-interventional";
    } else if (studyTypeRaw.toLowerCase().includes("observational")) {
      studyType = "Observational";
    } else {
      studyType = studyTypeRaw;
    }
  }

  // === Phase ===
  const phase = extractDtDd($, "Phase") || null;

  // === Enrollment ===
  const targetSizeStr = extractDtDd($, "Target Sample Size");
  const finalSizeStr = extractDtDd($, "Final Sample Size");
  const targetSize = targetSizeStr ? parseInt(targetSizeStr, 10) : null;
  const actualSize = finalSizeStr ? parseInt(finalSizeStr, 10) : null;
  const enrollmentCount = actualSize || targetSize;

  // === Dates ===
  const startDateStr =
    extractDtDd($, "Actual study start date") ||
    extractDtDd($, "Planned study start date");
  const completionDateStr =
    extractDtDd($, "Actual Study Completion Date") ||
    extractDtDd($, "Planned study completion date");

  // === Sponsor ===
  const sponsorInfo = extractAddressCard($, "Primary Sponsor");
  const sponsorName = sponsorInfo.affiliation;

  // === Principal Investigator ===
  const piInfo = extractAddressCard($, "Principal Investigator");
  const investigatorFullName = piInfo.name;
  const investigatorEmail = piInfo.email;

  // === Scientific Contact ===
  const scientificInfo = extractAddressCard($, "Scientific Queries");

  // === Public Contact ===
  const publicInfo = extractAddressCard($, "Public Queries");

  // Collect all investigators/contacts
  const principalInvestigators = [];
  if (piInfo.name) {
    principalInvestigators.push(piInfo.name);
  }
  if (
    scientificInfo.name &&
    !principalInvestigators.includes(scientificInfo.name)
  ) {
    principalInvestigators.push(scientificInfo.name);
  }
  if (publicInfo.name && !principalInvestigators.includes(publicInfo.name)) {
    principalInvestigators.push(publicInfo.name);
  }

  // === Conditions ===
  const conditions = [];
  const conditionFreeText = extractDtDd($, "Free text");
  if (conditionFreeText) {
    conditions.push(conditionFreeText);
  }

  // === Healthy Volunteers ===
  const healthyVolText = extractDtDd($, "Healthy volunteers");
  const healthyVolunteers = healthyVolText
    ? healthyVolText.toLowerCase().includes("yes")
    : null;

  // === Eligibility ===
  const sex = extractDtDd($, "Sex") || "All";
  const minimumAge = extractDtDd($, "Minimum Age") || null;
  const maximumAge = extractDtDd($, "Maximum Age") || null;
  const additionalInclusion =
    extractDtDd($, "Additional Inclusion Criteria") || "";

  // Get exclusion criteria from card
  let exclusionCriteria = "";
  $("h4").each((_, el) => {
    if ($(el).text().trim().includes("Exclusion Criteria")) {
      const card = $(el).closest(".card");
      const bodyText = card
        .find(".card-body p, .card-body .withLineBreak")
        .text()
        .trim();
      if (bodyText && bodyText !== "No Entry") {
        exclusionCriteria = bodyText;
      }
      return false;
    }
  });

  let eligibilityCriteria = "";
  if (additionalInclusion) {
    eligibilityCriteria += `Inclusion Criteria:\n${additionalInclusion}`;
  }
  if (exclusionCriteria) {
    eligibilityCriteria += `${
      eligibilityCriteria ? "\n\n" : ""
    }Exclusion Criteria:\n${exclusionCriteria}`;
  }

  // === Outcomes ===
  const primaryOutcomes = [];
  const primaryOutcomeText = extractDtDd($, "Primary outcome");
  if (primaryOutcomeText) {
    primaryOutcomes.push({
      measure: primaryOutcomeText,
      timeFrame: "",
    });
  }

  const secondaryOutcomes = [];
  const secondaryOutcomeText = extractDtDd($, "Secondary outcome");
  if (secondaryOutcomeText) {
    secondaryOutcomes.push({
      measure: secondaryOutcomeText,
      timeFrame: "",
    });
  }

  // === Arms / Interventions ===
  const arms = [];
  const interventions = [];
  $("dt").each((_, el) => {
    const dtText = $(el).text().trim();
    if (dtText.match(/^Arm \d+:/)) {
      const dd = $(el).next("dd");
      if (dd.length) {
        const armText = dd.text().trim();
        if (armText && armText !== "No Entry") {
          arms.push({
            label: dtText.replace(":", ""),
            description: armText,
          });
        }
      }
    }
  });

  // === Summaries ===
  const briefSummary =
    extractSectionContent($, "Brief summary in lay language") || "";
  const detailedDescription =
    extractSectionContent($, "Brief summary in scientific language") || "";

  // === Publications / Results ===
  const references = [];
  $('a[href*="doi.org"], a[href*="pubmed"], a[href*="ncbi"]').each((_, el) => {
    const href = $(el).attr("href");
    const text = $(el).text().trim();
    if (href && !href.includes("bfarm.de")) {
      // Try to extract PMID from text first, then from URL
      const pmidMatch =
        text.match(/PMID:\s*(\d+)/) || href.match(/pubmed\/(\d+)/);
      references.push({
        pmid: pmidMatch ? pmidMatch[1] : null,
        citation: text || href,
        url: href,
        type: "result",
      });
    }
  });

  // Check for results
  const firstPublicationDate = extractDtDd(
    $,
    "Date of the first journal publication"
  );
  const hasResults = references.length > 0 || !!firstPublicationDate;

  // === Parse dates ===
  const parseDate = (str) => {
    if (!str) return null;
    const date = new Date(str);
    return isNaN(date.getTime()) ? null : date;
  };

  // Build normalized registration object matching CTGov/EUCTR structure
  const registration = {
    trialId: drksId,
    registryType: REGISTRY_TYPES.DRKS,
    hasResults,

    // Titles
    briefTitle,
    officialTitle: briefTitle,
    acronym,

    // Organization/Sponsor
    organization: {
      fullName: sponsorName || "Unknown Sponsor",
      country: null,
    },
    leadSponsorName: sponsorName,
    collaboratorNames: [],

    // Study type and phase
    studyType,
    phase,

    // Enrollment
    enrollmentInfo: enrollmentCount
      ? {
          count: enrollmentCount,
          type: actualSize ? "Actual" : "Anticipated",
        }
      : null,

    // Descriptions
    briefSummary,
    detailedDescription,

    // Status and dates
    overallStatus: recruitmentStatus,
    startDate: parseDate(startDateStr),
    completionDate: parseDate(completionDateStr),
    registrationDate: parseDate(registrationDateStr),
    lastUpdate: parseDate(lastUpdateStr),

    // Investigators
    investigatorFullName,
    investigatorEmail,
    investigatorType: null,
    principalInvestigators,

    // Conditions
    conditions: conditions.filter(Boolean),
    keywords: [],

    // Interventions
    interventions,
    arms,

    // Eligibility
    eligibilityCriteria: eligibilityCriteria.trim() || null,
    healthyVolunteers,
    minimumAge,
    maximumAge,
    sex,

    // Outcomes
    primaryOutcomes,
    secondaryOutcomes,

    // References
    references,
  };

  return registration;
};

/**
 * Full DRKS registration discovery - fetches and parses registration
 * @param {string} trialId - DRKS ID (e.g., DRKS00025107)
 * @returns {Promise<object>} Parsed registration object
 */
export const discoverRegistration = async (trialId) => {
  const html = await fetchRegistration(trialId);
  return parseRegistration(html, trialId);
};
