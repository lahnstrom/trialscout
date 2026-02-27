import fs from "node:fs";
import path from "node:path";
import { STAGES } from "../utils/constants.js";
import { saveProgress } from "../utils/progress.js";
import { detectRegistryType, getRegistryName } from "../../../registry/utils.js";

// Pricing per 1M tokens (Batch tier)
const BATCH_PRICING = {
  "gpt-5.1": { input: 0.625, output: 5.0 },
  "gpt-5": { input: 0.625, output: 5.0 },
  "gpt-5-mini": { input: 0.125, output: 1.0 },
  "gpt-5-nano": { input: 0.025, output: 0.2 },
  "gpt-5-pro": { input: 7.5, output: 60.0 },
  "gpt-4.1": { input: 1.0, output: 4.0 },
  "gpt-4.1-mini": { input: 0.2, output: 0.8 },
  "gpt-4.1-nano": { input: 0.05, output: 0.2 },
  "gpt-4o": { input: 1.25, output: 5.0 },
  "gpt-4o-2024-05-13": { input: 2.5, output: 7.5 },
  "gpt-4o-mini": { input: 0.075, output: 0.3 },
  "o1": { input: 7.5, output: 30.0 },
  "o1-pro": { input: 75.0, output: 300.0 },
  "o3-pro": { input: 10.0, output: 40.0 },
  "o3": { input: 1.0, output: 4.0 },
  "o3-deep-research": { input: 5.0, output: 20.0 },
  "o4-mini": { input: 0.55, output: 2.2 },
  "o4-mini-deep-research": { input: 1.0, output: 4.0 },
  "o3-mini": { input: 0.55, output: 2.2 },
  "o1-mini": { input: 0.55, output: 2.2 },
  "computer-use-preview": { input: 1.5, output: 6.0 },
};

/**
 * Extracts the base model name from a full model string
 * e.g., "gpt-5-mini-2025-08-07" -> "gpt-5-mini"
 * e.g., "gpt-5.1-2025-11-13" -> "gpt-5.1"
 */
function getBaseModel(modelString) {
  if (!modelString) return null;

  // Remove date suffix (pattern: -YYYY-MM-DD or -YYYY-DD-MM)
  const withoutDate = modelString.replace(/-\d{4}-\d{2}-\d{2}$/, "");

  // Try exact match first
  if (BATCH_PRICING[withoutDate]) {
    return withoutDate;
  }

  // Try to match model prefix
  for (const baseModel of Object.keys(BATCH_PRICING)) {
    if (withoutDate.startsWith(baseModel)) {
      return baseModel;
    }
  }

  return null;
}

/**
 * Calculate cost for a single API call
 */
function calculateCallCost(usage, modelString) {
  const baseModel = getBaseModel(modelString);

  if (!baseModel) {
    return {
      cost: 0,
      inputCost: 0,
      outputCost: 0,
      error: `Unknown model: ${modelString}`,
    };
  }

  const pricing = BATCH_PRICING[baseModel];

  // Extract tokens from new API format
  const inputTokens = usage.input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;
  const cachedTokens = usage.input_tokens_details?.cached_tokens || 0;
  const reasoningTokens = usage.output_tokens_details?.reasoning_tokens || 0;

  // Calculate regular (non-cached, non-reasoning) tokens
  const regularInputTokens = inputTokens - cachedTokens;
  const regularOutputTokens = outputTokens - reasoningTokens;

  // Calculate costs by category
  // Cached tokens are billed at 1/10th of regular input price
  const regularInputCost = (regularInputTokens / 1_000_000) * pricing.input;
  const cachedInputCost = (cachedTokens / 1_000_000) * pricing.input * 0.1;
  const regularOutputCost = (regularOutputTokens / 1_000_000) * pricing.output;
  const reasoningOutputCost = (reasoningTokens / 1_000_000) * pricing.output;

  // Total costs
  const inputCost = regularInputCost + cachedInputCost;
  const outputCost = regularOutputCost + reasoningOutputCost;
  const cost = inputCost + outputCost;

  return {
    cost,
    inputCost,
    outputCost,
    inputTokens,
    outputTokens,
    cachedTokens,
    reasoningTokens,
    regularInputCost,
    cachedInputCost,
    regularOutputCost,
    reasoningOutputCost,
    model: baseModel,
    fullModel: modelString,
  };
}

/**
 * Process a single JSONL output file
 */
function processOutputFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {
      fileName: path.basename(filePath),
      exists: false,
      calls: 0,
      totalCost: 0,
      errors: [],
    };
  }

  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.trim().split("\n").filter(Boolean);

  let totalCost = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCachedTokens = 0;
  let totalReasoningTokens = 0;
  let totalRegularInputCost = 0;
  let totalCachedInputCost = 0;
  let totalRegularOutputCost = 0;
  let totalReasoningOutputCost = 0;
  const errors = [];
  const modelBreakdown = {};
  const registryBreakdown = {};

  for (const line of lines) {
    try {
      const result = JSON.parse(line);

      // Extract model and usage from response body
      const model = result?.response?.body?.model;
      const usage = result?.response?.body?.usage;

      if (!model || !usage) {
        errors.push(`Missing model or usage data for custom_id: ${result.custom_id}`);
        continue;
      }

      const callCost = calculateCallCost(usage, model);

      if (callCost.error) {
        errors.push(callCost.error);
        continue;
      }

      totalCost += callCost.cost;
      totalInputTokens += callCost.inputTokens;
      totalOutputTokens += callCost.outputTokens;
      totalCachedTokens += callCost.cachedTokens;
      totalReasoningTokens += callCost.reasoningTokens;
      totalRegularInputCost += callCost.regularInputCost;
      totalCachedInputCost += callCost.cachedInputCost;
      totalRegularOutputCost += callCost.regularOutputCost;
      totalReasoningOutputCost += callCost.reasoningOutputCost;

      // Track breakdown by base model
      if (!modelBreakdown[callCost.model]) {
        modelBreakdown[callCost.model] = {
          calls: 0,
          cost: 0,
          inputTokens: 0,
          outputTokens: 0,
          cachedTokens: 0,
          reasoningTokens: 0,
          regularInputCost: 0,
          cachedInputCost: 0,
          regularOutputCost: 0,
          reasoningOutputCost: 0,
        };
      }

      modelBreakdown[callCost.model].calls += 1;
      modelBreakdown[callCost.model].cost += callCost.cost;
      modelBreakdown[callCost.model].inputTokens += callCost.inputTokens;
      modelBreakdown[callCost.model].outputTokens += callCost.outputTokens;
      modelBreakdown[callCost.model].cachedTokens += callCost.cachedTokens;
      modelBreakdown[callCost.model].reasoningTokens += callCost.reasoningTokens;
      modelBreakdown[callCost.model].regularInputCost += callCost.regularInputCost;
      modelBreakdown[callCost.model].cachedInputCost += callCost.cachedInputCost;
      modelBreakdown[callCost.model].regularOutputCost += callCost.regularOutputCost;
      modelBreakdown[callCost.model].reasoningOutputCost += callCost.reasoningOutputCost;

      // Track breakdown by registry
      // Extract trial ID from custom_id (format: "TRIAL_ID__PMID")
      const customId = result.custom_id;
      if (customId) {
        const trialId = customId.split("__")[0];
        const registryType = detectRegistryType(trialId);
        const registryName = getRegistryName(registryType);

        if (!registryBreakdown[registryName]) {
          registryBreakdown[registryName] = {
            calls: 0,
            cost: 0,
            inputTokens: 0,
            outputTokens: 0,
            cachedTokens: 0,
            reasoningTokens: 0,
            regularInputCost: 0,
            cachedInputCost: 0,
            regularOutputCost: 0,
            reasoningOutputCost: 0,
          };
        }

        registryBreakdown[registryName].calls += 1;
        registryBreakdown[registryName].cost += callCost.cost;
        registryBreakdown[registryName].inputTokens += callCost.inputTokens;
        registryBreakdown[registryName].outputTokens += callCost.outputTokens;
        registryBreakdown[registryName].cachedTokens += callCost.cachedTokens;
        registryBreakdown[registryName].reasoningTokens += callCost.reasoningTokens;
        registryBreakdown[registryName].regularInputCost += callCost.regularInputCost;
        registryBreakdown[registryName].cachedInputCost += callCost.cachedInputCost;
        registryBreakdown[registryName].regularOutputCost += callCost.regularOutputCost;
        registryBreakdown[registryName].reasoningOutputCost += callCost.reasoningOutputCost;
      }
    } catch (parseError) {
      errors.push(`JSON parse error: ${parseError.message}`);
    }
  }

  return {
    fileName: path.basename(filePath),
    exists: true,
    calls: lines.length,
    totalCost,
    totalInputTokens,
    totalOutputTokens,
    totalCachedTokens,
    totalReasoningTokens,
    totalRegularInputCost,
    totalCachedInputCost,
    totalRegularOutputCost,
    totalReasoningOutputCost,
    modelBreakdown,
    registryBreakdown,
    errors,
  };
}

export async function stageCostCalculation({ rows, options, progress }) {
  console.log("\n[COST_CALCULATION] Calculating batch run costs...");

  const batchDir = options.batchDir;

  // Find all output JSONL files
  const outputFiles = fs
    .readdirSync(batchDir)
    .filter((file) =>
      file.endsWith("_output.jsonl") ||
      file.match(/_output_chunk_\d+\.jsonl$/)
    )
    .map((file) => path.join(batchDir, file));

  if (outputFiles.length === 0) {
    console.log("  ⚠ No output JSONL files found");
    progress.stage = STAGES.COMPLETE;
    saveProgress(options.progressFile, progress);
    return;
  }

  console.log(`  Found ${outputFiles.length} output file(s)`);

  const fileResults = [];
  let grandTotalCost = 0;
  let grandTotalCalls = 0;
  let grandTotalInputTokens = 0;
  let grandTotalOutputTokens = 0;
  let grandTotalCachedTokens = 0;
  let grandTotalReasoningTokens = 0;
  let grandTotalRegularInputCost = 0;
  let grandTotalCachedInputCost = 0;
  let grandTotalRegularOutputCost = 0;
  let grandTotalReasoningOutputCost = 0;
  const grandRegistryBreakdown = {};

  for (const filePath of outputFiles) {
    const result = processOutputFile(filePath);
    fileResults.push(result);

    if (result.exists) {
      grandTotalCost += result.totalCost;
      grandTotalCalls += result.calls;
      grandTotalInputTokens += result.totalInputTokens;
      grandTotalOutputTokens += result.totalOutputTokens;
      grandTotalCachedTokens += result.totalCachedTokens;
      grandTotalReasoningTokens += result.totalReasoningTokens;
      grandTotalRegularInputCost += result.totalRegularInputCost;
      grandTotalCachedInputCost += result.totalCachedInputCost;
      grandTotalRegularOutputCost += result.totalRegularOutputCost;
      grandTotalReasoningOutputCost += result.totalReasoningOutputCost;

      // Accumulate registry breakdown
      for (const [registry, stats] of Object.entries(result.registryBreakdown)) {
        if (!grandRegistryBreakdown[registry]) {
          grandRegistryBreakdown[registry] = {
            calls: 0,
            cost: 0,
            inputTokens: 0,
            outputTokens: 0,
            cachedTokens: 0,
            reasoningTokens: 0,
            regularInputCost: 0,
            cachedInputCost: 0,
            regularOutputCost: 0,
            reasoningOutputCost: 0,
          };
        }
        grandRegistryBreakdown[registry].calls += stats.calls;
        grandRegistryBreakdown[registry].cost += stats.cost;
        grandRegistryBreakdown[registry].inputTokens += stats.inputTokens;
        grandRegistryBreakdown[registry].outputTokens += stats.outputTokens;
        grandRegistryBreakdown[registry].cachedTokens += stats.cachedTokens;
        grandRegistryBreakdown[registry].reasoningTokens += stats.reasoningTokens;
        grandRegistryBreakdown[registry].regularInputCost += stats.regularInputCost;
        grandRegistryBreakdown[registry].cachedInputCost += stats.cachedInputCost;
        grandRegistryBreakdown[registry].regularOutputCost += stats.regularOutputCost;
        grandRegistryBreakdown[registry].reasoningOutputCost += stats.reasoningOutputCost;
      }

      console.log(`\n  ${result.fileName}:`);
      console.log(`    Calls:        ${result.calls}`);

      const regularInputTokens = result.totalInputTokens - result.totalCachedTokens;
      const regularOutputTokens = result.totalOutputTokens - result.totalReasoningTokens;

      console.log(`    Input tokens: ${result.totalInputTokens.toLocaleString()} (${regularInputTokens.toLocaleString()} regular + ${result.totalCachedTokens.toLocaleString()} cached)`);
      console.log(`    Output tokens: ${result.totalOutputTokens.toLocaleString()} (${regularOutputTokens.toLocaleString()} regular + ${result.totalReasoningTokens.toLocaleString()} reasoning)`);
      console.log(`    Cost breakdown:`);
      console.log(`      Regular input:  $${result.totalRegularInputCost.toFixed(4)}`);
      console.log(`      Cached input:   $${result.totalCachedInputCost.toFixed(4)}`);
      console.log(`      Regular output: $${result.totalRegularOutputCost.toFixed(4)}`);
      console.log(`      Reasoning:      $${result.totalReasoningOutputCost.toFixed(4)}`);
      console.log(`    Total cost:   $${result.totalCost.toFixed(4)}`);

      if (Object.keys(result.modelBreakdown).length > 0) {
        console.log(`    Models:`);
        for (const [model, stats] of Object.entries(result.modelBreakdown)) {
          const modelRegularIn = stats.inputTokens - stats.cachedTokens;
          const modelRegularOut = stats.outputTokens - stats.reasoningTokens;
          console.log(`      ${model}: ${stats.calls} calls, $${stats.cost.toFixed(4)}`);
          console.log(`        Input: ${stats.inputTokens.toLocaleString()} (${modelRegularIn.toLocaleString()} regular + ${stats.cachedTokens.toLocaleString()} cached)`);
          console.log(`        Output: ${stats.outputTokens.toLocaleString()} (${modelRegularOut.toLocaleString()} regular + ${stats.reasoningTokens.toLocaleString()} reasoning)`);
        }
      }

      if (Object.keys(result.registryBreakdown).length > 0) {
        console.log(`    Registries:`);
        for (const [registry, stats] of Object.entries(result.registryBreakdown)) {
          const regRegularIn = stats.inputTokens - stats.cachedTokens;
          const regRegularOut = stats.outputTokens - stats.reasoningTokens;
          console.log(`      ${registry}: ${stats.calls} calls, $${stats.cost.toFixed(4)}`);
          console.log(`        Input: ${stats.inputTokens.toLocaleString()} (${regRegularIn.toLocaleString()} regular + ${stats.cachedTokens.toLocaleString()} cached)`);
          console.log(`        Output: ${stats.outputTokens.toLocaleString()} (${regRegularOut.toLocaleString()} regular + ${stats.reasoningTokens.toLocaleString()} reasoning)`);
        }
      }

      if (result.errors.length > 0) {
        console.log(`    Errors: ${result.errors.length}`);
      }
    }
  }

  // Summary
  console.log("\n  ========================================");
  console.log("  TOTAL COST SUMMARY");
  console.log("  ========================================");
  console.log(`  Total API calls:    ${grandTotalCalls}`);

  const grandRegularInputTokens = grandTotalInputTokens - grandTotalCachedTokens;
  const grandRegularOutputTokens = grandTotalOutputTokens - grandTotalReasoningTokens;

  console.log(`  Total input tokens: ${grandTotalInputTokens.toLocaleString()} (${grandRegularInputTokens.toLocaleString()} regular + ${grandTotalCachedTokens.toLocaleString()} cached)`);
  console.log(`  Total output tokens: ${grandTotalOutputTokens.toLocaleString()} (${grandRegularOutputTokens.toLocaleString()} regular + ${grandTotalReasoningTokens.toLocaleString()} reasoning)`);
  console.log(`\n  Cost breakdown:`);
  console.log(`    Regular input:  $${grandTotalRegularInputCost.toFixed(4)}`);
  console.log(`    Cached input:   $${grandTotalCachedInputCost.toFixed(4)}`);
  console.log(`    Regular output: $${grandTotalRegularOutputCost.toFixed(4)}`);
  console.log(`    Reasoning:      $${grandTotalReasoningOutputCost.toFixed(4)}`);
  console.log(`\n  TOTAL COST:         $${grandTotalCost.toFixed(4)}`);

  if (Object.keys(grandRegistryBreakdown).length > 0) {
    console.log("\n  Cost by Registry:");
    for (const [registry, stats] of Object.entries(grandRegistryBreakdown)) {
      const regRegularIn = stats.inputTokens - stats.cachedTokens;
      const regRegularOut = stats.outputTokens - stats.reasoningTokens;
      console.log(`    ${registry}:`);
      console.log(`      Calls:        ${stats.calls}`);
      console.log(`      Input tokens: ${stats.inputTokens.toLocaleString()} (${regRegularIn.toLocaleString()} regular + ${stats.cachedTokens.toLocaleString()} cached)`);
      console.log(`      Output tokens: ${stats.outputTokens.toLocaleString()} (${regRegularOut.toLocaleString()} regular + ${stats.reasoningTokens.toLocaleString()} reasoning)`);
      console.log(`      Cost breakdown:`);
      console.log(`        Regular input:  $${stats.regularInputCost.toFixed(4)}`);
      console.log(`        Cached input:   $${stats.cachedInputCost.toFixed(4)}`);
      console.log(`        Regular output: $${stats.regularOutputCost.toFixed(4)}`);
      console.log(`        Reasoning:      $${stats.reasoningOutputCost.toFixed(4)}`);
      console.log(`      Total cost:   $${stats.cost.toFixed(4)}`);
    }
  }

  console.log("  ========================================");

  // Save detailed breakdown to JSON
  const summary = {
    calculatedAt: new Date().toISOString(),
    batchDir,
    totalCalls: grandTotalCalls,
    totalInputTokens: grandTotalInputTokens,
    totalOutputTokens: grandTotalOutputTokens,
    totalCachedTokens: grandTotalCachedTokens,
    totalReasoningTokens: grandTotalReasoningTokens,
    totalCost: grandTotalCost,
    costBreakdown: {
      regularInputCost: grandTotalRegularInputCost,
      cachedInputCost: grandTotalCachedInputCost,
      regularOutputCost: grandTotalRegularOutputCost,
      reasoningOutputCost: grandTotalReasoningOutputCost,
    },
    pricingTier: "Batch",
    registryBreakdown: grandRegistryBreakdown,
    files: fileResults,
  };

  const summaryPath = path.join(batchDir, "cost_summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`\n  ✓ Cost summary saved to: ${summaryPath}`);

  progress.stage = STAGES.COMPLETE;
  saveProgress(options.progressFile, progress);
}
