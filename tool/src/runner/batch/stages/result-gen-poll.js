import OpenAI from "openai";
import { STAGES } from "../utils/constants.js";
import { saveProgress } from "../utils/progress.js";
import { sleep } from "../utils/helpers.js";

const openai = new OpenAI();

export async function stageResultGenPoll({ options, progress }) {
  console.log("\n[RESULT_GEN_POLL] Polling for batch completion...");

  const resultDetection = progress.batchJobs.resultDetection;
  if (!resultDetection || !resultDetection.chunks) {
    throw new Error("No result detection chunks found in progress");
  }

  const { chunks } = resultDetection;

  // Find all chunks with status "uploaded"
  const uploadedChunks = chunks.filter(
    (c) =>
      c.status === "uploaded" ||
      c.status === "in_progress" ||
      c.status == "finalizing" ||
      c.status == "validating"
  );

  if (uploadedChunks.length === 0) {
    console.log("  → No uploaded chunks to poll");
    progress.stage = STAGES.RESULT_GEN_PROCESS;
    saveProgress(options.progressFile, progress);
    return;
  }

  console.log(
    `  → Polling ${uploadedChunks.length} chunk${
      uploadedChunks.length > 1 ? "s" : ""
    }...`
  );

  while (true) {
    // Poll all uploaded chunks in parallel
    const pollPromises = uploadedChunks.map((chunk) =>
      openai.batches.retrieve(chunk.batchId)
    );
    const statuses = await Promise.all(pollPromises);

    // Update each chunk status
    let anyFailed = false;
    let allCompleted = true;

    statuses.forEach((batch, idx) => {
      const chunk = uploadedChunks[idx];

      // Update chunk status
      chunk.status = batch.status;

      if (batch.status === "completed") {
        if (!batch.output_file_id) {
          throw new Error(
            `Batch ${chunk.batchId} completed but output_file_id is missing`
          );
        }
        chunk.status = "completed";
        chunk.outputFileId = batch.output_file_id;
        chunk.completedAt = new Date().toISOString();

        console.log(
          `  ✓ Chunk ${chunk.index} completed (${
            batch.request_counts?.completed || 0
          }/${batch.request_counts?.total || 0} requests)`
        );
      } else if (["failed", "expired", "cancelled"].includes(batch.status)) {
        anyFailed = true;
        throw new Error(
          `Chunk ${chunk.index} batch ${batch.status}: ${chunk.batchId}`
        );
      } else {
        allCompleted = false;
        console.log(
          `  → Chunk ${chunk.index}: ${batch.status} | ${
            batch.request_counts?.completed || 0
          }/${batch.request_counts?.total || 0} requests`
        );
      }
    });

    saveProgress(options.progressFile, progress);

    // Check if all uploaded chunks are complete
    if (allCompleted) {
      console.log(
        `  ✓ All ${uploadedChunks.length} chunk${
          uploadedChunks.length > 1 ? "s" : ""
        } completed!`
      );
      progress.stage = STAGES.RESULT_GEN_PROCESS;
      saveProgress(options.progressFile, progress);
      return;
    }

    // Wait before next poll
    console.log(`  ⏱ Waiting ${options.pollInterval}s before next poll...`);
    await sleep(options.pollInterval * 1000);
  }
}
