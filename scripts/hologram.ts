#!/usr/bin/env bun
/**
 * hologram.ts — CLI for the Hologram API (localhost:3000)
 *
 * Usage:
 *   bun scripts/hologram.ts list [--q <name>]
 *   bun scripts/hologram.ts get <id>
 *   bun scripts/hologram.ts create <name> [--owner <discord-user-id>]
 *   bun scripts/hologram.ts facts <id>
 *   bun scripts/hologram.ts add-fact <id> <content>
 *   bun scripts/hologram.ts config <id>
 *   bun scripts/hologram.ts set-config <id> <key=value> [<key=value> ...]
 *   bun scripts/hologram.ts import-st <charName>  # import from SillyTavern
 */

const BASE = "http://localhost:3000";

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json() as { ok: boolean; data?: unknown; error?: string };
  if (!json.ok) throw new Error(`API error: ${json.error}`);
  return json.data;
}

const commands: Record<string, (args: string[]) => Promise<void>> = {
  async list(args) {
    const q = args.includes("--q") ? args[args.indexOf("--q") + 1] : undefined;
    const params = new URLSearchParams({ limit: "100" });
    if (q) params.set("q", q);
    const data = await api("GET", `/api/entities?${params}`) as { id: number; name: string; owned_by: string | null }[];
    for (const e of data) {
      console.log(`${String(e.id).padStart(4)}  ${e.name}${e.owned_by ? `  [owner:${e.owned_by}]` : ""}`);
    }
    console.log(`\n${data.length} entities`);
  },

  async get(args) {
    const id = args[0];
    if (!id) { console.error("usage: get <id>"); process.exit(1); }
    const e = await api("GET", `/api/entities/${id}`) as Record<string, unknown>;
    const facts = (e.facts as { id: number; content: string }[]) ?? [];
    delete e.facts;
    console.log(`=== ${e.name} (id:${e.id}) ===`);
    console.log(`owned_by: ${e.owned_by ?? "(none)"}`);
    console.log(`model:    ${e.config_model ?? "(default)"}`);
    console.log(`avatar:   ${e.config_avatar ?? "(none)"}`);
    console.log(`context:  ${e.config_context ?? "(always)"}`);
    console.log(`respond:  ${e.config_respond ?? "(default)"}`);
    console.log(`keywords: ${e.config_keywords ?? "(none)"}`);
    console.log(`\nfacts (${facts.length}):`);
    for (const f of facts) {
      const preview = f.content.length > 120 ? f.content.slice(0, 120) + "…" : f.content;
      console.log(`  [${f.id}] ${preview}`);
    }
  },

  async create(args) {
    const name = args[0];
    if (!name) { console.error("usage: create <name> [--owner <id>]"); process.exit(1); }
    const ownerIdx = args.indexOf("--owner");
    const owned_by = ownerIdx !== -1 ? args[ownerIdx + 1] : null;
    const e = await api("POST", "/api/entities", { name, owned_by }) as { id: number; name: string };
    console.log(`created entity ${e.id}: ${e.name}`);
  },

  async facts(args) {
    const id = args[0];
    if (!id) { console.error("usage: facts <id>"); process.exit(1); }
    const facts = await api("GET", `/api/entities/${id}/facts`) as { id: number; content: string }[];
    for (const f of facts) console.log(`[${f.id}] ${f.content}`);
    console.log(`\n${facts.length} facts`);
  },

  async "add-fact"(args) {
    const [id, ...rest] = args;
    const content = rest.join(" ");
    if (!id || !content) { console.error("usage: add-fact <id> <content>"); process.exit(1); }
    const f = await api("POST", `/api/entities/${id}/facts`, { content }) as { id: number };
    console.log(`added fact ${f.id}`);
  },

  async config(args) {
    const id = args[0];
    if (!id) { console.error("usage: config <id>"); process.exit(1); }
    const c = await api("GET", `/api/entities/${id}/config`) as Record<string, unknown>;
    for (const [k, v] of Object.entries(c)) {
      if (v !== null) console.log(`${k}: ${v}`);
    }
  },

  async "set-config"(args) {
    const [id, ...pairs] = args;
    if (!id || !pairs.length) { console.error("usage: set-config <id> <key=value> ..."); process.exit(1); }
    const patch: Record<string, string | null> = {};
    for (const pair of pairs) {
      const eq = pair.indexOf("=");
      if (eq === -1) { console.error(`bad pair: ${pair}`); process.exit(1); }
      const key = pair.slice(0, eq);
      const val = pair.slice(eq + 1);
      patch[key] = val === "null" ? null : val;
    }
    await api("PATCH", `/api/entities/${id}/config`, patch);
    console.log("config updated");
  },

  async "import-st"(args) {
    const charGlob = args[0];
    if (!charGlob) { console.error("usage: import-st <charName>"); process.exit(1); }
    const stDir = "/mnt/ssd/ai/SillyTavern/data/default-user/characters";
    const { readdirSync, readFileSync } = await import("fs");

    // find matching PNG (PascalCase, possible glob)
    const files = readdirSync(stDir);
    const pattern = charGlob.toLowerCase();
    const matches = files.filter(f =>
      f.toLowerCase().startsWith(pattern) && f.endsWith(".png")
    );
    if (!matches.length) {
      console.error(`no SillyTavern character found matching: ${charGlob}`);
      console.error(`available (sample): ${files.slice(0, 10).join(", ")}`);
      process.exit(1);
    }

    const file = matches[0];
    console.log(`reading ${file}…`);
    const buf = readFileSync(`${stDir}/${file}`);

    // extract chara tEXt chunk (base64-encoded JSON)
    const binary = buf.toString("binary");
    const charaIdx = binary.indexOf("chara\0");
    if (charaIdx === -1) throw new Error("no chara chunk in PNG");
    let end = charaIdx + 6;
    while (end < buf.length && buf[end] >= 32 && buf[end] <= 126) end++;
    const b64 = binary.slice(charaIdx + 6, end);
    const card = JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as {
      spec?: string;
      data?: {
        name: string;
        description?: string;
        personality?: string;
        scenario?: string;
        first_mes?: string;
        system_prompt?: string;
        post_history_instructions?: string;
      };
      // v1 fallback
      name?: string;
      description?: string;
      personality?: string;
    };

    const d = card.data ?? card; // v1 fallback
    const name = (d as { name: string }).name;
    console.log(`character: ${name}`);

    const entity = await api("POST", "/api/entities", { name, owned_by: null }) as { id: number; name: string };
    console.log(`created entity ${entity.id}`);

    // add facts from card fields
    const factSources = [
      d.description && `description: ${d.description}`,
      (d as { personality?: string }).personality && `personality: ${(d as { personality?: string }).personality}`,
      (d as { scenario?: string }).scenario && `scenario: ${(d as { scenario?: string }).scenario}`,
    ].filter(Boolean) as string[];

    for (const content of factSources) {
      const f = await api("POST", `/api/entities/${entity.id}/facts`, { content }) as { id: number };
      console.log(`  added fact ${f.id} (${content.slice(0, 60)}…)`);
    }

    // set avatar to a local file URL
    const avatarPath = `file://${stDir}/${file}`;
    await api("PATCH", `/api/entities/${entity.id}/config`, { config_avatar: avatarPath });
    console.log(`set avatar: ${avatarPath}`);
    console.log(`\ndone — entity ${entity.id}: ${name}`);
  },
};

const [cmd, ...rest] = process.argv.slice(2);

if (!cmd || !commands[cmd]) {
  console.log("hologram.ts — Hologram API CLI");
  console.log("");
  console.log("commands:");
  console.log("  list [--q <name>]              list entities");
  console.log("  get <id>                        get entity + facts");
  console.log("  create <name> [--owner <id>]   create entity");
  console.log("  facts <id>                      list facts");
  console.log("  add-fact <id> <content>         add a fact");
  console.log("  config <id>                     show config");
  console.log("  set-config <id> key=val ...     patch config");
  console.log("  import-st <charName>            import SillyTavern character");
  process.exit(cmd ? 1 : 0);
}

commands[cmd](rest).catch(e => { console.error(e.message); process.exit(1); });
