#!/usr/bin/env node

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parse as parseCsv } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { registrationDiscovery } from "../discovery/registration.js";
import { publicationDiscovery } from "../discovery/publication/index.js";
import { resultsDiscovery } from "../discovery/results.js";
import { maxDateFilter, minDateFilter } from "../utils/utils.js";
import { writeRegistrationLiveCache } from "../utils/server_utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function usage() {
  const script = path.relative(process.cwd(), __filename);
  console.log(`Usage: node ${script} --input <file> [options]

Options:
  --input <file>          CSV file containing trials (must include nct_id column)
  --output-csv <file>     Where to append summary rows (default: <input>_progress.csv)
  --json-dir <dir>        Directory for per-row JSON payloads (default: <input>_progress_json/)
  --progress <file>       JSON file tracking processed/failed rows (default: <input>_progress.json)
  --delimiter <char>      CSV delimiter for the input file (default: ,)
  --retry-errors          Re-run rows previously marked as errors
  --validation-run        Enable validation mode with dataset-based date filtering
  --help                  Show this message
`);
}

function parseArgs(argv) {
  const options = {
    input: null,
    outputCsv: null,
    jsonDir: null,
    progressFile: null,
    delimiter: ",",
    retryErrors: false,
    validationRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--input":
        options.input = argv[++i];
        break;
      case "--output-csv":
        options.outputCsv = argv[++i];
        break;
      case "--json-dir":
        options.jsonDir = argv[++i];
        break;
      case "--progress":
        options.progressFile = argv[++i];
        break;
      case "--delimiter":
        options.delimiter = argv[++i];
        break;
      case "--retry-errors":
        options.retryErrors = true;
        break;
      case "--validation-run":
        options.validationRun = true;
        break;
      case "--help":
        usage();
        process.exit(0);
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        usage();
        process.exit(1);
    }
  }

  if (!options.input) {
    console.error("Missing required --input flag.");
    usage();
    process.exit(1);
  }

  const resolvedInput = path.resolve(options.input);
  const inputBase = path.basename(resolvedInput, path.extname(resolvedInput));

  // Create run-specific folder in prototype/out directory
  const prototypeRoot = path.resolve(__dirname, "../..");
  const outDir = path.join(prototypeRoot, "out");
  const timestamp =
    new Date().toISOString().replace(/[:.]/g, "-").split("T")[0] +
    "_" +
    new Date().toTimeString().split(" ")[0].replace(/:/g, "-");
  const runFolder = path.join(outDir, `live_run_${inputBase}_${timestamp}`);

  const defaultOutputCsv = path.join(runFolder, `${inputBase}_results.csv`);
  const defaultProgressFile = path.join(
    runFolder,
    `${inputBase}_progress.json`
  );
  const defaultJsonDir = path.join(runFolder, `${inputBase}_json`);

  const resolvedOutputCsv = options.outputCsv
    ? path.resolve(options.outputCsv)
    : defaultOutputCsv;
  const resolvedProgressFile = options.progressFile
    ? path.resolve(options.progressFile)
    : defaultProgressFile;
  const resolvedJsonDir = options.jsonDir
    ? path.resolve(options.jsonDir)
    : defaultJsonDir;

  return {
    ...options,
    input: resolvedInput,
    outputCsv: resolvedOutputCsv,
    jsonDir: resolvedJsonDir,
    progressFile: resolvedProgressFile,
    runFolder,
  };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function ensureOutputCsv(filePath) {
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
  ];
  fs.writeFileSync(filePath, stringify([header]));
}

function readInputRows(filePath, delimiter) {
  const content = fs.readFileSync(filePath, "utf8");
  return parseCsv(content, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    delimiter,
  });
}

function formatDuration(ms) {
  if (!Number.isFinite(ms)) {
    return "n/a";
  }
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (hours) parts.push(`${hours}h`);
  if (minutes || hours) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(" ");
}

function formatAvg(ms) {
  if (!Number.isFinite(ms)) return "n/a";
  return `${(ms / 1000).toFixed(1)}s`;
}

function normalizeProgress(progress) {
  Object.entries(progress.rows).forEach(([key, entry]) => {
    if (
      entry?.status === "processing" &&
      entry.jsonWritten &&
      entry.csvAppended
    ) {
      progress.rows[key] = {
        ...entry,
        status: "success",
        error: null,
      };
    }
  });
}

function loadProgress(progressFile, inputPath) {
  if (!fs.existsSync(progressFile)) {
    return { input: inputPath, rows: {}, durationsMs: [] };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(progressFile, "utf8"));
    if (parsed.input && parsed.input !== inputPath) {
      console.warn(
        `Progress file references ${parsed.input}, but current input is ${inputPath}. Starting fresh.`
      );
      return { input: inputPath, rows: {} };
    }
    const progress = {
      input: inputPath,
      rows: parsed.rows || {},
      durationsMs: parsed.durationsMs || [],
    };
    normalizeProgress(progress);
    return progress;
  } catch (error) {
    console.error("Failed to read progress file. Starting fresh.", error);
    return { input: inputPath, rows: {}, durationsMs: [] };
  }
}

function saveProgress(progressFile, progress) {
  const payload = {
    input: progress.input,
    rows: progress.rows,
    durationsMs: progress.durationsMs || [],
  };
  fs.writeFileSync(progressFile, JSON.stringify(payload, null, 2));
}

function getRowStatus(progress, rowIndex) {
  const key = String(rowIndex);
  return progress.rows[key];
}

function recordRowStatus(progress, rowIndex, data) {
  const key = String(rowIndex);
  progress.rows[key] = {
    ...(progress.rows[key] || {}),
    ...data,
    updatedAt: new Date().toISOString(),
  };
}

function shouldProcessRow(progress, rowIndex, retryErrors) {
  const entry = getRowStatus(progress, rowIndex);
  if (!entry) {
    return true;
  }
  if (entry.status === "success") {
    return false;
  }
  if (entry.status === "error") {
    return retryErrors;
  }
  return true;
}

function extractTrialId(row) {
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

function appendSummaryRow(outputCsv, summary) {
  const row = [
    summary.nct_id,
    summary.trial_id,
    summary.tool_results,
    summary.has_error,
    summary.tool_prompted_pmids,
    summary.tool_result_pmids,
    summary.tool_ident_steps,
    summary.earliest_result_publication,
    summary.earliest_result_publication_date,
    summary.failed_publication_discoveries,
    summary.failed_result_discoveries,
  ];
  fs.appendFileSync(outputCsv, stringify([row]));
}

function buildSummary({
  trialId,
  publicationErrors,
  detectionResults,
  failedResultDiscoveries,
  rowError,
}) {
  const promptedPmids = detectionResults.map((res) => res.pmid).filter(Boolean);

  const positives = detectionResults.filter((res) => res.hasResults === true);

  const toolResultPmids = positives.map((res) => res.pmid).filter(Boolean);
  const toolIdentSteps = [
    ...new Set(positives.flatMap((res) => res.sources || [])),
  ].filter(Boolean);

  // Find the earliest result publication
  const positivesWithDates = positives.filter(
    (res) => res.pmid && res.publicationDate
  );

  let earliestResultPublication = "";
  let earliestResultPublicationDate = "";

  if (positivesWithDates.length > 0) {
    // Sort by publicationDate (ascending) and take the first
    const sorted = [...positivesWithDates].sort((a, b) => {
      const dateA = a.publicationDate;
      const dateB = b.publicationDate;
      if (dateA < dateB) return -1;
      if (dateA > dateB) return 1;
      return 0;
    });

    const earliest = sorted[0];
    earliestResultPublication = earliest.pmid;
    earliestResultPublicationDate = earliest.publicationDate;
  }

  // Extract failed publication discovery sources (function names that failed)
  const failedPubDiscoveries = (publicationErrors || [])
    .map((err) => err.fn || "unknown")
    .filter(Boolean);

  const hasError =
    Boolean(rowError) ||
    (publicationErrors?.length || 0) > 0 ||
    (failedResultDiscoveries?.length || 0) > 0;

  return {
    nct_id: trialId,
    trial_id: trialId,
    tool_results: positives.length > 0,
    has_error: hasError,
    tool_prompted_pmids: promptedPmids.join(","),
    tool_result_pmids: toolResultPmids.join(","),
    tool_ident_steps: toolIdentSteps.join(","),
    earliest_result_publication: earliestResultPublication,
    earliest_result_publication_date: earliestResultPublicationDate,
    failed_publication_discoveries: failedPubDiscoveries.join(","),
    failed_result_discoveries: (failedResultDiscoveries || []).join(","),
  };
}

async function processRow({ row, rowIndex, totalRows, options, progress }) {
  const trialId = extractTrialId(row);
  if (!trialId) {
    throw new Error(`Row ${rowIndex + 1} is missing a trial_id column/value.`);
  }

  console.log(`\n[${rowIndex + 1}/${totalRows}] Processing ${trialId}...`);
  const startedAt = Date.now();

  recordRowStatus(progress, rowIndex, {
    trial_id: trialId,
    status: "processing",
  });
  saveProgress(options.progressFile, progress);

  let publicationErrors = [];
  let detectionResults = [];

  try {
    const trialData = await registrationDiscovery(trialId);
    if (trialData) {
      writeRegistrationLiveCache(trialId, trialData);
    }
    // Uses default live strategies from config
    const [publications = [], pubErrors = []] = await publicationDiscovery(
      trialId
    );

    // Apply validation filtering if enabled
    let eligiblePublications = publications;
    if (options.validationRun) {
      const dataset = row.dataset || row.Dataset;
      const maxDate = dataset === "iv" ? "2020-11-17" : "2023-02-15";
      const { eligible } = maxDateFilter(publications, maxDate);
      eligiblePublications = eligible;
      console.log(
        `  → Validation filtering (dataset=${dataset}): ${publications.length} → ${eligiblePublications.length} publications`
      );
    }

    // Filter out publications before trial start date
    let publicationsBeforeStart = [];
    if (trialData?.startDate) {
      const beforeFilterCount = eligiblePublications.length;

      const { eligible, filtered } = minDateFilter(
        eligiblePublications,
        trialData.startDate
      );

      eligiblePublications = eligible;
      publicationsBeforeStart = filtered;

      console.log(
        `  → Start date filtering: ${beforeFilterCount} → ${eligiblePublications.length} publications (${publicationsBeforeStart.length} before start)`
      );
    }

    publicationErrors = pubErrors || [];

    const publicationsWithPmids = (eligiblePublications || []).filter(
      (pub) => !!pub?.pmid
    );

    // Track failed result discoveries separately
    const failedResultDiscoveries = [];

    detectionResults = await Promise.all(
      publicationsWithPmids.map(async (pub) => {
        try {
          const detection = await resultsDiscovery(trialId, pub.pmid);
          const hasResults = detection?.content?.hasResults === true;
          return {
            pmid: pub.pmid,
            publicationDate: pub.publicationDate || null,
            sources: Array.isArray(pub.sources) ? pub.sources : [],
            publication: {
              title: pub.title || null,
              doi: pub.doi || null,
            },
            result: detection?.content || null,
            hasResults,
            tokens: detection?.tokens ?? null,
            success: detection?.success ?? false,
          };
        } catch (error) {
          console.error(
            `    ⚠ Result discovery failed for PMID ${pub.pmid}: ${error.message}`
          );
          failedResultDiscoveries.push(pub.pmid);
          return {
            pmid: pub.pmid,
            publicationDate: pub.publicationDate || null,
            sources: Array.isArray(pub.sources) ? pub.sources : [],
            publication: {
              title: pub.title || null,
              doi: pub.doi || null,
            },
            result: null,
            hasResults: false,
            tokens: null,
            success: false,
            error: error.message,
          };
        }
      })
    );

    const rowDurationMs = Date.now() - startedAt;
    const summary = buildSummary({
      trialId,
      publicationErrors,
      detectionResults,
      failedResultDiscoveries,
      rowError: null,
    });

    const payload = {
      rowIndex,
      trial_id: trialId,
      trial: trialData,
      publications: eligiblePublications,
      publicationsFilteredByStartDate: publicationsBeforeStart,
      publicationErrors,
      detectionResults,
      failedResultDiscoveries,
      summary,
      durationMs: rowDurationMs,
      processedAt: new Date().toISOString(),
    };

    const jsonPath = path.join(options.jsonDir, `${trialId}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
    recordRowStatus(progress, rowIndex, { jsonWritten: true });
    saveProgress(options.progressFile, progress);

    appendSummaryRow(options.outputCsv, summary);
    recordRowStatus(progress, rowIndex, { csvAppended: true });
    saveProgress(options.progressFile, progress);

    recordRowStatus(progress, rowIndex, {
      trial_id: trialId,
      status: "success",
      error: null,
      jsonWritten: true,
      csvAppended: true,
    });
    progress.durationsMs = progress.durationsMs || [];
    progress.durationsMs.push(rowDurationMs);
    saveProgress(options.progressFile, progress);

    console.log(
      `  ✓ Completed ${trialId} in ${formatAvg(rowDurationMs)} (publications: ${
        detectionResults.length
      })`
    );
  } catch (error) {
    console.error(`  ✗ Failed ${trialId}: ${error.message}`);
    const errorPayload = {
      rowIndex,
      trial_id: trialId,
      error: error.message,
      stack: error.stack,
      publicationErrors,
      processedAt: new Date().toISOString(),
    };
    const fileSafe = trialId || `row-${String(rowIndex + 1).padStart(4, "0")}`;
    const errorJsonPath = path.join(options.jsonDir, `${fileSafe}_error.json`);
    fs.writeFileSync(errorJsonPath, JSON.stringify(errorPayload, null, 2));

    recordRowStatus(progress, rowIndex, {
      trial_id: trialId,
      status: "error",
      error: error.message,
    });
    saveProgress(options.progressFile, progress);

    throw error;
  }
}

async function main() {
  const runStartedAt = Date.now();
  const options = parseArgs(process.argv.slice(2));

  // Ensure run folder exists (contains all outputs)
  if (options.runFolder) {
    ensureDir(options.runFolder);
  }
  ensureDir(path.dirname(options.outputCsv));
  ensureDir(options.jsonDir);
  ensureDir(path.dirname(options.progressFile));
  ensureOutputCsv(options.outputCsv);

  const rows = readInputRows(options.input, options.delimiter);
  if (rows.length === 0) {
    console.log("No rows found in the input CSV.");
    return;
  }

  // If validation run, check that dataset column exists
  if (options.validationRun) {
    if (rows.length > 0) {
      const firstRow = rows[0];
      const hasDatasetColumn = Object.keys(firstRow).some(
        (key) => key.toLowerCase() === "dataset"
      );
      if (!hasDatasetColumn) {
        console.error(
          "Error: --validation-run requires input CSV to have a 'dataset' column"
        );
        process.exit(1);
      }
    }
    console.log(
      `Validation mode enabled - will apply dataset-based date filtering`
    );
  }

  console.log(
    `\nOutput will be written to: ${
      options.runFolder || path.dirname(options.outputCsv)
    }\n`
  );

  const progress = loadProgress(options.progressFile, options.input);

  const plan = rows
    .map((row, index) => ({ row, rowIndex: index }))
    .filter(({ rowIndex }) =>
      shouldProcessRow(progress, rowIndex, options.retryErrors)
    );

  if (plan.length === 0) {
    console.log(
      options.retryErrors
        ? "No errored rows left to retry."
        : "Everything in this input file is already processed."
    );
    return;
  }

  console.log(
    `Ready to process ${plan.length} of ${rows.length} row(s)${
      options.retryErrors ? " (retrying errors only)" : ""
    }.`
  );

  let successCount = 0;
  let failureCount = 0;

  for (const item of plan) {
    try {
      await processRow({
        ...item,
        totalRows: rows.length,
        options,
        progress,
      });
      const durations = progress.durationsMs || [];
      const avgRowMs =
        durations.length > 0
          ? durations.reduce((sum, val) => sum + val, 0) / durations.length
          : 0;
      const completed = durations.length;
      const remaining = Math.max(rows.length - completed, 0);
      const estRemainingMs = avgRowMs * remaining;
      const estTotalMs = avgRowMs * rows.length;
      console.log(
        `  ⏱ Avg row: ${formatAvg(avgRowMs)} | ETA remaining: ${formatDuration(
          estRemainingMs
        )} | Est. total runtime: ${formatDuration(estTotalMs)}`
      );
      successCount += 1;
    } catch {
      failureCount += 1;
    }
  }

  const entries = Object.values(progress.rows);
  const totalSuccess = entries.filter(
    (entry) => entry.status === "success"
  ).length;
  const totalErrors = entries.filter(
    (entry) => entry.status === "error"
  ).length;
  const pending = rows.length - totalSuccess - totalErrors;

  console.log("\nRun complete.");
  console.log(
    `  This run → Success: ${successCount}, Failures: ${failureCount}`
  );
  console.log(
    `  Overall   → Success: ${totalSuccess}, Failures: ${totalErrors}, Pending: ${pending}`
  );
  console.log(
    `\n  Run folder: ${options.runFolder || path.dirname(options.outputCsv)}`
  );
  console.log(`  Output CSV: ${options.outputCsv}`);
  console.log(`  JSON dir:   ${options.jsonDir}`);
  if ((progress.durationsMs || []).length) {
    const avgRowMs =
      progress.durationsMs.reduce((sum, val) => sum + val, 0) /
      progress.durationsMs.length;
    console.log(
      `  Avg row time: ${formatAvg(avgRowMs)} over ${
        progress.durationsMs.length
      } row(s)`
    );
  }
  console.log(
    `  Actual runtime this session: ${formatDuration(
      Date.now() - runStartedAt
    )}`
  );
  console.log(`  Progress:   ${options.progressFile}`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
