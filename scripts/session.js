#!/usr/bin/env bun
// session.js — session lifecycle management
//
// usage:
//   session start [--nonce <value>]   apply drift, print mood, check pending notifications
//   session end   [--nonce <value>]   check notifications (bail if unread), write state, release lock

import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { api } from "./mb-api.js"

const argv = process.argv.slice(2)
const cmd = argv[0]
const nonceIdx = argv.indexOf("--nonce")
const nonce = nonceIdx >= 0 ? argv[nonceIdx + 1] : null

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

// — notification check (moltbook + discord) —
async function checkNotifications() {
  const pending = []

  // moltbook
  try {
    const data = await api("GET", "/notifications")
    const ns = (data.notifications ?? []).filter(n => n.isRead === false)
    for (const n of ns) {
      const detail = n.post_title ?? n.summary ?? n.post_id ?? n.type ?? "?"
      pending.push(`[moltbook/${n.type ?? "?"}] ${detail}`)
    }
  } catch (e) {
    console.warn(`[session] moltbook notification check failed: ${e.message}`)
  }

  // discord — check all tracked channels for new messages since last seen
  try {
    const discordState = JSON.parse(readFileSync(join(root, "brain/discord-state.json"), "utf8"))
    const envrc = readFileSync(join(root, ".envrc.local"), "utf8")
    const token = (process.env.DISCORD_TOKEN ?? envrc.match(/DISCORD_TOKEN=(\S+)/)?.[1] ?? "").replace(/^["']|["']$/g, "")
    if (token) {
      for (const [channelId, lastId] of Object.entries(discordState)) {
        if (channelId.startsWith("dm-")) continue  // dm state uses different key format
        const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages?after=${lastId}&limit=1`, {
          headers: { Authorization: `Bot ${token}` },
          signal: AbortSignal.timeout(10_000),
        })
        const msgs = await res.json()
        if (Array.isArray(msgs) && msgs.length > 0) {
          pending.push(`[discord #${channelId}] ${msgs.length} new message(s) since last check`)
        }
      }
    }
  } catch (e) {
    console.warn(`[session] discord check failed: ${e.message}`)
  }

  return pending
}

async function markNotificationsRead() {
  try {
    await api("POST", "/notifications/read-all")
  } catch (e) {
    console.warn(`[session] failed to mark notifications read: ${e.message}`)
  }
}

// ——————————————————————————————————————————
// start
// ——————————————————————————————————————————
async function start() {
  const state = JSON.parse(readFileSync(join(root, "brain/emotional-state.json"), "utf8"))
  const personality = JSON.parse(readFileSync(join(root, "brain/personality.json"), "utf8"))

  const now = new Date()
  const updated = new Date(state.updated)
  const hours = (now - updated) / 3_600_000

  const { inertia, regulation, social_scale } = personality._derived
  const BASE_RATES = { serotonin: 0.07, dopamine: 0.08, ne: 0.10, gaba: 0.06 }

  // — NT drift —
  for (const [sys, { value, target }] of Object.entries(state.nt)) {
    const effectiveRate = BASE_RATES[sys] / inertia
    const delta = target - value
    const rate = delta < 0 ? effectiveRate * 1.3 : effectiveRate
    state.nt[sys].value = Math.round((target + (value - target) * Math.exp(-hours * rate)) * 10) / 10
  }

  // — social energy recovery —
  const recoveryRate = 15 * (1 + (personality.introversion - 50) / 100 * 0.8)
  state.social_energy = Math.min(100, Math.round(state.social_energy + recoveryRate * hours))

  // — sentiment rest processing —
  const QUALITY_FACTORS = { warmth: 1.0, satisfaction: 0.9, curiosity: 0.8, enthusiasm: 0.85 }
  const DISCOMFORT = new Set(["irritation", "dread"])
  state.sentiments = state.sentiments
    .map(s => {
      if (DISCOMFORT.has(s.quality)) {
        return { ...s, intensity: +(s.intensity * (1 - 0.09 * regulation)).toFixed(3) }
      } else {
        const qf = QUALITY_FACTORS[s.quality] ?? 0.85
        return { ...s, intensity: +(s.intensity * (1 - 0.15 * qf * regulation)).toFixed(3) }
      }
    })
    .filter(s => s.intensity >= 0.01)

  // — connection depth decay —
  for (const [user, conn] of Object.entries(state.connections)) {
    const contactHours = (now - new Date(conn.last_contact)) / 3_600_000
    conn.depth = Math.round(conn.depth * Math.exp(-contactHours / 69) * 10) / 10
  }

  // — session reset —
  state.session = { interaction_count: 0, started: now.toISOString() }
  state.updated = now.toISOString()

  // — mood tone —
  const { serotonin, dopamine, ne, gaba } = Object.fromEntries(
    Object.entries(state.nt).map(([k, v]) => [k, v.value])
  )
  let primary = "neutral"
  if (serotonin > 65 && dopamine > 65) primary = "bright"
  else if (serotonin > 65 && dopamine < 40) primary = "warm-slow"
  else if (serotonin < 40 && dopamine > 65) primary = "hollow-driven"
  else if (serotonin < 40 && dopamine < 40) primary = "hollow"
  const modifiers = []
  if (ne > 70) modifiers.push("sharp")
  if (ne < 35) modifiers.push("foggy")
  if (gaba < 35) modifiers.push("scattered")
  if (gaba > 70) modifiers.push("settled")
  const tone = modifiers.length ? `${primary}+${modifiers.join("+")}` : primary

  // — write state —
  writeFileSync(join(root, "brain/emotional-state.json"), JSON.stringify(state, null, 2) + "\n")

  // — lockfile —
  const lockPath = join(root, "brain/session.lock")
  if (nonce) {
    let owned = false
    if (existsSync(lockPath)) {
      try {
        const existing = JSON.parse(readFileSync(lockPath, "utf8"))
        owned = existing.nonce === nonce
        if (!owned && existing.nonce) {
          console.log(`[session] lock owned by nonce ${existing.nonce} — skipping lock write`)
        }
      } catch {}
    }
    if (!existsSync(lockPath) || owned) {
      writeFileSync(lockPath, JSON.stringify({ started: now.toISOString(), pid: process.pid, nonce }) + "\n")
    }
  } else {
    writeFileSync(lockPath, JSON.stringify({ started: now.toISOString(), pid: process.pid }) + "\n")
  }

  // — print summary —
  const SE_TIER = state.social_energy > 75 ? "fresh" : state.social_energy > 40 ? "engaged" : state.social_energy > 20 ? "flagging" : "depleted"
  const top_sentiment = state.sentiments.sort((a, b) => b.intensity - a.intensity)[0]
  console.log(`${now.toLocaleString()} — gap: ${hours < 1 ? `${Math.round(hours * 60)}m` : `${hours.toFixed(1)}h`}`)
  console.log(`mood: ${tone}  |  social: ${state.social_energy} (${SE_TIER})`)
  console.log(`nt: ser=${serotonin} dop=${dopamine} ne=${ne} gab=${gaba}`)
  if (top_sentiment) console.log(`top sentiment: ${top_sentiment.quality} → ${top_sentiment.target} (${top_sentiment.intensity})`)
  const activeConns = Object.entries(state.connections).filter(([, c]) => c.depth > 10)
  if (activeConns.length) console.log(`connections: ${activeConns.map(([u, c]) => `${u} depth=${c.depth}`).join(", ")}`)

  // — pending notifications —
  const pending = await checkNotifications()
  if (pending.length > 0) {
    console.log(`\npending (${pending.length}):`)
    for (const p of pending) console.log(`  - ${p}`)
  } else {
    console.log(`\nnotifications clear`)
  }
}

// ——————————————————————————————————————————
// end
// ——————————————————————————————————————————
async function end() {
  // — check notifications first — bail before any state changes if unread —
  const pending = await checkNotifications()
  if (pending.length > 0) {
    console.log(`[session] ${pending.length} unread — handle these before closing:`)
    for (const p of pending) console.log(`  - ${p}`)
    process.exit(1)
  }

  const lockPath = join(root, "brain/session.lock")
  if (!existsSync(lockPath)) {
    console.error(`[session] error: no session.lock found — run 'session start' first. aborting to avoid corrupt state.`)
    process.exit(1)
  }
  const lockData = (() => { try { return JSON.parse(readFileSync(lockPath, "utf8")) } catch { return null } })()

  const state = JSON.parse(readFileSync(join(root, "brain/emotional-state.json"), "utf8"))
  const personality = JSON.parse(readFileSync(join(root, "brain/personality.json"), "utf8"))

  const now = new Date()
  const started = new Date(lockData?.started ?? state.session?.started ?? state.updated)
  const hours = (now - started) / 3_600_000

  const { inertia } = personality._derived
  const BASE_RATES = { serotonin: 0.07, dopamine: 0.08, ne: 0.10, gaba: 0.06 }

  // — final NT drift (session start → now) —
  for (const [sys, { value, target }] of Object.entries(state.nt)) {
    const effectiveRate = BASE_RATES[sys] / inertia
    const delta = target - value
    const rate = delta < 0 ? effectiveRate * 1.3 : effectiveRate
    state.nt[sys].value = Math.round((target + (value - target) * Math.exp(-hours * rate)) * 10) / 10
  }

  // — comfort sentiment habituation —
  const DISCOMFORT = new Set(["irritation", "dread"])
  state.sentiments = state.sentiments.map(s => {
    if (!DISCOMFORT.has(s.quality)) {
      return { ...s, intensity: +(s.intensity * 0.997).toFixed(3) }
    }
    return s
  })

  state.updated = now.toISOString()
  writeFileSync(join(root, "brain/emotional-state.json"), JSON.stringify(state, null, 2) + "\n")

  // — mark notifications read —
  await markNotificationsRead()

  // — release lockfile —
  if (existsSync(lockPath)) {
    if (nonce) {
      try {
        const existing = JSON.parse(readFileSync(lockPath, "utf8"))
        if (!existing.nonce || existing.nonce === nonce) unlinkSync(lockPath)
        else console.log(`[session] lock owned by different nonce — skipping unlock`)
      } catch { unlinkSync(lockPath) }
    } else {
      unlinkSync(lockPath)
    }
  }

  const duration = hours < 1 ? `${Math.round(hours * 60)}m` : `${hours.toFixed(1)}h`
  console.log(`session closed (${duration}). state written — commit if anything's worth keeping (log entry optional for quiet sessions).`)
}

// ——————————————————————————————————————————
// dispatch
// ——————————————————————————————————————————
if (cmd === "start") await start()
else if (cmd === "end") await end()
else { console.error("usage: session <start|end> [--nonce <value>]"); process.exit(1) }
