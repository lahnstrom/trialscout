/**
 * Utilities for fetching and parsing EU Clinical Trials Register (EUCTR) data
 * EudraCT ID format: YYYY-NNNNNN-NN (e.g., 2007-002931-95)
 */

import { REGISTRY_TYPES } from "./utils.js";
import { log } from "../utils/utils.js";

const EUCTR_BASE_URL = "https://www.clinicaltrialsregister.eu";

/**
 * Fetch the full registration text file from EUCTR
 * @param {string} trialId - EudraCT ID (e.g., 2007-002931-95)
 * @returns {Promise<string>} Raw text content
 */
export const fetchRegistration = async (trialId) => {
  const url = `${EUCTR_BASE_URL}/ctr-search/rest/download/full?query=${trialId}&mode=current_page`;
  log(`Fetching EUCTR registration from ${url}`);

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "text/plain",
    },
  });

  if (!res.ok) {
    throw new Error(
      `Failed to fetch EUCTR registration: ${res.status} ${res.statusText}`
    );
  }

  return await res.text();
};

/**
 * Fetch the results HTML page from EUCTR
 * @param {string} trialId - EudraCT ID
 * @returns {Promise<string>} HTML content of results page
 */
export const fetchResultsPage = async (trialId) => {
  const url = `${EUCTR_BASE_URL}/ctr-search/trial/${trialId}/results`;
  log(`Fetching EUCTR results page from ${url}`);

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "text/html",
    },
  });

  if (!res.ok) {
    // Not all trials have results, so 404 is expected
    if (res.status === 404) {
      log(`No results page found for ${trialId}`);
      return null;
    }
    throw new Error(
      `Failed to fetch EUCTR results page: ${res.status} ${res.statusText}`
    );
  }

  return await res.text();
};

/**
 * Extract PubMed IDs from the EUCTR results HTML page
 * Looks for links in format: http(s)://www.ncbi.nlm.nih.gov/pubmed/XXXXXXXX
 * @param {string} html - HTML content of results page
 * @returns {string[]} Array of PubMed IDs
 */
export const extractPubmedIdsFromHtml = (html) => {
  if (!html) {
    return [];
  }

  // Pattern to match PubMed URLs and extract the ID
  const pubmedPattern =
    /https?:\/\/(?:www\.)?ncbi\.nlm\.nih\.gov\/pubmed\/(\d+)/gi;
  const pmids = [];
  let match;

  while ((match = pubmedPattern.exec(html)) !== null) {
    const pmid = match[1];
    if (!pmids.includes(pmid)) {
      pmids.push(pmid);
    }
  }

  log(`Extracted ${pmids.length} PubMed IDs from EUCTR results page`);
  return pmids;
};

/**
 * Parse a field value from the EUCTR text format
 * EUCTR uses numbered fields like "A.3 Full title of the trial: Value"
 * @param {string} text - Raw text content
 * @param {string} fieldPattern - Regex pattern or field name to match
 * @returns {string|null} Field value or null
 */
const parseTextField = (text, fieldPattern) => {
  // Create regex to match field pattern followed by colon and capture the value
  const pattern = new RegExp(`${fieldPattern}[^:]*:\\s*(.*)$`, "mi");
  const match = text.match(pattern);
  return match ? match[1].trim() : null;
};

/**
 * Parse a multi-line field from EUCTR text format
 * These fields span multiple lines until the next field header
 * @param {string} text - Raw text content
 * @param {string} fieldPattern - Regex pattern or field name to match
 * @returns {string|null} Field value or null
 */
const parseMultilineField = (text, fieldPattern) => {
  const startPattern = new RegExp(`${fieldPattern}[^:]*:\\s*`, "mi");
  const match = startPattern.exec(text);

  if (!match) {
    return null;
  }

  const startIndex = match.index + match[0].length;

  // Find the next field header (line starting with letter/number followed by period and letters/numbers)
  const nextFieldPattern = /\n[A-Z]\.[0-9.]*\s+[A-Za-z]/;
  const nextMatch = nextFieldPattern.exec(text.slice(startIndex));

  const endIndex = nextMatch ? startIndex + nextMatch.index : text.length;

  return text.slice(startIndex, endIndex).trim();
};

/**
 * Parse all occurrences of a field pattern (for multi-country entries)
 * @param {string} text - Raw text content
 * @param {string} fieldPattern - Regex pattern to match
 * @returns {string[]} Array of all matched values
 */
const parseAllTextFields = (text, fieldPattern) => {
  const pattern = new RegExp(`${fieldPattern}[^:]*:\\s*(.*)$`, "gmi");
  const results = [];
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const value = match[1].trim();
    // Filter out empty values, "Information not present" placeholders, and section headers
    if (
      value &&
      !results.includes(value) &&
      value !== "Information not present in EudraCT" &&
      !/^[A-Z]\.\s+[A-Z]/.test(value) && // Skip section headers like "D. IMP Identification"
      value.length < 100
    ) {
      // Contact names shouldn't be super long
      results.push(value);
    }
  }

  return results;
};

/**
 * Parse a Yes/No field as boolean
 * @param {string} text - Raw text content
 * @param {string} fieldPattern - Regex pattern to match
 * @returns {boolean|null} True/False or null if not found
 */
const parseBooleanField = (text, fieldPattern) => {
  const value = parseTextField(text, fieldPattern);
  if (!value) return null;
  if (value.toLowerCase() === "yes") return true;
  if (value.toLowerCase() === "no") return false;
  return null;
};

/**
 * Determine trial phase from E.7.x fields
 * @param {string} text - Raw text content
 * @returns {string} Phase string (e.g., "Phase II")
 */
const parsePhase = (text) => {
  const phases = [];

  if (parseBooleanField(text, "E\\.7\\.1 Human pharmacology \\(Phase I\\)")) {
    phases.push("Phase I");
  }
  if (
    parseBooleanField(text, "E\\.7\\.2 Therapeutic exploratory \\(Phase II\\)")
  ) {
    phases.push("Phase II");
  }
  if (
    parseBooleanField(
      text,
      "E\\.7\\.3 Therapeutic confirmatory \\(Phase III\\)"
    )
  ) {
    phases.push("Phase III");
  }
  if (parseBooleanField(text, "E\\.7\\.4 Therapeutic use \\(Phase IV\\)")) {
    phases.push("Phase IV");
  }

  return phases.length > 0 ? phases.join("/") : null;
};

/**
 * Determine sex/gender eligibility from F.2.x fields
 * @param {string} text - Raw text content
 * @returns {string} "All", "Female", "Male", or null
 */
const parseSex = (text) => {
  const female = parseBooleanField(text, "F\\.2\\.1 Female");
  const male = parseBooleanField(text, "F\\.2\\.2 Male");

  if (female && male) return "All";
  if (female) return "Female";
  if (male) return "Male";
  return null;
};

/**
 * Parse design characteristics from E.8.x fields
 * @param {string} text - Raw text content
 * @returns {object} Design characteristics
 */
const parseDesign = (text) => {
  return {
    isControlled: parseBooleanField(text, "E\\.8\\.1 Controlled"),
    isRandomized: parseBooleanField(text, "E\\.8\\.1\\.1 Randomised"),
    isOpen: parseBooleanField(text, "E\\.8\\.1\\.2 Open"),
    isSingleBlind: parseBooleanField(text, "E\\.8\\.1\\.3 Single blind"),
    isDoubleBlind: parseBooleanField(text, "E\\.8\\.1\\.4 Double blind"),
    isParallelGroup: parseBooleanField(text, "E\\.8\\.1\\.5 Parallel group"),
    isCrossover: parseBooleanField(text, "E\\.8\\.1\\.6 Cross over"),
    hasPlacebo: parseBooleanField(text, "E\\.8\\.2\\.2 Placebo"),
    numberOfArms:
      parseInt(
        parseTextField(text, "E\\.8\\.2\\.4 Number of treatment arms"),
        10
      ) || null,
  };
};

/**
 * Check if results are available based on HTML content
 * @param {string} html - HTML content of results page
 * @returns {boolean} True if results are posted
 */
const hasResultsFromHtml = (html) => {
  if (!html) {
    return false;
  }

  // Check for indicators that results are actually posted
  // The presence of the page alone isn't enough - check for actual result content
  const hasResultContent =
    html.includes("Trial results") ||
    html.includes("Summary results") ||
    html.includes("pubmed");

  return hasResultContent;
};

/**
 * Parse EUCTR registration text into normalized registration object
 * Returns an object with the same shape as CTGov registrations for consistency
 * @param {string} rawText - Raw text content from EUCTR download
 * @param {string} trialId - The EudraCT ID
 * @param {string|null} resultsHtml - Optional HTML from results page
 * @returns {object} Normalized registration object
 */
export const parseRegistration = (rawText, trialId, resultsHtml = null) => {
  if (!rawText) {
    throw new Error("Cannot parse empty EUCTR registration text");
  }

  // === A. Protocol Information ===
  const briefTitle = parseTextField(rawText, "A\\.3 Full title");
  const layTitle = parseTextField(
    rawText,
    "A\\.3\\.1 Title of the trial for lay people"
  );
  const acronym = parseTextField(
    rawText,
    "A\\.3\\.2 Name or abbreviated title"
  );
  const protocolCode = parseTextField(
    rawText,
    "A\\.4\\.1 Sponsor's protocol code"
  );

  // === B. Sponsor Information ===
  const sponsorName = parseTextField(rawText, "B\\.1\\.1 Name of Sponsor");
  const sponsorCountry = parseTextField(rawText, "B\\.1\\.3\\.4\\s+Country");
  const sponsorType = parseTextField(
    rawText,
    "B\\.3\\.1 and B\\.3\\.2\\s+Status of the sponsor"
  );
  const fundingOrganization = parseTextField(
    rawText,
    "B\\.4\\.1 Name of organisation providing support"
  );

  // CRITICAL: Contact point for author matching
  // Collect all functional contact names and emails across all country entries
  const contactNames = parseAllTextFields(
    rawText,
    "B\\.5\\.2 Functional name of contact point"
  );
  const contactEmails = parseAllTextFields(rawText, "B\\.5\\.6 E-mail");

  // === D. IMP (Investigational Medicinal Product) Information ===
  const productName = parseTextField(rawText, "D\\.3\\.1 Product name");
  const innName = parseTextField(rawText, "D\\.3\\.8 INN - Proposed INN");
  const pharmaceuticalForm = parseTextField(
    rawText,
    "D\\.3\\.4 Pharmaceutical form"
  );

  // === E. General Information on the Trial ===
  // E.1 Medical condition
  const condition = parseTextField(
    rawText,
    "E\\.1\\.1 Medical condition\\(s\\) being investigated"
  );
  const conditionLayTerms = parseTextField(
    rawText,
    "E\\.1\\.1\\.1 Medical condition in easily understood"
  );
  const therapeuticArea = parseTextField(
    rawText,
    "E\\.1\\.1\\.2 Therapeutic area"
  );

  // E.2 Objectives
  const mainObjective = parseMultilineField(
    rawText,
    "E\\.2\\.1 Main objective"
  );
  const secondaryObjectives = parseMultilineField(
    rawText,
    "E\\.2\\.2 Secondary objectives"
  );

  // E.3 & E.4 Eligibility criteria
  const inclusionCriteria = parseMultilineField(
    rawText,
    "E\\.3 Principal inclusion criteria"
  );
  const exclusionCriteria = parseMultilineField(
    rawText,
    "E\\.4 Principal exclusion criteria"
  );

  // E.5 Endpoints
  const primaryEndpoint = parseMultilineField(
    rawText,
    "E\\.5\\.1 Primary end point"
  );
  const primaryEndpointTimepoint = parseTextField(
    rawText,
    "E\\.5\\.1\\.1 Timepoint\\(s\\) of evaluation"
  );
  const secondaryEndpoints = parseMultilineField(
    rawText,
    "E\\.5\\.2 Secondary end point"
  );

  // E.7 Phase and E.8 Design
  const phase = parsePhase(rawText);
  const design = parseDesign(rawText);

  // === F. Population ===
  const sex = parseSex(rawText);
  const healthyVolunteers = parseBooleanField(
    rawText,
    "F\\.3\\.1 Healthy volunteers"
  );
  const totalEnrollmentEEA = parseTextField(
    rawText,
    "F\\.4\\.2\\.1 In the EEA"
  );
  const totalEnrollmentGlobal = parseTextField(
    rawText,
    "F\\.4\\.2\\.2 In the whole clinical trial"
  );

  // === Summary fields ===
  const overallStatus = parseTextField(rawText, "Trial Status");
  const clinicalTrialType = parseTextField(rawText, "Clinical Trial Type");
  const startDateStr = parseTextField(
    rawText,
    "Date on which this record was first entered"
  );

  // === P. End of Trial ===
  const endOfTrialStatus = parseTextField(rawText, "P\\. End of Trial Status");
  const globalEndDateStr = parseTextField(
    rawText,
    "P\\. Date of the global end of the trial"
  );

  // Extract PubMed IDs from results page if available
  const linkedPubmedIds = extractPubmedIdsFromHtml(resultsHtml);

  // Check if results are posted
  const hasResults = hasResultsFromHtml(resultsHtml);

  // Combine eligibility criteria
  let eligibilityCriteria = "";
  if (inclusionCriteria) {
    eligibilityCriteria += `Inclusion Criteria:\n${inclusionCriteria}`;
  }
  if (exclusionCriteria) {
    eligibilityCriteria += `\n\nExclusion Criteria:\n${exclusionCriteria}`;
  }

  // Build interventions array from IMP info
  const interventions = [];
  if (innName) {
    interventions.push({
      type: "Drug",
      name: innName,
      description: productName || innName,
    });
  }

  // Build primary outcomes array
  const primaryOutcomes = [];
  if (primaryEndpoint) {
    primaryOutcomes.push({
      measure: primaryEndpoint,
      timeFrame: primaryEndpointTimepoint || "",
    });
  }

  // Build secondary outcomes array
  const secondaryOutcomes = [];
  if (secondaryEndpoints) {
    secondaryOutcomes.push({
      measure: secondaryEndpoints,
      timeFrame: "",
    });
  }

  // Parse enrollment count
  const enrollmentCount =
    parseInt(totalEnrollmentGlobal, 10) ||
    parseInt(totalEnrollmentEEA, 10) ||
    null;

  // Build normalized registration object matching CTGov structure
  const registration = {
    trialId,
    registryType: REGISTRY_TYPES.EUCTR,
    hasResults,

    // Titles
    briefTitle: briefTitle || acronym || `EudraCT Trial ${trialId}`,
    officialTitle: briefTitle || `EudraCT Trial ${trialId}`,
    layTitle: layTitle || null,
    acronym: acronym || null,

    // Organization/Sponsor
    organization: {
      fullName: sponsorName || "Unknown Sponsor",
      country: sponsorCountry || null,
    },
    leadSponsorName: sponsorName,
    sponsorType: sponsorType || null,
    fundingOrganization: fundingOrganization || null,
    collaboratorNames: [],

    // Study type and phase
    studyType: clinicalTrialType || "Interventional",
    phase: phase,

    // Enrollment
    enrollmentInfo: enrollmentCount
      ? {
          count: enrollmentCount,
          type: "Anticipated",
        }
      : null,

    // Descriptions and objectives
    briefSummary: mainObjective || "",
    detailedDescription: secondaryObjectives || "",

    // Status and dates
    overallStatus: endOfTrialStatus || overallStatus || "Unknown",
    startDate: startDateStr ? new Date(startDateStr) : null,
    completionDate: globalEndDateStr ? new Date(globalEndDateStr) : null,

    // Investigators - CRITICAL for author matching
    principalInvestigators: contactNames,
    investigatorFullName: contactNames.length > 0 ? contactNames[0] : null,
    investigatorType: null,
    contactEmails: contactEmails,

    // Conditions
    conditions: condition ? [condition] : [],
    conditionLayTerms: conditionLayTerms || null,
    therapeuticArea: therapeuticArea || null,
    keywords: [],

    // Interventions
    interventions,
    arms: [],

    // Eligibility
    eligibilityCriteria: eligibilityCriteria.trim() || null,
    healthyVolunteers: healthyVolunteers,
    sex: sex,

    // Outcomes
    primaryOutcomes,
    secondaryOutcomes,

    // Design characteristics
    design,

    // References
    references: [],
    protocolCode: protocolCode || null,

    // EUCTR-specific fields
    linkedPubmedIds,
  };

  return registration;
};

/**
 * Full EUCTR registration discovery - fetches and parses registration
 * @param {string} trialId - EudraCT ID
 * @returns {Promise<object>} Parsed registration object
 */
export const discoverRegistration = async (trialId) => {
  // Fetch both registration text and results page in parallel
  const [rawText, resultsHtml] = await Promise.all([
    fetchRegistration(trialId),
    fetchResultsPage(trialId).catch(() => null), // Don't fail if no results page
  ]);

  return parseRegistration(rawText, trialId, resultsHtml);
};
