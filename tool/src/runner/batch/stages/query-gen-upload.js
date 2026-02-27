import fs from "node:fs";
import path from "node:path";
import config from "config";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import {
  PubmedGptQueryOutput,
  PubmedGptQueryOutputV2,
} from "../../../discovery/publication/index.js";
import { STAGES, BATCH_API_LIMIT } from "../utils/constants.js";
import { extractTrialId, ensureDir } from "../utils/io.js";
import { saveProgress } from "../utils/progress.js";

const openai = new OpenAI();

export async function stageQueryGenUpload({ rows, options, progress }) {
  // Determine which query versions to generate based on configured strategies
  const strategies = config.get("batch.strategies");
  const useV1 = strategies.includes("pubmed_gpt_v1_batch");
  const useV2 = strategies.includes("pubmed_gpt_v2_batch");

  // Skip if no query generation strategies are configured
  if (!useV1 && !useV2) {
    console.log(
      "\n[QUERY_GEN_UPLOAD] No query generation strategies configured, skipping..."
    );
    progress.stage = STAGES.PUB_DISCOVERY;
    saveProgress(options.progressFile, progress);
    return;
  }

  const versionsEnabled = [];
  if (useV1) versionsEnabled.push("v1");
  if (useV2) versionsEnabled.push("v2");

  console.log(
    `\n[QUERY_GEN_UPLOAD] Generating query batch jobs (${versionsEnabled.join(" + ")})...`
  );

  ensureDir(options.batchDir);

  // Get valid trials
  const validTrials = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const trialId = extractTrialId(row);
    if (!trialId) continue;

    const registration = progress.registrations[trialId];
    if (!registration) {
      console.warn(`  ⚠ No registration data for ${trialId}, skipping`);
      progress.skippedCounts.noRegistration += 1;
      continue;
    }

    validTrials.push({ trialId, registration });
  }
  saveProgress(options.progressFile, progress);

  if (validTrials.length === 0) {
    console.log("  ⚠ No valid trials to process, skipping query generation");
    progress.stage = STAGES.PUB_DISCOVERY;
    saveProgress(options.progressFile, progress);
    return;
  }

  // Generate and upload V1 batch job
  if (useV1) {
    console.log(`\n  [V1] Generating legacy query batch job...`);
    const systemPromptV1 = fs
      .readFileSync(config.get("batch.systemPromptQueriesV1"))
      .toString();

    const maxTokensV1 = config.get("batch.maxTokensQueryV1") || 10000;
    const modelV1 = config.get("batch.modelQueryV1");
    const reasoningEffortV1 = config.get("batch.reasoningEffortQueryV1");
    const batchRequestsV1 = validTrials.map(({ trialId, registration }) => ({
      custom_id: trialId,
      method: "POST",
      url: "/v1/responses",
      body: {
        model: modelV1,
        max_output_tokens: maxTokensV1,
        reasoning: { effort: reasoningEffortV1 },
        input: [
          { role: "developer", content: systemPromptV1 },
          { role: "user", content: JSON.stringify(registration) },
        ],
        text: {
          format: zodTextFormat(
            PubmedGptQueryOutput,
            "pubmed_search_format"
          ),
        },
      },
    }));

    const queryInputPathV1 = path.join(
      options.batchDir,
      "query_gen_v1_input.jsonl"
    );
    const jsonlContentV1 = batchRequestsV1
      .map((req) => JSON.stringify(req))
      .join("\n");
    fs.writeFileSync(queryInputPathV1, jsonlContentV1);

    console.log(`    ✓ Generated ${batchRequestsV1.length} V1 query requests`);

    if (batchRequestsV1.length > BATCH_API_LIMIT) {
      throw new Error(
        `V1 batch size (${batchRequestsV1.length}) exceeds OpenAI Batch API limit (${BATCH_API_LIMIT})`
      );
    }

    console.log(`    → Uploading V1 batch to OpenAI...`);

    const fileV1 = await openai.files.create({
      file: fs.createReadStream(queryInputPathV1),
      purpose: "batch",
    });

    const completionWindow = config.get("batch.completionWindow");
    const batchV1 = await openai.batches.create({
      input_file_id: fileV1.id,
      endpoint: "/v1/responses",
      completion_window: completionWindow,
    });

    console.log(
      `    ✓ V1 batch job created: ${batchV1.id} (status: ${batchV1.status})`
    );

    progress.batchJobs.queryGenV1 = {
      id: batchV1.id,
      status: batchV1.status,
      createdAt: new Date().toISOString(),
      inputFileId: fileV1.id,
    };
    saveProgress(options.progressFile, progress);
  }

  // Generate and upload V2 batch job
  if (useV2) {
    console.log(`\n  [V2] Generating advanced query batch job...`);
    const systemPromptV2 = fs
      .readFileSync(config.get("batch.systemPromptQueriesV2"))
      .toString();

    const maxTokensV2 = config.get("batch.maxTokensQueryV2") || 10000;
    const modelV2 = config.get("batch.modelQueryV2");
    const reasoningEffortV2 = config.get("batch.reasoningEffortQueryV2");
    const batchRequestsV2 = validTrials.map(({ trialId, registration }) => ({
      custom_id: trialId,
      method: "POST",
      url: "/v1/responses",
      body: {
        model: modelV2,
        max_output_tokens: maxTokensV2,
        reasoning: { effort: reasoningEffortV2 },
        input: [
          { role: "developer", content: systemPromptV2 },
          { role: "user", content: JSON.stringify(registration) },
        ],
        text: {
          format: zodTextFormat(
            PubmedGptQueryOutputV2,
            "pubmed_search_format_v2"
          ),
        },
      },
    }));

    const queryInputPathV2 = path.join(
      options.batchDir,
      "query_gen_v2_input.jsonl"
    );
    const jsonlContentV2 = batchRequestsV2
      .map((req) => JSON.stringify(req))
      .join("\n");
    fs.writeFileSync(queryInputPathV2, jsonlContentV2);

    console.log(`    ✓ Generated ${batchRequestsV2.length} V2 query requests`);

    if (batchRequestsV2.length > BATCH_API_LIMIT) {
      throw new Error(
        `V2 batch size (${batchRequestsV2.length}) exceeds OpenAI Batch API limit (${BATCH_API_LIMIT})`
      );
    }

    console.log(`    → Uploading V2 batch to OpenAI...`);

    const fileV2 = await openai.files.create({
      file: fs.createReadStream(queryInputPathV2),
      purpose: "batch",
    });

    const completionWindow = config.get("batch.completionWindow");
    const batchV2 = await openai.batches.create({
      input_file_id: fileV2.id,
      endpoint: "/v1/responses",
      completion_window: completionWindow,
    });

    console.log(
      `    ✓ V2 batch job created: ${batchV2.id} (status: ${batchV2.status})`
    );

    progress.batchJobs.queryGenV2 = {
      id: batchV2.id,
      status: batchV2.status,
      createdAt: new Date().toISOString(),
      inputFileId: fileV2.id,
    };
    saveProgress(options.progressFile, progress);
  }

  progress.stage = STAGES.QUERY_GEN_POLL;
  saveProgress(options.progressFile, progress);
}
