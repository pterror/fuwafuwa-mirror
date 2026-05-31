#!/usr/bin/env bun
// install-hooks.ts — idempotent git hook installer.
//
// Sets core.hooksPath to .githooks (the tracked hooks directory) in the
// local repo config. Safe to run repeatedly — only logs if it had to change
// something. Run once after a fresh clone to re-apply hook wiring.

import { execSync } from "child_process"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

const current = (() => {
  try {
    return execSync("git config --local core.hooksPath", { cwd: root, encoding: "utf8" }).trim()
  } catch {
    return null
  }
})()

if (current === ".githooks") {
  // already correct — silent on the happy path
} else {
  execSync("git config core.hooksPath .githooks", { cwd: root })
  console.log(`[install-hooks] core.hooksPath set to .githooks (was: ${current ?? "(unset)"})`)
}
