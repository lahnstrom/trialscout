# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TrialScout is an automated tool for discovering publications linked to clinical trial registrations and detecting whether they contain trial results, using LLMs. Developed at Karolinska Institutet. The repo has two parts: a Node.js tool (`tool/`) and R statistical analysis scripts (`analysis/`).

## Commands

All tool commands run from `tool/`:

```bash
cd tool
npm install                # Install dependencies
cp .env.example .env       # Set up API keys (OPENAI_API_KEY, SERPER_API_KEY, optional PUBMED_API_KEY)
```

**REST API server:**
```bash
node src/runner/server.js  # Starts on http://localhost:3001
```

**Live CLI (sequential, real-time):**
```bash
node src/runner/live.js --input <file.csv> [--output-csv results.csv] [--validation-run] [--retry-errors]
```

**Batch processing (OpenAI Batch API, lower cost):**
```bash
node src/runner/batch/index.js --input <file.csv> [--step-by-step] [--validation-run] [--local-registrations <dir>]
```

Both runners resume from `progress.json` automatically on restart.

**R analysis** (from `analysis/`, run in order): Scripts `0` → `1` → `1b` → `2a` → `2b` → `2c` → `2d`. All use `set.seed(42)`. Open `analysis.Rproj` in RStudio.

No test suite or linter is configured.

## Architecture

### Pipeline flow

```
Trial ID → Registry fetch → Publication discovery (5 strategies) → Deduplicate
→ Fetch PubMed abstracts → LLM results detection (GPT) → Structured output
```

### Three registries (`tool/src/registry/`)

- **ctgov.js** — ClinicalTrials.gov JSON API (`NCT\d{8}`)
- **euctr.js** — EU Clinical Trials Register, HTML scraping (`\d{4}-\d{6}-\d{2}`)
- **drks.js** — German DRKS, HTML scraping (`DRKS\d{8}`)
- **utils.js** — Auto-detects registry type from trial ID format

### Five publication discovery strategies (`tool/src/discovery/publication/strategies/`)

Each has a `_cached` variant for live mode with file-based TTL caching:

1. `linked_at_registration` — PMIDs from the registry record itself
2. `pubmed_naive` — PubMed search by trial ID, investigator, title
3. `google_scholar` — Google Scholar via Serper.dev API, then title-match in PubMed
4. `pubmed_gpt_v1` — Single GPT-generated PubMed query (batch or live)
5. `pubmed_gpt_v2` — Multiple GPT-generated queries (batch or live)

Orchestrated by `discovery/publication/index.js` which runs strategies in parallel and deduplicates by PMID.

### Results detection (`tool/src/discovery/results.js`)

Compares registration metadata against publication abstract using GPT with structured output (Zod schema: `{ hasResults: boolean, reason: string }`). Prompt templates are in `tool/prompts/`.

### Batch runner state machine (`tool/src/runner/batch/`)

11-stage pipeline: PREP → QUERY_GEN_UPLOAD → QUERY_GEN_POLL → QUERY_GEN_PROCESS → PUB_DISCOVERY → RESULT_GEN_PREPARATION → RESULT_GEN_UPLOAD → RESULT_GEN_POLL → RESULT_GEN_PROCESS → FINALIZE → COST_CALCULATION. Each stage saves to `progress.json` for resumption. Stage implementations are in `stages/`.

### Configuration (`tool/config/default.json`)

Separate `batch` and `live` sections controlling: models, reasoning effort, strategies, token limits, batch size limits. Cache TTLs range from 7 days (PubMed/Scholar) to 90 days (GPT queries).

### Key utilities (`tool/src/utils/`)

- **pubmed_utils.js** — PubMed XML fetching/parsing, abstract extraction, DOI-to-PMID conversion, citation matching
- **utils.js** — `retryAsync()`, `rateLimitedPubmedCall()` (4 concurrent, 8/sec via p-queue), date filters for validation runs
- **cache.js** — File-based cache with TTL and metadata

### Validation mode

Both runners accept `--validation-run` which applies max date filters based on `dataset` column: dataset `"iv"` uses cutoff `2020-11-17`, others use `2023-02-15`. Also filters publications before trial start date.

## Known Issues

### PubMed date fallback uses `DateRevised` instead of actual publication date
**File:** `tool/src/utils/pubmed_utils.js` (line ~416, `parsePubmedRecord`)

The date extraction logic uses fallback chain: `acceptedDate || dateCompleted || dateRevised`. When a PubMed record has no "accepted" history entry and no `DateCompleted`, it falls back to `DateRevised` — a record maintenance date that can be years after actual publication.

**Example:** PMID 29502304 (NCT02916576) was published 2018-03-03 but got `publicationDate: "2024-03-30"` from `DateRevised`. This caused the validation max date filter to incorrectly exclude it.

**Fix:** Use PubMed History dates (`pubmed`, `entrez`, `medline`) before falling back to `DateRevised`. E.g.: `accepted || dateCompleted || pubmed || entrez || dateRevised`. The same issue exists in `extractMetadata` (~line 205) which has the identical fallback chain.

### DRKS silently produces placeholder records for non-existent trials
**File:** `tool/src/registry/drks.js` (line ~18, `fetchRegistration`)

DRKS returns a 302 redirect to an error page (HTTP 200) for non-existent trial IDs. Since `fetch()` follows redirects and the error page returns 200, `!res.ok` doesn't catch it. The HTML parser then produces a placeholder record with generic values ("DRKS Trial DRKSXXXXXXXX", "Unknown Sponsor", etc.) and `has_error: false`.

**Fix:** Check `res.url` after fetch for redirect to error page, or detect error page markers in the HTML (`<h2 class="modal-title">Error!</h2>`).
