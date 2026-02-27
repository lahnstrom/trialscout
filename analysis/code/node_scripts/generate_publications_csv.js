/**
 * generate_publications_csv.js
 *
 * Reads per-trial JSON output from the tool and generates a flat
 * publications CSV for analysis in R (used by 2c-results.R).
 *
 * Usage:
 *   node generate_publications_csv.js <json-dir> [output-path]
 *
 * Arguments:
 *   json-dir    — path to a run's json/ folder
 *                 (e.g. tool/out/final-sample-ctgov_2026-02-12T20-51-14/json/)
 *   output-path — where to write the CSV (default: analysis/data/publications.csv)
 *
 * Source name mapping:
 *   pubmed_gpt_* variants → pubmed_enhanced  (so R grepl() works unchanged)
 */

const { readdir, readFile } = require("fs/promises");
const { join } = require("path");
const { createObjectCsvWriter } = require("csv-writer");

const DEFAULT_OUTPUT = join(__dirname, "../../data/publications.csv");

/**
 * Map tool source names to the names expected by the R analysis script.
 * Any source starting with "pubmed_gpt" becomes "pubmed_enhanced".
 */
function mapSourceName(source) {
  if (source.startsWith("pubmed_gpt")) {
    return "pubmed_enhanced";
  }
  return source;
}

async function main() {
  const jsonDir = process.argv[2];
  const outputPath = process.argv[3] || DEFAULT_OUTPUT;

  if (!jsonDir) {
    console.error("Usage: node generate_publications_csv.js <json-dir> [output-path]");
    process.exit(1);
  }

  console.log(`Reading JSON files from: ${jsonDir}`);
  console.log(`Output CSV: ${outputPath}`);

  const files = (await readdir(jsonDir)).filter((f) => f.endsWith(".json"));
  console.log(`Found ${files.length} JSON files`);

  const records = [];

  for (const file of files) {
    const raw = await readFile(join(jsonDir, file), "utf-8");
    const data = JSON.parse(raw);
    const results = data.detectionResults || [];

    for (const pub of results) {
      const mappedSources = (pub.sources || []).map(mapSourceName);
      // Deduplicate (multiple gpt variants may collapse to the same name)
      const uniqueSources = [...new Set(mappedSources)];

      records.push({
        pmid: pub.pmid || "",
        has_results: pub.hasResults === true ? "true" : "false",
        sources: uniqueSources.join(","),
        publicationDate: pub.publicationDate || "",
      });
    }
  }

  console.log(`Extracted ${records.length} publication records`);

  const csvWriter = createObjectCsvWriter({
    path: outputPath,
    header: [
      { id: "pmid", title: "pmid" },
      { id: "has_results", title: "has_results" },
      { id: "sources", title: "sources" },
      { id: "publicationDate", title: "publicationDate" },
    ],
  });

  await csvWriter.writeRecords(records);
  console.log(`CSV written to: ${outputPath}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
