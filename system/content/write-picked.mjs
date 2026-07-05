/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  TERRYTORY PICKED WRITER v2 — niche-aware                    ║
 * ║  Research → style guide → write → images → save draft.      ║
 * ║                                                              ║
 * ║  Usage: node write-picked.mjs <pickId> [model] --niche ufo   ║
 * ╚══════════════════════════════════════════════════════════════╝
 */
import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "./content-config.mjs";
import { cliNiche, getNicheContext, getApiKey, generateDraftFromPick } from "./pipeline-core.mjs";

async function main() {
  const positional = process.argv.slice(2).filter((a, i, arr) => !a.startsWith("--") && arr[i - 1] !== "--niche");
  const pickId = positional[0];
  const modelOverride = positional[1] || null;

  if (!pickId) {
    console.error("Usage: node write-picked.mjs <pickId> [modelOverride] [--niche <id>]");
    process.exit(1);
  }

  const ctx = getNicheContext(cliNiche());
  const { log, paths } = ctx;

  log("info", "═══════════════════════════════════════════════════════");
  log("info", `Picked Writer starting — niche: ${ctx.niche.id}, pick: ${pickId} (Model: ${modelOverride || CONFIG.model})`);

  const pickPath = path.join(paths.picks, `${pickId}.json`);
  if (!fs.existsSync(pickPath)) {
    log("error", `Pick file not found at ${pickPath}`);
    process.exit(1);
  }

  const pick = JSON.parse(fs.readFileSync(pickPath, "utf-8"));
  log("info", `Topic: "${pick.headline}" (Rating: ${pick.rating}/10)`);

  let apiKey;
  try {
    apiKey = getApiKey();
  } catch (err) {
    log("error", `API Key error: ${err.message}`);
    process.exit(1);
  }

  try {
    await generateDraftFromPick(ctx, pick, apiKey, { modelOverride });
    log("info", "Picked Writer finished successfully ✓");
  } catch (err) {
    log("error", `✗ Generation failed: ${err.message}`);
    if (err.stack) log("error", err.stack);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Unhandled agent error: ${err.message}`);
  process.exit(1);
});
