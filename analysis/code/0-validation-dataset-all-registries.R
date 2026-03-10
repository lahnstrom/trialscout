# ===== 0. SETUP =====

library(dplyr)

# Results collector: accumulates key-value rows for export
results <- list()
add_result <- function(section, key, value, formatted) {
  results[[length(results) + 1]] <<- data.frame(
    section = section, key = key,
    value = as.character(value), formatted = formatted,
    stringsAsFactors = FALSE
  )
}

# ===== 1. DATA LOADING =====

df_iv <- read.csv("./data/iv_main_dataset.csv")
df_nordic <- read.csv("./data/nordic_dataset.csv")

add_result("raw_data", "n_iv_raw", nrow(df_iv), format(nrow(df_iv), big.mark = ","))
add_result("raw_data", "n_nordic_raw", nrow(df_nordic), format(nrow(df_nordic), big.mark = ","))

# ===== 2. INTOVALUE PRE-PROCESSING =====

# Remap identification_step for IntoValue dataset
df_iv_remapped <- df_iv %>% mutate(
  identification_step = case_when(
    identification_step == "Abstract only" ~ "Other",
    identification_step == "Dissertation" ~ "Other",
    identification_step == "Hand search" ~ "Systematic Google search",
    identification_step == "No publ" ~ NA,
    identification_step == "Publ found in Google ID search" ~ "Systematic Google search",
    identification_step == "Publ found in Google search (no ID)" ~ "Systematic Google search",
    identification_step == "Pubmed" ~ "Other",
    identification_step == "Registry linked" ~ "Linked at the registration",
    TRUE ~ identification_step
  ),
  has_publication = ifelse(has_publication, "Yes", "No"),
  has_summary_results = ifelse(has_summary_results, "Yes", "No")
)

# Add dataset identifier and standardize columns
df_iv_processed <- df_iv_remapped %>%
  mutate(
    dataset = "iv",
    trial_id = id,
    registry = tolower(case_when(
      registry == "ClinicalTrials.gov" ~ "ctgov",
      registry == "DRKS" ~ "drks",
      TRUE ~ registry
    ))
  ) %>%
  select(trial_id, registry, has_publication, publication_doi, publication_pmid,
         publication_url, identification_step, has_summary_results,
         completion_year, dataset)

# ===== 3. NORDIC PRE-PROCESSING =====

df_nordic_processed <- df_nordic %>%
  mutate(
    dataset = "nordic",
    trial_id = main_id,
    registry = tolower(registry),
    has_publication = case_when(
      has_publication == "Yes" ~ "Yes",
      has_publication == "No" ~ "No",
      TRUE ~ NA_character_
    ),
    has_summary_results = case_when(
      has_summary_results == "Yes" ~ "Yes",
      has_summary_results == "No" ~ "No",
      TRUE ~ NA_character_
    )
  ) %>%
  select(trial_id, registry, has_publication, publication_doi, publication_pmid,
         publication_url, identification_step, has_summary_results,
         completion_year, dataset)

# ===== 4. MERGE AND DEDUPLICATION =====

df <- bind_rows(df_iv_processed, df_nordic_processed)
n_before_dedup <- nrow(df)

# Identify duplicates between datasets
duplicated_ids <- df %>%
  group_by(trial_id) %>%
  filter(n() > 1) %>%
  pull(trial_id) %>%
  unique()
n_duplicates <- length(duplicated_ids)

cat("Duplicates between IntoValue and Nordic datasets:", n_duplicates, "\n")
if (n_duplicates > 0) {
  cat("Duplicated trial IDs:\n")
  print(duplicated_ids)
}

add_result("deduplication", "n_before_dedup", n_before_dedup, format(n_before_dedup, big.mark = ","))
add_result("deduplication", "n_duplicates_between_datasets", n_duplicates, format(n_duplicates, big.mark = ","))

# Remove duplicates (keep first occurrence, i.e. IntoValue)
df <- df %>%
  distinct(trial_id, .keep_all = TRUE)

# ===== 5. FILTERING =====

n_before_multi_id <- nrow(df)

# Remove trials with multiple IDs (separated by ;)
df <- df %>%
  filter(!grepl(";", trial_id))
n_removed_multi_id <- n_before_multi_id - nrow(df)

add_result("filtering", "n_removed_multi_id", n_removed_multi_id, format(n_removed_multi_id, big.mark = ","))

# Clean up registry column - remove quotes and standardize
df <- df %>%
  mutate(registry = gsub('"', '', registry))

n_before_registry_filter <- nrow(df)
df <- df %>%
  filter(registry %in% c("ctgov", "drks", "euctr"))
n_removed_registry <- n_before_registry_filter - nrow(df)

add_result("filtering", "n_removed_other_registry", n_removed_registry, format(n_removed_registry, big.mark = ","))
add_result("filtering", "n_final", nrow(df), format(nrow(df), big.mark = ","))

# ===== 6. SUMMARY STATISTICS =====

cat("\nTotal trials by registry:\n")
print(df %>% group_by(registry) %>% summarise(n = n()))

cat("\nTotal trials:", nrow(df), "\n")

for (reg in c("ctgov", "drks", "euctr")) {
  n_reg <- df %>% filter(registry == reg) %>% nrow()
  add_result("by_registry", paste0("n_", reg), n_reg, format(n_reg, big.mark = ","))
}

cat("\nPublications by registry:\n")
print(df %>%
        group_by(registry, has_publication) %>%
        summarise(n = n(), .groups = "drop"))

cat("\nSummary results by registry:\n")
print(df %>%
        group_by(registry, has_summary_results) %>%
        summarise(n = n(), .groups = "drop"))

# ===== 7. CROSS-REGISTRATION ANALYSIS =====
# In the Nordic dataset, trials registered in both EUCTR and ClinicalTrials.gov
# have both eudract_id and nct_id populated. The registry column reflects the
# primary trial ID (main_id) used in the dataset, which determines how the trial
# is classified in per-registry performance analyses.
# Note: The Nordic paper (Nilsonne et al. 2025) preferred EUCTR for cross-registered
# trials, but TrialScout was run against main_id, so registry assignment here reflects
# which ID was actually used for evaluation.

# Non-exclusive registry counts (a trial can be counted in both)
# These match the figures reported in Nilsonne et al. (2025) Table 1
n_nordic_with_nct <- df_nordic %>%
  filter(!is.na(nct_id) & nct_id != "") %>% nrow()
n_nordic_with_eudract <- df_nordic %>%
  filter(!is.na(eudract_id) & eudract_id != "") %>% nrow()

add_result("cross_registration", "n_nordic_registered_ctgov", n_nordic_with_nct,
           format(n_nordic_with_nct, big.mark = ","))
add_result("cross_registration", "n_nordic_registered_euctr", n_nordic_with_eudract,
           format(n_nordic_with_eudract, big.mark = ","))

nordic_cross_registered <- df_nordic %>%
  filter(!is.na(eudract_id) & eudract_id != "" &
         !is.na(nct_id) & nct_id != "")

n_cross_registered <- nrow(nordic_cross_registered)
n_cross_as_euctr <- nordic_cross_registered %>%
  filter(tolower(registry) == "euctr") %>% nrow()
n_cross_as_ctgov <- nordic_cross_registered %>%
  filter(tolower(registry) == "ctgov") %>% nrow()

# Of cross-registered trials, how many ended up in the final validation dataset?
cross_ids <- nordic_cross_registered$main_id
n_cross_in_final <- df %>% filter(trial_id %in% cross_ids) %>% nrow()
n_cross_in_final_euctr <- df %>% filter(trial_id %in% cross_ids, registry == "euctr") %>% nrow()
n_cross_in_final_ctgov <- df %>% filter(trial_id %in% cross_ids, registry == "ctgov") %>% nrow()

cat("\n===== CROSS-REGISTRATION ANALYSIS =====\n")
cat("Nordic trials registered at ClinicalTrials.gov (non-exclusive):", n_nordic_with_nct, "\n")
cat("Nordic trials registered in EUCTR (non-exclusive):", n_nordic_with_eudract, "\n")
cat("Nordic trials registered in both EUCTR and ClinicalTrials.gov:", n_cross_registered, "\n")
cat("  Classified under EUCTR (EudraCT as main_id):", n_cross_as_euctr, "\n")
cat("  Classified under ClinicalTrials.gov (NCT as main_id):", n_cross_as_ctgov, "\n")
cat("Cross-registered trials in final validation dataset:", n_cross_in_final, "\n")
cat("  As EUCTR:", n_cross_in_final_euctr, "\n")
cat("  As ClinicalTrials.gov:", n_cross_in_final_ctgov, "\n")

add_result("cross_registration", "n_cross_registered_nordic", n_cross_registered,
           format(n_cross_registered, big.mark = ","))
add_result("cross_registration", "n_cross_as_euctr", n_cross_as_euctr,
           format(n_cross_as_euctr, big.mark = ","))
add_result("cross_registration", "n_cross_as_ctgov", n_cross_as_ctgov,
           format(n_cross_as_ctgov, big.mark = ","))
add_result("cross_registration", "n_cross_in_final", n_cross_in_final,
           format(n_cross_in_final, big.mark = ","))
add_result("cross_registration", "n_cross_in_final_euctr", n_cross_in_final_euctr,
           format(n_cross_in_final_euctr, big.mark = ","))
add_result("cross_registration", "n_cross_in_final_ctgov", n_cross_in_final_ctgov,
           format(n_cross_in_final_ctgov, big.mark = ","))

# ===== 8. EXPORT =====

write.csv(df, "./out/validation_dataset_all_registries.csv", row.names = FALSE)
cat("\nOutput written to: ./out/validation_dataset_all_registries.csv\n")

results_df <- do.call(rbind, results)
write.csv(results_df, "./out/0_results_summary_all_registries.csv", row.names = FALSE)
cat("Exported", nrow(results_df), "results to ./out/0_results_summary_all_registries.csv\n")
