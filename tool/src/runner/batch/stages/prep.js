import { registrationDiscovery } from "../../../discovery/registration.js";
import { STAGES } from "../utils/constants.js";
import { extractTrialId } from "../utils/io.js";
import { saveProgress, recordRowStatus } from "../utils/progress.js";

export async function stagePrepRegistrations({ rows, options, progress }) {
  console.log(
    `\n[PREP] Fetching registration data for ${rows.length} trials...`
  );

  let fetchCount = 0;
  let skipCount = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const trialId = extractTrialId(row);
    if (!trialId) {
      console.warn(`  ⚠ Row ${i + 1} missing trial_id, skipping`);
      progress.skippedCounts.noTrialId += 1;
      saveProgress(options.progressFile, progress);
      continue;
    }

    // Skip if already fetched
    if (progress.registrations[trialId]) {
      skipCount += 1;
      continue;
    }

    try {
      console.log(`  [${i + 1}/${rows.length}] Fetching ${trialId}...`);
      const trialData = await registrationDiscovery(trialId, {
        localRegistrations: options.localRegistrations,
      });
      if (trialData) {
        progress.registrations[trialId] = trialData;
        fetchCount += 1;
      }
    } catch (error) {
      console.error(`  ✗ Failed to fetch ${trialId}: ${error.message}`);
      recordRowStatus(progress, i, {
        trial_id: trialId,
        status: "error",
        error: `Registration fetch failed: ${error.message}`,
      });
    }

    saveProgress(options.progressFile, progress);
  }

  console.log(`  ✓ Fetched ${fetchCount} registrations (${skipCount} cached)`);
  progress.stage = STAGES.QUERY_GEN_UPLOAD;
  saveProgress(options.progressFile, progress);
}
