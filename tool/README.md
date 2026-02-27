# TrialScout — Tool

Node.js tool for automated clinical trial publication discovery and results detection.

## Prerequisites

- **Node.js** v22.7+ (uses ES modules)
- **OpenAI API key** — for GPT-based query generation and results detection
- **Serper.dev API key** — for Google Scholar publication discovery
- **NCBI API key** (optional) — for higher PubMed rate limits

## Setup

```bash
npm install
cp .env.example .env
# Add your API keys to .env
```

## Three modes of operation

### 1. REST API (`src/runner/server.js`)

Interactive API for single-trial lookups.

```bash
node src/runner/server.js
# Starts on http://localhost:3001
```

**Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/trials/:trialId` | Fetch trial metadata from registry |
| `GET` | `/api/publications/:trialId` | Discover publications for a trial |
| `GET` | `/api/results/:trialId/:pmid` | Detect if a publication contains trial results |

Query parameters for `/api/publications` and `/api/results`:
- `model` — `gpt-5.1` or `gpt-5.1-mini`
- `reasoning` — `minimal`, `low`, `medium`, or `high`

### 2. Live CLI (`src/runner/live.js`)

Process a CSV file of trials sequentially in real-time.

```bash
node src/runner/live.js --input <file.csv> [options]
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--input <file>` | Input CSV with trial IDs (required) |
| `--output-csv <file>` | Output summary CSV |
| `--json-dir <dir>` | Directory for per-trial JSON output |
| `--progress <file>` | Progress tracking file (for resuming) |
| `--delimiter <char>` | CSV delimiter (default: `,`) |
| `--retry-errors` | Re-process rows that previously errored |
| `--validation-run` | Validation mode with date filtering |

### 3. Batch (`src/runner/batch/index.js`)

Process large datasets using the OpenAI Batch API for lower cost.

```bash
node src/runner/batch/index.js --input <file.csv> [options]
```

Runs an 11-stage pipeline:
1. **Prep** — Fetch trial registrations
2. **Query Gen Upload/Poll/Process** — Generate PubMed search queries via GPT batch
3. **Pub Discovery** — Execute all publication discovery strategies
4. **Result Gen Preparation/Upload/Poll/Process** — Detect results via GPT batch
5. **Finalize** — Produce output files
6. **Cost Calculation** — Compute API costs

Additional flag: `--step-by-step` to pause between stages.

## Source layout

```
src/
├── discovery/
│   ├── registration.js              # Registry type detection + trial data fetch
│   ├── results.js                   # LLM-based results detection
│   └── publication/
│       ├── index.js                 # Strategy orchestration & deduplication
│       └── strategies/
│           ├── linked-at-registration.js   # Publications linked in registry
│           ├── pubmed-naive.js             # Basic PubMed title/ID search
│           ├── google-scholar.js           # Google Scholar via Serper.dev
│           ├── pubmed-gpt-v1-batch.js      # GPT query gen (batch)
│           ├── pubmed-gpt-v1-live.js       # GPT query gen (live)
│           ├── pubmed-gpt-v2-batch.js      # Enhanced multi-query (batch)
│           ├── pubmed-gpt-v2-live.js       # Enhanced multi-query (live)
│           ├── constants.js
│           └── utils.js
├── registry/
│   ├── ctgov.js         # ClinicalTrials.gov API
│   ├── euctr.js         # EU Clinical Trials Register
│   ├── drks.js          # German Clinical Trials Register (DRKS)
│   └── utils.js         # Registry type detection
├── runner/
│   ├── server.js        # Koa.js REST API
│   ├── live.js          # Live processing CLI
│   └── batch/
│       ├── index.js     # 11-stage state machine
│       ├── stages/      # Individual stage implementations
│       └── utils/       # CLI parsing, constants, I/O, progress
├── utils/
│   ├── cache.js         # File-based cache with TTL
│   ├── utils.js         # Logging, retryAsync, rate limiting
│   ├── pubmed_utils.js  # PubMed XML parsing
│   └── server_utils.js  # Server-specific cache utilities
└── scripts/             # Misc utility scripts
```

## Publication discovery strategies

| # | Strategy | Source | Mode |
|---|----------|--------|------|
| 1 | `linked_at_registration` | Publications already linked in the trial registry | Both |
| 2 | `pubmed_naive` | PubMed search by trial ID, investigator, dates | Both |
| 3 | `google_scholar` | Google Scholar via Serper.dev API | Both |
| 4 | `pubmed_gpt_v1` | GPT-generated PubMed query (single query) | Batch / Live |
| 5 | `pubmed_gpt_v2` | GPT-generated PubMed queries (multi-query, enhanced) | Batch / Live |

In live mode, strategies use file-based caching (suffix `_cached` in config).

## Configuration

Settings are in `config/default.json` with separate sections for `batch` and `live` modes.

Key settings per mode:
- `modelQueryV1` / `modelQueryV2` — Model for PubMed query generation
- `modelResults` — Model for results detection
- `reasoningEffort*` — OpenAI reasoning effort (`minimal`/`low`/`medium`/`high`)
- `strategies` — Ordered list of discovery strategies to run
- `systemPrompt*` — Paths to prompt template files

Cache TTLs:
- Default: 7 days
- Linked registrations: 30 days
- GPT queries: 90 days

## LLM prompts

Prompt templates are in `prompts/`:
- `systemPromptSingleAbstract.txt` — Results detection (compares registration to publication)
- `systemPromptPubmedSearchGeneration.txt` — Query generation V1
- `systemPromptGptQueryV2.txt` — Enhanced query generation V2
