#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const RESULT_DIR = path.join(PROJECT_ROOT, 'out', 'validation_dataset_all_registries_2026-01-03T19-09-56', 'batch', 'result_results');

const FP_CSV = path.join(DATA_DIR, 'validation_errors_false_positives_randomized.csv');
const FN_CSV = path.join(DATA_DIR, 'validation_errors_false_negatives_randomized.csv');
const OUTPUT_EXCEL = path.join(DATA_DIR, 'FP_FN_ALL_2026-01-11.xlsx');

/**
 * Extract registry from trial_id
 */
function getRegistry(trialId) {
  if (trialId.startsWith('NCT')) return 'ctgov';
  if (trialId.startsWith('DRKS')) return 'drks';
  // EudraCT format: YYYY-NNNNNN-NN
  if (/^\d{4}-\d{6}-\d{2}$/.test(trialId)) return 'euctr';
  return 'unknown';
}

/**
 * Generate trial URL based on registry
 */
function getTrialUrl(trialId) {
  const registry = getRegistry(trialId);

  switch (registry) {
    case 'ctgov':
      return `https://clinicaltrials.gov/study/${trialId}`;
    case 'drks':
      return `https://drks.de/search/en/trial/${trialId}/details`;
    case 'euctr':
      return `https://www.clinicaltrialsregister.eu/ctr-search/search?query=${trialId}`;
    default:
      return '';
  }
}

/**
 * Generate PubMed URL from PMID
 */
function getPubmedUrl(pmid) {
  if (!pmid || pmid === '') return '';
  return `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
}

/**
 * Generate DOI URL from DOI
 */
function getDoiUrl(doi) {
  if (!doi || doi === '' || doi === 'NA') return '';
  // Remove "https://doi.org/" prefix if it's already there
  const cleanDoi = doi.replace(/^https?:\/\/doi\.org\//, '');
  return `https://doi.org/${cleanDoi}`;
}

/**
 * Read reason from JSON file
 */
function getReason(trialId, pmid) {
  const filename = `${trialId}__${pmid}.json`;
  const filepath = path.join(RESULT_DIR, filename);

  try {
    const content = fs.readFileSync(filepath, 'utf-8');
    const data = JSON.parse(content);
    return data?.content?.reason || '';
  } catch (error) {
    console.warn(`Warning: Could not read ${filename}: ${error.message}`);
    return '';
  }
}

/**
 * Parse comma-separated PMIDs
 */
function parsePmids(pmidString) {
  if (!pmidString || pmidString === '') return [];
  return pmidString.split(',').map(p => p.trim()).filter(p => p !== '');
}

/**
 * Process false positives
 */
function processFalsePositives(rows) {
  return rows.map(row => {
    const pmids = parsePmids(row.tool_result_pmids);

    // Get reasons for each PMID
    const reasons = pmids.map(pmid => {
      const reason = getReason(row.trial_id, pmid);
      return reason ? `[PMID ${pmid}]: ${reason}` : '';
    }).filter(r => r !== '');

    // Create pub_url for all PMIDs, separated by newline
    const pubUrls = pmids.map(pmid => getPubmedUrl(pmid)).filter(url => url !== '');

    return {
      ...row,
      reason: reasons.join('\n\n'),
      trial_url: getTrialUrl(row.trial_id),
      pub_url: pubUrls.join('\n')
    };
  });
}

/**
 * Process false negatives
 */
function processFalseNegatives(rows) {
  return rows.map(row => {
    const publicationPmid = row.publication_pmid?.trim() || '';
    const publicationDoi = row.publication_doi?.trim() || '';
    const publicationUrl = row.publication_url?.trim() || '';
    const promptedPmids = parsePmids(row.tool_prompted_pmids);

    // Only get reason if publication_pmid is in tool_prompted_pmids
    let reason = '';
    if (publicationPmid && promptedPmids.includes(publicationPmid)) {
      const fetchedReason = getReason(row.trial_id, publicationPmid);
      if (fetchedReason) {
        reason = `[PMID ${publicationPmid}]: ${fetchedReason}`;
      }
    }

    // Generate pub_url: prefer PMID, then DOI, then publication_url, otherwise empty
    let pubUrl = '';
    if (publicationPmid && publicationPmid !== 'NA') {
      pubUrl = getPubmedUrl(publicationPmid);
    } else if (publicationDoi && publicationDoi !== 'NA') {
      pubUrl = getDoiUrl(publicationDoi);
    } else if (publicationUrl && publicationUrl !== 'NA') {
      pubUrl = publicationUrl;
    }

    return {
      ...row,
      reason,
      trial_url: getTrialUrl(row.trial_id),
      pub_url: pubUrl
    };
  });
}

/**
 * Add data to worksheet with hyperlinks
 */
function addDataToWorksheet(worksheet, data, sheetName) {
  if (data.length === 0) {
    console.warn(`No data for ${sheetName}`);
    return;
  }

  // Get headers
  const headers = Object.keys(data[0]);

  // Add header row
  worksheet.addRow(headers);
  worksheet.getRow(1).font = { bold: true };

  // Add data rows
  data.forEach((row, rowIndex) => {
    const values = headers.map(header => {
      const value = row[header];
      return value === undefined || value === null ? '' : value;
    });

    const excelRow = worksheet.addRow(values);
    const excelRowNum = rowIndex + 2; // +2 because Excel is 1-indexed and we have a header

    // Add hyperlinks
    headers.forEach((header, colIndex) => {
      const colNum = colIndex + 1;
      const cell = excelRow.getCell(colNum);

      if (header === 'trial_url' && row.trial_url) {
        cell.value = {
          text: row.trial_url,
          hyperlink: row.trial_url
        };
        cell.font = { color: { argb: 'FF0000FF' }, underline: true };
      } else if (header === 'pub_url' && row.pub_url) {
        cell.value = {
          text: row.pub_url,
          hyperlink: row.pub_url
        };
        cell.font = { color: { argb: 'FF0000FF' }, underline: true };
      }
    });
  });

  // Auto-fit columns
  worksheet.columns.forEach(column => {
    let maxLength = 0;
    column.eachCell({ includeEmpty: true }, cell => {
      const cellValue = cell.value ? cell.value.toString() : '';
      maxLength = Math.max(maxLength, cellValue.length);
    });
    column.width = Math.min(maxLength + 2, 100); // Cap at 100
  });
}

/**
 * Main function
 */
async function main() {
  console.log('Starting FP/FN analysis export...\n');

  // Read CSV files
  console.log(`Reading ${FP_CSV}...`);
  const fpCsvContent = fs.readFileSync(FP_CSV, 'utf-8');
  const fpRows = parse(fpCsvContent, { columns: true, skip_empty_lines: true });
  console.log(`  Found ${fpRows.length} false positive rows\n`);

  console.log(`Reading ${FN_CSV}...`);
  const fnCsvContent = fs.readFileSync(FN_CSV, 'utf-8');
  const fnRows = parse(fnCsvContent, { columns: true, skip_empty_lines: true });
  console.log(`  Found ${fnRows.length} false negative rows\n`);

  // Process data
  console.log('Processing false positives...');
  const fpProcessed = processFalsePositives(fpRows);
  console.log(`  Processed ${fpProcessed.length} rows\n`);

  console.log('Processing false negatives...');
  const fnProcessed = processFalseNegatives(fnRows);
  console.log(`  Processed ${fnProcessed.length} rows\n`);

  // Create Excel workbook
  console.log('Creating Excel workbook...');
  const workbook = new ExcelJS.Workbook();

  const fpSheet = workbook.addWorksheet('FALSE POSITIVES');
  const fnSheet = workbook.addWorksheet('FALSE NEGATIVES');

  console.log('Adding data to worksheets...');
  addDataToWorksheet(fpSheet, fpProcessed, 'FALSE POSITIVES');
  addDataToWorksheet(fnSheet, fnProcessed, 'FALSE NEGATIVES');

  // Save workbook
  console.log(`Writing to ${OUTPUT_EXCEL}...`);
  await workbook.xlsx.writeFile(OUTPUT_EXCEL);

  console.log('\n✓ Export completed successfully!');
  console.log(`  Output: ${OUTPUT_EXCEL}`);
  console.log(`  Sheets: FALSE POSITIVES (${fpProcessed.length} rows), FALSE NEGATIVES (${fnProcessed.length} rows)`);
}

// Run
main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
