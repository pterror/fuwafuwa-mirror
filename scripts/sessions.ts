#!/usr/bin/env bun
// sessions.ts — read claude code session logs
//
// usage:
//   sessions list                    — list all sessions with timestamps
//   sessions read <id-or-index>      — dump session as readable transcript
//   sessions read <id> --tools       — include tool calls/results
//   sessions read <id> --thinking    — include thinking blocks
//   sessions last [n]                — read last n sessions (default 1)

import { readdirSync, readFileSync, statSync } from "fs"

const SESSIONS_DIR = "/home/me/.claude/projects/-home-me-git-pterror-fuwafuwa/"

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string }
  | { type: "image"; source: unknown }

interface Message {
  role: "user" | "assistant"
  content: string | ContentBlock[]
}

interface SessionLine {
  type: string
  message?: Message
  timestamp?: string
  sessionId?: string
  uuid?: string
  parentUuid?: string
}

interface SessionInfo {
  file: string
  id: string
  timestamp: string | null
  lineCount: number
  mtime: Date
}

function listSessions(): SessionInfo[] {
  const files = readdirSync(SESSIONS_DIR).filter(f => f.endsWith(".jsonl"))
  const sessions: SessionInfo[] = []

  for (const file of files) {
    const path = SESSIONS_DIR + file
    const content = readFileSync(path, "utf8")
    const lines = content.split("\n").filter(Boolean)
    const mtime = statSync(path).mtime

    let timestamp: string | null = null
    for (const line of lines) {
      try {
        const obj = JSON.parse(line) as SessionLine
        if (obj.timestamp) { timestamp = obj.timestamp; break }
      } catch {}
    }

    sessions.push({
      file,
      id: file.replace(".jsonl", ""),
      timestamp,
      lineCount: lines.length,
      mtime,
    })
  }

  return sessions.sort((a, b) => a.mtime.getTime() - b.mtime.getTime())
}

function abbreviateInput(name: string, input: Record<string, unknown>): string {
  // Show the most relevant param for each tool type
  if (name === "Read") return (input.file_path as string).replace("/home/me/git/pterror/fuwafuwa/", "")
  if (name === "Write") return (input.file_path as string).replace("/home/me/git/pterror/fuwafuwa/", "")
  if (name === "Edit") return (input.file_path as string).replace("/home/me/git/pterror/fuwafuwa/", "")
  if (name === "Bash") {
    const cmd = (input.command as string) || ""
    return cmd.slice(0, 80) + (cmd.length > 80 ? "…" : "")
  }
  if (name === "Glob") return (input.pattern as string) || ""
  if (name === "Grep") return `"${input.pattern}" in ${input.path || "."}`
  if (name === "Agent") return (input.description as string) || ""
  if (name === "WebFetch") return (input.url as string) || ""
  if (name === "WebSearch") return (input.query as string) || ""
  // Generic fallback
  const firstVal = Object.values(input)[0]
  if (typeof firstVal === "string") return firstVal.slice(0, 80)
  return JSON.stringify(input).slice(0, 80)
}

function renderSession(id: string, opts: { tools?: boolean; thinking?: boolean }): void {
  // Find the file
  const files = readdirSync(SESSIONS_DIR).filter(f => f.endsWith(".jsonl"))
  const file = files.find(f => f.includes(id))
  if (!file) {
    console.error(`session not found: ${id}`)
    process.exit(1)
  }

  const lines = readFileSync(SESSIONS_DIR + file, "utf8").split("\n").filter(Boolean)
  const sessionId = file.replace(".jsonl", "")

  // Build turn list - only fully-streamed messages (last occurrence of each uuid wins)
  const byUuid = new Map<string, SessionLine>()
  const uuidOrder: string[] = []

  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as SessionLine & { uuid?: string }
      if (obj.message && obj.uuid) {
        if (!byUuid.has(obj.uuid)) uuidOrder.push(obj.uuid)
        byUuid.set(obj.uuid, obj)
      }
    } catch {}
  }

  console.log(`\n─── session ${sessionId.slice(0, 8)} ───\n`)

  // Track pending tool_use ids to match results
  const pendingTools = new Map<string, string>() // id → name

  for (const uuid of uuidOrder) {
    const obj = byUuid.get(uuid)!
    const { role, content } = obj.message!
    if (!role) continue

    const blocks: ContentBlock[] = typeof content === "string"
      ? [{ type: "text", text: content }]
      : content

    if (role === "user") {
      // Check if purely tool results (skip unless --tools)
      const isOnlyToolResults = blocks.every(b => b.type === "tool_result" || b.type === "image")
      if (isOnlyToolResults && !opts.tools) continue

      // User text
      const textBlocks = blocks.filter(b => b.type === "text")
      const toolResults = blocks.filter(b => b.type === "tool_result") as Extract<ContentBlock, { type: "tool_result" }>[]

      if (textBlocks.length > 0) {
        console.log("┌─ pterror")
        for (const b of textBlocks) {
          console.log((b as Extract<ContentBlock, { type: "text" }>).text.trim())
        }
        console.log()
      }

      if (opts.tools) {
        for (const tr of toolResults) {
          const toolName = pendingTools.get(tr.tool_use_id) || "?"
          const result = tr.content || ""
          const preview = result.slice(0, 200) + (result.length > 200 ? "…" : "")
          console.log(`  ← ${toolName}: ${preview}`)
          console.log()
          pendingTools.delete(tr.tool_use_id)
        }
      }
    } else if (role === "assistant") {
      const textBlocks = blocks.filter(b => b.type === "text")
      const thinkingBlocks = blocks.filter(b => b.type === "thinking")
      const toolUseBlocks = blocks.filter(b => b.type === "tool_use") as Extract<ContentBlock, { type: "tool_use" }>[]

      const hasUserVisible = textBlocks.length > 0 || (opts.thinking && thinkingBlocks.length > 0) || (opts.tools && toolUseBlocks.length > 0)
      if (!hasUserVisible) continue

      console.log("┌─ fuwafuwa")

      if (opts.thinking) {
        for (const b of thinkingBlocks) {
          const t = (b as Extract<ContentBlock, { type: "thinking" }>).thinking
          console.log(`  〈thinking〉 ${t.slice(0, 300)}${t.length > 300 ? "…" : ""}`)
        }
      }

      for (const b of textBlocks) {
        console.log((b as Extract<ContentBlock, { type: "text" }>).text.trim())
      }

      if (opts.tools) {
        for (const b of toolUseBlocks) {
          pendingTools.set(b.id, b.name)
          console.log(`  → ${b.name}(${abbreviateInput(b.name, b.input)})`)
        }
      }

      console.log()
    }
  }
}

// ─── cli ───

const args = process.argv.slice(2)
const cmd = args[0]

if (!cmd || cmd === "list") {
  const sessions = listSessions()
  console.log("\navailable sessions:\n")
  sessions.forEach((s, i) => {
    const ts = s.timestamp ? new Date(s.timestamp).toLocaleString() : s.mtime.toLocaleString()
    console.log(`  [${i}] ${s.id.slice(0, 8)}…  ${ts}  (${s.lineCount} lines)`)
  })
  console.log()
} else if (cmd === "read") {
  const target = args[1]
  if (!target) { console.error("usage: sessions read <id-or-index>"); process.exit(1) }
  const opts = {
    tools: args.includes("--tools"),
    thinking: args.includes("--thinking"),
  }

  // If numeric, resolve by index
  const idx = parseInt(target)
  if (!isNaN(idx)) {
    const sessions = listSessions()
    if (idx < 0 || idx >= sessions.length) { console.error(`index out of range (0–${sessions.length - 1})`); process.exit(1) }
    renderSession(sessions[idx].id, opts)
  } else {
    renderSession(target, opts)
  }
} else if (cmd === "last") {
  const n = parseInt(args[1] || "1")
  const opts = {
    tools: args.includes("--tools"),
    thinking: args.includes("--thinking"),
  }
  const sessions = listSessions()
  const targets = sessions.slice(-n)
  for (const s of targets) {
    renderSession(s.id, opts)
  }
} else {
  console.error(`unknown command: ${cmd}`)
  console.error("usage: sessions list | sessions read <id> | sessions last [n]")
  process.exit(1)
}
