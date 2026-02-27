import fs from "node:fs";
import path from "node:path";
import config from "config";
import { zodTextFormat } from "openai/helpers/zod";
import { SinglePublicationOutput } from "../../../discovery/results.js";
import { STAGES } from "../utils/constants.js";
import { extractTrialId } from "../utils/io.js";
import { saveProgress } from "../utils/progress.js";

export async function stageResultGenPreparation({ rows, options, progress }) {
  console.log(
    "\n[RESULT_GEN_PREPARATION] Building batch chunks for result detection..."
  );

  // Read configuration
  const systemPrompt = fs
    .readFileSync(config.get("batch.systemPromptResults"))
    .toString();
  const maxTokensResults = config.get("batch.maxTokensResults") || 10000;
  const modelResults = config.get("batch.modelResults");
  const reasoningEffort = config.get("batch.reasoningEffortResults");

  // Read batch limits from config
  const maxRequestsPerBatch = config.get("batch.maxRequestsPerBatch");
  const maxBytesPerBatch = config.get("batch.maxBytesPerBatch");
  const safetyBuffer = config.get("batch.safetyBuffer");

  // Calculate effective limits with safety buffer
  const effectiveMaxBytes = Math.floor(maxBytesPerBatch * safetyBuffer);

  // Calculate system prompt tokens once (reused for all requests)
  const systemTokensPerRequest = Math.ceil(systemPrompt.length / 4);

  // Initialize first chunk
  let currentChunk = {
    index: 0,
    requests: [],
    tokens: 0,
    bytes: 0,
  };
  const chunks = [currentChunk];

  // Build requests and split into chunks incrementally
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const trialId = extractTrialId(row);
    if (!trialId) continue;

    const registration = progress.registrations[trialId];
    const pubData = progress.publications[trialId];

    if (!registration || !pubData) {
      continue;
    }

    const publications = pubData.publications || [];
    const publicationsWithPmids = publications.filter((pub) => !!pub?.pmid);

    for (const pub of publicationsWithPmids) {
      // Exclude hasResults to avoid biasing ChatGPT
      const { hasResults, ...cleanedRegistration } = registration;

      // Build user prompt
      const userPrompt = JSON.stringify({
        registration: cleanedRegistration,
        publication: {
          pmid: pub.pmid,
          title: pub.title || null,
          abstract: pub.abstract || null,
        },
      });

      // Calculate user prompt tokens
      const userTokens = Math.ceil(userPrompt.length / 4);
      const requestTotalTokens = systemTokensPerRequest + userTokens;

      // Build full batch request
      const request = {
        custom_id: `${trialId}__${pub.pmid}`,
        method: "POST",
        url: "/v1/responses",
        body: {
          model: modelResults,
          max_output_tokens: maxTokensResults,
          reasoning: { effort: reasoningEffort },
          input: [
            { role: "developer", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          text: {
            format: zodTextFormat(
              SinglePublicationOutput,
              "single_publication_format"
            ),
          },
        },
      };

      // Calculate request size in bytes
      const requestJson = JSON.stringify(request);
      const requestBytes = Buffer.byteLength(requestJson, "utf8");

      // Check if adding this request would exceed chunk limits
      if (
        currentChunk.requests.length >= maxRequestsPerBatch ||
        currentChunk.bytes + requestBytes > effectiveMaxBytes
      ) {
        // Finalize current chunk - write to file
        const filename = `result_gen_input_chunk_${currentChunk.index}.jsonl`;
        const chunkPath = path.join(options.batchDir, filename);
        const jsonlContent = currentChunk.requests
          .map((req) => JSON.stringify(req))
          .join("\n");
        fs.writeFileSync(chunkPath, jsonlContent);

        console.log(
          `  ✓ Chunk ${currentChunk.index}: ${
            currentChunk.requests.length
          } requests, ${Math.ceil(
            currentChunk.tokens / 1000000
          )}M tokens, ${Math.ceil(currentChunk.bytes / 1000000)}MB`
        );

        // Start new chunk
        currentChunk = {
          index: chunks.length,
          requests: [],
          tokens: 0,
          bytes: 0,
        };
        chunks.push(currentChunk);
      }

      // Add request to current chunk
      currentChunk.requests.push(request);
      currentChunk.tokens += requestTotalTokens;
      currentChunk.bytes += requestBytes;
    }
  }

  // Write final chunk if it has any requests
  if (currentChunk.requests.length > 0) {
    const filename = `result_gen_input_chunk_${currentChunk.index}.jsonl`;
    const chunkPath = path.join(options.batchDir, filename);
    const jsonlContent = currentChunk.requests
      .map((req) => JSON.stringify(req))
      .join("\n");
    fs.writeFileSync(chunkPath, jsonlContent);

    console.log(
      `  ✓ Chunk ${currentChunk.index}: ${
        currentChunk.requests.length
      } requests, ${Math.ceil(
        currentChunk.tokens / 1000000
      )}M tokens, ${Math.ceil(currentChunk.bytes / 1000000)}MB`
    );
  } else {
    // Remove empty chunk
    chunks.pop();
  }

  if (chunks.length === 0) {
    console.log("  ⚠ No publications to analyze, skipping result detection");
    progress.stage = STAGES.FINALIZE;
    saveProgress(options.progressFile, progress);
    return;
  }

  // Build chunks metadata for progress
  const chunksMetadata = chunks.map((chunk) => ({
    index: chunk.index,
    inputFile: `result_gen_input_chunk_${chunk.index}.jsonl`,
    requestCount: chunk.requests.length,
    estimatedTokens: chunk.tokens,
    sizeBytes: chunk.bytes,
    status: "pending",
  }));

  // Calculate total tokens across all chunks
  const totalEstimatedTokens = chunksMetadata.reduce(
    (sum, chunk) => sum + chunk.estimatedTokens,
    0
  );

  // Initialize progress structure for result detection
  progress.batchJobs.resultDetection = {
    chunks: chunksMetadata,
    dailyTokensUsed: {
      date: new Date().toISOString().split("T")[0],
      tokens: 0,
    },
    totalEstimatedTokens,
  };

  // Log summary
  const maxTokensPerDay = config.get("batch.maxTokensPerDay");
  const estimatedDays = Math.ceil(totalEstimatedTokens / maxTokensPerDay);

  console.log(
    `\n  ✓ Created ${chunks.length} chunk${
      chunks.length > 1 ? "s" : ""
    } (${Math.ceil(totalEstimatedTokens / 1000000)}M tokens total)`
  );

  if (estimatedDays > 1) {
    console.log(
      `  ⚠ Total tokens (${Math.ceil(
        totalEstimatedTokens / 1000000
      )}M) may require multiple days given ${Math.ceil(
        maxTokensPerDay / 1000000
      )}M/day limit`
    );
  }

  progress.stage = STAGES.RESULT_GEN_UPLOAD;
  saveProgress(options.progressFile, progress);
}
