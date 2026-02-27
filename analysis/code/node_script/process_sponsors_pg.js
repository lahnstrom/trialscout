// 1. Import required modules
const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const { Pool } = require("pg");

// 2. --- CONFIGURATION ---
//    Update these file paths to match your file names.
const INPUT_CSV_PATH = path.join(__dirname, "final-sample-ctgov.csv");
const OUTPUT_CSV_PATH = path.join(__dirname, "patch_file_pg.csv");
// Database connection via env vars or defaults
const DB_CONFIG = {
  user: "loveahnstrom", // <-- ⚠️  REPLACE THIS
  host: "localhost",
  database: "local_db",
  password: null, // Should be null or undefined for no password
  port: 5432,
};
const DB_SCHEMA = process.env.PGSCHEMA || "ctgov";
// -----------------------

/**
 * Query sponsors by nct_id
 * Returns rows with columns: id, nct_id, agency_class, lead_or_collaborator, name
 */
async function fetchSponsorsForNctIds(pool, nctIds) {
  if (!nctIds.length) return new Map();
  const placeholders = nctIds.map((_, idx) => `$${idx + 1}`).join(", ");
  const sql = `
    SELECT id, nct_id, agency_class, lead_or_collaborator, name
    FROM ${DB_SCHEMA}.sponsors
    WHERE nct_id IN (${placeholders})
  `;
  const { rows } = await pool.query(sql, nctIds);
  const nctIdToRows = new Map();
  for (const row of rows) {
    if (!nctIdToRows.has(row.nct_id)) nctIdToRows.set(row.nct_id, []);
    nctIdToRows.get(row.nct_id).push(row);
  }
  return nctIdToRows;
}

/**
 * Query countries by nct_id
 * Expected columns: id, nct_id, name, removed (boolean)
 */
async function fetchCountriesForNctIds(pool, nctIds) {
  if (!nctIds.length) return new Map();
  const placeholders = nctIds.map((_, idx) => `$${idx + 1}`).join(", ");
  const sql = `
    SELECT id, nct_id, name, removed
    FROM ${DB_SCHEMA}.countries
    WHERE nct_id IN (${placeholders})
  `;
  const { rows } = await pool.query(sql, nctIds);
  const nctIdToRows = new Map();
  for (const row of rows) {
    if (!nctIdToRows.has(row.nct_id)) nctIdToRows.set(row.nct_id, []);
    nctIdToRows.get(row.nct_id).push(row);
  }
  return nctIdToRows;
}

/**
 * Reads the input CSV to collect nct_ids, queries Postgres, and writes the patch CSV.
 */
async function processFromPostgres() {
  console.log("🔄 Connecting to Postgres...");
  const pool = new Pool(DB_CONFIG);
  try {
    // 1) Read all nct_ids from input CSV
    console.log(`🔄 Reading input CSV: ${INPUT_CSV_PATH}`);
    const nctIds = await new Promise((resolve, reject) => {
      const collected = [];
      fs.createReadStream(INPUT_CSV_PATH)
        .pipe(csv({ separator: ";" }))
        .on("data", (row) => {
          if (row.nct_id) collected.push(row.nct_id);
        })
        .on("end", () => resolve(collected))
        .on("error", reject);
    });

    // 2) Query sponsors for all collected nct_ids
    console.log(`🔎 Querying sponsors for ${nctIds.length} nct_ids...`);
    const nctIdToSponsorRows = await fetchSponsorsForNctIds(pool, nctIds);

    // 3) Query countries for all collected nct_ids
    console.log(`🔎 Querying countries for ${nctIds.length} nct_ids...`);
    const nctIdToCountryRows = await fetchCountriesForNctIds(pool, nctIds);

    // 4) Build records
    const records = [];
    for (const nctId of nctIds) {
      const sponsorRows = nctIdToSponsorRows.get(nctId) || [];
      const sponsorTypes = new Set();
      let numCollaborators = 0;
      let leadSponsorType = "";
      for (const r of sponsorRows) {
        if (r && r.agency_class) sponsorTypes.add(r.agency_class);
        if (r && r.lead_or_collaborator === "collaborator")
          numCollaborators += 1;
        if (
          !leadSponsorType &&
          r &&
          r.lead_or_collaborator === "lead" &&
          r.agency_class
        )
          leadSponsorType = r.agency_class;
      }

      const countryRows = nctIdToCountryRows.get(nctId) || [];
      const countryNames = new Set();
      for (const c of countryRows) {
        const isRemoved = c && (c.removed === true || c.removed === "true");
        if (c && c.name && !isRemoved) countryNames.add(c.name);
      }

      records.push({
        nct_id: nctId,
        sponsor_types: Array.from(sponsorTypes).join(";"),
        num_collaborators: numCollaborators,
        countries: Array.from(countryNames).join(";"),
        num_countries: countryNames.size,
        lead_sponsor_type: leadSponsorType,
      });
    }

    // 5) Write output CSV
    const csvWriter = createCsvWriter({
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
    console.log("---");
    console.log(`🎉 Success! Patch file created at: ${OUTPUT_CSV_PATH}`);
    console.log(`Processed ${records.length} rows.`);
  } finally {
    await pool.end();
  }
}

(async function main() {
  try {
    await processFromPostgres();
  } catch (err) {
    console.error("❌ A critical error occurred:", err);
    process.exit(1);
  }
})();
