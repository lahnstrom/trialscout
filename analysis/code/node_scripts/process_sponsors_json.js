/**
 * process_sponsors_json.js
 *
 * Replaces process_sponsors_pg.js — reads sponsor and country data directly
 * from the ClinicalTrials.gov JSON downloads instead of querying AACT/Postgres.
 *
 * Input:  ../../../prototype/data/final-sample-ctgov.csv  (semicolon-separated, has "nct_id" column)
 * Source: ../../prototype/data/ctg-studies.json/<NCT_ID>.json
 * Output: patch_file_pg.csv       (same format as old AACT-based script)
 *
 * Output columns:
 *   nct_id, sponsor_types, num_collaborators, countries, num_countries, lead_sponsor_type
 */

const { createReadStream } = require("fs");
const { readFile, access } = require("fs/promises");
const { join } = require("path");
const csv = require("csv-parser");
const { createObjectCsvWriter } = require("csv-writer");

// --- CONFIGURATION ---
const INPUT_CSV_PATH = join(__dirname, "../../../tool/data/final-sample-ctgov.csv");
const OUTPUT_CSV_PATH = join(__dirname, "patch_file_pg.csv");
const JSON_DIR = join(__dirname, "../../../tool/data/ctg-studies.json");

/**
 * Read all NCT IDs from the input CSV (semicolon-separated).
 */
function readNctIds() {
  return new Promise((resolve, reject) => {
    const ids = [];
    createReadStream(INPUT_CSV_PATH)
      .pipe(csv({ separator: ";" }))
      .on("data", (row) => {
        if (row.nct_id) ids.push(row.nct_id);
      })
      .on("end", () => resolve(ids))
      .on("error", reject);
  });
}

/**
 * Extract sponsor and country data from a CTG JSON record.
 * Returns the same shape as the old AACT-based script.
 */
function extractPatchFields(nctId, data) {
  const protocol = data.protocolSection || {};
  const scModule = protocol.sponsorCollaboratorsModule || {};
  const locModule = protocol.contactsLocationsModule || {};

  // --- Sponsors ---
  const leadSponsor = scModule.leadSponsor || {};
  const collaborators = scModule.collaborators || [];

  const leadSponsorType = leadSponsor.class || "";

  const sponsorTypes = new Set();
  if (leadSponsorType) sponsorTypes.add(leadSponsorType);
  for (const collab of collaborators) {
    if (collab.class) sponsorTypes.add(collab.class);
  }

  // --- Countries (deduplicated from facility locations) ---
  const locations = locModule.locations || [];
  const countries = new Set();
  for (const loc of locations) {
    if (loc.country) countries.add(loc.country);
  }

  return {
    nct_id: nctId,
    sponsor_types: Array.from(sponsorTypes).join(";"),
    num_collaborators: collaborators.length,
    countries: Array.from(countries).join(";"),
    num_countries: countries.size,
    lead_sponsor_type: leadSponsorType,
  };
}

async function main() {
  console.log(`Reading input CSV: ${INPUT_CSV_PATH}`);
  const nctIds = await readNctIds();
  console.log(`Found ${nctIds.length} NCT IDs`);

  const records = [];
  let found = 0;
  let missing = 0;

  for (const nctId of nctIds) {
    const jsonPath = join(JSON_DIR, `${nctId}.json`);
    try {
      await access(jsonPath);
      const raw = await readFile(jsonPath, "utf-8");
      const data = JSON.parse(raw);
      records.push(extractPatchFields(nctId, data));
      found++;
    } catch {
      // JSON file not found — write empty row (same as AACT script when no DB match)
      records.push({
        nct_id: nctId,
        sponsor_types: "",
        num_collaborators: 0,
        countries: "",
        num_countries: 0,
        lead_sponsor_type: "",
      });
      missing++;
    }
  }

  console.log(`Matched: ${found}, Missing JSON: ${missing}`);

  const csvWriter = createObjectCsvWriter({
    path: OUTPUT_CSV_PATH,
    header: [
      { id: "nct_id", title: "nct_id" },
      { id: "sponsor_types", title: "sponsor_types" },
      { id: "num_collaborators", title: "num_collaborators" },
      { id: "countries", title: "countries" },
      { id: "num_countries", title: "num_countries" },
      { id: "lead_sponsor_type", title: "lead_sponsor_type" },
    ],
  });

  await csvWriter.writeRecords(records);
  console.log(`Patch file written to: ${OUTPUT_CSV_PATH}`);
  console.log(`Processed ${records.length} rows.`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
