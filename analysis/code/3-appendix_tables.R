# ===== Appendix Tables =====

library(flextable)
library(officer)
library(magrittr)

# ===== Table 1: Data fields for result detection =====

t1_data <- data.frame(
  `Trial data field` = c(
    "Trial registration data from ClinicalTrials.gov",
    "Trial title (brief)", "Official trial title", "Organization",
    "NCT-ID", "Study type", "Summary", "Description",
    "Publication data from PubMed",
    "Title", "Abstract", "Authors"
  ),
  `Explanation (When applicable)` = c(
    "",
    "", "", "The full name of the sponsor organization.",
    "", "Study type as listed in ClinicalTrials.gov, either interventional or observational.",
    "A limited length summary of the trial.", "A detailed description of the trial.",
    "",
    "", "", "All listed authors of a publication."
  ),
  check.names = FALSE,
  stringsAsFactors = FALSE
)

# Indices of section header rows
t1_header_indices <- c(1, 9)

ft1 <- flextable(t1_data) %>%
  font(fontname = "Times New Roman", part = "all") %>%
  bold(i = t1_header_indices, j = 1) %>%
  align(align = "left", part = "all") %>%
  fontsize(size = 9, part = "all") %>%
  set_table_properties(layout = "autofit", width = 1)

# Clear explanation column for header rows
for (r in t1_header_indices) {
  ft1 <- compose(ft1, i = r, j = 2, value = as_paragraph(""))
}

doc1 <- read_docx() %>%
  body_add_flextable(ft1)

print(doc1, target = "./out/tables/appendix_table_data_fields.docx")
cat("Exported Appendix Table 1 to ./out/tables/appendix_table_data_fields.docx\n")


# ===== Table 2: LLM Prompts =====

prompt_text <- paste(readLines("../tool/prompts/systemPromptSingleAbstract.txt",
  warn = FALSE), collapse = "\n")

t2_data <- data.frame(
  `Use-case` = "Determine whether a publication contains results of a given clinical trial registration",
  Prompt = prompt_text,
  check.names = FALSE,
  stringsAsFactors = FALSE
)

ft2 <- flextable(t2_data) %>%
  font(fontname = "Times New Roman", part = "all") %>%
  align(align = "left", part = "all") %>%
  fontsize(size = 9, part = "all") %>%
  fontsize(size = 8, j = 2, part = "body") %>%
  width(j = 1, width = 1.5) %>%
  width(j = 2, width = 5) %>%
  set_table_properties(layout = "fixed", width = 1) %>%
  valign(valign = "top", part = "body")

doc2 <- read_docx() %>%
  body_add_flextable(ft2)

print(doc2, target = "./out/tables/appendix_table_prompts.docx")
cat("Exported Appendix Table 2 to ./out/tables/appendix_table_prompts.docx\n")


# ===== Table: LLM Prompts for query generation =====

prompt_v1 <- paste(readLines("../tool/prompts/systemPromptPubmedSearchGeneration.txt",
  warn = FALSE), collapse = "\n")
prompt_v2 <- paste(readLines("../tool/prompts/systemPromptGptQueryV2.txt",
  warn = FALSE), collapse = "\n")

tq_data <- data.frame(
  `Use-case` = c(
    "To construct PubMed search queries for publication discovery #1:",
    "To construct PubMed search queries for publication discovery #2:"
  ),
  Prompt = c(prompt_v1, prompt_v2),
  check.names = FALSE,
  stringsAsFactors = FALSE
)

ftq <- flextable(tq_data) %>%
  font(fontname = "Times New Roman", part = "all") %>%
  align(align = "left", part = "all") %>%
  fontsize(size = 9, part = "all") %>%
  fontsize(size = 8, j = 2, part = "body") %>%
  width(j = 1, width = 1.5) %>%
  width(j = 2, width = 5) %>%
  set_table_properties(layout = "fixed", width = 1) %>%
  valign(valign = "top", part = "body")

docq <- read_docx() %>%
  body_add_flextable(ftq)

print(docq, target = "./out/tables/appendix_table_query_prompts.docx")
cat("Exported query prompts table to ./out/tables/appendix_table_query_prompts.docx\n")


# ===== Table 1: Existing automated tools =====

t3_data <- data.frame(
  `Authors (Name)` = c(
    "A. Powell-Smith, B. Goldacre, (TrialsTracker) (19)",
    "N. Smalheiser, A. Holt (20)",
    "T. Goodwin, M. Skinner, S. Harabagiu (21)"
  ),
  Scope = c(
    "Indexes all later phase interventional studies in ClinicalTrials.gov completed more than 24 months ago. Searches for results in ClinicalTrials.gov and explicit NCT-ID links in PubMed publications.",
    "Provides result searches for individual trials registered in ClinicalTrials.gov. Searches for matching PubMed publications.",
    "Links clinical trials in ClinicalTrials.gov to MEDLINE articles reporting their results."
  ),
  `Detection method` = c(
    "Algorithmic method based on regular expressions.",
    "Logistic regression model comparing similarity between trial-publication pairs based on metadata.",
    "Deep Highway Network with learning-to-rank features from trial and article metadata."
  ),
  Evaluation = c(
    "Derived sensitivity 69.8%, specificity 58.3% (vs. manual audit, n=2,562)\u00B9",
    "Recall 84.6%, precision 90.4%, AUC 0.95 (pair classification, n=13,042)\u00B2",
    "MAP 0.31, MRR 0.34 (closed); MAP 0.82, MRR 0.87 (open)\u00B3"
  ),
  check.names = FALSE,
  stringsAsFactors = FALSE
)

ft3 <- flextable(t3_data) %>%
  font(fontname = "Times New Roman", part = "all") %>%
  align(align = "left", part = "all") %>%
  valign(valign = "top", part = "body") %>%
  fontsize(size = 9, part = "all") %>%
  set_table_properties(layout = "autofit", width = 1) %>%
  autofit()

doc3 <- read_docx() %>%
  body_add_flextable(ft3)

print(doc3, target = "./out/tables/appendix_table_existing_tools.docx")
cat("Exported Appendix Table 1 to ./out/tables/appendix_table_existing_tools.docx\n")
