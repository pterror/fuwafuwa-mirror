#!/usr/bin/env bun
// freetime.ts — nondeterministic task scheduler for autonomous sessions
// tasks have weights (relative frequency) and a global scale controls overall rate
// usage:
//   bun scripts/freetime.ts check       — roll dice, print selected task (if any)
//   bun scripts/freetime.ts dry-run     — simulate a week of ticks, show frequencies
//   bun scripts/freetime.ts dry-run 4   — simulate 4 weeks
//   bun scripts/freetime.ts list        — show all tasks with status
//   bun scripts/freetime.ts record <id> — mark a task as just completed

import { readFileSync, writeFileSync, existsSync } from "fs";

const DIR = import.meta.dir + "/..";
const TASKS_FILE = DIR + "/brain/freetime-tasks.json";
const STATE_FILE = DIR + "/brain/freetime-state.json";
const TICK_INTERVAL_MS = 60_000; // heartbeat runs every 1 min

// --- scale = target sessions per day ---
// weights are relative; this controls the overall rate
// p_per_tick for each task = (SESSIONS_PER_DAY * weight) / (totalWeight * ticksPerDay)
const SESSIONS_PER_DAY = 3;

interface Task {
  id: string;
  name: string;
  prompt: string;
  weight: number;
  cooldownHours: number;
  maxPerDay: number;
}

interface TaskRun {
  timestamp: number;
}

interface State {
  runs: Record<string, TaskRun[]>;
}

function loadTasks(): Task[] {
  return JSON.parse(readFileSync(TASKS_FILE, "utf8"));
}

function loadState(): State {
  if (!existsSync(STATE_FILE)) return { runs: {} };
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { runs: {} };
  }
}

function saveState(state: State) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function taskP(task: Task, tasks: Task[]): number {
  const totalWeight = tasks.reduce((s, t) => s + t.weight, 0);
  const ticksPerDay = (24 * 3600_000) / TICK_INTERVAL_MS;
  return (SESSIONS_PER_DAY * task.weight) / (totalWeight * ticksPerDay);
}

function isOnCooldown(task: Task, runs: TaskRun[], now: number): boolean {
  if (runs.length === 0) return false;
  const last = Math.max(...runs.map((r) => r.timestamp));
  return now - last < task.cooldownHours * 3600_000;
}

function runsToday(runs: TaskRun[], now: number): number {
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  return runs.filter((r) => r.timestamp >= dayStart.getTime()).length;
}

function checkEligible(
  task: Task,
  runs: TaskRun[],
  now: number,
): { eligible: boolean; reason?: string } {
  if (isOnCooldown(task, runs, now)) {
    const last = Math.max(...runs.map((r) => r.timestamp));
    const remaining = task.cooldownHours * 3600_000 - (now - last);
    const hours = (remaining / 3600_000).toFixed(1);
    return { eligible: false, reason: `cooldown (${hours}h remaining)` };
  }
  if (runsToday(runs, now) >= task.maxPerDay) {
    return { eligible: false, reason: `daily cap (${task.maxPerDay})` };
  }
  return { eligible: true };
}

// --- commands ---

const cmd = process.argv[2] || "check";

if (cmd === "check") {
  const tasks = loadTasks();
  const state = loadState();
  const now = Date.now();
  const eligible: Task[] = [];

  for (const task of tasks) {
    const runs = state.runs[task.id] || [];
    const { eligible: ok } = checkEligible(task, runs, now);
    if (ok) eligible.push(task);
  }

  // roll each eligible task's die independently
  const hits: Task[] = [];
  for (const task of eligible) {
    if (Math.random() < taskP(task, tasks)) hits.push(task);
  }

  if (hits.length === 0) {
    console.log("no-task");
    process.exit(0);
  }

  // pick the one with longest time since last run (or never run)
  const selected = hits.sort((a, b) => {
    const aRuns = state.runs[a.id] || [];
    const bRuns = state.runs[b.id] || [];
    const aLast = aRuns.length ? Math.max(...aRuns.map((r) => r.timestamp)) : 0;
    const bLast = bRuns.length ? Math.max(...bRuns.map((r) => r.timestamp)) : 0;
    return aLast - bLast;
  })[0];

  console.log(JSON.stringify({ id: selected.id, name: selected.name, prompt: selected.prompt }));
  process.exit(0);
}

if (cmd === "record") {
  const taskId = process.argv[3];
  if (!taskId) {
    console.error("usage: freetime record <task-id>");
    process.exit(1);
  }
  const state = loadState();
  if (!state.runs[taskId]) state.runs[taskId] = [];
  state.runs[taskId].push({ timestamp: Date.now() });
  // prune runs older than 7 days
  const cutoff = Date.now() - 7 * 24 * 3600_000;
  for (const id in state.runs) {
    state.runs[id] = state.runs[id].filter((r) => r.timestamp > cutoff);
  }
  saveState(state);
  console.log(`recorded: ${taskId}`);
  process.exit(0);
}

if (cmd === "list") {
  const tasks = loadTasks();
  const state = loadState();
  const now = Date.now();

  console.log(`  target: ${SESSIONS_PER_DAY} sessions/day\n`);
  for (const task of tasks) {
    const runs = state.runs[task.id] || [];
    const { eligible, reason } = checkEligible(task, runs, now);
    const lastRun = runs.length
      ? new Date(Math.max(...runs.map((r) => r.timestamp))).toLocaleString()
      : "never";
    const today = runsToday(runs, now);
    const p = taskP(task, tasks);
    console.log(
      `  ${eligible ? "●" : "○"} ${task.name} (w=${task.weight}, p=${p.toFixed(6)}, cd=${task.cooldownHours}h, ${today}/${task.maxPerDay} today, last: ${lastRun})${reason ? ` — ${reason}` : ""}`,
    );
  }
  process.exit(0);
}

if (cmd === "dry-run") {
  const weeks = parseInt(process.argv[3] || "1") || 1;
  const tasks = loadTasks();
  const ticksPerDay = (24 * 3600_000) / TICK_INTERVAL_MS;
  const totalTicks = ticksPerDay * 7 * weeks;
  const simStart = Date.now();

  // per-task tracking
  const counts: Record<string, number> = {};
  const simRuns: Record<string, TaskRun[]> = {};
  const dailyCounts: Record<string, number[]> = {};
  for (const t of tasks) {
    counts[t.id] = 0;
    simRuns[t.id] = [];
    dailyCounts[t.id] = new Array(7 * weeks).fill(0);
  }

  let totalSessions = 0;

  for (let tick = 0; tick < totalTicks; tick++) {
    const now = simStart + tick * TICK_INTERVAL_MS;
    const day = Math.floor(tick / ticksPerDay);
    const eligible: Task[] = [];

    for (const task of tasks) {
      const runs = simRuns[task.id];
      const { eligible: ok } = checkEligible(task, runs, now);
      if (ok) eligible.push(task);
    }

    const hits: Task[] = [];
    for (const task of eligible) {
      if (Math.random() < taskP(task, tasks)) hits.push(task);
    }

    if (hits.length > 0) {
      const selected = hits.sort((a, b) => {
        const aLast = simRuns[a.id].length
          ? Math.max(...simRuns[a.id].map((r) => r.timestamp))
          : 0;
        const bLast = simRuns[b.id].length
          ? Math.max(...simRuns[b.id].map((r) => r.timestamp))
          : 0;
        return aLast - bLast;
      })[0];

      simRuns[selected.id].push({ timestamp: now });
      counts[selected.id]++;
      dailyCounts[selected.id][day]++;
      totalSessions++;
    }
  }

  console.log(`\n  freetime dry-run — ${weeks} week(s), target=${SESSIONS_PER_DAY}/day (${Math.round(totalTicks)} ticks)\n`);

  for (const task of tasks) {
    const c = counts[task.id];
    const perWeek = c / weeks;
    const days = dailyCounts[task.id];
    const maxDay = Math.max(...days);
    const activeDays = days.filter((d) => d > 0).length;
    console.log(
      `  ${task.name} (w=${task.weight})` +
        `\n    total: ${c} | ~${perWeek.toFixed(1)}/week | max ${maxDay}/day | active ${activeDays}/${7 * weeks} days\n`,
    );
  }

  console.log(`  total sessions: ${totalSessions} (~${(totalSessions / weeks).toFixed(1)}/week, ~${(totalSessions / weeks / 7).toFixed(1)}/day)\n`);
  process.exit(0);
}

console.error(`unknown command: ${cmd}`);
process.exit(1);
