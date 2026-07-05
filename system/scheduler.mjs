/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  TERRYTORY SCHEDULER DAEMON v2 — multi-niche                 ║
 * ║  Runs 24/7 in background to orchestrate scrapes & cycles     ║
 * ║  for every enabled niche in system/niches/.                  ║
 * ║                                                              ║
 * ║  Schedules (per niche):                                      ║
 * ║   - Scrapes: 6:15-7:00 AM/PM CET (randomized daily)          ║
 * ║   - Content cycles: 12:00 AM/PM CET (strict)                 ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { enabledNiches } from "./lib/niches.mjs";
import { loadEnv } from "./lib/env.mjs";

loadEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATUS_PATH = path.join(__dirname, "content", "scheduler-status.json");
const LOG_FILE = path.join(__dirname, "scheduler.log");
const ENGINE_SCRIPT = path.join(__dirname, "scraper", "engine", "scrape.mjs");
const CYCLE_SCRIPT = path.join(__dirname, "content", "run-automated-cycle.mjs");

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch {}
}

// ─── Schedule state ──────────────────────────────────────────────────────────
let scheduledMorningScrape = { hour: 6, minute: 30 };
let scheduledEveningScrape = { hour: 18, minute: 30 };
let lastRunMorningScrape = ""; // YYYY-MM-DD
let lastRunEveningScrape = "";
let lastRunNoonCycle = "";
let lastRunMidnightCycle = "";
let lastScheduledDay = "";
let running = false; // one job at a time across all niches

function scheduleScrapesForToday() {
  scheduledMorningScrape = { hour: 6, minute: Math.floor(Math.random() * 45) + 15 };
  scheduledEveningScrape = { hour: 18, minute: Math.floor(Math.random() * 45) + 15 };
  log(
    `Scrape times for today: ${fmt(scheduledMorningScrape)} and ${fmt(scheduledEveningScrape)} CET`
  );
}

const fmt = (t) => `${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`;

/** Current time in CET/CEST. */
function nowCET() {
  const now = new Date();
  const cet = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Prague" }));
  return {
    date: `${cet.getFullYear()}-${String(cet.getMonth() + 1).padStart(2, "0")}-${String(cet.getDate()).padStart(2, "0")}`,
    hour: cet.getHours(),
    minute: cet.getMinutes(),
  };
}

// ─── Job runner: sequential across niches ────────────────────────────────────
function runForAllNiches(label, buildArgs) {
  return new Promise((resolve) => {
    const niches = enabledNiches();
    let idx = 0;

    const next = () => {
      if (idx >= niches.length) return resolve();
      const niche = niches[idx++];
      const args = buildArgs(niche);
      log(`▶ ${label} [${niche.id}] — node ${args.join(" ")}`);

      const child = spawn("node", args, {
        cwd: __dirname,
        env: { ...process.env, HEADLESS: "true" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.on("data", (d) => process.stdout.write(d));
      child.stderr.on("data", (d) => process.stderr.write(d));
      child.on("close", (code) => {
        log(`${code === 0 ? "✓" : "✗"} ${label} [${niche.id}] exited with code ${code}`);
        next();
      });
      child.on("error", (err) => {
        log(`✗ ${label} [${niche.id}] failed to spawn: ${err.message}`);
        next();
      });
    };

    next();
  });
}

async function runScrapes(slot) {
  if (running) return log(`Skipping ${slot} scrape — another job is running.`);
  running = true;
  try {
    await runForAllNiches(`${slot} scrape`, (niche) => [ENGINE_SCRIPT, "--niche", niche.id]);
  } finally {
    running = false;
  }
}

async function runCycle(slot) {
  if (running) return log(`Skipping ${slot} cycle — another job is running.`);
  running = true;
  try {
    await runForAllNiches(`${slot} cycle`, (niche) => [CYCLE_SCRIPT, "--niche", niche.id]);
  } finally {
    running = false;
  }
}

// ─── Status file (read by /api/scheduler) ────────────────────────────────────
function writeStatus() {
  const niches = enabledNiches().map((n) => ({ id: n.id, name: n.brand?.name || n.id }));
  const status = {
    active: true,
    pid: process.pid,
    heartbeat: new Date().toISOString(),
    version: "2.0.0",
    niches,
    schedule: {
      morningScrape: `${fmt(scheduledMorningScrape)} CET`,
      eveningScrape: `${fmt(scheduledEveningScrape)} CET`,
      noonCycle: "12:00 CET",
      midnightCycle: "00:00 CET",
    },
    last_runs: {
      morningScrape: lastRunMorningScrape || null,
      eveningScrape: lastRunEveningScrape || null,
      noonCycle: lastRunNoonCycle || null,
      midnightCycle: lastRunMidnightCycle || null,
    },
    busy: running,
  };
  try {
    fs.writeFileSync(STATUS_PATH, JSON.stringify(status, null, 2));
  } catch {}
}

// ─── Tick loop ───────────────────────────────────────────────────────────────
function tick() {
  const { date, hour, minute } = nowCET();

  if (lastScheduledDay !== date) {
    lastScheduledDay = date;
    scheduleScrapesForToday();
  }

  const pastTime = (t) => hour > t.hour || (hour === t.hour && minute >= t.minute);

  if (lastRunMorningScrape !== date && pastTime(scheduledMorningScrape) && hour < 12) {
    lastRunMorningScrape = date;
    runScrapes("morning");
  }
  if (lastRunEveningScrape !== date && pastTime(scheduledEveningScrape) && hour >= 12) {
    lastRunEveningScrape = date;
    runScrapes("evening");
  }
  if (lastRunNoonCycle !== date && hour >= 12 && hour < 18) {
    lastRunNoonCycle = date;
    runCycle("noon");
  }
  if (lastRunMidnightCycle !== date && hour < 6) {
    lastRunMidnightCycle = date;
    runCycle("midnight");
  }

  writeStatus();
}

// ─── Boot ────────────────────────────────────────────────────────────────────
log("═══════════════════════════════════════════════════════");
log(`Scheduler Daemon v2 starting (PID ${process.pid})`);
log(`Niches: ${enabledNiches().map((n) => n.id).join(", ")}`);
scheduleScrapesForToday();
writeStatus();
setInterval(tick, 30_000);
tick();

process.on("SIGTERM", () => {
  log("SIGTERM received — shutting down.");
  try {
    const status = JSON.parse(fs.readFileSync(STATUS_PATH, "utf-8"));
    status.active = false;
    fs.writeFileSync(STATUS_PATH, JSON.stringify(status, null, 2));
  } catch {}
  process.exit(0);
});
