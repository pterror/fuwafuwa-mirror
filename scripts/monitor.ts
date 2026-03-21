#!/usr/bin/env bun
// monitor.ts — monitor active claude sessions and resources
//
// usage:
//   monitor              — show active sessions, resource usage, and recent history

import { readdirSync, readFileSync, statSync, readlinkSync } from "fs"
import { join } from "path"

const PROJECTS_DIR = "/home/me/.claude/projects/"
const TMP_DIR = "/tmp/claude-1000/"
const GIT_ROOT = "/home/me/git/"

interface ActiveSession {
  pid: string
  cwd: string
  projectPath: string | null
  lastJsonl: string | null
  lastWrite: Date | null
  statusType: "ACTIVE" | "IDLE" | "ZOMBIE"
  statusMessage: string
  subagents: SubAgentStatus[]
}

interface SubAgentStatus {
  id: string
  lastWrite: Date
  status: string
  path: string
}

interface BackgroundTask {
  project: string
  id: string
  mtime: Date
  contentSnippet: string
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
        projectSlug = cwd.split("/").filter(Boolean).join("-")
      }
      
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
              .filter(s => Date.now() - s.mtime.getTime() < 60 * 60 * 1000)

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

      let statusType: "ACTIVE" | "IDLE" | "ZOMBIE" = "ACTIVE"
      if (lastWrite) {
        const age = Date.now() - lastWrite.getTime()
        if (age > 20 * 60 * 1000) statusType = "ZOMBIE"
        else if (age > 5 * 60 * 1000) statusType = "IDLE"
      } else {
        statusType = "ZOMBIE" // No logs found
      }

      const statusMessage = lastJsonl ? getStatusFromLog(lastJsonl) : "no log found"

      sessions.push({
        pid,
        cwd,
        projectPath: possibleProjectDirs[0] || null,
        lastJsonl,
        lastWrite,
        statusType,
        statusMessage,
        subagents
      })
    } catch (e) {
      // Process ended or permission denied
    }
  }

  return sessions
}

async function getBackgroundTasks(): Promise<BackgroundTask[]> {
  const tasks: BackgroundTask[] = []
  try {
    const projects = readdirSync(TMP_DIR)
    for (const p of projects) {
      const tasksDir = join(TMP_DIR, p, "tasks")
      try {
        if (statSync(tasksDir).isDirectory()) {
          const files = readdirSync(tasksDir).filter(f => f.endsWith(".output"))
          for (const f of files) {
            const path = join(tasksDir, f)
            const mtime = statSync(path).mtime
            // Only show recent tasks (last 24h)
            if (Date.now() - mtime.getTime() < 24 * 60 * 60 * 1000) {
              let contentSnippet = ""
              try {
                const content = readFileSync(path, "utf8")
                contentSnippet = content.slice(-80).replace(/\n/g, " ")
              } catch {}
              tasks.push({
                project: p.replace("-home-me-git-", "").replace("rhizone-", ""),
                id: f.replace(".output", ""),
                mtime,
                contentSnippet
              })
            }
          }
        }
      } catch {}
    }
  } catch {}
  return tasks.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
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
  const backgroundTasks = await getBackgroundTasks()
  const mem = await getMemoryUsage()

  console.log(`memory: ${mem.used}MB / ${mem.total}MB used (${mem.available}MB available)\n`)

  if (sessions.length === 0) {
    console.log("no active interactive sessions.")
  } else {
    console.log("interactive sessions:")
    for (const s of sessions) {
      const lastUpdate = s.lastWrite ? s.lastWrite.toLocaleTimeString() : "unknown"
      let icon = "✅"
      if (s.statusType === "IDLE") icon = "⏳"
      if (s.statusType === "ZOMBIE") icon = "🧟"
      
      console.log(`  [${s.pid}] ${s.cwd.replace(GIT_ROOT, "")}`)
      console.log(`     ${icon} ${s.statusType} (${lastUpdate}) — ${s.statusMessage}`)
      
      if (s.subagents.length > 0) {
        console.log(`     ↳ subagents:`)
        for (const sub of s.subagents) {
          console.log(`       • ${sub.lastWrite.toLocaleTimeString()} — ${sub.status}`)
        }
      }
      
      if (s.statusType === "ZOMBIE") {
        console.log(`     path: ${s.lastJsonl}`)
      }
      console.log()
    }
  }

  if (backgroundTasks.length > 0) {
    console.log("background tasks (headless):")
    for (const t of backgroundTasks) {
      console.log(`  [${t.project}] ${t.id} (${t.mtime.toLocaleTimeString()})`)
      console.log(`     ↳ ...${t.contentSnippet}`)
    }
    console.log()
  }

  // Also show recent global history
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
