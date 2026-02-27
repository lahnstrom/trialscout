import fs from "node:fs";
import path from "node:path";
import config from "config";
import OpenAI from "openai";
import { STAGES } from "../utils/constants.js";
import { ensureDir } from "../utils/io.js";
import { saveProgress } from "../utils/progress.js";

const openai = new OpenAI();

export async function stageQueryGenProcess({ options, progress }) {
  // Determine which query versions to process based on configured strategies
  const strategies = config.get("batch.strategies");
  const useV1 = strategies.includes("pubmed_gpt_v1_batch");
  const useV2 = strategies.includes("pubmed_gpt_v2_batch");

  console.log(
    `\n[QUERY_GEN_PROCESS] Downloading and processing query results...`
  );

  // Process V1 results
  if (useV1) {
    const outputFileIdV1 = progress.batchJobs.queryGenV1?.outputFileId;
    if (!outputFileIdV1) {
      console.error("  ✗ No V1 output file ID found");
      throw new Error("Missing V1 query batch output file ID");
    }

    console.log(`\n  [V1] Downloading results from ${outputFileIdV1}...`);

    const fileResponseV1 = await openai.files.content(outputFileIdV1);
    const fileContentV1 = await fileResponseV1.text();

    const queryOutputPathV1 = path.join(
      options.batchDir,
      "query_gen_v1_output.jsonl"
    );
    fs.writeFileSync(queryOutputPathV1, fileContentV1);

    console.log(`    ✓ Downloaded to ${queryOutputPathV1}`);

    // Process V1 results to global ./batch_results/queries/
    const linesV1 = fileContentV1.trim().split("\n");
    const queryResultsDirV1 = "./batch_results/queries";
    ensureDir(queryResultsDirV1);

    let successCountV1 = 0;
    let errorCountV1 = 0;

    for (const line of linesV1) {
      const result = JSON.parse(line);
      const trialId = result.custom_id;

      if (result.error) {
        console.error(`    ✗ Error for ${trialId}: ${result.error.message}`);
        errorCountV1 += 1;
        continue;
      }

      try {
        const messageOutput = result.response.body.output?.find(o => o.type === "message");
        const content = messageOutput?.content?.find(c => c.type === "output_text")?.text;
        if (!content) throw new Error("Unexpected API response structure: missing message content");
        const parsed = JSON.parse(content);

        const resultPath = path.join(queryResultsDirV1, `${trialId}.json`);
        fs.writeFileSync(resultPath, JSON.stringify(parsed, null, 2));
        successCountV1 += 1;
      } catch (error) {
        console.error(
          `    ✗ Failed to parse result for ${trialId}: ${error.message}`
        );
        errorCountV1 += 1;
      }
    }

    console.log(
      `    ✓ Processed ${successCountV1} V1 query results (${errorCountV1} errors)`
    );
  }

  // Process V2 results
  if (useV2) {
    const outputFileIdV2 = progress.batchJobs.queryGenV2?.outputFileId;
    if (!outputFileIdV2) {
      console.error("  ✗ No V2 output file ID found");
      throw new Error("Missing V2 query batch output file ID");
    }

    console.log(`\n  [V2] Downloading results from ${outputFileIdV2}...`);

    const fileResponseV2 = await openai.files.content(outputFileIdV2);
    const fileContentV2 = await fileResponseV2.text();

    const queryOutputPathV2 = path.join(
      options.batchDir,
      "query_gen_v2_output.jsonl"
    );
    fs.writeFileSync(queryOutputPathV2, fileContentV2);

    console.log(`    ✓ Downloaded to ${queryOutputPathV2}`);

    // Process V2 results to global ./batch_results/queries_v2/
    const linesV2 = fileContentV2.trim().split("\n");
    const queryResultsDirV2 = "./batch_results/queries_v2";
    ensureDir(queryResultsDirV2);

    let successCountV2 = 0;
    let errorCountV2 = 0;

    for (const line of linesV2) {
      const result = JSON.parse(line);
      const trialId = result.custom_id;

      if (result.error) {
        console.error(`    ✗ Error for ${trialId}: ${result.error.message}`);
        errorCountV2 += 1;
        continue;
      }

      try {
        const messageOutput = result.response.body.output?.find(o => o.type === "message");
        const content = messageOutput?.content?.find(c => c.type === "output_text")?.text;
        if (!content) throw new Error("Unexpected API response structure: missing message content");
        const parsed = JSON.parse(content);

        const resultPath = path.join(queryResultsDirV2, `${trialId}.json`);
        fs.writeFileSync(resultPath, JSON.stringify(parsed, null, 2));
        successCountV2 += 1;
      } catch (error) {
        console.error(
          `    ✗ Failed to parse result for ${trialId}: ${error.message}`
        );
        errorCountV2 += 1;
      }
    }

    console.log(
      `    ✓ Processed ${successCountV2} V2 query results (${errorCountV2} errors)`
    );
  }

  progress.stage = STAGES.PUB_DISCOVERY;
  saveProgress(options.progressFile, progress);
}
