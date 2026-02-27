#!/usr/bin/env node

import "dotenv/config";
import path from "node:path";
import process from "node:process";
import { STAGES } from "./utils/constants.js";
import { parseArgs, waitForUserInput } from "./utils/cli.js";
import { ensureDir, readInputRows } from "./utils/io.js";
import { loadProgress } from "./utils/progress.js";
import { formatDuration } from "./utils/helpers.js";
import { stagePrepRegistrations } from "./stages/prep.js";
import { stageQueryGenUpload } from "./stages/query-gen-upload.js";
import { stageQueryGenPoll } from "./stages/query-gen-poll.js";
import { stageQueryGenProcess } from "./stages/query-gen-process.js";
import { stagePubDiscovery } from "./stages/pub-discovery.js";
import { stageResultGenPreparation } from "./stages/result-gen-preparation.js";
import { stageResultGenUpload } from "./stages/result-gen-upload.js";
import { stageResultGenPoll } from "./stages/result-gen-poll.js";
import { stageResultGenProcess } from "./stages/result-gen-process.js";
import { stageFinalize } from "./stages/finalize.js";
import { stageCostCalculation } from "./stages/cost-calculation.js";

async function main() {
  const runStartedAt = Date.now();
  const options = parseArgs(process.argv.slice(2));

  ensureDir(path.dirname(options.outputCsv));
  ensureDir(options.jsonDir);
  ensureDir(options.batchDir);
  ensureDir(path.dirname(options.progressFile));

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

  const progress = loadProgress(options.progressFile, options.input);

  console.log(`\n========================================`);
  console.log(`Batch Tool Runner`);
  console.log(`========================================`);
  console.log(`Input:    ${options.input}`);
  console.log(`Rows:     ${rows.length}`);
  console.log(`Stage:    ${progress.stage}`);
  console.log(`Started:  ${progress.startedAt}`);
  console.log(`========================================`);

  const context = { rows, options, progress };

  // State machine - resume from current stage
  while (progress.stage !== STAGES.COMPLETE) {
    const currentStage = progress.stage;

    try {
      switch (currentStage) {
        case STAGES.PREP:
          await stagePrepRegistrations(context);
          break;
        case STAGES.QUERY_GEN_UPLOAD:
          await stageQueryGenUpload(context);
          break;
        case STAGES.QUERY_GEN_POLL:
          await stageQueryGenPoll(context);
          break;
        case STAGES.QUERY_GEN_PROCESS:
          await stageQueryGenProcess(context);
          break;
        case STAGES.PUB_DISCOVERY:
          await stagePubDiscovery(context);
          break;
        case STAGES.RESULT_GEN_PREPARATION:
          await stageResultGenPreparation(context);
          break;
        case STAGES.RESULT_GEN_UPLOAD:
          await stageResultGenUpload(context);
          break;
        case STAGES.RESULT_GEN_POLL:
          await stageResultGenPoll(context);
          break;
        case STAGES.RESULT_GEN_PROCESS:
          await stageResultGenProcess(context);
          break;
        case STAGES.FINALIZE:
          await stageFinalize(context);
          break;
        case STAGES.COST_CALCULATION:
          await stageCostCalculation(context);
          break;
        default:
          throw new Error(`Unknown stage: ${currentStage}`);
      }

      // Wait for user input if step-by-step mode is enabled
      if (options.stepByStep && progress.stage !== STAGES.COMPLETE) {
        await waitForUserInput(
          currentStage,
          progress.stage,
          progress,
          runStartedAt
        );
      }
    } catch (error) {
      console.error(`\n✗ Error in stage ${currentStage}: ${error.message}`);
      console.error(`  You can restart the script to resume from this stage.`);
      throw error;
    }
  }

  // Final summary
  const entries = Object.values(progress.rows);
  const totalSuccess = entries.filter(
    (entry) => entry.status === "success"
  ).length;
  const totalErrors = entries.filter(
    (entry) => entry.status === "error"
  ).length;

  console.log("\n========================================");
  console.log("Run Complete!");
  console.log("========================================");
  console.log(`Success:  ${totalSuccess} trials`);
  console.log(`Errors:   ${totalErrors} trials`);
  console.log(
    `Skipped (no trial ID):     ${progress.skippedCounts.noTrialId} trials`
  );
  console.log(
    `Skipped (no registration): ${progress.skippedCounts.noRegistration} trials`
  );
  console.log(`Output:   ${options.outputCsv}`);
  console.log(`JSON:     ${options.jsonDir}`);
  console.log(`Runtime:  ${formatDuration(Date.now() - runStartedAt)}`);
  console.log("========================================");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
