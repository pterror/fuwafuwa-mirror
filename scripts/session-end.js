#!/usr/bin/env bun
// session-end.js — compute final NT values, apply sentiment habituation, write state

import { readFileSync, writeFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const state = JSON.parse(readFileSync(join(root, "brain/emotional-state.json"), "utf8"))
const personality = JSON.parse(readFileSync(join(root, "brain/personality.json"), "utf8"))

const now = new Date()
const started = new Date(state.session?.started ?? state.updated)
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

// — comfort sentiment habituation (activated this session) —
// light per-session habituation on all comfort sentiments present
const DISCOMFORT = new Set(["irritation", "dread"])
state.sentiments = state.sentiments.map(s => {
  if (!DISCOMFORT.has(s.quality)) {
    return { ...s, intensity: +(s.intensity * 0.997).toFixed(3) }
  }
  return s
})

state.updated = now.toISOString()
writeFileSync(join(root, "brain/emotional-state.json"), JSON.stringify(state, null, 2) + "\n")

import { unlinkSync, existsSync } from "fs"
const lockPath = join(root, "brain/session.lock")
if (existsSync(lockPath)) unlinkSync(lockPath)

const duration = hours < 1 ? `${Math.round(hours * 60)}m` : `${hours.toFixed(1)}h`
console.log(`session closed (${duration}). state written — commit with the session log.`)
