import fs from "node:fs";
import path from "node:path";
import config from "config";
import OpenAI from "openai";
import { STAGES } from "../utils/constants.js";
import { saveProgress } from "../utils/progress.js";

const openai = new OpenAI();

export async function stageResultGenUpload({ options, progress }) {
  console.log("\n[RESULT_GEN_UPLOAD] Uploading batch chunks...");

  const resultDetection = progress.batchJobs.resultDetection;
  if (!resultDetection || !resultDetection.chunks) {
    throw new Error("No result detection chunks found in progress");
  }

  const { chunks, dailyTokensUsed } = resultDetection;

  // Reset daily quota if new day
  const today = new Date().toISOString().split("T")[0];
  if (dailyTokensUsed.date !== today) {
    console.log(`  → New day detected, resetting daily token quota`);
    dailyTokensUsed.date = today;
    dailyTokensUsed.tokens = 0;
  }

  const maxTokensPerDay = config.get("batch.maxTokensPerDay");
  console.log(
    `  → Daily quota: ${Math.ceil(dailyTokensUsed.tokens / 1000000)}M/${Math.ceil(maxTokensPerDay / 1000000)}M tokens used`
  );

  // Find all chunks with status "pending" (sorted by index)
  const pendingChunks = chunks
    .filter((c) => c.status === "pending")
    .sort((a, b) => a.index - b.index);

  if (pendingChunks.length === 0) {
    console.log("  → No pending chunks to upload");
    progress.stage = STAGES.RESULT_GEN_POLL;
    saveProgress(options.progressFile, progress);
    return;
  }

  console.log(
    `  → Found ${pendingChunks.length} pending chunk${pendingChunks.length > 1 ? "s" : ""}`
  );

  // Calculate how many chunks fit in remaining daily quota
  const chunksToUpload = [];
  let tokenBudget = maxTokensPerDay - dailyTokensUsed.tokens;

  for (const chunk of pendingChunks) {
    if (chunk.estimatedTokens <= tokenBudget) {
      chunksToUpload.push(chunk);
      tokenBudget -= chunk.estimatedTokens;
    } else {
      break; // Stop when we can't fit the next chunk
    }
  }

  // Error if quota exhausted and no chunks can be uploaded
  if (chunksToUpload.length === 0 && pendingChunks.length > 0) {
    const nextChunk = pendingChunks[0];
    throw new Error(
      `Daily token quota exhausted (${Math.ceil(dailyTokensUsed.tokens / 1000000)}M/${Math.ceil(maxTokensPerDay / 1000000)}M tokens used). ` +
        `Next chunk (${nextChunk.index}) needs ${Math.ceil(nextChunk.estimatedTokens / 1000000)}M tokens. ` +
        `Restart tomorrow to continue.`
    );
  }

  console.log(
    `  → Uploading ${chunksToUpload.length} chunk${chunksToUpload.length > 1 ? "s" : ""} in parallel (${Math.ceil(chunksToUpload.reduce((sum, c) => sum + c.estimatedTokens, 0) / 1000000)}M tokens)...`
  );

  // Upload all eligible chunks in parallel
  const completionWindow = config.get("batch.completionWindow");

  const uploadPromises = chunksToUpload.map(async (chunk) => {
    const chunkPath = path.join(options.batchDir, chunk.inputFile);

    // Upload file
    const file = await openai.files.create({
      file: fs.createReadStream(chunkPath),
      purpose: "batch",
    });

    // Create batch job
    const batch = await openai.batches.create({
      input_file_id: file.id,
      endpoint: "/v1/responses",
      completion_window: completionWindow,
    });

    // Update chunk metadata
    chunk.status = "uploaded";
    chunk.batchId = batch.id;
    chunk.inputFileId = file.id;
    chunk.uploadedAt = new Date().toISOString();

    // Increment daily token usage
    dailyTokensUsed.tokens += chunk.estimatedTokens;

    console.log(`  ✓ Chunk ${chunk.index} uploaded: ${batch.id}`);

    return batch;
  });

  await Promise.all(uploadPromises);

  console.log(
    `  → Daily quota now: ${Math.ceil(dailyTokensUsed.tokens / 1000000)}M/${Math.ceil(maxTokensPerDay / 1000000)}M tokens used`
  );

  // Check if there are still pending chunks
  const remainingPending = chunks.filter((c) => c.status === "pending");
  if (remainingPending.length > 0) {
    console.log(
      `  → ${remainingPending.length} chunk${remainingPending.length > 1 ? "s" : ""} remaining (will upload after current batches complete)`
    );
  }

  progress.stage = STAGES.RESULT_GEN_POLL;
  saveProgress(options.progressFile, progress);
}
