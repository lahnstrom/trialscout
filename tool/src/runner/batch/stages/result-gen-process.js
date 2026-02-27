import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { STAGES } from "../utils/constants.js";
import { ensureDir } from "../utils/io.js";
import { saveProgress } from "../utils/progress.js";

const openai = new OpenAI();

export async function stageResultGenProcess({ options, progress }) {
  console.log("\n[RESULT_GEN_PROCESS] Processing completed chunks...");

  const resultDetection = progress.batchJobs.resultDetection;
  if (!resultDetection || !resultDetection.chunks) {
    throw new Error("No result detection chunks found in progress");
  }

  const { chunks } = resultDetection;

  // Find all chunks with status "completed" (not yet processed)
  const completedChunks = chunks.filter((c) => c.status === "completed");

  if (completedChunks.length === 0) {
    console.log("  → No completed chunks to process");

    // Check if there are pending chunks to loop back to upload
    const pendingChunks = chunks.filter((c) => c.status === "pending");
    if (pendingChunks.length > 0) {
      console.log(
        `  ⟲ ${pendingChunks.length} chunk${pendingChunks.length > 1 ? "s" : ""} remaining, looping back to upload...`
      );
      progress.stage = STAGES.RESULT_GEN_UPLOAD;
    } else {
      progress.stage = STAGES.FINALIZE;
    }
    saveProgress(options.progressFile, progress);
    return;
  }

  console.log(
    `  → Processing ${completedChunks.length} chunk${completedChunks.length > 1 ? "s" : ""}...`
  );

  // Ensure result output directory exists
  const resultResultsDir = path.join(options.batchDir, "result_results");
  ensureDir(resultResultsDir);

  let totalSuccessCount = 0;
  let totalErrorCount = 0;

  // Process each completed chunk
  for (const chunk of completedChunks) {
    console.log(`  → Processing chunk ${chunk.index}...`);

    if (!chunk.outputFileId) {
      throw new Error(`Chunk ${chunk.index} has no output file ID`);
    }

    // Download output file
    const fileResponse = await openai.files.content(chunk.outputFileId);
    const fileContent = await fileResponse.text();

    // Save output file
    const chunkOutputPath = path.join(
      options.batchDir,
      `result_gen_output_chunk_${chunk.index}.jsonl`
    );
    fs.writeFileSync(chunkOutputPath, fileContent);

    // Process results from this chunk
    const lines = fileContent.trim().split("\n");
    let successCount = 0;
    let errorCount = 0;

    for (const line of lines) {
      const result = JSON.parse(line);
      const customId = result.custom_id; // Format: "NCT123__12345678"

      if (result.error) {
        console.error(`    ✗ Error for ${customId}: ${result.error.message}`);
        errorCount += 1;
        continue;
      }

      try {
        const messageOutput = result.response.body.output?.find(o => o.type === "message");
        const content = messageOutput?.content?.find(c => c.type === "output_text")?.text;
        if (!content) throw new Error("Unexpected API response structure: missing message content");
        const parsed = JSON.parse(content);

        const resultPath = path.join(resultResultsDir, `${customId}.json`);
        fs.writeFileSync(
          resultPath,
          JSON.stringify(
            {
              content: parsed,
              tokens: result.response.body.usage,
              success: true,
            },
            null,
            2
          )
        );
        successCount += 1;
      } catch (error) {
        console.error(
          `    ✗ Failed to parse result for ${customId}: ${error.message}`
        );
        errorCount += 1;
      }
    }

    console.log(
      `    ✓ Chunk ${chunk.index}: ${successCount} results (${errorCount} errors)`
    );

    totalSuccessCount += successCount;
    totalErrorCount += errorCount;

    // Mark chunk as processed
    chunk.status = "processed";
    chunk.processedAt = new Date().toISOString();

    saveProgress(options.progressFile, progress);
  }

  console.log(
    `  ✓ Total: ${totalSuccessCount} result detections (${totalErrorCount} errors)`
  );

  // Check if there are still pending chunks
  const pendingChunks = chunks.filter((c) => c.status === "pending");
  if (pendingChunks.length > 0) {
    console.log(
      `\n  ⟲ ${pendingChunks.length} chunk${pendingChunks.length > 1 ? "s" : ""} remaining, looping back to upload...`
    );
    progress.stage = STAGES.RESULT_GEN_UPLOAD;
  } else {
    console.log(`  ✓ All chunks processed!`);
    progress.stage = STAGES.FINALIZE;
  }

  saveProgress(options.progressFile, progress);
}
