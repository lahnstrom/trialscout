# TrialScout

Automated tool for discovering publications linked to clinical trial registrations and detecting whether they contain trial results, using large language models.

Developed as part of a Master's thesis at Karolinska Institutet by Love Ahnström.

> **Thesis:** [Automated Detection of Clinical Trial Results Reporting Using Large Language Models](https://example.com) *(link pending)*

## Overview

TrialScout takes a list of clinical trial registration IDs (e.g. NCT numbers) and:

1. **Fetches trial metadata** from ClinicalTrials.gov, EU Clinical Trials Register, or DRKS
2. **Discovers linked publications** using six complementary strategies (registry links, PubMed search, Google Scholar, GPT-generated PubMed queries)
3. **Detects whether each publication reports trial results** by comparing the publication abstract against the trial registration using GPT

```
Trial ID → Registry fetch → Publication discovery (6 strategies) → Deduplicate
→ Fetch abstracts → LLM results detection → Structured output
```

## Repository structure

```
├── tool/              # The TrialScout Node.js tool
│   ├── src/           # Source code
│   ├── config/        # Configuration (batch/live modes)
│   ├── prompts/       # LLM prompt templates
│   └── data/          # Input data files
├── analysis/          # R statistical analysis for the thesis
│   ├── code/          # R scripts (run in order 0 → 1 → 1b → 2a → 2b → 2c → 2d)
│   ├── data/          # Datasets
│   └── out/           # Figures and result tables
```

## Quick start

### Prerequisites

- Node.js v22.7+
- An [OpenAI API key](https://platform.openai.com/api-keys)
- A [Serper.dev API key](https://serper.dev/) (for Google Scholar strategy)

### Setup

```bash
git clone git@github.com:lahnstrom/trialscout.git
cd trialscout/tool
npm install
cp .env.example .env
# Edit .env with your API keys
```

### Run the REST API

```bash
node src/runner/server.js
# Starts on http://localhost:3001
# Try: GET /api/trials/NCT00000001
```

### Run on a CSV of trials

```bash
node src/runner/live.js --input data/validation_dataset_all_registries.csv --output-csv results.csv
```

See [tool/README.md](tool/README.md) for detailed usage and [analysis/README.md](analysis/README.md) for reproducing the statistical analysis.

## License

MIT

## Citation

If you use TrialScout in your research, please cite:

```
Ahnström, L. (2026). Automated Detection of Clinical Trial Results Reporting
Using Large Language Models. Master's thesis, Karolinska Institutet.
```
