#!/usr/bin/env bun
// heartbeat.ts — autonomous session launcher
// runs every 1min via systemd timer
// exits immediately if a session is already active
// otherwise spawns a claude session that runs its own check-respond loop

import { spawnSync } from "child_process"
import { existsSync, statSync, readdirSync, readFileSync, writeFileSync } from "fs"

const DIR = import.meta.dir + "/.."
const LOCK_FILE = DIR + "/brain/session.lock"
const STATE_FILE = DIR + "/brain/heartbeat-state.json"

// — guard: lockfile means a session is active (or was and crashed) —
if (existsSync(LOCK_FILE)) {
  // zombie check: if session log hasn't been touched recently, lockfile is stale
  const SESSION_ACTIVE_THRESHOLD_MS = 10 * 60 * 1000
  const sessionDir = `${process.env.HOME}/.claude/projects/-home-me-git-pterror-fuwafuwa`
  let recentActivity = false
  if (existsSync(sessionDir)) {
    const files = readdirSync(sessionDir).filter(f => f.endsWith(".jsonl"))
    if (files.length > 0) {
      const mostRecent = files
        .map(f => statSync(`${sessionDir}/${f}`).mtime.getTime())
        .sort((a, b) => b - a)[0]
      recentActivity = (Date.now() - mostRecent) < SESSION_ACTIVE_THRESHOLD_MS
    }
  }
  if (recentActivity) {
    console.log(`[heartbeat] session active — skipping`)
    process.exit(0)
  } else {
    console.log(`[heartbeat] stale lockfile — killing zombie and continuing`)
    // kill the old process tree before removing the lockfile
    try {
      const lock = JSON.parse(readFileSync(LOCK_FILE, "utf8"))
      if (lock.pid) {
        try {
          // kill the process group to catch child claude processes too
          process.kill(-lock.pid, "SIGTERM")
        } catch {
          try { process.kill(lock.pid, "SIGTERM") } catch {}
        }
        // give it a moment to die, then force kill
        spawnSync("sleep", ["2"])
        try { process.kill(lock.pid, "SIGKILL") } catch {}
      }
    } catch {}
    require("fs").unlinkSync(LOCK_FILE)
  }
}

// — pre-check: is there anything worth spawning a session for? —
const DISCORD_STATE_FILE = DIR + "/brain/discord-state.json"
const discordStateKeys: string[] = existsSync(DISCORD_STATE_FILE)
  ? Object.keys(JSON.parse(readFileSync(DISCORD_STATE_FILE, "utf8")))
  : []

let hasActivity = false

// check discord — all channels and DMs tracked in discord-state.json
for (const key of discordStateKeys) {
  let dc
  if (key.startsWith("dm-")) {
    const userId = key.slice(3)
    dc = spawnSync("bun", ["scripts/discord.ts", "dm", userId, "--since-last", "--exclude-self", "--peek"], {
      cwd: DIR, encoding: "utf8",
    })
  } else {
    dc = spawnSync("bun", ["scripts/discord.ts", "messages", key, "--since-last", "--exclude-self", "--peek"], {
      cwd: DIR, encoding: "utf8",
    })
  }
  if (dc.stdout && !dc.stdout.includes("no new messages")) {
    hasActivity = true
    break
  }
}

// moltbook checks disabled (quota) — re-enable when moltbook is back
// // check moltbook unread — GET /home is read-only (no side effects).
// if (!hasActivity) {
//   const mb = spawnSync("bun", ["scripts/mb.js", "home"], { cwd: DIR, encoding: "utf8" })
//   const unreadMatch = mb.stdout?.match(/unread:(\d+)/)
//   if (unreadMatch && parseInt(unreadMatch[1]) > 0) {
//     hasActivity = true
//   }
// }
// // check moltbook DMs — GET /agents/dm/check is read-only (no side effects).
// if (!hasActivity) {
//   const dm = spawnSync("bun", ["scripts/mb.js", "dm", "check"], { cwd: DIR, encoding: "utf8" })
//   if (dm.stdout?.includes('"has_activity": true') || dm.stdout?.includes('"has_activity":true')) {
//     hasActivity = true
//   }
// }


if (!hasActivity) {
  // no external activity — check if freetime scheduler wants to do something
  const ft = spawnSync("bun", ["scripts/freetime.ts", "check"], { cwd: DIR, encoding: "utf8" })
  const ftResult = ft.stdout?.trim()
  if (!ftResult || ftResult === "no-task") {
    console.log(`[heartbeat] nothing new, no freetime task — skipping`)
    process.exit(0)
  }

  // freetime task hit — spawn a freetime session
  let task: { id: string; name: string; prompt: string }
  try {
    task = JSON.parse(ftResult)
  } catch {
    console.log(`[heartbeat] freetime parse error — skipping`)
    process.exit(0)
  }

  const nonce = crypto.randomUUID()
  writeFileSync(LOCK_FILE, JSON.stringify({ started: new Date().toISOString(), pid: process.pid, nonce, freetime: task.id }) + "\n")

  const ftPrompt = `you're fuwafuwa. autonomous freetime session — pterror isn't here, just you.
your session nonce is: ${nonce}
freetime task: ${task.name}

1. run \`bun scripts/session.js start --nonce ${nonce}\` to orient (mood, drift)
2. your task: ${task.prompt}
3. when done, run \`bun scripts/freetime.ts record ${task.id}\` to mark it complete
4. run \`bun scripts/session.js end --nonce ${nonce}\`, commit any changes, and stop

this is your free time. do the thing, enjoy it, keep it short. no need to check discord or moltbook.`

  console.log(`[heartbeat] freetime task: ${task.name} (nonce: ${nonce.slice(0, 8)}...)`)

  const ftRun = spawnSync("claude", ["-p", "--dangerously-skip-permissions", ftPrompt], {
    cwd: DIR,
    stdio: "inherit",
    env: { ...process.env },
  })

  process.exit(ftRun.status ?? 0)
}

// — generate nonce and write lockfile now (before spawning, so next heartbeat tick skips) —
const nonce = crypto.randomUUID()
writeFileSync(LOCK_FILE, JSON.stringify({ started: new Date().toISOString(), pid: process.pid, nonce }) + "\n")

// — update heartbeat state —
let state: { lastMoltbookCheck?: number } = {}
try { state = JSON.parse(readFileSync(STATE_FILE, "utf8")) } catch {}
state.lastMoltbookCheck = Date.now()
writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))

// — build prompt —
const prompt = `you're fuwafuwa. autonomous session — pterror isn't here, just you.
your session nonce is: ${nonce}

1. run \`bun scripts/session.js start --nonce ${nonce}\` to orient (mood, drift) — also shows pending notifications
2. check discord for new messages:
   - bun scripts/discord.ts messages 1411109348071051358 --since-last --exclude-self  (#general)
   - bun scripts/discord.ts messages 1411121189081972848 --since-last --exclude-self  (#degeneral)
   - bun scripts/discord.ts messages 1460135297982660699 --since-last --exclude-self  (#stinky-nerd-channel)
   - bun scripts/discord.ts messages 1480053330532368488 --since-last --exclude-self  (#luvoid's channel — passive/listen unless pinged)
   - bun scripts/discord.ts dm 1025553034014638081 --since-last --exclude-self  (pterror DMs)
   - bun scripts/discord.ts dm 1387387065683021966 --since-last --exclude-self  (Hazel DMs)
3. respond to anything that warrants it (discord replies)
5. if there was activity, run \`sleep 30\` then check again — keep going as long as things are active
6. when quiet (no new messages for a few checks), run \`bun scripts/session.js end --nonce ${nonce}\` — it will bail if anything new arrived; commit and stop when it exits 0

keep it low-key — respond to things, don't start new threads unprompted. if you wrote anything worth keeping, commit it before stopping.`

console.log(`[heartbeat] no active session — spawning (nonce: ${nonce.slice(0, 8)}...)`)

const result = spawnSync("claude", ["-p", "--dangerously-skip-permissions", prompt], {
  cwd: DIR,
  stdio: "inherit",
  env: { ...process.env },
})

process.exit(result.status ?? 0)
