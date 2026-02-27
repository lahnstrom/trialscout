# ===== 0. SETUP AND THEME =====

library(data.table)
library(lubridate)
library(presize)
library(dplyr)
library(tidyr)
library(ggplot2)
library(scales)
library(patchwork)
library(stringr)
library(eulerr)
library(grid)

# Results collector: accumulates key-value rows for export
results <- list()
add_result <- function(section, key, value, formatted) {
  results[[length(results) + 1]] <<- data.frame(
    section = section, key = key,
    value = as.character(value), formatted = formatted,
    stringsAsFactors = FALSE
  )
}

# Table collectors
table3_rows <- list()
table4_rows <- list()

my_theme <- theme(
  plot.title = element_text(size = 24),
  axis.title.x = element_text(size = 24),
  axis.title.y = element_text(size = 24),
  axis.text.x = element_text(size = 20),
  axis.text.y = element_text(size = 20),
  legend.text = element_text(size = 20),
  legend.title = element_text(size = 20),
  panel.background = element_rect(fill = "white"),
  plot.background = element_rect(fill = "white"),
  panel.grid.major = element_line(color = "gray90"),
  panel.grid.minor = element_line(color = "gray95")
)

my_theme_small <- theme(
  plot.title = element_text(size = 24),
  axis.title.x = element_text(size = 24),
  axis.title.y = element_text(size = 20),
  axis.text.x = element_text(size = 20),
  axis.text.y = element_text(size = 20),
  legend.text = element_text(size = 20),
  panel.background = element_rect(fill = "white"),
  plot.background = element_rect(fill = "white"),
  panel.grid.major = element_line(color = "gray90"),
  panel.grid.minor = element_line(color = "gray95")
)

# ===== 1. DATA LOADING AND PRE-PROCESSING =====

load("./data/finalSample.rda")
tool_results <- read.csv("./data/results-final-run.csv") %>%
  select(nct_id, starts_with("tool"))

n_trials <- tool_results %>% nrow()

merged_trials <- left_join(x = tool_results, y = df, by = join_by(nct_id == `NCT Number`)) %>%
  mutate(tool_results = !is.na(tool_results) & tool_results == 1) %>%
  mutate(funder_type_grouped = case_match(
    `Funder Type`,
    c("FED") ~ "Federal",
    c("INDIV", "OTHER", "NETWORK", "UNKNOWN") ~ "All others (individuals, universities, organizations)",
    "INDUSTRY" ~ "Industry",
    c("NIH", "OTHER_GOV") ~ "NIH/Other governmental",
  ))

merged_trials <- merged_trials %>%
  mutate(
    tool_or_summary = tool_results | (`Study Results` == "YES"),
    has_summary_results = `Study Results` == "YES"
  )

merged_trials <- merged_trials %>%
  mutate(
    pubmed_naive = grepl("pubmed_naive", x = tool_ident_steps),
    pubmed_enhanced = grepl("pubmed_enhanced", x = tool_ident_steps),
    linked_at_registration = grepl("linked_at_registration", x = tool_ident_steps),
    google_scholar = grepl("google_scholar", x = tool_ident_steps),
    nct_match = grepl("nct_match", x = tool_ident_steps),
  )

# ===== 2. DETECTION RATES =====

n_published <- merged_trials %>% filter(tool_results) %>% nrow()
n_not_published <- n_trials - n_published
pct_published <- round(n_published * 100 / n_trials, 1)

n_reported <- merged_trials %>% filter(tool_or_summary) %>% nrow()
n_not_reported <- n_trials - n_reported
pct_reported <- round(n_reported * 100 / n_trials, 1)

n_summary <- merged_trials %>% filter(`Study Results` == "YES") %>% nrow()
pct_summary <- round(n_summary * 100 / n_trials, 1)

add_result("detection_rates", "n_trials", n_trials,
           format(n_trials, big.mark = ","))
add_result("detection_rates", "n_published_results", n_published,
           sprintf("%s/%s (%s%%)", format(n_published, big.mark = ","), format(n_trials, big.mark = ","), pct_published))
add_result("detection_rates", "pct_published_results", pct_published,
           paste0(pct_published, "%"))
add_result("detection_rates", "n_reported_results", n_reported,
           sprintf("%s/%s (%s%%)", format(n_reported, big.mark = ","), format(n_trials, big.mark = ","), pct_reported))
add_result("detection_rates", "pct_reported_results", pct_reported,
           paste0(pct_reported, "%"))
add_result("detection_rates", "n_summary_results", n_summary,
           sprintf("%s/%s (%s%%)", format(n_summary, big.mark = ","), format(n_trials, big.mark = ","), pct_summary))
add_result("detection_rates", "pct_summary_results", pct_summary,
           paste0(pct_summary, "%"))

# Discovery strategy attribution (trial-level: which strategies contributed to results)
discovery_categories <- c("pubmed_naive", "pubmed_enhanced", "linked_at_registration", "google_scholar", "nct_match")

for (category in discovery_categories) {
  n_cat <- merged_trials %>% filter(!!sym(category)) %>% nrow()
  pct_cat <- round(n_cat * 100 / n_trials, 1)
  add_result("discovery_attribution", paste0("n_trials_", category), n_cat,
             sprintf("%s/%s (%s%%)", format(n_cat, big.mark = ","), format(n_trials, big.mark = ","), pct_cat))
}

# ===== 2b. VENN DIAGRAM: PUBLISHED VS SUMMARY RESULTS =====

n_both <- n_published + n_summary - n_reported
n_published_only <- n_reported - n_summary
n_summary_only <- n_reported - n_published
n_neither <- n_trials - n_reported

add_result("venn", "n_published_only", n_published_only,
           sprintf("%s (%s%%)", format(n_published_only, big.mark = ","),
                   round(n_published_only * 100 / n_trials, 1)))
add_result("venn", "n_summary_only", n_summary_only,
           sprintf("%s (%s%%)", format(n_summary_only, big.mark = ","),
                   round(n_summary_only * 100 / n_trials, 1)))
add_result("venn", "n_both", n_both,
           sprintf("%s (%s%%)", format(n_both, big.mark = ","),
                   round(n_both * 100 / n_trials, 1)))
add_result("venn", "n_neither", n_neither,
           sprintf("%s (%s%%)", format(n_neither, big.mark = ","),
                   round(n_neither * 100 / n_trials, 1)))

fit <- euler(c(
  "Published results" = n_published_only,
  "Summary results" = n_summary_only,
  "Published results&Summary results" = n_both
))

pdf("./out/figures/2c_venn_published_summary.pdf", width = 8, height = 6)
print(plot(fit,
     quantities = list(labels = c(format(n_published_only, big.mark = ","),
                                  format(n_summary_only, big.mark = ","),
                                  format(n_both, big.mark = ",")),
                       fontsize = 16),
     labels = FALSE,
     fills = list(fill = c("#4A90D9", "#D94A4A"), alpha = 0.5)))
seekViewport("panel.vp.1.1")
grid.text("Published results",
          x = unit(-32.5, "native"), y = unit(8, "native"),
          gp = gpar(fontsize = 18, fontface = "bold"))
grid.text("Reported results",
          x = unit(11.6, "native"), y = unit(8, "native"),
          gp = gpar(fontsize = 18, fontface = "bold"))
grid.text("Summary\nresults",
          x = unit(39.5, "native"), y = unit(8, "native"),
          gp = gpar(fontsize = 16, fontface = "bold"))
upViewport()
dev.off()

# ===== 3. PUBLICATION-LEVEL ANALYSIS =====

tool_pubs <- read.csv("./data/random_sample_1_publications.csv")

tool_pubs <- tool_pubs %>%
  mutate(has_results = ifelse(has_results == "true", T, F)) %>%
  mutate(
    pubmed_naive = grepl("pubmed_naive", x = sources),
    pubmed_enhanced = grepl("pubmed_enhanced", x = sources),
    linked_at_registration = grepl("linked_at_registration", x = sources),
    google_scholar = grepl("google_scholar", x = sources),
    nct_match = grepl("nct_match", x = sources),
  )

n_publications <- tool_pubs %>% nrow()
n_publications_res <- tool_pubs %>% filter(has_results) %>% nrow()
pct_result_pubs <- round(n_publications_res * 100 / n_publications, 1)

add_result("publications", "n_candidate_publications", n_publications,
           format(n_publications, big.mark = ","))
add_result("publications", "n_result_publications", n_publications_res,
           format(n_publications_res, big.mark = ","))
add_result("publications", "pct_result_publications", pct_result_pubs,
           paste0(pct_result_pubs, "%"))

# Per-strategy publication counts
strategy_labels <- c(
  pubmed_naive = "Predefined PubMed search query",
  pubmed_enhanced = "LLM-constructed PubMed search query",
  linked_at_registration = "Linked to from trial registration",
  google_scholar = "NCT-ID-search in Google Scholar",
  nct_match = "NCT-ID-search in offline PubMed database"
)

for (strategy in names(strategy_labels)) {
  n_cand <- tool_pubs %>% filter(!!sym(strategy)) %>% nrow()
  n_res <- tool_pubs %>% filter(!!sym(strategy), has_results) %>% nrow()
  pct_cand <- round(n_cand * 100 / n_publications, 1)
  pct_res <- round(n_res * 100 / n_publications_res, 1)
  pct_res_per_cand <- round(n_res * 100 / n_cand, 1)

  add_result("discovery_strategy", paste0("n_candidates_", strategy), n_cand,
             sprintf("%s (%s%%)", format(n_cand, big.mark = ","), pct_cand))
  add_result("discovery_strategy", paste0("n_results_", strategy), n_res,
             sprintf("%s (%s%%)", format(n_res, big.mark = ","), pct_res))
  add_result("discovery_strategy", paste0("pct_result_per_candidate_", strategy), pct_res_per_cand,
             paste0(pct_res_per_cand, "%"))

  table4_rows[[length(table4_rows) + 1]] <- data.frame(
    strategy = strategy_labels[[strategy]],
    n_candidates = n_cand,
    pct_candidates = pct_cand,
    n_results = n_res,
    pct_results = pct_res,
    pct_result_per_candidate = pct_res_per_cand,
    stringsAsFactors = FALSE
  )
}

# "All" totals row for Table 4
table4_rows[[length(table4_rows) + 1]] <- data.frame(
  strategy = "All",
  n_candidates = n_publications,
  pct_candidates = 100.0,
  n_results = n_publications_res,
  pct_results = 100.0,
  pct_result_per_candidate = pct_result_pubs,
  stringsAsFactors = FALSE
)

# Publication source combinations
pub_source_summary <- tool_pubs %>%
  group_by(sources) %>%
  summarise(n = n())

# ===== 4. PUBLICATIONS PER TRIAL =====

trials_with_results <- merged_trials %>%
  filter(tool_results) %>%
  mutate(n_publications = str_count(tool_result_pmids, ",") + 1)

median_pubs <- median(trials_with_results$n_publications)
mean_pubs <- round(mean(trials_with_results$n_publications), 2)
sd_pubs <- round(sd(trials_with_results$n_publications), 2)

add_result("publications_per_trial", "mean_pubs_per_trial", mean_pubs, as.character(mean_pubs))
add_result("publications_per_trial", "median_pubs_per_trial", median_pubs, as.character(median_pubs))
add_result("publications_per_trial", "sd_pubs_per_trial", sd_pubs, as.character(sd_pubs))

binned_publication_counts <- trials_with_results %>%
  mutate(
    publication_category = case_when(
      n_publications == 1 ~ "1",
      n_publications == 2 ~ "2",
      n_publications == 3 ~ "3",
      n_publications > 3 ~ ">3"
    )
  ) %>%
  count(publication_category, name = "number_of_trials")

for (i in seq_len(nrow(binned_publication_counts))) {
  cat_label <- binned_publication_counts$publication_category[i]
  cat_n <- binned_publication_counts$number_of_trials[i]
  key_suffix <- ifelse(cat_label == ">3", "gt3", cat_label)
  add_result("publications_per_trial", paste0("n_trials_", key_suffix, "_pub"), cat_n,
             sprintf("n=%s", format(cat_n, big.mark = ",")))
}

count_10_or_more <- trials_with_results %>% filter(n_publications >= 10) %>% nrow()
count_20_or_more <- trials_with_results %>% filter(n_publications >= 20) %>% nrow()

add_result("publications_per_trial", "n_trials_gte10_pub", count_10_or_more,
           sprintf("n=%s", count_10_or_more))
add_result("publications_per_trial", "n_trials_gte20_pub", count_20_or_more,
           sprintf("n=%s", count_20_or_more))

# ===== 5. LOGISTIC REGRESSION: ENROLLMENT =====

merged_trials_enrolment <- merged_trials %>%
  mutate(
    tool_results = ifelse(tool_results, 1, 0),
    tool_or_summary = ifelse(tool_or_summary, 1, 0)
  )

# Published results ~ log(Enrollment)
logistic_model_enrolment <- merged_trials_enrolment %>%
  filter(!is.na(Enrollment) & Enrollment != 0) %>%
  glm(tool_results ~ log(Enrollment), data = ., family = binomial())

# Reported results ~ log(Enrollment)
logistic_model_enrolment_any <- merged_trials_enrolment %>%
  filter(!is.na(Enrollment) & Enrollment != 0) %>%
  glm(tool_or_summary ~ log(Enrollment), data = ., family = binomial())

summary(logistic_model_enrolment)
summary(logistic_model_enrolment_any)

coef_enrol_pub <- summary(logistic_model_enrolment)$coefficients
coef_enrol_rep <- summary(logistic_model_enrolment_any)$coefficients

add_result("logistic_enrollment", "beta_enrollment_published",
           round(coef_enrol_pub["log(Enrollment)", "Estimate"], 3),
           sprintf("\u03b2=%.3f", coef_enrol_pub["log(Enrollment)", "Estimate"]))
add_result("logistic_enrollment", "p_enrollment_published",
           coef_enrol_pub["log(Enrollment)", "Pr(>|z|)"],
           ifelse(coef_enrol_pub["log(Enrollment)", "Pr(>|z|)"] < 0.001, "p<0.001",
                  sprintf("p=%.3f", coef_enrol_pub["log(Enrollment)", "Pr(>|z|)"])))

add_result("logistic_enrollment", "beta_enrollment_reported",
           round(coef_enrol_rep["log(Enrollment)", "Estimate"], 3),
           sprintf("\u03b2=%.3f", coef_enrol_rep["log(Enrollment)", "Estimate"]))
add_result("logistic_enrollment", "p_enrollment_reported",
           coef_enrol_rep["log(Enrollment)", "Pr(>|z|)"],
           ifelse(coef_enrol_rep["log(Enrollment)", "Pr(>|z|)"] < 0.001, "p<0.001",
                  sprintf("p=%.3f", coef_enrol_rep["log(Enrollment)", "Pr(>|z|)"])))

# Enrollment decile plot
merged_trials_enrolment_non_na <- merged_trials_enrolment %>%
  filter(!is.na(Enrollment)) %>%
  mutate(decile = cut(
    Enrollment,
    breaks = quantile(Enrollment, probs = seq(0, 1, 0.1), na.rm = TRUE),
    include.lowest = TRUE,
    labels = FALSE
  ))

proportions <- merged_trials_enrolment_non_na %>%
  group_by(decile) %>%
  summarise(
    proportion = mean(tool_or_summary == 1, na.rm = TRUE),
    min_enrolment = min(Enrollment, na.rm = TRUE),
    max_enrolment = max(Enrollment, na.rm = TRUE)
  ) %>%
  mutate(
    label = if_else(
      decile == 10,
      paste0(format(min_enrolment, big.mark = ","), "\u2013\n", format(max_enrolment, big.mark = ",")),
      paste0(min_enrolment, "\u2013", max_enrolment)
    )
  )

plot_enrolment_deciles <- ggplot(proportions, aes(x = reorder(label, decile), y = proportion)) +
  geom_bar(stat = "identity", fill = "steelblue") +
  scale_y_continuous(
    labels = scales::percent,
    limits = c(0, 1)
  ) +
  labs(
    x = "Enrolment (n)",
    y = "Proportion with Reported Results"
  ) +
  theme_minimal() +
  theme(
    axis.text.x = element_text(angle = 0)
  )

ggsave("./out/figures/2c_enrollment_deciles.pdf", plot = plot_enrolment_deciles, device = "pdf", width = 8, height = 6)

# ===== 6. LOGISTIC REGRESSION: COMPLETION YEAR =====

merged_trials_year <- merged_trials %>% mutate(
  tool_results = ifelse(tool_results, 1, 0),
  tool_or_summary = ifelse(tool_or_summary, 1, 0),
  centered_year = completion_year - mean(merged_trials$completion_year)
)

mean_completion_year <- round(mean(merged_trials$completion_year), 2)
add_result("logistic_year", "mean_completion_year", mean_completion_year, as.character(mean_completion_year))

# Centered models
logistic_model_year <- merged_trials_year %>%
  glm(tool_results ~ centered_year, data = ., family = binomial())
logistic_model_year_any <- merged_trials_year %>%
  glm(tool_or_summary ~ centered_year, data = ., family = binomial())

summary(logistic_model_year)
summary(logistic_model_year_any)

coef_year_pub_c <- summary(logistic_model_year)$coefficients
coef_year_rep_c <- summary(logistic_model_year_any)$coefficients

add_result("logistic_year", "beta_year_centered_published",
           round(coef_year_pub_c["centered_year", "Estimate"], 3),
           sprintf("\u03b2=%.3f", coef_year_pub_c["centered_year", "Estimate"]))
add_result("logistic_year", "p_year_centered_published",
           coef_year_pub_c["centered_year", "Pr(>|z|)"],
           ifelse(coef_year_pub_c["centered_year", "Pr(>|z|)"] < 0.001, "p<0.001",
                  sprintf("p=%.3f", coef_year_pub_c["centered_year", "Pr(>|z|)"])))
add_result("logistic_year", "beta_year_centered_reported",
           round(coef_year_rep_c["centered_year", "Estimate"], 3),
           sprintf("\u03b2=%.3f", coef_year_rep_c["centered_year", "Estimate"]))
add_result("logistic_year", "p_year_centered_reported",
           coef_year_rep_c["centered_year", "Pr(>|z|)"],
           ifelse(coef_year_rep_c["centered_year", "Pr(>|z|)"] < 0.001, "p<0.001",
                  sprintf("p=%.3f", coef_year_rep_c["centered_year", "Pr(>|z|)"])))

# Uncentered models
logistic_model_year_uncentered <- merged_trials_year %>%
  glm(tool_results ~ completion_year, data = ., family = binomial())
logistic_model_year_uncentered_any <- merged_trials_year %>%
  glm(tool_or_summary ~ completion_year, data = ., family = binomial())

summary(logistic_model_year_uncentered)
summary(logistic_model_year_uncentered_any)

coef_year_pub_u <- summary(logistic_model_year_uncentered)$coefficients
coef_year_rep_u <- summary(logistic_model_year_uncentered_any)$coefficients

add_result("logistic_year", "beta_year_published",
           round(coef_year_pub_u["completion_year", "Estimate"], 3),
           sprintf("\u03b2=%.3f", coef_year_pub_u["completion_year", "Estimate"]))
add_result("logistic_year", "p_year_published",
           coef_year_pub_u["completion_year", "Pr(>|z|)"],
           ifelse(coef_year_pub_u["completion_year", "Pr(>|z|)"] < 0.001, "p<0.001",
                  sprintf("p=%.3f", coef_year_pub_u["completion_year", "Pr(>|z|)"])))
add_result("logistic_year", "beta_year_reported",
           round(coef_year_rep_u["completion_year", "Estimate"], 3),
           sprintf("\u03b2=%.3f", coef_year_rep_u["completion_year", "Estimate"]))
add_result("logistic_year", "p_year_reported",
           coef_year_rep_u["completion_year", "Pr(>|z|)"],
           ifelse(coef_year_rep_u["completion_year", "Pr(>|z|)"] < 0.001, "p<0.001",
                  sprintf("p=%.3f", coef_year_rep_u["completion_year", "Pr(>|z|)"])))

# Predicted values for plot
Predicted_data_year <- data.frame(completion_year = seq(
  min(merged_trials_year$completion_year, na.rm = T),
  max(merged_trials_year$completion_year, na.rm = T),
  length.out = 500
))
Predicted_data_year$tool_results <- predict(logistic_model_year_uncentered, Predicted_data_year, type = "response")

# Completion year scatter plot
summary_data <- merged_trials_year %>%
  group_by(completion_year) %>%
  summarise(
    proportion = mean(tool_results == 1),
    trial_count = n(),
    .groups = "drop"
  )

underlying_data_plot_year <- ggplot(summary_data, aes(x = completion_year, y = proportion)) +
  geom_point(aes(size = trial_count), color = "steelblue", alpha = 0.7) +
  my_theme +
  labs(
    x = "Completion Year",
    y = "Proportion with\nPublished results",
    size = "Number of Trials"
  ) +
  theme(axis.text.x = element_text(angle = 45, hjust = 1))
print(underlying_data_plot_year)
ggsave("./out/figures/2c_completion_year_scatter.pdf", plot = underlying_data_plot_year, device = "pdf", width = 10, height = 6)

# ===== 7. CHI-SQUARED: REPORTED RESULTS (tool_or_summary) =====

# Helper function for summary tables
create_summary_table <- function(contingency_tbl) {
  if (!all(c("TRUE", "FALSE") %in% colnames(contingency_tbl))) {
    stop("Input table must have 'TRUE' and 'FALSE' columns.")
  }

  reordered_tbl <- contingency_tbl[, c("TRUE", "FALSE")]
  sum_col <- rowSums(reordered_tbl)
  percent_true_col <- ifelse(sum_col == 0, 0, (reordered_tbl[, "TRUE"] / sum_col) * 100)

  summary_string <- sprintf(
    "%d/%d (%.1f%%)",
    reordered_tbl[, "TRUE"],
    sum_col,
    percent_true_col
  )

  final_tbl <- cbind(reordered_tbl,
    SUM = sum_col,
    PERCENT_TRUE = round(percent_true_col, 1),
    SUMMARY = summary_string
  )

  return(final_tbl)
}

# Helper: run chi-squared test and collect results for a subgroup
run_chisq_subgroup <- function(data, group_var, outcome_var, section_name, category_name) {
  contingency_table <- table(data[[group_var]], data[[outcome_var]])
  chi_test <- chisq.test(contingency_table)
  summary_tbl <- create_summary_table(contingency_table)

  print(chi_test)
  print(summary_tbl)

  # Store chi-squared test results
  p_val <- chi_test$p.value
  add_result(section_name, paste0("chisq_statistic_", category_name),
             round(chi_test$statistic, 3), sprintf("X2=%.3f", chi_test$statistic))
  add_result(section_name, paste0("chisq_df_", category_name),
             chi_test$parameter, sprintf("df=%d", chi_test$parameter))
  add_result(section_name, paste0("chisq_p_", category_name),
             p_val, ifelse(p_val < 0.001, "p<0.001", sprintf("p=%.3f", p_val)))

  # Return summary table for Table 3 building
  list(summary_tbl = summary_tbl, p_value = p_val, chi_test = chi_test)
}

# Helper: add rows to table3 from a summary table
add_table3_rows <- function(summary_tbl, category_name, p_val,
                            reported_summary_tbl = NULL, reported_p_val = NULL,
                            summary_result_tbl = NULL, summary_result_p_val = NULL) {
  levels <- rownames(summary_tbl)
  for (i in seq_along(levels)) {
    level <- levels[i]
    n_true <- summary_tbl[level, "TRUE"]
    n_total <- summary_tbl[level, "SUM"]
    pct <- summary_tbl[level, "PERCENT_TRUE"]
    summary_str <- summary_tbl[level, "SUMMARY"]

    # Get reported columns if provided
    if (!is.null(reported_summary_tbl)) {
      n_rep <- reported_summary_tbl[level, "TRUE"]
      n_rep_total <- reported_summary_tbl[level, "SUM"]
      pct_rep <- reported_summary_tbl[level, "PERCENT_TRUE"]
      summary_rep <- reported_summary_tbl[level, "SUMMARY"]
    } else {
      n_rep <- NA; n_rep_total <- NA; pct_rep <- NA; summary_rep <- NA
    }

    # Get summary result columns if provided
    if (!is.null(summary_result_tbl)) {
      n_sum_res <- summary_result_tbl[level, "TRUE"]
      pct_sum_res <- summary_result_tbl[level, "PERCENT_TRUE"]
      summary_sum_res <- summary_result_tbl[level, "SUMMARY"]
    } else {
      n_sum_res <- NA; pct_sum_res <- NA; summary_sum_res <- NA
    }

    table3_rows[[length(table3_rows) + 1]] <<- data.frame(
      subgroup_category = category_name,
      subgroup_level = level,
      n_reported = n_rep,
      n_total = n_rep_total,
      pct_reported = pct_rep,
      summary_reported = summary_rep,
      n_summary_result = n_sum_res,
      pct_summary_result = pct_sum_res,
      summary_summary_result = summary_sum_res,
      n_published = n_true,
      pct_published = pct,
      summary_published = summary_str,
      p_value = ifelse(i == 1 & !is.null(reported_p_val),
                       ifelse(reported_p_val < 0.001, "<0.001", sprintf("%.3f", reported_p_val)), ""),
      p_value_summary_result = ifelse(i == 1 & !is.null(summary_result_p_val),
                       ifelse(summary_result_p_val < 0.001, "<0.001", sprintf("%.3f", summary_result_p_val)), ""),
      stringsAsFactors = FALSE
    )
  }
}

# --- Study Status ---
chisq_status_reported <- run_chisq_subgroup(
  merged_trials, "Study Status", "tool_or_summary", "chisq_reported", "status")

chisq_status_summary <- run_chisq_subgroup(
  merged_trials, "Study Status", "has_summary_results", "chisq_summary", "status")

chisq_status_published <- run_chisq_subgroup(
  merged_trials, "Study Status", "tool_results", "chisq_published", "status")

add_table3_rows(chisq_status_published$summary_tbl, "Study status",
                chisq_status_published$p_value,
                chisq_status_reported$summary_tbl, chisq_status_reported$p_value,
                chisq_status_summary$summary_tbl, chisq_status_summary$p_value)

# --- Study Phases ---
df_named_missing_phase <- merged_trials %>%
  mutate(Phases = ifelse(is.na(Phases) | Phases == "", "Missing/NA", Phases))

chisq_phase_reported <- run_chisq_subgroup(
  df_named_missing_phase, "Phases", "tool_or_summary", "chisq_reported", "phase")

chisq_phase_summary <- run_chisq_subgroup(
  df_named_missing_phase, "Phases", "has_summary_results", "chisq_summary", "phase")

chisq_phase_published <- run_chisq_subgroup(
  df_named_missing_phase, "Phases", "tool_results", "chisq_published", "phase")

add_table3_rows(chisq_phase_published$summary_tbl, "Phase",
                chisq_phase_published$p_value,
                chisq_phase_reported$summary_tbl, chisq_phase_reported$p_value,
                chisq_phase_summary$summary_tbl, chisq_phase_summary$p_value)

# --- Lead Sponsor Type ---
df_lead_sponsor_type <- merged_trials %>%
  mutate(lead_sponsor_group = case_when(
    lead_sponsor_type %in% c("NIH", "FED") ~ "U.S. Federal Agency/NIH",
    lead_sponsor_type == "INDUSTRY" ~ "Industry",
    TRUE ~ "Other (Universities, Organizations, Networks, Non-U.S. Governmental Agencies, Individuals)"
  )) %>%
  filter(!is.na(lead_sponsor_group) & lead_sponsor_group != "")

chisq_sponsor_reported <- run_chisq_subgroup(
  df_lead_sponsor_type, "lead_sponsor_group", "tool_or_summary", "chisq_reported", "sponsor")

chisq_sponsor_summary <- run_chisq_subgroup(
  df_lead_sponsor_type, "lead_sponsor_group", "has_summary_results", "chisq_summary", "sponsor")

chisq_sponsor_published <- run_chisq_subgroup(
  df_lead_sponsor_type, "lead_sponsor_group", "tool_results", "chisq_published", "sponsor")

add_table3_rows(chisq_sponsor_published$summary_tbl, "Lead Sponsor Type",
                chisq_sponsor_published$p_value,
                chisq_sponsor_reported$summary_tbl, chisq_sponsor_reported$p_value,
                chisq_sponsor_summary$summary_tbl, chisq_sponsor_summary$p_value)

# --- US-Only Zarin Funder (Reported) ---
df_us_zarin <- merged_trials %>%
  mutate(
    start_dt = as.Date(suppressWarnings(lubridate::parse_date_time(`Start Date`, orders = c("Y-m-d", "Y-m", "Y")))),
    pcomp_dt_raw = ifelse(is.na(`Primary Completion Date`) | `Primary Completion Date` == "", `Completion Date`, `Primary Completion Date`),
    pcomp_dt = as.Date(suppressWarnings(lubridate::parse_date_time(pcomp_dt_raw, orders = c("Y-m-d", "Y-m", "Y"))))
  ) %>%
  filter(
    !is.na(countries) & grepl("United States", countries, fixed = TRUE),
    !is.na(start_dt) & start_dt >= as.Date("2015-01-01"),
    !is.na(pcomp_dt) & pcomp_dt <= as.Date("2018-08-01")
  ) %>%
  mutate(zarin_category = case_when(
    grepl("NIH", sponsor_types) ~ "NIH",
    grepl("FED|OTHER_GOV", sponsor_types) ~ "Non-NIH Federal",
    grepl("INDUSTRY", sponsor_types) ~ "Industry",
    TRUE ~ "Other"
  ))

chisq_zarin_reported <- run_chisq_subgroup(
  df_us_zarin, "zarin_category", "tool_or_summary", "chisq_reported", "zarin")

chisq_zarin_published <- run_chisq_subgroup(
  df_us_zarin, "zarin_category", "tool_results", "chisq_published", "zarin")

# Zarin subgroup is not part of the main Table 3 but we store the results
for (i in seq_len(nrow(chisq_zarin_reported$summary_tbl))) {
  level <- rownames(chisq_zarin_reported$summary_tbl)[i]
  add_result("chisq_reported", paste0("zarin_", gsub(" ", "_", tolower(level))),
             chisq_zarin_reported$summary_tbl[level, "TRUE"],
             chisq_zarin_reported$summary_tbl[level, "SUMMARY"])
}
for (i in seq_len(nrow(chisq_zarin_published$summary_tbl))) {
  level <- rownames(chisq_zarin_published$summary_tbl)[i]
  add_result("chisq_published", paste0("zarin_", gsub(" ", "_", tolower(level))),
             chisq_zarin_published$summary_tbl[level, "TRUE"],
             chisq_zarin_published$summary_tbl[level, "SUMMARY"])
}

# --- Participant Sex ---
df_sex <- merged_trials %>%
  mutate(Sex = ifelse(is.na(Sex) | Sex == "", "Missing", Sex))

chisq_sex_reported <- run_chisq_subgroup(
  df_sex, "Sex", "tool_or_summary", "chisq_reported", "sex")

chisq_sex_summary <- run_chisq_subgroup(
  df_sex, "Sex", "has_summary_results", "chisq_summary", "sex")

chisq_sex_published <- run_chisq_subgroup(
  df_sex, "Sex", "tool_results", "chisq_published", "sex")

add_table3_rows(chisq_sex_published$summary_tbl, "Participant sex",
                chisq_sex_published$p_value,
                chisq_sex_reported$summary_tbl, chisq_sex_reported$p_value,
                chisq_sex_summary$summary_tbl, chisq_sex_summary$p_value)

# ===== 8. POST-HOC TESTS =====

# --- Industry vs Non-Industry ---
df_lead_sponsor <- merged_trials %>%
  filter(!is.na(lead_sponsor_type) & lead_sponsor_type != "") %>%
  mutate(Lead_Sponsor_Category = if_else(lead_sponsor_type == "INDUSTRY", "Industry", "Non-Industry"))

contingency_lead_sponsor <- table(df_lead_sponsor$Lead_Sponsor_Category, df_lead_sponsor$tool_or_summary)
contingency_lead_sponsor <- contingency_lead_sponsor[c("Industry", "Non-Industry"), ]
lead_sponsor_test <- chisq.test(contingency_lead_sponsor)

print(contingency_lead_sponsor)
print(round(prop.table(contingency_lead_sponsor, margin = 1) * 100, 1))
print(lead_sponsor_test)

pct_industry <- round(prop.table(contingency_lead_sponsor, margin = 1)["Industry", "TRUE"] * 100, 1)
pct_non_industry <- round(prop.table(contingency_lead_sponsor, margin = 1)["Non-Industry", "TRUE"] * 100, 1)

add_result("posthoc", "pct_reported_industry", pct_industry, paste0(pct_industry, "%"))
add_result("posthoc", "pct_reported_non_industry", pct_non_industry, paste0(pct_non_industry, "%"))
add_result("posthoc", "p_industry_vs_non_industry", lead_sponsor_test$p.value,
           ifelse(lead_sponsor_test$p.value < 0.001, "p<0.001",
                  sprintf("p=%.3f", lead_sponsor_test$p.value)))

# --- Male vs Other Sex ---
df_sex_posthoc <- merged_trials %>%
  filter(!is.na(Sex) & Sex != "") %>%
  mutate(Sex_Category = if_else(Sex == "MALE", "Male", "Other"))

contingency_sex <- table(df_sex_posthoc$Sex_Category, df_sex_posthoc$tool_or_summary)
contingency_sex <- contingency_sex[c("Male", "Other"), ]
sex_test <- chisq.test(contingency_sex)

print(contingency_sex)
print(round(prop.table(contingency_sex, margin = 1) * 100, 1))
print(sex_test)

pct_male <- round(prop.table(contingency_sex, margin = 1)["Male", "TRUE"] * 100, 1)
pct_other_sex <- round(prop.table(contingency_sex, margin = 1)["Other", "TRUE"] * 100, 1)

add_result("posthoc", "pct_reported_male", pct_male, paste0(pct_male, "%"))
add_result("posthoc", "pct_reported_other_sex", pct_other_sex, paste0(pct_other_sex, "%"))
add_result("posthoc", "p_male_vs_other", sex_test$p.value,
           ifelse(sex_test$p.value < 0.001, "p<0.001",
                  sprintf("p=%.3f", sex_test$p.value)))

# --- Early Phase vs Later Phase ---
early_phases_list <- c("EARLY_PHASE1", "PHASE1")

df_phase <- merged_trials %>%
  filter(!is.na(Phases) & Phases != "") %>%
  mutate(Phase_Category = if_else(Phases %in% early_phases_list, "Early Phase", "Later Phase"))

contingency_phase <- table(df_phase$Phase_Category, df_phase$tool_or_summary)
contingency_phase <- contingency_phase[c("Early Phase", "Later Phase"), ]
phase_test <- chisq.test(contingency_phase)

print(contingency_phase)
print(round(prop.table(contingency_phase, margin = 1) * 100, 1))
print(phase_test)

pct_early <- round(prop.table(contingency_phase, margin = 1)["Early Phase", "TRUE"] * 100, 1)
pct_later <- round(prop.table(contingency_phase, margin = 1)["Later Phase", "TRUE"] * 100, 1)

add_result("posthoc", "pct_reported_early_phase", pct_early, paste0(pct_early, "%"))
add_result("posthoc", "pct_reported_later_phase", pct_later, paste0(pct_later, "%"))
add_result("posthoc", "p_early_vs_later_phase", phase_test$p.value,
           ifelse(phase_test$p.value < 0.001, "p<0.001",
                  sprintf("p=%.3f", phase_test$p.value)))

# ===== 9. EXPORT =====

# Key-value summary
results_df <- do.call(rbind, results)
write.csv(results_df, "./out/2c_results_summary.csv", row.names = FALSE)
cat("Exported", nrow(results_df), "results to ./out/2c_results_summary.csv\n")

# Table 3: Subgroup analyses
table3_df <- do.call(rbind, table3_rows)
write.csv(table3_df, "./out/2c_table3_subgroups.csv", row.names = FALSE)
cat("Exported Table 3 with", nrow(table3_df), "rows to ./out/2c_table3_subgroups.csv\n")

# Table 4: Search strategy performance
table4_df <- do.call(rbind, table4_rows)
write.csv(table4_df, "./out/2c_table4_strategies.csv", row.names = FALSE)
cat("Exported Table 4 with", nrow(table4_df), "rows to ./out/2c_table4_strategies.csv\n")
