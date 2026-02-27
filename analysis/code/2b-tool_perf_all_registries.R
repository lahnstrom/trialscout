# ===== 0. SETUP =====

library(dplyr)
library(stringr)
library(ggplot2)

# Results collector: accumulates key-value rows for export
results <- list()
add_result <- function(section, key, value, formatted) {
  results[[length(results) + 1]] <<- data.frame(
    section = section, key = key,
    value = as.character(value), formatted = formatted,
    stringsAsFactors = FALSE
  )
}

# Performance table collector (one row per registry)
perf_table_rows <- list()

# ===== 1. DATA LOADING AND PRE-PROCESSING =====

perf_df <- read.csv("./data/validation_run_all_registries_reasoning_2026_01_03.csv")
validation_df <- read.csv("./out/validation_dataset_all_registries.csv")

validation_df <- validation_df %>%
  distinct(trial_id, .keep_all = TRUE)

df <- left_join(perf_df, validation_df, by = "trial_id")

# Convert mixed boolean representations to logical
df <- df %>%
  mutate(across(c(tool_results, has_error, has_publication, has_summary_results), ~ case_when(
    . == "true" ~ TRUE,
    . == "false" ~ FALSE,
    . == "Yes" ~ TRUE,
    . == "No" ~ FALSE,
    . == 1 ~ TRUE,
    is.na(.) ~ FALSE,
    TRUE ~ as.logical(.)
  ))) %>%
  mutate(across(everything(), ~ ifelse(. == "null", "", .))) %>%
  mutate(across(everything(), ~ ifelse(. == "undefined", "", .))) %>%
  mutate(
    agree = has_publication == tool_results,
  )

n_total <- df %>% nrow()

# ===== 2. VALIDATION DATASET SUMMARY =====

add_result("validation_dataset", "n_total", n_total, format(n_total, big.mark = ","))

# Publications and summary results overall
n_has_publication <- df %>% filter(has_publication) %>% nrow()
n_has_summary_results <- df %>% filter(has_summary_results) %>% nrow()
n_has_any_results <- df %>% filter(has_summary_results | has_publication) %>% nrow()
n_has_both <- df %>% filter(has_summary_results & has_publication) %>% nrow()

add_result("validation_dataset", "n_has_publication", n_has_publication,
           sprintf("%s/%s (%s%%)", format(n_has_publication, big.mark = ","), format(n_total, big.mark = ","),
                   round(n_has_publication * 100 / n_total, 1)))
add_result("validation_dataset", "n_has_summary_results", n_has_summary_results,
           format(n_has_summary_results, big.mark = ","))
add_result("validation_dataset", "n_has_any_results", n_has_any_results,
           format(n_has_any_results, big.mark = ","))
add_result("validation_dataset", "n_has_both", n_has_both,
           format(n_has_both, big.mark = ","))

# Per-dataset breakdowns
for (ds in c("iv", "nordic")) {
  ds_df <- df %>% filter(dataset == ds)
  n_ds <- nrow(ds_df)
  n_pub_ds <- ds_df %>% filter(has_publication) %>% nrow()
  n_sum_ds <- ds_df %>% filter(has_summary_results) %>% nrow()
  n_any_ds <- ds_df %>% filter(has_summary_results | has_publication) %>% nrow()
  n_both_ds <- ds_df %>% filter(has_summary_results & has_publication) %>% nrow()
  n_missing_pmid_ds <- ds_df %>% filter(has_publication & is.na(publication_pmid)) %>% nrow()
  n_with_pub_ds <- ds_df %>% filter(has_publication) %>% nrow()

  add_result("validation_dataset", paste0("n_total_", ds), n_ds, format(n_ds, big.mark = ","))
  add_result("validation_dataset", paste0("n_has_publication_", ds), n_pub_ds, format(n_pub_ds, big.mark = ","))
  add_result("validation_dataset", paste0("n_has_summary_results_", ds), n_sum_ds, format(n_sum_ds, big.mark = ","))
  add_result("validation_dataset", paste0("n_has_any_results_", ds), n_any_ds, format(n_any_ds, big.mark = ","))
  add_result("validation_dataset", paste0("n_has_both_", ds), n_both_ds, format(n_both_ds, big.mark = ","))
  add_result("validation_dataset", paste0("n_missing_pmid_", ds), n_missing_pmid_ds,
             sprintf("%s/%s", n_missing_pmid_ds, n_with_pub_ds))
}

# ===== 3. PERFORMANCE (ALL + PER-REGISTRY) =====

# Helper: compute all performance metrics for a data subset
calc_registry_performance <- function(data, registry_name) {
  n <- nrow(data)

  # --- Confusion matrix ---
  tp <- data %>% filter(tool_results & has_publication) %>% nrow()
  fp <- data %>% filter(tool_results & !has_publication) %>% nrow()
  tn <- data %>% filter(!tool_results & !has_publication) %>% nrow()
  fn <- data %>% filter(!tool_results & has_publication) %>% nrow()

  sens <- if ((tp + fn) > 0) tp / (tp + fn) else NA
  spec <- if ((tn + fp) > 0) tn / (tn + fp) else NA
  ppv  <- if ((tp + fp) > 0) tp / (tp + fp) else NA
  npv  <- if ((tn + fn) > 0) tn / (tn + fn) else NA
  f_score <- if (!is.na(ppv) && !is.na(sens) && (ppv + sens) > 0) 2 / sum(1 / c(ppv, sens)) else NA

  suffix <- registry_name
  add_result("confusion_matrix", paste0("tp_", suffix), tp, format(tp, big.mark = ","))
  add_result("confusion_matrix", paste0("fp_", suffix), fp, format(fp, big.mark = ","))
  add_result("confusion_matrix", paste0("tn_", suffix), tn, format(tn, big.mark = ","))
  add_result("confusion_matrix", paste0("fn_", suffix), fn, format(fn, big.mark = ","))
  add_result("confusion_matrix", paste0("sensitivity_", suffix), round(sens * 100, 1),
             paste0(round(sens * 100, 1), "%"))
  add_result("confusion_matrix", paste0("specificity_", suffix), round(spec * 100, 1),
             paste0(round(spec * 100, 1), "%"))
  add_result("confusion_matrix", paste0("ppv_", suffix), round(ppv * 100, 1),
             paste0(round(ppv * 100, 1), "%"))
  add_result("confusion_matrix", paste0("npv_", suffix), round(npv * 100, 1),
             paste0(round(npv * 100, 1), "%"))
  add_result("confusion_matrix", paste0("f_score_", suffix),
             ifelse(is.na(f_score), NA, round(f_score * 100, 1)),
             ifelse(is.na(f_score), "NA", paste0(round(f_score * 100, 1), "%")))

  # --- Detection comparison ---
  n_found_tool <- data %>% filter(tool_results) %>% nrow()
  n_found_human <- data %>% filter(has_publication) %>% nrow()
  pct_found_tool <- round(n_found_tool * 100 / n, 1)
  pct_found_human <- round(n_found_human * 100 / n, 1)

  add_result("detection_comparison", paste0("n_found_tool_", suffix), n_found_tool,
             sprintf("%s/%s (%s%%)", format(n_found_tool, big.mark = ","), format(n, big.mark = ","), pct_found_tool))
  add_result("detection_comparison", paste0("n_found_human_", suffix), n_found_human,
             sprintf("%s/%s (%s%%)", format(n_found_human, big.mark = ","), format(n, big.mark = ","), pct_found_human))

  # --- Publication matching accuracy ---
  data_has_pub <- data %>% filter(has_publication & publication_pmid != "" & !is.na(publication_pmid))
  n_with_pubmed_pub <- nrow(data_has_pub)

  data_has_pub <- data_has_pub %>%
    rowwise() %>%
    mutate(
      correct_pub_found = str_detect(tool_prompted_pmids, fixed(publication_pmid)),
      correct_classification = str_detect(tool_result_pmids, fixed(publication_pmid))
    ) %>%
    ungroup()

  n_correct_pub_found <- data_has_pub %>% filter(correct_pub_found) %>% nrow()
  n_correct_classification <- data_has_pub %>% filter(correct_classification) %>% nrow()
  pct_correct_pub <- if (n_with_pubmed_pub > 0) round(n_correct_pub_found * 100 / n_with_pubmed_pub, 1) else NA
  pct_correct_class <- if (n_with_pubmed_pub > 0) round(n_correct_classification * 100 / n_with_pubmed_pub, 1) else NA

  add_result("publication_matching", paste0("n_with_pubmed_pub_", suffix), n_with_pubmed_pub,
             format(n_with_pubmed_pub, big.mark = ","))
  add_result("publication_matching", paste0("n_correct_pub_found_", suffix), n_correct_pub_found,
             sprintf("%s/%s (%s%%)", format(n_correct_pub_found, big.mark = ","),
                     format(n_with_pubmed_pub, big.mark = ","),
                     ifelse(is.na(pct_correct_pub), "NA", pct_correct_pub)))
  add_result("publication_matching", paste0("pct_correct_pub_found_", suffix),
             ifelse(is.na(pct_correct_pub), NA, pct_correct_pub),
             ifelse(is.na(pct_correct_pub), "NA", paste0(pct_correct_pub, "%")))
  add_result("publication_matching", paste0("n_correct_classification_", suffix), n_correct_classification,
             sprintf("%s/%s (%s%%)", format(n_correct_classification, big.mark = ","),
                     format(n_with_pubmed_pub, big.mark = ","),
                     ifelse(is.na(pct_correct_class), "NA", pct_correct_class)))
  add_result("publication_matching", paste0("pct_correct_classification_", suffix),
             ifelse(is.na(pct_correct_class), NA, pct_correct_class),
             ifelse(is.na(pct_correct_class), "NA", paste0(pct_correct_class, "%")))

  # --- Performance by identification step ---
  data_linked <- data %>% filter(identification_step == "Linked at the registration")
  data_google <- data %>% filter(identification_step == "Systematic Google search")

  n_linked <- nrow(data_linked)
  n_linked_found <- data_linked %>% filter(has_publication & tool_results) %>% nrow()
  pct_linked_found <- if (n_linked > 0) round(n_linked_found * 100 / n_linked, 1) else NA

  n_google <- nrow(data_google)
  n_google_found <- data_google %>% filter(has_publication & tool_results) %>% nrow()
  pct_google_found <- if (n_google > 0) round(n_google_found * 100 / n_google, 1) else NA

  add_result("performance_by_step", paste0("n_linked_", suffix), n_linked, format(n_linked, big.mark = ","))
  add_result("performance_by_step", paste0("n_linked_found_", suffix), n_linked_found,
             sprintf("%s/%s (%s%%)", format(n_linked_found, big.mark = ","), format(n_linked, big.mark = ","),
                     ifelse(is.na(pct_linked_found), "NA", pct_linked_found)))
  add_result("performance_by_step", paste0("pct_linked_found_", suffix),
             ifelse(is.na(pct_linked_found), NA, pct_linked_found),
             ifelse(is.na(pct_linked_found), "NA", paste0(pct_linked_found, "%")))

  add_result("performance_by_step", paste0("n_google_", suffix), n_google, format(n_google, big.mark = ","))
  add_result("performance_by_step", paste0("n_google_found_", suffix), n_google_found,
             sprintf("%s/%s (%s%%)", format(n_google_found, big.mark = ","), format(n_google, big.mark = ","),
                     ifelse(is.na(pct_google_found), "NA", pct_google_found)))
  add_result("performance_by_step", paste0("pct_google_found_", suffix),
             ifelse(is.na(pct_google_found), NA, pct_google_found),
             ifelse(is.na(pct_google_found), "NA", paste0(pct_google_found, "%")))

  # Return row for performance table CSV
  data.frame(
    registry = registry_name,
    n_total = n,
    tp = tp, fp = fp, tn = tn, fn = fn,
    sensitivity = round(sens, 3),
    specificity = round(spec, 3),
    ppv = round(ppv, 3),
    npv = round(npv, 3),
    f_score = ifelse(is.na(f_score), NA, round(f_score, 3)),
    n_found_tool = n_found_tool,
    pct_found_tool = pct_found_tool,
    n_found_human = n_found_human,
    pct_found_human = pct_found_human,
    n_with_pubmed_pub = n_with_pubmed_pub,
    n_correct_pub_found = n_correct_pub_found,
    pct_correct_pub_found = ifelse(is.na(pct_correct_pub), NA, pct_correct_pub),
    n_correct_classification = n_correct_classification,
    pct_correct_classification = ifelse(is.na(pct_correct_class), NA, pct_correct_class),
    n_linked = n_linked,
    n_linked_found = n_linked_found,
    pct_linked_found = ifelse(is.na(pct_linked_found), NA, pct_linked_found),
    n_google = n_google,
    n_google_found = n_google_found,
    pct_google_found = ifelse(is.na(pct_google_found), NA, pct_google_found),
    stringsAsFactors = FALSE
  )
}

# Compute for all registries combined
perf_table_rows[[1]] <- calc_registry_performance(df, "all")

# Compute per registry
for (reg in c("ctgov", "drks", "euctr")) {
  reg_df <- df %>% filter(registry == reg)
  perf_table_rows[[length(perf_table_rows) + 1]] <- calc_registry_performance(reg_df, reg)
}

# ===== 4. ERROR ANALYSIS EXPORTS =====

# Keep false_pos_df and false_neg_df for the exports below
false_pos_df <- df %>% filter(tool_results & !has_publication)
false_neg_df <- df %>% filter(!tool_results & has_publication)
false_pos <- nrow(false_pos_df)
false_neg <- nrow(false_neg_df)

# Export 20 randomly sampled false positives and false negatives to Excel
if (require(writexl, quietly = TRUE)) {
  set.seed(42)

  false_positives_sample <- df %>%
    filter(tool_results & !has_publication) %>%
    sample_n(min(20, false_pos)) %>%
    select(
      trial_id, tool_results, has_publication, has_summary_results,
      tool_prompted_pmids, tool_result_pmids, tool_ident_steps, identification_step, dataset
    )

  false_negatives_sample <- df %>%
    filter(!tool_results & has_publication) %>%
    sample_n(min(20, false_neg)) %>%
    select(
      trial_id, tool_results, has_publication, has_summary_results,
      tool_prompted_pmids, tool_result_pmids, tool_ident_steps, identification_step,
      publication_pmid, publication_url, publication_doi, dataset
    )

  write_xlsx(
    list(
      "False_Positives" = false_positives_sample,
      "False_Negatives" = false_negatives_sample
    ),
    "./data/validation_errors_sample.xlsx"
  )

  cat("Exported", nrow(false_positives_sample), "false positives and", nrow(false_negatives_sample), "false negatives to ./data/validation_errors_sample.xlsx\n")
} else {
  cat("Note: writexl package not available. Install with: install.packages('writexl')\n")
}

# Export all false pos and false neg to excel
if (require(writexl, quietly = TRUE)) {
  false_positives_all <- df %>%
    filter(tool_results & !has_publication) %>%
    select(
      trial_id, tool_results, has_publication, has_summary_results,
      tool_prompted_pmids, tool_result_pmids, tool_ident_steps, identification_step, dataset
    )

  false_negatives_all <- df %>%
    filter(!tool_results & has_publication) %>%
    select(
      trial_id, tool_results, has_publication, has_summary_results,
      tool_prompted_pmids, tool_result_pmids, tool_ident_steps, identification_step,
      publication_pmid, publication_url, publication_doi, dataset
    )

  write_xlsx(
    list(
      "False_Positives" = false_positives_all,
      "False_Negatives" = false_negatives_all
    ),
    "./data/validation_errors_all.xlsx"
  )

  cat("Exported all false positives and false negatives to ./data/validation_errors_all.xlsx\n")
} else {
  cat("Note: writexl package not available. Install with: install.packages('writexl')\n")
}

# Export all false positives and false negatives to separate CSV files in random order
set.seed(42)

false_positives_randomized <- false_pos_df %>%
  slice_sample(n = nrow(false_pos_df)) %>%
  select(
    trial_id, tool_results, has_publication, has_summary_results,
    tool_prompted_pmids, tool_result_pmids, tool_ident_steps, identification_step, dataset
  )

false_negatives_randomized <- false_neg_df %>%
  slice_sample(n = nrow(false_neg_df)) %>%
  select(
    trial_id, tool_results, has_publication, has_summary_results,
    tool_prompted_pmids, tool_result_pmids, tool_ident_steps, identification_step,
    publication_pmid, publication_url, publication_doi, dataset
  )

write.csv(false_positives_randomized, "./data/validation_errors_false_positives_randomized.csv", row.names = FALSE)
write.csv(false_negatives_randomized, "./data/validation_errors_false_negatives_randomized.csv", row.names = FALSE)

cat("Exported", nrow(false_positives_randomized), "randomized false positives to ./data/validation_errors_false_positives_randomized.csv\n")
cat("Exported", nrow(false_negatives_randomized), "randomized false negatives to ./data/validation_errors_false_negatives_randomized.csv\n")

# ===== 5. RESPONSE TIMES =====

response_times <- read.csv("./data/response_time.csv")

response_times <- response_times %>%
  mutate(
    first_timestamp_parsed = as.POSIXct(first_timestamp, format = "%Y-%m-%dT%H:%M:%OSZ", tz = "UTC"),
    last_timestamp_parsed = as.POSIXct(last_timestamp, format = "%Y-%m-%dT%H:%M:%OSZ", tz = "UTC"),
    duration_calculated_ms = as.numeric(difftime(last_timestamp_parsed, first_timestamp_parsed, units = "secs")) * 1000
  )

n_rt <- nrow(response_times)
mean_dur_s <- round(mean(response_times$duration_calculated_ms, na.rm = TRUE) / 1000, 1)
sd_dur_s <- round(sd(response_times$duration_calculated_ms, na.rm = TRUE) / 1000, 1)
min_dur_s <- round(min(response_times$duration_calculated_ms, na.rm = TRUE) / 1000, 1)
max_dur_s <- round(max(response_times$duration_calculated_ms, na.rm = TRUE) / 1000, 1)

add_result("response_time", "n_response_time_trials", n_rt, as.character(n_rt))
add_result("response_time", "mean_duration_s", mean_dur_s, sprintf("%.1f s", mean_dur_s))
add_result("response_time", "sd_duration_s", sd_dur_s, sprintf("SD=%.1f s", sd_dur_s))
add_result("response_time", "min_duration_s", min_dur_s, sprintf("%.1f s", min_dur_s))
add_result("response_time", "max_duration_s", max_dur_s, sprintf("%.1f s", max_dur_s))

# ===== 6. EXPORT =====

# Key-value summary
results_df <- do.call(rbind, results)
write.csv(results_df, "./out/2b_results_summary.csv", row.names = FALSE)
cat("Exported", nrow(results_df), "results to ./out/2b_results_summary.csv\n")

# Validation performance table (all + per-registry)
perf_table_df <- do.call(rbind, perf_table_rows)
write.csv(perf_table_df, "./out/2b_validation_performance.csv", row.names = FALSE)
cat("Exported performance table with", nrow(perf_table_df), "rows to ./out/2b_validation_performance.csv\n")

# ===== 7. MANUAL REVIEW ANALYSIS =====

library(readxl)

# --- Step 1: Read both Excel files (4 sheets total) ---
ava_file  <- "./data/FP_FN_ALL_2026-01-11_Ava.xlsx"
love_file <- "./data/FP_FN_ALL_2026-01-11_Love_Ahnstom.xlsx"

fp_ava  <- read_excel(ava_file, sheet = "FALSE POSITIVES")
fn_ava  <- read_excel(ava_file, sheet = "FALSE NEGATIVES")
fp_love <- read_excel(love_file, sheet = "FALSE POSITIVES")
fn_love <- read_excel(love_file, sheet = "FALSE NEGATIVES")

# Clean Ava's FN: convert literal "NA" strings to actual NA, then coerce to logical
fn_ava <- fn_ava %>%
  mutate(has_results_reviewer_2 = case_when(
    has_results_reviewer_2 == "TRUE"  ~ TRUE,
    has_results_reviewer_2 == "FALSE" ~ FALSE,
    TRUE ~ NA
  ))

# --- Step 2: Merge reviewer data ---
# Base = Love's file (has base columns + reviewer_1 + discussion_needed)
# Join Ava's reviewer_2 columns on trial_id

fp_merged <- fp_love %>%
  left_join(
    fp_ava %>% select(trial_id, has_results_reviewer_2, reason_reviewer_2),
    by = "trial_id"
  ) %>%
  mutate(
    agreement = case_when(
      is.na(has_results_reviewer_1) | is.na(has_results_reviewer_2) ~ "Pending",
      has_results_reviewer_1 == has_results_reviewer_2 ~ "Agreement",
      TRUE ~ "Disagreement"
    )
  )

fn_merged <- fn_love %>%
  left_join(
    fn_ava %>% select(trial_id, has_results_reviewer_2, reason_reviewer_2),
    by = "trial_id"
  ) %>%
  mutate(
    agreement = case_when(
      is.na(has_results_reviewer_1) | is.na(has_results_reviewer_2) ~ "Pending",
      has_results_reviewer_1 == has_results_reviewer_2 ~ "Agreement",
      TRUE ~ "Disagreement"
    )
  )

# --- Step 3: Export merged Excel file ---
write_xlsx(
  list(
    "False_Positives" = fp_merged,
    "False_Negatives" = fn_merged
  ),
  "./data/FP_FN_ALL_merged_with_discrepancies.xlsx"
)
cat("Exported merged review file to ./data/FP_FN_ALL_merged_with_discrepancies.xlsx\n")

# --- Step 4: Compute reclassification proportions ---
# FP: reviewer says TRUE  → tool was correct → reclassify as TP
# FN: reviewer says FALSE → tool was correct → reclassify as TN

# -- False Positives --
fp_reviewed_r1 <- fp_merged %>% filter(!is.na(has_results_reviewer_1))
fp_reviewed_r2 <- fp_merged %>% filter(!is.na(has_results_reviewer_2))
fp_both        <- fp_merged %>% filter(!is.na(has_results_reviewer_1) & !is.na(has_results_reviewer_2))
fp_consensus   <- fp_both %>% filter(agreement == "Agreement")

fp_reclass_r1        <- sum(fp_reviewed_r1$has_results_reviewer_1 == TRUE)
fp_reclass_r2        <- sum(fp_reviewed_r2$has_results_reviewer_2 == TRUE)
fp_reclass_consensus <- sum(fp_consensus$has_results_reviewer_1 == TRUE)

fp_rate_r1        <- if (nrow(fp_reviewed_r1) > 0) fp_reclass_r1 / nrow(fp_reviewed_r1) else NA
fp_rate_r2        <- if (nrow(fp_reviewed_r2) > 0) fp_reclass_r2 / nrow(fp_reviewed_r2) else NA
fp_rate_consensus <- if (nrow(fp_consensus) > 0) fp_reclass_consensus / nrow(fp_consensus) else NA

# -- False Negatives --
fn_reviewed_r1 <- fn_merged %>% filter(!is.na(has_results_reviewer_1))
fn_reviewed_r2 <- fn_merged %>% filter(!is.na(has_results_reviewer_2))
fn_both        <- fn_merged %>% filter(!is.na(has_results_reviewer_1) & !is.na(has_results_reviewer_2))
fn_consensus   <- fn_both %>% filter(agreement == "Agreement")

fn_reclass_r1        <- sum(fn_reviewed_r1$has_results_reviewer_1 == FALSE)
fn_reclass_r2        <- sum(fn_reviewed_r2$has_results_reviewer_2 == FALSE)
fn_reclass_consensus <- sum(fn_consensus$has_results_reviewer_1 == FALSE)

fn_rate_r1        <- if (nrow(fn_reviewed_r1) > 0) fn_reclass_r1 / nrow(fn_reviewed_r1) else NA
fn_rate_r2        <- if (nrow(fn_reviewed_r2) > 0) fn_reclass_r2 / nrow(fn_reviewed_r2) else NA
fn_rate_consensus <- if (nrow(fn_consensus) > 0) fn_reclass_consensus / nrow(fn_consensus) else NA

# -- Inter-rater agreement --
fp_agree     <- sum(fp_both$agreement == "Agreement")
fp_agree_pct <- if (nrow(fp_both) > 0) round(fp_agree * 100 / nrow(fp_both), 1) else NA

fn_agree     <- sum(fn_both$agreement == "Agreement")
fn_agree_pct <- if (nrow(fn_both) > 0) round(fn_agree * 100 / nrow(fn_both), 1) else NA

# -- Add to results collector --
add_result("manual_review", "fp_reviewed_r1", nrow(fp_reviewed_r1), as.character(nrow(fp_reviewed_r1)))
add_result("manual_review", "fp_reviewed_r2", nrow(fp_reviewed_r2), as.character(nrow(fp_reviewed_r2)))
add_result("manual_review", "fp_both_reviewed", nrow(fp_both), as.character(nrow(fp_both)))
add_result("manual_review", "fp_agreement", fp_agree, sprintf("%d/%d (%.1f%%)", fp_agree, nrow(fp_both), fp_agree_pct))
add_result("manual_review", "fp_discrepancies", sum(fp_both$agreement == "Disagreement"), as.character(sum(fp_both$agreement == "Disagreement")))

add_result("manual_review", "fp_reclass_rate_r1", round(fp_rate_r1 * 100, 1),
           sprintf("%d/%d (%.1f%%)", fp_reclass_r1, nrow(fp_reviewed_r1), fp_rate_r1 * 100))
add_result("manual_review", "fp_reclass_rate_r2", round(fp_rate_r2 * 100, 1),
           sprintf("%d/%d (%.1f%%)", fp_reclass_r2, nrow(fp_reviewed_r2), fp_rate_r2 * 100))
add_result("manual_review", "fp_reclass_rate_consensus", round(fp_rate_consensus * 100, 1),
           sprintf("%d/%d (%.1f%%)", fp_reclass_consensus, nrow(fp_consensus), fp_rate_consensus * 100))

add_result("manual_review", "fn_reviewed_r1", nrow(fn_reviewed_r1), as.character(nrow(fn_reviewed_r1)))
add_result("manual_review", "fn_reviewed_r2", nrow(fn_reviewed_r2), as.character(nrow(fn_reviewed_r2)))
add_result("manual_review", "fn_both_reviewed", nrow(fn_both), as.character(nrow(fn_both)))
if (nrow(fn_both) > 0) {
  add_result("manual_review", "fn_agreement", fn_agree, sprintf("%d/%d (%.1f%%)", fn_agree, nrow(fn_both), fn_agree_pct))
  add_result("manual_review", "fn_discrepancies", sum(fn_both$agreement == "Disagreement"), as.character(sum(fn_both$agreement == "Disagreement")))
}

add_result("manual_review", "fn_reclass_rate_r1",
           ifelse(is.na(fn_rate_r1), NA, round(fn_rate_r1 * 100, 1)),
           ifelse(is.na(fn_rate_r1), "NA",
                  sprintf("%d/%d (%.1f%%)", fn_reclass_r1, nrow(fn_reviewed_r1), fn_rate_r1 * 100)))
add_result("manual_review", "fn_reclass_rate_r2",
           ifelse(is.na(fn_rate_r2), NA, round(fn_rate_r2 * 100, 1)),
           ifelse(is.na(fn_rate_r2), "NA",
                  sprintf("%d/%d (%.1f%%)", fn_reclass_r2, nrow(fn_reviewed_r2), fn_rate_r2 * 100)))
add_result("manual_review", "fn_reclass_rate_consensus",
           ifelse(is.na(fn_rate_consensus), NA, round(fn_rate_consensus * 100, 1)),
           ifelse(is.na(fn_rate_consensus), "NA",
                  sprintf("%d/%d (%.1f%%)", fn_reclass_consensus, nrow(fn_consensus), fn_rate_consensus * 100)))

# --- Step 5: Print summary ---
cat("\n===== MANUAL REVIEW SUMMARY =====\n")

cat("\n-- False Positives --\n")
cat("Reviewed by Reviewer 1 (Love):", nrow(fp_reviewed_r1), "/", nrow(fp_merged), "\n")
cat("Reviewed by Reviewer 2 (Ava): ", nrow(fp_reviewed_r2), "/", nrow(fp_merged), "\n")
cat("Both reviewed:                 ", nrow(fp_both), "\n")
cat("Inter-rater agreement:         ", fp_agree, "/", nrow(fp_both),
    sprintf("(%.1f%%)\n", fp_agree_pct))
cat("Reclassified as TP (R1):       ", fp_reclass_r1, "/", nrow(fp_reviewed_r1),
    sprintf("(%.1f%%)\n", fp_rate_r1 * 100))
cat("Reclassified as TP (R2):       ", fp_reclass_r2, "/", nrow(fp_reviewed_r2),
    sprintf("(%.1f%%)\n", fp_rate_r2 * 100))
cat("Reclassified as TP (consensus):", fp_reclass_consensus, "/", nrow(fp_consensus),
    sprintf("(%.1f%%)\n", fp_rate_consensus * 100))

cat("\n-- False Negatives --\n")
cat("Reviewed by Reviewer 1 (Love):", nrow(fn_reviewed_r1), "/", nrow(fn_merged), "\n")
cat("Reviewed by Reviewer 2 (Ava): ", nrow(fn_reviewed_r2), "/", nrow(fn_merged), "\n")
cat("Both reviewed:                 ", nrow(fn_both), "\n")
if (nrow(fn_both) > 0) {
  cat("Inter-rater agreement:         ", fn_agree, "/", nrow(fn_both),
      sprintf("(%.1f%%)\n", fn_agree_pct))
}
if (!is.na(fn_rate_r1)) {
  cat("Reclassified as TN (R1):       ", fn_reclass_r1, "/", nrow(fn_reviewed_r1),
      sprintf("(%.1f%%)\n", fn_rate_r1 * 100))
}
if (!is.na(fn_rate_r2)) {
  cat("Reclassified as TN (R2):       ", fn_reclass_r2, "/", nrow(fn_reviewed_r2),
      sprintf("(%.1f%%)\n", fn_rate_r2 * 100))
}
if (!is.na(fn_rate_consensus)) {
  cat("Reclassified as TN (consensus):", fn_reclass_consensus, "/", nrow(fn_consensus),
      sprintf("(%.1f%%)\n", fn_rate_consensus * 100))
}

cat("\n=================================\n")

# Re-export results summary with manual review data included
results_df <- do.call(rbind, results)
write.csv(results_df, "./out/2b_results_summary.csv", row.names = FALSE)
cat("Re-exported", nrow(results_df), "results (incl. manual review) to ./out/2b_results_summary.csv\n")

