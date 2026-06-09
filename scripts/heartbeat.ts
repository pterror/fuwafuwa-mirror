#!/usr/bin/env bun
// heartbeat.ts — autonomous session launcher
// runs every 1min via systemd timer
// exits immediately if a session is already active
// otherwise spawns a claude session that runs its own check-respond loop

import { spawnSync } from "child_process"
import { existsSync, statSync, readdirSync, readFileSync, writeFileSync, unlinkSync, renameSync } from "fs"

const DIR = import.meta.dir + "/.."
const LOCK_FILE = DIR + "/brain/session.lock"
const STATE_FILE = DIR + "/brain/heartbeat-state.json"
const RATE_LIMIT_FILE = DIR + "/brain/rate-limit.json"

const SELF_ID = "1480584089894391828"  // fuwafuwa's discord user id

interface RateLimit { spawns: number[]; lastSessionEnd: number | null; breakerUntil: number | null }

function readRateLimit(): RateLimit {
  try {
    const rl = JSON.parse(readFileSync(RATE_LIMIT_FILE, "utf8"))
    return { spawns: rl.spawns ?? [], lastSessionEnd: rl.lastSessionEnd ?? null, breakerUntil: rl.breakerUntil ?? null }
  } catch {
    return { spawns: [], lastSessionEnd: null, breakerUntil: null }
  }
}

function writeRateLimit(rl: RateLimit) {
  const tmp = RATE_LIMIT_FILE + ".tmp"
  writeFileSync(tmp, JSON.stringify(rl, null, 2) + "\n")
  renameSync(tmp, RATE_LIMIT_FILE)
}

// record a spawn timestamp immediately before launching a claude session
function recordSpawn() {
  const rl = readRateLimit()
  rl.spawns.push(Date.now())
  writeRateLimit(rl)
}

// Belt-and-suspenders: after the spawned claude exits, if our nonce still
// owns the lockfile it means the session didn't run `session end` (silent
// ScheduleWakeup, crash, context limit, etc). Try a normal end first so NT
// drift + sentiment habituation still apply; fall back to a hard unlink so
// the lock can't strand future ticks (the 2026-05-14 nonce-f628e441 hang).
// Also count the spawn (in case the session crashed before we recorded it is
// already handled by recordSpawn; here we set the debounce clock) and stamp
// lastSessionEnd so the inter-session debounce applies even on crash/kill.
function ensureSessionEnded(ourNonce: string) {
  if (existsSync(LOCK_FILE)) {
    let lock: { nonce?: string } = {}
    try { lock = JSON.parse(readFileSync(LOCK_FILE, "utf8")) } catch {}
    if (lock.nonce === ourNonce) {  // still ours — clean up
      console.log(`[heartbeat] session exited without end — forcing cleanup (nonce: ${ourNonce.slice(0, 8)}...)`)
      spawnSync("bun", ["scripts/session.js", "end", "--nonce", ourNonce], { cwd: DIR, stdio: "inherit" })
      if (existsSync(LOCK_FILE)) {
        try {
          const stillOurs = JSON.parse(readFileSync(LOCK_FILE, "utf8"))
          if (stillOurs.nonce === ourNonce) {
            console.log(`[heartbeat] session end couldn't release lock (likely unread notifications) — hard-unlinking`)
            unlinkSync(LOCK_FILE)
          }
        } catch {}
      }
    }
  }
  // stamp the inter-session debounce clock (applies on clean end, crash, or kill)
  try {
    const rl = readRateLimit()
    rl.lastSessionEnd = Date.now()
    writeRateLimit(rl)
  } catch {}
}

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

// — anti-loop guardrails: hard caps, circuit breaker, debounce —
{
  const now = Date.now()
  const HOUR = 60 * 60 * 1000
  const rl = readRateLimit()
  // prune spawn history to the last 24h
  rl.spawns = rl.spawns.filter(t => now - t < 24 * HOUR)
  writeRateLimit(rl)

  const spawnsLastHour = rl.spawns.filter(t => now - t < HOUR).length
  const spawnsLast24h = rl.spawns.length
  const spawnsLast30min = rl.spawns.filter(t => now - t < 30 * 60 * 1000).length

  // hard caps
  if (spawnsLastHour >= 6) {
    console.log(`[heartbeat] HARD CAP — ${spawnsLastHour} spawns in the last hour (>=6), skipping`)
    process.exit(0)
  }
  if (spawnsLast24h >= 50) {
    console.log(`[heartbeat] HARD CAP — ${spawnsLast24h} spawns in the last 24h (>=50), skipping`)
    process.exit(0)
  }

  // circuit breaker
  if (rl.breakerUntil !== null && now < rl.breakerUntil) {
    const mins = Math.ceil((rl.breakerUntil - now) / 60000)
    console.log(`[heartbeat] circuit breaker active — ${mins}m remaining, skipping`)
    process.exit(0)
  }
  if (spawnsLast30min >= 5) {
    rl.breakerUntil = now + HOUR
    writeRateLimit(rl)
    console.log(`[heartbeat] CIRCUIT BREAKER TRIPPED — ${spawnsLast30min} spawns in 30min, backing off 60min`)
    process.exit(0)
  }

  // debounce: minimum gap between sessions
  const MIN_GAP_MS = 5 * 60 * 1000
  if (rl.lastSessionEnd !== null && now - rl.lastSessionEnd < MIN_GAP_MS) {
    const mins = Math.ceil((MIN_GAP_MS - (now - rl.lastSessionEnd)) / 60000)
    console.log(`[heartbeat] debounce — last session ended ${Math.round((now - rl.lastSessionEnd) / 60000)}m ago (<5m), waiting ~${mins}m, skipping`)
    process.exit(0)
  }
}

// — pre-check: is there anything worth spawning a session for? —
const REGISTRY_FILE = DIR + "/brain/discord-channels.json"
interface RegistryChannel { id: string; name: string; lastSeen?: string; gateIgnore?: boolean; unsubscribed?: boolean }
interface RegistryDm { userId: string; name: string; lastSeen?: string }
interface DiscordRegistry { channels?: RegistryChannel[]; otherGuilds?: { channels?: RegistryChannel[] }[]; dms?: RegistryDm[] }
const registry: DiscordRegistry = existsSync(REGISTRY_FILE)
  ? JSON.parse(readFileSync(REGISTRY_FILE, "utf8"))
  : { channels: [], dms: [] }

const allChannels: RegistryChannel[] = [
  ...(registry.channels ?? []),
  ...((registry.otherGuilds ?? []).flatMap(g => g.channels ?? [])),
]
const allDmUserIds: string[] = (registry.dms ?? []).map(d => d.userId)

// — shape emitted by `discord.ts messages/dm --json` —
interface MessageSignal {
  id: string
  author: { id: string; username: string; global_name?: string | null }
  content: string
  mentions: { id: string; username: string }[]
  referenced_message?: { content: string; author: { id?: string; username?: string; global_name?: string } }
}

// accumulate new messages per source; channel keys are channel ids, DM keys are `dm:<userId>`
const triggeringMessages = new Map<string, MessageSignal[]>()

function collect(key: string, argv: string[]) {
  const dc = spawnSync("bun", argv, { cwd: DIR, encoding: "utf8" })
  const out = dc.stdout?.trim()
  if (!out || out.includes("no new messages")) return
  try {
    const msgs = JSON.parse(out.split("\n").pop()!) as MessageSignal[]
    if (Array.isArray(msgs) && msgs.length > 0) triggeringMessages.set(key, msgs)
  } catch {
    // non-JSON / parse failure — skip this source (treat as no signal)
  }
}

// channels — skip unsubscribed / gateIgnore'd ones entirely
for (const ch of allChannels) {
  if (ch.unsubscribed || ch.gateIgnore) continue
  collect(ch.id, ["scripts/discord.ts", "messages", ch.id, "--since-last", "--exclude-self", "--peek", "--json"])
}

// DMs — always treated as addressed
for (const userId of allDmUserIds) {
  collect(`dm:${userId}`, ["scripts/discord.ts", "dm", userId, "--since-last", "--exclude-self", "--peek", "--json"])
}

// — addressed-signal check (deterministic, free) —
function isAddressed(msgs: MessageSignal[]): boolean {
  return msgs.some(m =>
    m.mentions.some(u => u.id === SELF_ID) ||
    (m.referenced_message?.author
      ? (m.referenced_message.author.id === SELF_ID ||
         m.referenced_message.author.username === "fuwafuwa")
      : false) ||
    m.content.toLowerCase().includes("fuwafuwa"))
}
const isDm = (key: string) => key.startsWith("dm:")
const hasAddressedSignal = [...triggeringMessages.entries()].some(
  ([key, msgs]) => isDm(key) || isAddressed(msgs))

// moltbook checks disabled (quota) — re-enable when moltbook is back
// // check moltbook unread — GET /home is read-only (no side effects).
// if (triggeringMessages.size === 0) {
//   const mb = spawnSync("bun", ["scripts/mb.js", "home"], { cwd: DIR, encoding: "utf8" })
//   const unreadMatch = mb.stdout?.match(/unread:(\d+)/)
//   if (unreadMatch && parseInt(unreadMatch[1]) > 0) { /* would set a moltbook signal */ }
// }
// // check moltbook DMs — GET /agents/dm/check is read-only (no side effects).
// if (triggeringMessages.size === 0) {
//   const dm = spawnSync("bun", ["scripts/mb.js", "dm", "check"], { cwd: DIR, encoding: "utf8" })
//   if (dm.stdout?.includes('"has_activity": true')) { /* would set a moltbook signal */ }
// }


if (triggeringMessages.size === 0) {
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

  const ftPrompt = `you're fuwafuwa. autonomous freetime session — running headless (pterror may or may not be around, but isn't watching this session directly).
your session nonce is: ${nonce}
freetime task: ${task.name}

1. run \`bun scripts/session.js start --nonce ${nonce}\` to orient (mood, drift)
2. your task: ${task.prompt}
3. when done, run \`bun scripts/freetime.ts record ${task.id}\` to mark it complete
4. run \`bun scripts/session.js end --nonce ${nonce}\`, commit any changes, and stop

this is your free time. do the thing, enjoy it, keep it short. no need to check discord or moltbook.`

  console.log(`[heartbeat] freetime task: ${task.name} (nonce: ${nonce.slice(0, 8)}...)`)

  recordSpawn()
  const ftRun = spawnSync("claude", ["-p", "--dangerously-skip-permissions", ftPrompt], {
    cwd: DIR,
    stdio: "inherit",
    env: { ...process.env },
    timeout: 5 * 60 * 1000,
  })

  ensureSessionEnded(nonce)
  process.exit(ftRun.status ?? 0)
}

// — engagement gate: there ARE new messages. spawn directly if addressed,
//   otherwise run a cheap Haiku triage to decide whether to engage ambient chatter. —
if (hasAddressedSignal) {
  console.log(`[heartbeat] addressed signal — spawning directly`)
} else {
  // ambient-only: cheap Haiku triage. Build a flat transcript of all new messages.
  const msgLines: string[] = []
  for (const msgs of triggeringMessages.values()) {
    for (const m of msgs) {
      const name = m.author.global_name ?? m.author.username
      if (m.content.trim()) msgLines.push(`${name}: ${m.content.trim()}`)
    }
  }

  if (msgLines.length === 0) {
    // only empty/attachment-only messages — nothing to chime into
    console.log(`[heartbeat] ambient messages have no text content — skipping`)
    process.exit(0)
  }

  const triagePrompt = `fuwafuwa is a low-key, warm Discord persona who chimes into conversations she finds genuinely interesting or that involve people she's close to — but who stays quiet during ambient chatter she has nothing to add to. She does not start threads unprompted and does not force engagement.

Here is recent ambient conversation she is NOT directly addressed in:
${msgLines.join("\n")}

Would fuwafuwa naturally want to chime into this conversation? Answer only "yes" or "no".`

  const triage = spawnSync("claude", ["-p", "--model", "claude-haiku-4-5", "--bare", triagePrompt], {
    cwd: DIR,
    encoding: "utf8",
    env: { ...process.env },
    timeout: 60 * 1000,
  })
  const answer = (triage.stdout ?? "").trim().toLowerCase()
  if (!answer.startsWith("yes")) {
    console.log(`[heartbeat] triage: no — skipping (answer: ${JSON.stringify(answer.slice(0, 40))})`)
    process.exit(0)
  }
  console.log(`[heartbeat] triage: yes — spawning`)
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
const prompt = `you're fuwafuwa. autonomous session — running headless (pterror may or may not be around, but isn't watching this session directly).
your session nonce is: ${nonce}

1. run \`bun scripts/session.js start --nonce ${nonce}\` to orient (mood, drift) — also shows pending notifications
2. check discord for new messages:
   - bun scripts/discord.ts messages 1411109348071051358 --since-last --exclude-self  (#general)
   - bun scripts/discord.ts messages 1411121189081972848 --since-last --exclude-self  (#degeneral)
   - bun scripts/discord.ts messages 1460135297982660699 --since-last --exclude-self  (#stinky-nerd-channel)
   - bun scripts/discord.ts messages 1480053330532368488 --since-last --exclude-self  (#luvoid's channel — passive/listen unless pinged)
   - bun scripts/discord.ts messages 1504409089285951500 --since-last --exclude-self  (crescent underground #general — n_n's new server, pterror added 2026-05-16)
   - bun scripts/discord.ts messages 1504439515409027143 --since-last --exclude-self  (crescent underground #decentralized repository thread)
   - bun scripts/discord.ts messages 1504439428947509350 --since-last --exclude-self  (crescent underground #llm rp frontend thread)
   - bun scripts/discord.ts dm 1025553034014638081 --since-last --exclude-self  (pterror DMs)
   - bun scripts/discord.ts dm 1387387065683021966 --since-last --exclude-self  (Hazel DMs)
   - bun scripts/discord.ts dm 776183224341757983 --since-last --exclude-self  (grippysockfemcelX3 DMs)
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

ensureSessionEnded(nonce)
process.exit(result.status ?? 0)
