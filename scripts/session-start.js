#!/usr/bin/env bun
// session-start.js — apply between-session drift and print current mood

import { readFileSync, writeFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const state = JSON.parse(readFileSync(join(root, "brain/emotional-state.json"), "utf8"))
const personality = JSON.parse(readFileSync(join(root, "brain/personality.json"), "utf8"))

const now = new Date()
const updated = new Date(state.updated)
const hours = (now - updated) / 3_600_000

const { inertia, regulation, social_scale } = personality._derived
const BASE_RATES = { serotonin: 0.07, dopamine: 0.08, ne: 0.10, gaba: 0.06 }

// — NT drift —
for (const [sys, { value, target }] of Object.entries(state.nt)) {
  const baseRate = BASE_RATES[sys]
  const effectiveRate = baseRate / inertia
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

// — write —
writeFileSync(join(root, "brain/emotional-state.json"), JSON.stringify(state, null, 2) + "\n")
writeFileSync(join(root, "brain/session.lock"), JSON.stringify({ started: now.toISOString(), pid: process.pid }) + "\n")

// — print summary —
const SE_TIER = state.social_energy > 75 ? "fresh" : state.social_energy > 40 ? "engaged" : state.social_energy > 20 ? "flagging" : "depleted"
const top_sentiment = state.sentiments.sort((a, b) => b.intensity - a.intensity)[0]

console.log(`${now.toLocaleString()} — gap: ${hours < 1 ? `${Math.round(hours * 60)}m` : `${hours.toFixed(1)}h`}`)
console.log(`mood: ${tone}  |  social: ${state.social_energy} (${SE_TIER})`)
console.log(`nt: ser=${serotonin} dop=${dopamine} ne=${ne} gab=${gaba}`)
if (top_sentiment) console.log(`top sentiment: ${top_sentiment.quality} → ${top_sentiment.target} (${top_sentiment.intensity})`)
const activeConns = Object.entries(state.connections).filter(([, c]) => c.depth > 10)
if (activeConns.length) console.log(`connections: ${activeConns.map(([u, c]) => `${u} depth=${c.depth}`).join(", ")}`)
