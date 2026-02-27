import config from "config";
import OpenAI from "openai";
import { STAGES } from "../utils/constants.js";
import { saveProgress } from "../utils/progress.js";
import { sleep } from "../utils/helpers.js";

const openai = new OpenAI();

export async function stageQueryGenPoll({ options, progress }) {
  // Determine which query versions to poll based on configured strategies
  const strategies = config.get("batch.strategies");
  const useV1 = strategies.includes("pubmed_gpt_v1_batch");
  const useV2 = strategies.includes("pubmed_gpt_v2_batch");

  const batchV1Id = progress.batchJobs.queryGenV1?.id;
  const batchV2Id = progress.batchJobs.queryGenV2?.id;

  if ((useV1 && !batchV1Id) || (useV2 && !batchV2Id)) {
    console.error("  ✗ Missing query batch job ID(s) in progress");
    throw new Error("Missing query batch job ID");
  }

  console.log(`\n[QUERY_GEN_POLL] Polling for query batch job(s)...`);

  while (true) {
    let allCompleted = true;
    let anyFailed = false;

    // Poll V1 batch
    if (useV1 && batchV1Id) {
      const batchV1 = await openai.batches.retrieve(batchV1Id);
      progress.batchJobs.queryGenV1.status = batchV1.status;

      console.log(
        `  [V1] Status: ${batchV1.status} | Completed: ${
          batchV1.request_counts?.completed || 0
        }/${batchV1.request_counts?.total || 0}`
      );

      if (batchV1.status === "completed") {
        if (!batchV1.output_file_id) {
          throw new Error(
            `V1 batch completed but output_file_id is missing: ${batchV1Id}`
          );
        }
        progress.batchJobs.queryGenV1.outputFileId = batchV1.output_file_id;
      } else if (["failed", "expired", "cancelled"].includes(batchV1.status)) {
        anyFailed = true;
      } else {
        allCompleted = false;
      }
    }

    // Poll V2 batch
    if (useV2 && batchV2Id) {
      const batchV2 = await openai.batches.retrieve(batchV2Id);
      progress.batchJobs.queryGenV2.status = batchV2.status;

      console.log(
        `  [V2] Status: ${batchV2.status} | Completed: ${
          batchV2.request_counts?.completed || 0
        }/${batchV2.request_counts?.total || 0}`
      );

      if (batchV2.status === "completed") {
        if (!batchV2.output_file_id) {
          throw new Error(
            `V2 batch completed but output_file_id is missing: ${batchV2Id}`
          );
        }
        progress.batchJobs.queryGenV2.outputFileId = batchV2.output_file_id;
      } else if (["failed", "expired", "cancelled"].includes(batchV2.status)) {
        anyFailed = true;
      } else {
        allCompleted = false;
      }
    }

    saveProgress(options.progressFile, progress);

    if (anyFailed) {
      throw new Error(`One or more batch jobs failed/expired/cancelled`);
    }

    if (allCompleted) {
      progress.stage = STAGES.QUERY_GEN_PROCESS;
      saveProgress(options.progressFile, progress);
      console.log(`  ✓ All batch jobs completed!`);
      return;
    }

    console.log(`  ⏱ Waiting ${options.pollInterval}s before next poll...`);
    await sleep(options.pollInterval * 1000);
  }
}
