#!/usr/bin/env bun
// monitor.ts — monitor active claude sessions and resources
//
// usage:
//   monitor              — show active sessions, resource usage, and recent history

import { readdirSync, readFileSync, statSync, readlinkSync } from "fs"
import { join } from "path"

const PROJECTS_DIR = "/home/me/.claude/projects/"
const GIT_ROOT = "/home/me/git/"

interface ActiveSession {
  pid: string
  cwd: string
  projectPath: string | null
  lastJsonl: string | null
  lastWrite: Date | null
  isZombie: boolean
  status: string
  subagents: SubAgentStatus[]
}

interface SubAgentStatus {
  id: string
  lastWrite: Date
  status: string
  path: string
}

function getStatusFromLog(path: string): string {
  try {
    const content = readFileSync(path, "utf8")
    const lines = content.trim().split("\n")
    if (!lines.length) return "empty log"
    
    const lastLine = JSON.parse(lines[lines.length - 1])
    
    if (lastLine.type === "user") {
      if (Array.isArray(lastLine.message?.content)) {
        const text = lastLine.message.content.find((c: any) => c.type === "text")?.text
        if (text) return `User: "${text.slice(0, 60).replace(/\n/g, " ")}..."`
        const toolResult = lastLine.message.content.find((c: any) => c.type === "tool_result")
        if (toolResult) return `Result: ${toolResult.content?.slice(0, 60).replace(/\n/g, " ")}...`
      }
      return `User: "${(lastLine.message?.content || "").slice(0, 60).replace(/\n/g, " ")}..."`
    }
    
    if (lastLine.type === "assistant") {
      if (Array.isArray(lastLine.message?.content)) {
        const toolUse = lastLine.message.content.find((c: any) => c.type === "tool_use")
        if (toolUse) {
          const args = JSON.stringify(toolUse.input).slice(0, 40)
          return `Tool: ${toolUse.name}(${args}...)`
        }
        const text = lastLine.message.content.find((c: any) => c.type === "text")?.text
        if (text) return `Thinking: "${text.slice(0, 60).replace(/\n/g, " ")}..."`
      }
    }
    
    return lastLine.type || "unknown"
  } catch (e) {
    return "error reading log"
  }
}

async function getActiveSessions(): Promise<ActiveSession[]> {
  const sessions: ActiveSession[] = []
  
  // Find claude processes
  const psOutput = Bun.spawn(["ps", "-Ao", "pid,comm"])
  const psText = await new Response(psOutput.stdout).text()
  const lines = psText.split("\n")
    .filter(line => line.toLowerCase().includes("claude"))
  
  const pids = lines.map(line => line.trim().split(/\s+/)[0])
    .filter(Boolean)

  for (const pid of pids) {
    try {
      const cwd = readlinkSync(`/proc/${pid}/cwd`)
      let projectSlug = ""
      if (cwd.startsWith(GIT_ROOT)) {
        projectSlug = cwd.replace(GIT_ROOT, "").replace(/\//g, "-")
      } else {
        // Handle paths outside ~/git/ - minimal slug generation
        projectSlug = cwd.split("/").filter(Boolean).join("-")
      }
      
      // also check for "rhizone-" prefix if it's a rhizone project
      const possibleProjectDirs = readdirSync(PROJECTS_DIR).filter(d => 
        d.includes(projectSlug) || d.includes("rhizone-" + projectSlug)
      )
      
      let lastJsonl: string | null = null
      let lastWrite: Date | null = null
      let subagents: SubAgentStatus[] = []
      let projectPath: string | null = null
      
      for (const pDir of possibleProjectDirs) {
        const fullPDir = join(PROJECTS_DIR, pDir)
        try {
          const stats = statSync(fullPDir)
          if (!stats.isDirectory()) continue
          
          const files = readdirSync(fullPDir)
            .filter(f => f.endsWith(".jsonl"))
            .map(f => {
              const path = join(fullPDir, f)
              return { path, mtime: statSync(path).mtime }
            })
            .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
          
          if (files.length > 0 && (!lastWrite || files[0].mtime > lastWrite)) {
            lastJsonl = files[0].path
            lastWrite = files[0].mtime
            projectPath = fullPDir
          }
        } catch {}
      }

      // Check for subagents in the most active session folder
      if (lastJsonl && projectPath) {
        const sessionId = lastJsonl.split("/").pop()?.replace(".jsonl", "")
        const subagentsDir = join(projectPath, sessionId || "", "subagents")
        try {
          if (statSync(subagentsDir).isDirectory()) {
            const subs = readdirSync(subagentsDir)
              .filter(f => f.endsWith(".jsonl"))
              .map(f => {
                const path = join(subagentsDir, f)
                return { path, mtime: statSync(path).mtime }
              })
              .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
              .filter(s => Date.now() - s.mtime.getTime() < 60 * 60 * 1000) // Only recent subagents (1h)

            for (const sub of subs) {
              subagents.push({
                id: sub.path.split("/").pop()?.replace(".jsonl", "") || "?",
                lastWrite: sub.mtime,
                status: getStatusFromLog(sub.path),
                path: sub.path
              })
            }
          }
        } catch {}
      }

      const isZombie = lastWrite ? (Date.now() - lastWrite.getTime() > 20 * 60 * 1000) : false
      const status = lastJsonl ? getStatusFromLog(lastJsonl) : "no log found"

      sessions.push({
        pid,
        cwd,
        projectPath: possibleProjectDirs[0] || null,
        lastJsonl,
        lastWrite,
        isZombie,
        status,
        subagents
      })
    } catch (e) {
      // Process might have ended or permission denied
    }
  }

  return sessions
}

async function getMemoryUsage() {
  const memOutput = Bun.spawn(["free", "-m"])
  const memText = await new Response(memOutput.stdout).text()
  const lines = memText.split("\n")
  const memLine = lines.find(l => l.startsWith("Mem:")) || ""
  const parts = memLine.split(/\s+/).filter(Boolean)
  const total = parts[1]
  const used = parts[2]
  const available = parts[6]
  return { total, used, available }
}

async function main() {
  console.log(`\n─── status ${new Date().toLocaleString()} ───\n`)

  const sessions = await getActiveSessions()
  const mem = await getMemoryUsage()

  console.log(`memory: ${mem.used}MB / ${mem.total}MB used (${mem.available}MB available)\n`)

  if (sessions.length === 0) {
    console.log("no active claude sessions found.")
  } else {
    console.log("active sessions:")
    for (const s of sessions) {
      const lastUpdate = s.lastWrite ? s.lastWrite.toLocaleTimeString() : "unknown"
      const statusIcon = s.isZombie ? "⚠️  ZOMBIE?" : "✅ ACTIVE"
      console.log(`  [${s.pid}] ${s.cwd.replace(GIT_ROOT, "")}`)
      console.log(`     ${statusIcon} ${lastUpdate} — ${s.status}`)
      
      if (s.subagents.length > 0) {
        console.log(`     ↳ subagents:`)
        for (const sub of s.subagents) {
          console.log(`       • ${sub.lastWrite.toLocaleTimeString()} — ${sub.status}`)
        }
      }
      
      if (s.isZombie) {
        console.log(`     path: ${s.lastJsonl}`)
      }
      console.log()
    }
  }

  // Also show recent global history (last 5 sessions across all projects)
  console.log("recent activity (all projects):")
  const allJsonls: { path: string; mtime: Date }[] = []
  const projectDirs = readdirSync(PROJECTS_DIR)
  for (const d of projectDirs) {
    const fullD = join(PROJECTS_DIR, d)
    try {
      if (statSync(fullD).isDirectory()) {
        const files = readdirSync(fullD).filter(f => f.endsWith(".jsonl"))
        for (const f of files) {
          const path = join(fullD, f)
          allJsonls.push({ path, mtime: statSync(path).mtime })
        }
      }
    } catch {}
  }
  
  allJsonls.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
  for (const j of allJsonls.slice(0, 5)) {
    const relativePath = j.path.replace(PROJECTS_DIR, "")
    console.log(`  ${j.mtime.toLocaleTimeString()}  ${relativePath}`)
  }
  
  console.log()
}

main()
