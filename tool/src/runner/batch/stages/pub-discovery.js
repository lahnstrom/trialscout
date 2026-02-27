import { publicationDiscovery } from "../../../discovery/publication/index.js";
import { maxDateFilter, minDateFilter } from "../../../utils/utils.js";
import { STAGES } from "../utils/constants.js";
import { extractTrialId } from "../utils/io.js";
import { saveProgress, recordRowStatus } from "../utils/progress.js";
import config from "config";

export async function stagePubDiscovery({ rows, options, progress }) {
  console.log("\n[PUB_DISCOVERY] Discovering publications...");

  let processCount = 0;
  let skipCount = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const trialId = extractTrialId(row);
    if (!trialId) continue;

    // Skip if already processed
    if (progress.publications[trialId]) {
      skipCount += 1;
      continue;
    }

    // Skip if no registration
    if (!progress.registrations[trialId]) {
      console.warn(`  ⚠ No registration for ${trialId}, skipping`);
      progress.skippedCounts.noRegistration += 1;
      saveProgress(options.progressFile, progress);
      continue;
    }

    try {
      console.log(
        `  [${i + 1}/${rows.length}] Discovering publications for ${trialId}...`
      );

      // Use batch strategies from config
      const batchStrategies = config.get("batch.strategies");
      const [publications = [], pubErrors = []] = await publicationDiscovery(
        trialId,
        batchStrategies
      );

      // Apply validation filtering if enabled
      let eligiblePublications = publications;
      let filteredPublications = [];

      if (options.validationRun) {
        const dataset = row.dataset || row.Dataset;
        const maxDate = dataset === "iv" ? "2020-11-17" : "2023-02-15";
        const { eligible, filtered } = maxDateFilter(publications, maxDate);
        filteredPublications.push(...filtered);
        eligiblePublications = eligible;
        console.log(
          `    → Max date filtering (validation) (dataset=${dataset}): ${publications.length} → ${eligiblePublications.length} publications`
        );
      }

      // Filter out publications before trial start date
      const registration = progress.registrations[trialId];
      if (registration?.startDate) {
        const beforeFilterCount = eligiblePublications.length;

        const { eligible, filtered } = minDateFilter(
          eligiblePublications,
          registration.startDate
        );

        filteredPublications.push(...filtered);
        eligiblePublications = eligible;

        console.log(
          `    → Start date filtering: ${beforeFilterCount} → ${eligiblePublications.length} publications `
        );
      }

      progress.publications[trialId] = {
        publications: eligiblePublications,
        filteredPublications,
        errors: pubErrors,
      };

      console.log(
        `    → Found ${eligiblePublications.length} publications${
          pubErrors.length > 0 ? ` (${pubErrors.length} errors)` : ""
        }`
      );
      processCount += 1;
    } catch (error) {
      console.error(`  ✗ Failed ${trialId}: ${error.message}`);
      recordRowStatus(progress, i, {
        trial_id: trialId,
        status: "error",
        error: `Publication discovery failed: ${error.message}`,
      });
    }

    saveProgress(options.progressFile, progress);
  }

  console.log(
    `  ✓ Discovered publications for ${processCount} trials (${skipCount} cached)`
  );

  progress.stage = STAGES.RESULT_GEN_PREPARATION;
  saveProgress(options.progressFile, progress);
}
