import fs from "node:fs";
import path from "node:path";
import { stringify } from "csv-stringify/sync";
import { STAGES } from "../utils/constants.js";
import { ensureDir, ensureOutputCsv, extractTrialId } from "../utils/io.js";
import { saveProgress, recordRowStatus } from "../utils/progress.js";

export async function stageFinalize({ rows, options, progress }) {
  console.log("\n[FINALIZE] Generating final outputs...");

  ensureDir(options.jsonDir);
  ensureOutputCsv(options.outputCsv);

  const resultResultsDir = path.join(options.batchDir, "result_results");

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const trialId = extractTrialId(row);
    if (!trialId) continue;

    const registration = progress.registrations[trialId];
    const pubData = progress.publications[trialId];

    if (!registration || !pubData) {
      errorCount += 1;
      continue;
    }

    try {
      const publications = pubData.publications || [];
      const publicationsBeforeStart = pubData.publicationsBeforeStart || [];
      const publicationErrors = pubData.errors || [];
      const publicationsWithPmids = publications.filter((pub) => !!pub?.pmid);

      // Load result detection for each publication, tracking failures
      const detectionResults = [];
      const failedResultDiscoveries = [];

      for (const pub of publicationsWithPmids) {
        const resultPath = path.join(
          resultResultsDir,
          `${trialId}__${pub.pmid}.json`
        );
        let detection = null;
        let loadError = null;

        if (fs.existsSync(resultPath)) {
          try {
            detection = JSON.parse(fs.readFileSync(resultPath, "utf8"));
          } catch (parseError) {
            loadError = `Parse error: ${parseError.message}`;
            failedResultDiscoveries.push(pub.pmid);
          }
        } else {
          // Result file doesn't exist - batch job may have failed for this item
          failedResultDiscoveries.push(pub.pmid);
        }

        const hasResults = detection?.content?.hasResults === true;
        detectionResults.push({
          pmid: pub.pmid,
          publicationDate: pub.publicationDate || null,
          sources: Array.isArray(pub.sources) ? pub.sources : [],
          publication: {
            title: pub.title || null,
            doi: pub.doi || null,
          },
          result: detection?.content || null,
          hasResults,
          tokens: detection?.tokens ?? null,
          success: detection?.success ?? false,
          error: loadError,
        });
      }

      // Build summary
      const promptedPmids = detectionResults
        .map((res) => res.pmid)
        .filter(Boolean);
      const positives = detectionResults.filter(
        (res) => res.hasResults === true
      );
      const toolResultPmids = positives.map((res) => res.pmid).filter(Boolean);
      const toolIdentSteps = [
        ...new Set(positives.flatMap((res) => res.sources || [])),
      ].filter(Boolean);

      // Find the earliest result publication
      const positivesWithDates = positives.filter(
        (res) => res.pmid && res.publicationDate
      );

      let earliestResultPublication = "";
      let earliestResultPublicationDate = "";

      if (positivesWithDates.length > 0) {
        const sorted = [...positivesWithDates].sort((a, b) => {
          const dateA = a.publicationDate;
          const dateB = b.publicationDate;
          if (dateA < dateB) return -1;
          if (dateA > dateB) return 1;
          return 0;
        });

        const earliest = sorted[0];
        earliestResultPublication = earliest.pmid;
        earliestResultPublicationDate = earliest.publicationDate;
      }

      // Extract failed publication discovery sources (function names that failed)
      const failedPubDiscoveries = (publicationErrors || [])
        .map((err) => err.fn || "unknown")
        .filter(Boolean);

      const hasError =
        (publicationErrors?.length || 0) > 0 ||
        failedResultDiscoveries.length > 0;

      // Concatenate reasons from positive results with PMID labels
      const reasons = positives
        .map((res) => {
          const reason = res.result?.reason || "";
          return reason ? `PMID${res.pmid}: ${reason}` : "";
        })
        .filter(Boolean)
        .join("; ");

      const summary = {
        nct_id: trialId,
        trial_id: trialId,
        tool_results: positives.length > 0,
        has_error: hasError,
        tool_prompted_pmids: promptedPmids.join(","),
        tool_result_pmids: toolResultPmids.join(","),
        tool_ident_steps: toolIdentSteps.join(","),
        earliest_result_publication: earliestResultPublication,
        earliest_result_publication_date: earliestResultPublicationDate,
        failed_publication_discoveries: failedPubDiscoveries.join(","),
        failed_result_discoveries: failedResultDiscoveries.join(","),
        reasons,
      };

      // Write JSON payload
      const payload = {
        rowIndex: i,
        trial_id: trialId,
        trial: registration,
        publications,
        publicationsFilteredByStartDate: publicationsBeforeStart,
        publicationErrors,
        detectionResults,
        failedResultDiscoveries,
        summary,
        processedAt: new Date().toISOString(),
      };

      const jsonPath = path.join(options.jsonDir, `${trialId}.json`);
      fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));

      // Append to CSV
      const csvRow = [
        summary.nct_id,
        summary.trial_id,
        summary.tool_results,
        summary.has_error,
        summary.tool_prompted_pmids,
        summary.tool_result_pmids,
        summary.tool_ident_steps,
        summary.earliest_result_publication,
        summary.earliest_result_publication_date,
        summary.failed_publication_discoveries,
        summary.failed_result_discoveries,
        summary.reasons,
      ];
      fs.appendFileSync(options.outputCsv, stringify([csvRow]));

      recordRowStatus(progress, i, {
        trial_id: trialId,
        status: "success",
      });

      successCount += 1;
    } catch (error) {
      console.error(`  ✗ Failed to finalize ${trialId}: ${error.message}`);
      recordRowStatus(progress, i, {
        trial_id: trialId,
        status: "error",
        error: `Finalization failed: ${error.message}`,
      });
      errorCount += 1;
    }
  }

  console.log(
    `  ✓ Generated outputs for ${successCount} trials (${errorCount} errors)`
  );

  progress.stage = STAGES.COST_CALCULATION;
  saveProgress(options.progressFile, progress);
}
