import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { formatDuration } from "./helpers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function usage() {
  const script = path.relative(process.cwd(), path.join(__dirname, "..", "index.js"));
  console.log(`Usage: node ${script} --input <file> [options]

Batch processing script that uses OpenAI Batch API for cost-effective processing.
Supports stop/resume at any stage - just Ctrl+C and restart to continue.

Options:
  --input <file>          CSV file containing trials (must include nct_id column)
  --output-dir <dir>      Root directory for this run's outputs (default: ./out/<input>_<timestamp>/)
  --delimiter <char>      CSV delimiter for the input file (default: ,)
  --poll-interval <sec>   Batch job polling interval in seconds (default: 60)
  --validation-run        Enable validation mode with dataset-based date filtering
  --local-registrations <dir>  Directory of local CTG JSON files; tried before API fetch
  --step-by-step          Pause between stages and wait for user input to continue
  --help                  Show this message

Output Structure:
  Within --output-dir (./out/<input>_<timestamp>/):
    results.csv           Summary CSV with results
    progress.json         State tracking for resume capability
    json/                 Per-trial detailed JSON files
    batch/                Batch job input/output files

  Global (shared across runs):
    ./batch_results/queries/      V1 query results (reusable)
    ./batch_results/queries_v2/   V2 query results (reusable)
`);
}

export function parseArgs(argv) {
  const options = {
    input: null,
    outputDir: null,
    delimiter: ",",
    pollInterval: 60,
    validationRun: false,
    localRegistrations: null,
    stepByStep: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--input":
        options.input = argv[++i];
        break;
      case "--output-dir":
        options.outputDir = argv[++i];
        break;
      case "--delimiter":
        options.delimiter = argv[++i];
        break;
      case "--poll-interval":
        options.pollInterval = Number.parseInt(argv[++i], 10);
        break;
      case "--validation-run":
        options.validationRun = true;
        break;
      case "--local-registrations":
        options.localRegistrations = path.resolve(argv[++i]);
        break;
      case "--step-by-step":
        options.stepByStep = true;
        break;
      case "--help":
        usage();
        process.exit(0);
      default:
        console.error(`Unknown argument: ${arg}`);
        usage();
        process.exit(1);
    }
  }

  if (!options.input) {
    console.error("Missing required --input flag.");
    usage();
    process.exit(1);
  }

  const resolvedInput = path.resolve(options.input);
  const inputBase = path.basename(resolvedInput, path.extname(resolvedInput));

  // Generate output directory with timestamp if not provided
  let runDir;
  if (options.outputDir) {
    runDir = path.resolve(options.outputDir);
  } else {
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);
    runDir = path.resolve("./out", `${inputBase}_${timestamp}`);
  }

  // All outputs go into the run directory
  const outputCsv = path.join(runDir, "results.csv");
  const progressFile = path.join(runDir, "progress.json");
  const jsonDir = path.join(runDir, "json");
  const batchDir = path.join(runDir, "batch");

  return {
    ...options,
    input: resolvedInput,
    runDir,
    outputCsv,
    jsonDir,
    progressFile,
    batchDir,
  };
}


export async function waitForUserInput(currentStage, nextStage, progress, startTime) {
  const elapsedMs = Date.now() - startTime;
  const registrationCount = Object.keys(progress.registrations || {}).length;
  const publicationCount = Object.keys(progress.publications || {}).length;
  const rowEntries = Object.values(progress.rows || {});
  const successCount = rowEntries.filter((r) => r.status === "success").length;
  const errorCount = rowEntries.filter((r) => r.status === "error").length;

  console.log("\n========================================");
  console.log(`  ✓ Completed: ${currentStage}`);
  console.log(`  → Next: ${nextStage}`);
  console.log("========================================");
  console.log(`  Registrations: ${registrationCount}`);
  console.log(`  Publications: ${publicationCount}`);
  console.log(`  Success: ${successCount}`);
  console.log(`  Errors: ${errorCount}`);
  console.log(`  Elapsed: ${formatDuration(elapsedMs)}`);
  console.log("========================================");

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    });

    rl.question("  Press Enter to continue or type 'exit' to quit: ", (answer) => {
      rl.close();

      if (answer.trim().toLowerCase() === "exit") {
        console.log("\n  → User requested exit. Exiting gracefully...");
        process.exit(0);
      }

      console.log("  → Continuing to next stage...\n");
      resolve();
    });
  });
}
