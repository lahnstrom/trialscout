import fs from "node:fs";
import { STAGES } from "./constants.js";

export function loadProgress(progressFile, inputPath) {
  if (!fs.existsSync(progressFile)) {
    return {
      input: inputPath,
      stage: STAGES.PREP,
      batchJobs: {},
      rows: {},
      registrations: {},
      publications: {},
      skippedCounts: {
        noTrialId: 0,
        noRegistration: 0,
      },
      startedAt: new Date().toISOString(),
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(progressFile, "utf8"));
    if (parsed.input && parsed.input !== inputPath) {
      console.warn(
        `Progress file references ${parsed.input}, but current input is ${inputPath}. Starting fresh.`
      );
      return {
        input: inputPath,
        stage: STAGES.PREP,
        batchJobs: {},
        rows: {},
        registrations: {},
        publications: {},
        skippedCounts: {
          noTrialId: 0,
          noRegistration: 0,
        },
        startedAt: new Date().toISOString(),
      };
    }
    return {
      input: inputPath,
      stage: parsed.stage || STAGES.PREP,
      batchJobs: parsed.batchJobs || {},
      rows: parsed.rows || {},
      registrations: parsed.registrations || {},
      publications: parsed.publications || {},
      skippedCounts: parsed.skippedCounts || {
        noTrialId: 0,
        noRegistration: 0,
      },
      startedAt: parsed.startedAt || new Date().toISOString(),
    };
  } catch (error) {
    console.error("Failed to read progress file. Starting fresh.", error);
    return {
      input: inputPath,
      stage: STAGES.PREP,
      batchJobs: {},
      rows: {},
      registrations: {},
      publications: {},
      skippedCounts: {
        noTrialId: 0,
        noRegistration: 0,
      },
      startedAt: new Date().toISOString(),
    };
  }
}

export function saveProgress(progressFile, progress) {
  fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2));
}

export function recordRowStatus(progress, rowIndex, data) {
  const key = String(rowIndex);
  progress.rows[key] = {
    ...(progress.rows[key] || {}),
    ...data,
    updatedAt: new Date().toISOString(),
  };
}
