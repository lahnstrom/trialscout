# ===== 0. SETUP AND THEME =====

library(data.table)
library(lubridate)
library(presize)
library(dplyr)
library(ggplot2)
library(scales)
library(patchwork)

# Results collector: accumulates key-value rows for export
results <- list()
add_result <- function(section, key, value, formatted) {
  results[[length(results) + 1]] <<- data.frame(
    section = section, key = key,
    value = as.character(value), formatted = formatted,
    stringsAsFactors = FALSE
  )
}

# Table 2 collector
table2_rows <- list()

# Helper: build table2 rows from a count summary
add_table2_category <- function(data, category_name, level_col, total_n) {
  for (i in seq_len(nrow(data))) {
    level <- as.character(data[[level_col]][i])
    n_val <- data$n[i]
    pct_val <- round(n_val / total_n * 100, 1)
    summary_str <- sprintf("%s (%s%%)", format(n_val, big.mark = ","), pct_val)

    table2_rows[[length(table2_rows) + 1]] <<- data.frame(
      category = category_name,
      level = level,
      n = n_val,
      pct = pct_val,
      summary = summary_str,
      stringsAsFactors = FALSE
    )
  }
}

my_theme <- theme(
  plot.title = element_text(size = 24),
  axis.title.x = element_text(size = 24),
  axis.title.y = element_text(size = 24),
  axis.text.x = element_text(size = 20),
  axis.text.y = element_text(size = 20),
  panel.background = element_rect(fill = "white"),
  plot.background = element_rect(fill = "white"),
  panel.grid.major = element_line(color = "gray90"),
  panel.grid.minor = element_line(color = "gray95")
)

# ===== 1. DATA LOADING =====

load("./data/finalSample.rda")
total_studies <- nrow(df)

add_result("sample_overview", "total_studies", total_studies,
           format(total_studies, big.mark = ","))

# ===== 2. ENROLLMENT AND COMPLETION YEAR DESCRIPTIVES =====

filtered_enrol <- df %>% filter(!is.na(Enrollment))

mean_enrol <- round(mean(filtered_enrol$Enrollment), 1)
median_enrol <- median(filtered_enrol$Enrollment)
sd_enrol <- round(sd(filtered_enrol$Enrollment), 1)
iqr_enrol <- IQR(filtered_enrol$Enrollment)
q1_enrol <- quantile(filtered_enrol$Enrollment, 1 / 4)
q3_enrol <- quantile(filtered_enrol$Enrollment, 3 / 4)

geometric_mean <- round(exp(mean(log(filtered_enrol$Enrollment[filtered_enrol$Enrollment > 0]))), 1)
geometric_sd <- round(exp(sd(log(filtered_enrol$Enrollment[filtered_enrol$Enrollment > 0]))), 1)

add_result("enrollment_descriptives", "mean_enrollment", mean_enrol, format(mean_enrol, big.mark = ","))
add_result("enrollment_descriptives", "median_enrollment", median_enrol, format(median_enrol, big.mark = ","))
add_result("enrollment_descriptives", "sd_enrollment", sd_enrol, format(sd_enrol, big.mark = ","))
add_result("enrollment_descriptives", "iqr_enrollment", iqr_enrol, as.character(iqr_enrol))
add_result("enrollment_descriptives", "q1_enrollment", q1_enrol, as.character(q1_enrol))
add_result("enrollment_descriptives", "q3_enrollment", q3_enrol, as.character(q3_enrol))
add_result("enrollment_descriptives", "geometric_mean_enrollment", geometric_mean, as.character(geometric_mean))
add_result("enrollment_descriptives", "geometric_sd_enrollment", geometric_sd, as.character(geometric_sd))

filtered_year <- df %>% filter(!is.na(completion_year))

median_year <- median(filtered_year$completion_year)
iqr_year <- IQR(filtered_year$completion_year)
q1_year <- quantile(filtered_year$completion_year, 1 / 4)
q3_year <- quantile(filtered_year$completion_year, 3 / 4)
min_year <- min(filtered_year$completion_year)

add_result("completion_year_descriptives", "median_completion_year", median_year, as.character(median_year))
add_result("completion_year_descriptives", "iqr_completion_year", iqr_year, as.character(iqr_year))
add_result("completion_year_descriptives", "q1_completion_year", q1_year, as.character(q1_year))
add_result("completion_year_descriptives", "q3_completion_year", q3_year, as.character(q3_year))
add_result("completion_year_descriptives", "min_completion_year", min_year, as.character(min_year))

# ===== 3. CATEGORY SUMMARIES (TABLE 2) =====

# Study status
status_counts <- df %>% count(`Study Status`)
add_table2_category(status_counts, "Study status", "Study Status", total_studies)

# Phase
phase_counts <- df %>%
  mutate(Phases = ifelse(is.na(Phases) | Phases == "", "Missing/Not applicable", Phases)) %>%
  count(Phases)
add_table2_category(phase_counts, "Phase", "Phases", total_studies)

# Completion year bin
year_counts <- df %>% count(year_bin)
add_table2_category(year_counts, "Completion year", "year_bin", total_studies)

# Enrollment bin
enrollment_counts <- df %>% count(enrollment_bin)
add_table2_category(enrollment_counts, "Enrolled participants", "enrollment_bin", total_studies)

# Summary results
results_counts <- df %>% count(`Study Results`)
add_table2_category(results_counts, "Summary results", "Study Results", total_studies)

# Participant sex
sex_counts <- df %>% count(Sex)
add_table2_category(sex_counts, "Participant sex", "Sex", total_studies)

# Lead sponsor type (grouped)
sponsor_grouped_counts <- df %>%
  mutate(lead_sponsor_type_grouped = case_when(
    lead_sponsor_type %in% c("NIH", "FED") ~ "U.S. Federal Agency/NIH",
    lead_sponsor_type == "INDUSTRY" ~ "Industry",
    TRUE ~ "Other (Universities, Organizations, Networks, Non-U.S. Governmental Agencies, Individuals)"
  )) %>%
  count(lead_sponsor_type_grouped)
add_table2_category(sponsor_grouped_counts, "Lead sponsor type", "lead_sponsor_type_grouped", total_studies)

# Lead sponsor type (ungrouped — for footnote detail)
sponsor_ungrouped_counts <- df %>% count(lead_sponsor_type)
add_table2_category(sponsor_ungrouped_counts, "Lead sponsor type (detail)", "lead_sponsor_type", total_studies)

# ===== 4. ZARIN FUNDER CATEGORIZATION (US SUBSET) =====

parse_dt <- function(x) {
  suppressWarnings(lubridate::parse_date_time(x, orders = c("Y-m-d", "Y-m", "Y")))
}

df_us <- df %>%
  mutate(
    start_dt = as.Date(parse_dt(`Start Date`)),
    pcomp_dt_raw = ifelse(is.na(`Primary Completion Date`) | `Primary Completion Date` == "", `Completion Date`, `Primary Completion Date`),
    pcomp_dt = as.Date(parse_dt(pcomp_dt_raw))
  ) %>%
  filter(
    !is.na(countries) & grepl("United States", countries, fixed = TRUE),
    !is.na(start_dt) & start_dt >= as.Date("2015-01-01"),
    !is.na(pcomp_dt) & pcomp_dt <= as.Date("2018-08-01")
  )

total_us_studies <- nrow(df_us)
add_result("sample_overview", "total_us_studies", total_us_studies,
           format(total_us_studies, big.mark = ","))

zarin_counts <- df_us %>%
  mutate(zarin_category = case_when(
    grepl("NIH", sponsor_types) ~ "NIH",
    grepl("FED|OTHER_GOV", sponsor_types) ~ "Non-NIH Federal",
    grepl("INDUSTRY", sponsor_types) ~ "Industry",
    TRUE ~ "Other"
  )) %>%
  count(zarin_category)
add_table2_category(zarin_counts, "Zarin funder (US subset)", "zarin_category", total_us_studies)

# ===== 5. FIGURES =====

year_plot_data <- df %>%
  group_by(completion_year) %>%
  summarise(count = n())

# English version
year_plot <- ggplot(year_plot_data, aes(x = completion_year, y = count)) +
  geom_bar(stat = "identity", fill = "steelblue") +
  my_theme +
  labs(
    x = "Completion Year",
    y = "Number of trials"
  ) +
  annotate("text", x = -Inf, y = Inf, label = "b.", fontface = "bold", hjust = -0.5, vjust = 1, size = 5)

enrolment_plot <- ggplot(df, aes(x = Enrollment, )) +
  scale_x_continuous(trans = "log10", labels = comma) +
  geom_histogram(bins = 30, fill = "steelblue", color = "white", boundary = 0) +
  my_theme +
  labs(
    x = "Enrolment (n, log scale)",
    y = "Number of trials"
  ) +
  annotate("text", x = -Inf, y = Inf, label = "a.", fontface = "bold", hjust = -0.5, vjust = 1, size = 5)

demo_plot_combined <- enrolment_plot + year_plot + plot_layout(ncol = 2)
print(demo_plot_combined)
ggsave("./out/figures/2d_demo_plot_combined.pdf", plot = demo_plot_combined, device = "pdf", width = 6, height = 4)

# Swedish version
year_plot_swe <- ggplot(year_plot_data, aes(x = completion_year, y = count)) +
  geom_bar(stat = "identity", fill = "steelblue") +
  my_theme +
  labs(
    x = "Avslutningsår",
    y = "Antal prövningar"
  )

enrolment_plot_swe <- ggplot(df, aes(x = Enrollment, )) +
  scale_x_continuous(trans = "log10", labels = comma) +
  geom_histogram(bins = 30, fill = "steelblue", color = "white", boundary = 0) +
  labs(
    x = "Deltagarantal (n, log-skala)",
    y = "Antal prövningar"
  ) +
  my_theme

demo_plot_combined_swe <- enrolment_plot_swe + year_plot_swe + plot_layout(ncol = 2)
print(demo_plot_combined_swe)
ggsave("./out/figures/2d_demo_plot_combined_swe.pdf", plot = demo_plot_combined_swe, device = "pdf")

# ===== 6. EXPORT =====

# Key-value summary
results_df <- do.call(rbind, results)
write.csv(results_df, "./out/2d_results_summary.csv", row.names = FALSE)
cat("Exported", nrow(results_df), "results to ./out/2d_results_summary.csv\n")

# Table 2: Trial characteristics
table2_df <- do.call(rbind, table2_rows)
write.csv(table2_df, "./out/2d_table2_characteristics.csv", row.names = FALSE)
cat("Exported Table 2 with", nrow(table2_df), "rows to ./out/2d_table2_characteristics.csv\n")
