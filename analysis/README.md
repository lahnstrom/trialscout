# TrialScout — Statistical Analysis

R scripts for the statistical analysis. Produces all figures and tables for the paper.

## Prerequisites

- **R** (tested with R 4.x)
- **RStudio** (recommended; open `analysis.Rproj`)
- **R packages:** dplyr, stringr, tidyr, data.table, DiagrammeR, DiagrammeRsvg, rsvg, ggplot2, scales, patchwork, lubridate, presize, writexl

Install all packages:
```r
install.packages(c("dplyr", "stringr", "tidyr", "data.table", "DiagrammeR",
                    "DiagrammeRsvg", "rsvg", "ggplot2", "scales", "patchwork",
                    "lubridate", "presize", "writexl"))
```

## Script execution order

Run scripts in this order (each depends on outputs of previous scripts):

| Script | Purpose |
|--------|---------|
| `0-validation-dataset-all-registries.R` | Combine IntoValue + Nordic datasets into validation ground truth |
| `1-processing_ctgov.R` | Filter interventional studies from ClinicalTrials.gov, sample 9,600 trials |
| `1b-patching_sponsors.R` | Enrich sample with sponsor/funder classification |
| `2a-flowcharts.R` | Generate inclusion/exclusion flowcharts (EN + SWE) |
| `2b-tool_perf_all_registries.R` | Confusion matrix, sensitivity, specificity, F1, error analysis |
| `2c-results.R` | Detection rates, logistic regression, discovery method attribution |
| `2d-demographics.R` | Enrollment, year, phase, funder demographics |

All scripts use `set.seed(42)` for reproducibility.

## Data files

### Included in this repository

| File | Size | Used by | Description |
|------|------|---------|-------------|
| `data/iv_main_dataset.csv` | 1.3 MB | Script 0 | IntoValue ground truth dataset |
| `data/nordic_dataset.csv` | 1.5 MB | Script 0 | Nordic ground truth dataset |
| `data/finalSample.rda` | 6.5 MB | Scripts 1b, 2c, 2d | Pre-computed sample (9,600 trials) |
| `data/validation_run_all_registries_reasoning_2026_01_03.csv` | <1 MB | Script 2b | Validation run output |
| `data/response_time.csv` | <1 MB | Script 2b | Processing time data |
| `data/results-final-run.csv` | 6.5 MB | Script 2c | Main tool output for analysis |

### Not included (too large)

| File | Size | Used by | How to obtain |
|------|------|---------|---------------|
| ClinicalTrials.gov bulk export | ~1.4 GB | Script 1 | Download from [ClinicalTrials.gov](https://clinicaltrials.gov/search?aggFilters=status:com ter&downloadFormat=csv). |

Since the CTGov bulk export is not included, `finalSample.rda` is provided as a pre-computed output of Script 1 so that scripts 1b onward can run without it.

## Outputs

All outputs are written to `out/`:
- `out/figures/` — Publication-ready PDF figures (English + Swedish)
- `out/*.csv` — Result summary tables (validation performance, regression results, demographics)

## Additional files

- `code/*.dot` — Graphviz diagrams for the tool architecture flowcharts
- `code/node_script/` — Node.js helper for sponsor/funder data enrichment (used by Script 1b)
