# ===== 0. SETUP =====

library(dplyr)
library(DiagrammeR)
library(DiagrammeRsvg)
library(stringr)
library(rsvg)

# Results collector: accumulates key-value rows for export
results <- list()
add_result <- function(section, key, value, formatted) {
  results[[length(results) + 1]] <<- data.frame(
    section = section, key = key,
    value = as.character(value), formatted = formatted,
    stringsAsFactors = FALSE
  )
}

# ===== 1. DETECTION TOOL DIAGRAM =====

# English
detection_tool_file <- "./code/detection_tool.dot"
detection_tool_diagram <- readChar(detection_tool_file, file.info(detection_tool_file)$size)
detection_tool <- grViz(detection_tool_diagram)
print(detection_tool)
tmp <- DiagrammeRsvg::export_svg(detection_tool)
tmp <- charToRaw(tmp)
rsvg::rsvg_pdf(tmp, "./out/figures/2a_detection_tool.pdf")

# Swedish
detection_tool_file_swe <- "./code/detection_tool_SWE.dot"
detection_tool_diagram_swe <- readChar(detection_tool_file_swe, file.info(detection_tool_file_swe)$size)
detection_tool_swe <- grViz(detection_tool_diagram_swe)
tmp <- DiagrammeRsvg::export_svg(detection_tool_swe)
tmp <- charToRaw(tmp)
rsvg::rsvg_pdf(tmp, "./out/figures/2a_detection_tool_swe.pdf")

# ===== 2. FLOWCHART DATA (requires 1-processing_ctgov.R variables in memory) =====

observational_n <- study_type %>%
  filter(`Study Type` == "OBSERVATIONAL") %>%
  pull(n)
interventional_n <- study_type %>%
  filter(`Study Type` == "INTERVENTIONAL") %>%
  pull(n)
ineligible_date_n <- eligibility_year %>%
  filter(eligible_year == FALSE) %>%
  pull(n)
missing_date_n <- eligibility_year %>%
  filter(is.na(eligible_year)) %>%
  pull(n)
eligible_date_n <- eligibility_year %>%
  filter(eligible_year) %>%
  pull(n)
eligible_missing_date_n <- missing_date_n + eligible_date_n
excluded_random_sample_n <- eligible_date_n - sample_size
completed_terminated_n <- study_status %>%
  filter(`Study Status` %in% c("COMPLETED", "TERMINATED")) %>%
  summarise(n = sum(n)) %>%
  pull(n)
other_status_n <- study_status %>%
  filter(!(`Study Status` %in% c("COMPLETED", "TERMINATED"))) %>%
  summarise(n = sum(n)) %>%
  pull(n)

# Capture raw numeric values before formatting
add_result("flowchart", "total_n", total_n, format(total_n, big.mark = ","))
add_result("flowchart", "completed_terminated_n", completed_terminated_n, format(completed_terminated_n, big.mark = ","))
add_result("flowchart", "other_status_n", other_status_n, format(other_status_n, big.mark = ","))
add_result("flowchart", "interventional_n", interventional_n, format(interventional_n, big.mark = ","))
add_result("flowchart", "observational_n", observational_n, format(observational_n, big.mark = ","))
add_result("flowchart", "eligible_date_n", eligible_date_n, format(eligible_date_n, big.mark = ","))
add_result("flowchart", "ineligible_date_n", ineligible_date_n, format(ineligible_date_n, big.mark = ","))
add_result("flowchart", "missing_date_n", missing_date_n, format(missing_date_n, big.mark = ","))
add_result("flowchart", "eligible_missing_date_n", eligible_missing_date_n, format(eligible_missing_date_n, big.mark = ","))
add_result("flowchart", "excluded_random_sample_n", excluded_random_sample_n, format(excluded_random_sample_n, big.mark = ","))
add_result("flowchart", "sample_size", sample_size, format(sample_size, big.mark = ","))

# Format numbers as strings for diagram labels
numbers_to_format <- c(
  "total_n", "observational_n", "interventional_n",
  "completed_terminated_n", "other_status_n",
  "ineligible_date_n", "missing_date_n", "eligible_date_n",
  "eligible_missing_date_n", "excluded_random_sample_n", "sample_size"
)

for (var in numbers_to_format) {
  assign(var, format(eval(parse(text = var)), big.mark = ",", scientific = FALSE))
}

# ===== 3. EXCLUSION FLOWCHART (ENGLISH) =====

digraph_contents <- str_glue("
  graph [layout = dot, rankdir = TB, splines = ortho nodesep=0.8]
  node [shape = rectangle, style = filled, fillcolor = white, fontsize = 12, width = 4, fontname = \"Helvetica\"]

  Start [label = 'All studies on clinicaltrials.gov\non February 12, 2026\n(n = {total_n})'  ]

  Excluded_Status [label = 'Excluded due to non-completed/terminated status\n(n = {other_status_n})' fillcolor = \"#DDEEFF\"]
  Included_Status [label = 'Completed or terminated trials\n(n = {completed_terminated_n})']

  Excluded_Design [label = 'Excluded due to non-interventional design\n(n = {observational_n})' fillcolor = \"#DDEEFF\"]
  Included_Design [label = 'Trials with interventional design\n(n = {interventional_n})']

  Excluded_Date [label = 'Excluded due to completion during,\nor after October 2022\n(n = {ineligible_date_n})' fillcolor = \"#DDEEFF\"]
  Included_Date [label = 'Trials completed before October 2022,\nor with missing completion date\n(n = {eligible_missing_date_n})']

  Excluded_Missing_Date [label = 'Excluded due to missing completion date\n(n = {missing_date_n})' fillcolor = \"#DDEEFF\"]
  Included_Missing_Date [label = 'Interventional trials with appropriate completion dates\n(n = {eligible_date_n})']

  Excluded_Sample [label = 'Excluded during random sampling\n(n = {excluded_random_sample_n})' fillcolor = \"#DDEEFF\"]
  Included_Sample [label = 'Final included random sample\n(n = {sample_size})']
")

# Have to be split due to conflicts with syntax and glue templating
digraph_contents_2 <-
  "
  { rank = same; Start; Excluded_Status }
  { rank = same; Included_Status; Excluded_Design }
  { rank = same; Included_Design; Excluded_Date }
  { rank = same; Included_Date; Excluded_Missing_Date }
  { rank = same; Included_Missing_Date; Excluded_Sample }
  { rank = same; Included_Sample }

  Start -> Excluded_Status
  Start -> Included_Status
  Included_Status -> Excluded_Design
  Included_Status -> Included_Design
  Included_Design -> Excluded_Date
  Included_Design -> Included_Date
  Included_Date -> Excluded_Missing_Date
  Included_Date -> Included_Missing_Date
  Included_Missing_Date -> Excluded_Sample
  Included_Missing_Date -> Included_Sample"

exclusion_chart <- grViz(paste0("digraph inclusion_exclusion {", digraph_contents, digraph_contents_2, "} "))
tmp <- DiagrammeRsvg::export_svg(exclusion_chart)
tmp <- charToRaw(tmp)
rsvg::rsvg_pdf(tmp, "./out/figures/2a_exclusion.pdf")

# ===== 4. EXCLUSION FLOWCHART (SWEDISH) =====

digraph_contents <- str_glue("
  graph [layout = dot, rankdir = TB, splines = ortho, fontname = \"Helvetica\" ]
  node [shape = rectangle, style = filled, fillcolor = white, fontsize = 12, width = 4]

  Start [label = 'Alla studier på clinicaltrials.gov\n12:e februari, 2026\n(n = {total_n})'  ]

  Excluded_Status [label = 'Exkluderade på grund av ej avslutad status\n(n = {other_status_n})' fillcolor = \"#DDEEFF\"]
  Included_Status [label = 'Avslutade prövningar\n(n = {completed_terminated_n})']

  Excluded_Design [label = 'Exkluderade på grund av icke-interventionell design\n(n = {observational_n})' fillcolor = \"#DDEEFF\"]
  Included_Design [label = 'Prövningar med interventioner\n(n = {interventional_n})']

  Excluded_Date [label = 'Exkluderade på grund av avslutningsdatum\n efter oktober 2022\n(n = {ineligible_date_n})' fillcolor = \"#DDEEFF\"]
  Included_Date [label = 'Prövningar avslutade innan oktober 2022,\neller utan avslutningsdatum\n(n = {eligible_missing_date_n})']

  Excluded_Missing_Date [label = 'Exkluderade på grund av saknat avslutningsdatum\n(n = {missing_date_n})' fillcolor = \"#DDEEFF\"]
  Included_Missing_Date [label = 'Interventionella prövningar med giltigt avslutningsdatum\n(n = {eligible_date_n})']

  Excluded_Sample [label = 'Exkluderade under slumpmässigt urval\n(n = {excluded_random_sample_n})' fillcolor = \"#DDEEFF\"]
  Included_Sample [label = 'Slutgiltigt urval\n(n = {sample_size})']
")

# Have to be split due to conflicts with syntax and glue templating
digraph_contents_2 <-
  "
  { rank = same; Start; Excluded_Status }
  { rank = same; Included_Status; Excluded_Design }
  { rank = same; Included_Design; Excluded_Date }
  { rank = same; Included_Date; Excluded_Missing_Date }
  { rank = same; Included_Missing_Date; Excluded_Sample }
  { rank = same; Included_Sample }

  Start -> Excluded_Status
  Start -> Included_Status
  Included_Status -> Excluded_Design
  Included_Status -> Included_Design
  Included_Design -> Excluded_Date
  Included_Design -> Included_Date
  Included_Date -> Excluded_Missing_Date
  Included_Date -> Included_Missing_Date
  Included_Missing_Date -> Excluded_Sample
  Included_Missing_Date -> Included_Sample"

exclusion_chart <- grViz(paste0("digraph inclusion_exclusion {", digraph_contents, digraph_contents_2, "} "))
tmp <- DiagrammeRsvg::export_svg(exclusion_chart)
tmp <- charToRaw(tmp)
rsvg::rsvg_pdf(tmp, "./out/figures/2a_exclusion_swe.pdf")

# ===== 5. EXPORT =====

results_df <- do.call(rbind, results)
write.csv(results_df, "./out/2a_results_summary.csv", row.names = FALSE)
cat("Exported", nrow(results_df), "results to ./out/2a_results_summary.csv\n")
