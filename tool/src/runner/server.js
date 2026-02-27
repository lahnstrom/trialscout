import "dotenv/config";
import Koa from "koa";
import Router from "koa-router";
import cors from "@koa/cors";
import { registrationDiscovery } from "../discovery/registration.js";
import { publicationDiscovery } from "../discovery/publication/index.js";
import { resultsDiscovery } from "../discovery/results.js";

// To avoid rate limit on chatgpt
const LIMIT_PUBS = 15;

const ALLOWED_MODELS = ["gpt-5.1", "gpt-5.1-mini"];
const ALLOWED_REASONING = ["minimal", "low", "medium", "high"];

/**
 * Parse and validate optional model/reasoning query params.
 * Returns overrides object, or null if validation failed (400 already set).
 */
function parseModelOverrides(ctx) {
  const { model, reasoning } = ctx.query;
  const overrides = {};

  if (model) {
    if (!ALLOWED_MODELS.includes(model)) {
      ctx.status = 400;
      ctx.body = {
        error: `Invalid model "${model}". Allowed: ${ALLOWED_MODELS.join(", ")}`,
      };
      return null;
    }
    overrides.model = model;
  }

  if (reasoning) {
    if (!ALLOWED_REASONING.includes(reasoning)) {
      ctx.status = 400;
      ctx.body = {
        error: `Invalid reasoning "${reasoning}". Allowed: ${ALLOWED_REASONING.join(", ")}`,
      };
      return null;
    }
    overrides.reasoning = reasoning;
  }

  return overrides;
}

const app = new Koa();
const router = new Router();

// Enable CORS for all origins
app.use(cors());

// Endpoint to fetch trial data by trial ID
router.get("/api/trials/:nctId", async (ctx) => {
  try {
    const trialId = ctx.params.nctId;

    if (!trialId) {
      ctx.status = 400;
      ctx.body = { error: "Trial ID is required" };
      return;
    }

    const trial = await registrationDiscovery(trialId);

    if (trial) {
      ctx.body = trial;
    } else {
      ctx.status = 404;
      ctx.body = { error: "Trial not found" };
    }
  } catch (error) {
    ctx.status = 500;
    ctx.body = { error: "Failed to read trial data" };
  }
});

router.get("/api/publications/:nctId", async (ctx) => {
  try {
    const trialId = ctx.params.nctId;

    if (!trialId) {
      ctx.status = 400;
      ctx.body = { error: "Trial ID is required" };
      return;
    }

    const overrides = parseModelOverrides(ctx);
    if (overrides === null) return;

    // Uses default live strategies from config
    const [pubs, errors] = await publicationDiscovery(
      trialId,
      undefined,
      overrides
    );

    if (pubs) {
      ctx.body = { pubs, errors };
    } else {
      ctx.status = 404;
      ctx.body = { error: "Publications not found" };
    }
  } catch (error) {
    console.error("Error retrieving trial publications:", error);
    ctx.status = 500;
    ctx.body = {
      error: "Failed to retrieve publications for trial ID: " + trialId,
    };
  }
});

router.get("/api/results/:nctId/:pmid", async (ctx) => {
  const trialId = ctx.params.nctId;
  const pmid = ctx.params.pmid;
  try {
    if (!trialId) {
      ctx.status = 400;
      ctx.body = { error: "Trial ID is required" };
      return;
    }

    if (!pmid) {
      ctx.status = 400;
      ctx.body = { error: "PMID is required" };
      return;
    }

    const overrides = parseModelOverrides(ctx);
    if (overrides === null) return;

    const discoveredResults = await resultsDiscovery(trialId, pmid, overrides);

    ctx.body = discoveredResults;
  } catch (error) {
    console.error("Error searching for results publications:", error);
    ctx.status = 500;
    ctx.body = {
      error: `Failed to retrieve results for publication: ${pmid} and trial ${trialId}`,
    };
  }
});

// Use the router middleware
app.use(router.routes());
app.use(router.allowedMethods());

// Start the Koa server
const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
