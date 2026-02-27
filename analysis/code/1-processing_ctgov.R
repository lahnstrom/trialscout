library(data.table)
library(lubridate)
library(presize)
library(dplyr)
library(ggplot2)
library(scales)

# Read dataset of all studies
ctgov <- fread("./data/ctg-studies-2026-02-12.csv", sep = ",")
total_n <- ctgov %>% nrow()

# Include only completed or terminated trials
study_status <- ctgov %>%
  group_by(`Study Status`) %>%
  summarise(n = n())
ctgov <- ctgov %>% filter(`Study Status` %in% c("COMPLETED", "TERMINATED"))

# Include only interventional
study_type <- ctgov %>%
  group_by(`Study Type`) %>%
  summarise(n = n())
ctgov <- ctgov %>% filter(`Study Type` == "INTERVENTIONAL")

# Add Year and month for grouping purposes
# Pick primary completion date if exists, else pick completion date if exists, else put NA
ctgov <- ctgov %>% mutate(
  completion_date = ifelse(
    is.na(`Primary Completion Date`) | `Primary Completion Date` == "",
    ifelse(is.na(`Completion Date`) | `Completion Date` == "", NA, `Completion Date`),
    `Primary Completion Date`
  )
)

ctgov <- ctgov %>% mutate(
  completion_year = as.integer(substr(completion_date, 1, 4)),
  completion_month = as.integer(substr(completion_date, 6, 7)),
)

# Eligible if completed during or before September 2022, filter away newer trials
ctgov <- ctgov %>% mutate(eligible_year = completion_year < 2022 | (completion_year == 2022 & completion_month < 10))

eligibility_year <- ctgov %>%
  group_by(eligible_year) %>%
  summarise(n = n())
ctgov <- ctgov %>% filter(eligible_year == T)

# Create bins for year grouping
ctgov <- ctgov %>%
  mutate(year_bin = cut(completion_year,
    breaks = c(-Inf, seq(2005, 2025, by = 5)),
    right = FALSE,
    labels = c(
      "<2005",
      paste0(seq(2005, 2020, by = 5), "-", seq(2009, 2024, by = 5))
    )
  ))

# Create bins for enrollment grouping
ctgov <- ctgov %>%
  mutate(
    enrollment_bin = cut(
      Enrollment,
      breaks = c(0, 99, 499, Inf),
      labels = c("1-99", "100-499", "500+"),
      right = TRUE
    )
  )

# Sample size calculation, proportion of 50% in line with previous studies, rounded up
sample_size <- round(prec_prop(.5, conf.width = .02)$n, 0)

# Final sample
set.seed(42)
df <- ctgov %>% sample_n(sample_size)

save(file = "./data/finalSample.rda", df)

# For exporting to detection tool
df <- df %>% rename(nct_id = `NCT Number`)

write.csv2(df, file = "../tool/data/final-sample-ctgov.csv", row.names = F)

# Small sample for time analysis
time_sample <- ctgov %>% sample_n(20)
write.csv2(time_sample, file = "./out/time_sample.csv", row.names = F)


