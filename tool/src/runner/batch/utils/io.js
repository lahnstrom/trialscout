import fs from "node:fs";
import { parse as parseCsv } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function ensureOutputCsv(filePath) {
  if (fs.existsSync(filePath)) {
    return;
  }
  const header = [
    "nct_id",
    "trial_id",
    "tool_results",
    "has_error",
    "tool_prompted_pmids",
    "tool_result_pmids",
    "tool_ident_steps",
    "earliest_result_publication",
    "earliest_result_publication_date",
    "failed_publication_discoveries",
    "failed_result_discoveries",
    "reasons",
  ];
  fs.writeFileSync(filePath, stringify([header]));
}

export function readInputRows(filePath, delimiter) {
  const content = fs.readFileSync(filePath, "utf8");
  return parseCsv(content, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    delimiter,
  });
}

export function extractTrialId(row) {
  const key =
    Object.keys(row).find((name) => {
      const normalized = name.toLowerCase();
      return (
        normalized === "nct_id" ||
        normalized === "nctid" ||
        normalized === "trial_id" ||
        normalized === "trialid"
      );
    }) || null;
  return key ? (row[key] || "").trim() : "";
}
