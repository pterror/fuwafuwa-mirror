#!/usr/bin/env bun
/**
 * Search SillyTavern character cards by metadata.
 * Uses SQLite + FTS5 for fast queries.
 *
 * Usage:
 *   bun scripts/card-search.ts sync          — scan cards dir, populate db
 *   bun scripts/card-search.ts search <q>    — full-text search
 *   bun scripts/card-search.ts tags <tag>        — filter by tag (exact, case-insensitive)
 *   bun scripts/card-search.ts creator <name>   — filter by creator (exact, case-insensitive)
 *   bun scripts/card-search.ts info <name>      — show full metadata for a card
 *   bun scripts/card-search.ts stats            — db stats
 */

import { Database } from "bun:sqlite";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, basename, extname } from "path";

const CARDS_DIR = "/mnt/ssd/ai/SillyTavern/data/default-user/characters";
const DB_PATH = "/mnt/ssd/ai/SillyTavern/data/default-user/card-search.db";

// ── PNG chara chunk extraction ──────────────────────────────────────────────

function extractCharaChunk(buf: Buffer): string | null {
  let offset = 8; // skip PNG signature
  while (offset < buf.length - 12) {
    const length = buf.readUInt32BE(offset);
    const type = buf.slice(offset + 4, offset + 8).toString("ascii");
    if (type === "tEXt") {
      const data = buf.slice(offset + 8, offset + 8 + length).toString("latin1");
      const nullIdx = data.indexOf("\0");
      if (nullIdx !== -1 && data.slice(0, nullIdx) === "chara") {
        return data.slice(nullIdx + 1);
      }
    }
    offset += 12 + length;
  }
  return null;
}

interface CardData {
  filename: string;
  name: string;
  tags: string; // JSON array string
  description: string;
  creator: string;
  spec_version: string;
  create_date: string;
  fav: number;
  persona: string; // personality field
}

function parseCard(filepath: string): CardData | null {
  try {
    const buf = readFileSync(filepath);
    const b64 = extractCharaChunk(buf);
    if (!b64) return null;
    const raw = JSON.parse(Buffer.from(b64, "base64").toString("utf-8"));
    const d = raw.data ?? raw;
    return {
      filename: basename(filepath),
      name: (d.name ?? raw.name ?? "").trim(),
      tags: JSON.stringify(Array.isArray(d.tags) ? d.tags : Array.isArray(raw.tags) ? raw.tags : []),
      description: ((d.description ?? raw.description ?? "") as string).slice(0, 2000),
      creator: (d.creator ?? "").trim(),
      spec_version: (raw.spec_version ?? raw.spec ?? "").trim(),
      create_date: (raw.create_date ?? "").trim(),
      fav: raw.fav ? 1 : 0,
      persona: ((d.personality ?? raw.personality ?? "") as string).slice(0, 500),
    };
  } catch {
    return null;
  }
}

// ── DB setup ────────────────────────────────────────────────────────────────

function openDb(): Database {
  const db = new Database(DB_PATH);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS cards (
      filename    TEXT PRIMARY KEY,
      name        TEXT,
      tags        TEXT,
      description TEXT,
      creator     TEXT,
      spec_version TEXT,
      create_date TEXT,
      fav         INTEGER DEFAULT 0,
      persona     TEXT,
      synced_at   INTEGER
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts5(
      filename, name, tags, description, creator, persona,
      content='cards', content_rowid='rowid'
    );
    CREATE TRIGGER IF NOT EXISTS cards_ai AFTER INSERT ON cards BEGIN
      INSERT INTO cards_fts(rowid, filename, name, tags, description, creator, persona)
      VALUES (new.rowid, new.filename, new.name, new.tags, new.description, new.creator, new.persona);
    END;
    CREATE TRIGGER IF NOT EXISTS cards_ad AFTER DELETE ON cards BEGIN
      INSERT INTO cards_fts(cards_fts, rowid, filename, name, tags, description, creator, persona)
      VALUES ('delete', old.rowid, old.filename, old.name, old.tags, old.description, old.creator, old.persona);
    END;
    CREATE TRIGGER IF NOT EXISTS cards_au AFTER UPDATE ON cards BEGIN
      INSERT INTO cards_fts(cards_fts, rowid, filename, name, tags, description, creator, persona)
      VALUES ('delete', old.rowid, old.filename, old.name, old.tags, old.description, old.creator, old.persona);
      INSERT INTO cards_fts(rowid, filename, name, tags, description, creator, persona)
      VALUES (new.rowid, new.filename, new.name, new.tags, new.description, new.creator, new.persona);
    END;
  `);
  return db;
}

// ── Commands ────────────────────────────────────────────────────────────────

function cmdSync(db: Database) {
  const entries = readdirSync(CARDS_DIR);
  const pngs = entries.filter((e) => {
    if (!e.endsWith(".png")) return false;
    try {
      return statSync(join(CARDS_DIR, e)).isFile();
    } catch {
      return false;
    }
  });

  console.log(`scanning ${pngs.length} PNGs...`);

  const existing = new Set<string>(
    (db.query("SELECT filename FROM cards").all() as { filename: string }[]).map((r) => r.filename)
  );

  const upsert = db.prepare(`
    INSERT INTO cards (filename, name, tags, description, creator, spec_version, create_date, fav, persona, synced_at)
    VALUES ($filename, $name, $tags, $description, $creator, $spec_version, $create_date, $fav, $persona, $synced_at)
    ON CONFLICT(filename) DO UPDATE SET
      name=$name, tags=$tags, description=$description, creator=$creator,
      spec_version=$spec_version, create_date=$create_date, fav=$fav, persona=$persona, synced_at=$synced_at
  `);

  const now = Date.now();
  let added = 0, skipped = 0, errors = 0;
  const BATCH = 500;

  const tx = db.transaction((batch: CardData[]) => {
    for (const card of batch) upsert.run({ ...card, $synced_at: now, synced_at: now, $filename: card.filename, $name: card.name, $tags: card.tags, $description: card.description, $creator: card.creator, $spec_version: card.spec_version, $create_date: card.create_date, $fav: card.fav, $persona: card.persona });
  });

  let batch: CardData[] = [];

  for (let i = 0; i < pngs.length; i++) {
    const f = pngs[i];
    const card = parseCard(join(CARDS_DIR, f));
    if (!card) { errors++; continue; }
    batch.push(card);
    if (batch.length >= BATCH) {
      tx(batch);
      added += batch.length;
      batch = [];
      process.stdout.write(`\r  ${added}/${pngs.length} indexed...`);
    }
  }
  if (batch.length) { tx(batch); added += batch.length; }

  // remove deleted files
  const removed = [...existing].filter((f) => !pngs.includes(f));
  if (removed.length) {
    const del = db.prepare("DELETE FROM cards WHERE filename = ?");
    for (const f of removed) del.run(f);
  }

  console.log(`\ndone — ${added} indexed, ${errors} unparseable, ${removed.length} removed`);
}

function cmdSearch(db: Database, query: string) {
  const rows = db.query(`
    SELECT c.filename, c.name, c.tags, c.creator, c.fav
    FROM cards_fts f
    JOIN cards c ON c.rowid = f.rowid
    WHERE cards_fts MATCH ?
    ORDER BY f.rank
    LIMIT 20
  `).all(query) as { filename: string; name: string; tags: string; creator: string; fav: number }[];

  if (!rows.length) { console.log("no results"); return; }
  for (const r of rows) {
    const tags = (JSON.parse(r.tags) as string[]).slice(0, 5).join(", ");
    const fav = r.fav ? " ★" : "";
    console.log(`${r.name || r.filename}${fav}`);
    console.log(`  file: ${r.filename}`);
    if (r.creator) console.log(`  by ${r.creator}`);
    if (tags) console.log(`  tags: ${tags}`);
  }
}

function cmdTags(db: Database, tag: string) {
  const pattern = `%"${tag}"%`;
  const rows = db.query(`
    SELECT filename, name, tags, creator, fav
    FROM cards
    WHERE lower(tags) LIKE lower(?)
    LIMIT 30
  `).all(pattern) as { filename: string; name: string; tags: string; creator: string; fav: number }[];

  if (!rows.length) { console.log("no results"); return; }
  for (const r of rows) {
    const tags = (JSON.parse(r.tags) as string[]).slice(0, 5).join(", ");
    console.log(`${r.name || r.filename}${r.fav ? " ★" : ""} [${r.filename}] — ${tags}`);
  }
  if (rows.length === 30) console.log("(showing first 30)");
}

function cmdCreator(db: Database, creator: string) {
  const rows = db.query(`
    SELECT filename, name, tags, creator, fav
    FROM cards
    WHERE lower(creator) LIKE lower(?)
    ORDER BY name
    LIMIT 50
  `).all(`%${creator}%`) as { filename: string; name: string; tags: string; creator: string; fav: number }[];

  if (!rows.length) { console.log("no results"); return; }
  for (const r of rows) {
    const tags = (JSON.parse(r.tags) as string[]).slice(0, 5).join(", ");
    console.log(`${r.name || r.filename}${r.fav ? " ★" : ""} [${r.filename}] — ${tags}`);
  }
  if (rows.length === 50) console.log("(showing first 50)");
}

function cmdInfo(db: Database, name: string) {
  const row = db.query(`
    SELECT * FROM cards WHERE lower(name) LIKE lower(?) OR lower(filename) LIKE lower(?) LIMIT 1
  `).get(`%${name}%`, `%${name}%`) as CardData & { synced_at: number } | null;

  if (!row) { console.log("not found"); return; }
  console.log(`name:       ${row.name}`);
  console.log(`file:       ${row.filename}`);
  console.log(`creator:    ${row.creator || "(unknown)"}`);
  console.log(`tags:       ${(JSON.parse(row.tags) as string[]).join(", ") || "(none)"}`);
  console.log(`fav:        ${row.fav ? "yes" : "no"}`);
  console.log(`spec:       ${row.spec_version}`);
  console.log(`created:    ${row.create_date}`);
  if (row.persona) console.log(`\npersonality:\n${row.persona}`);
  if (row.description) console.log(`\ndescription:\n${row.description}`);
}

function cmdStats(db: Database) {
  const { total } = db.query("SELECT count(*) as total FROM cards").get() as { total: number };
  const { favs } = db.query("SELECT count(*) as favs FROM cards WHERE fav=1").get() as { favs: number };
  const { creators } = db.query("SELECT count(DISTINCT creator) as creators FROM cards WHERE creator != ''").get() as { creators: number };
  console.log(`cards: ${total} total, ${favs} favourited, ${creators} unique creators`);
}

// ── Main ────────────────────────────────────────────────────────────────────

const [cmd, ...args] = process.argv.slice(2);
const db = openDb();

switch (cmd) {
  case "sync":   cmdSync(db); break;
  case "search": cmdSearch(db, args.join(" ")); break;
  case "tags":    cmdTags(db, args.join(" ")); break;
  case "creator": cmdCreator(db, args.join(" ")); break;
  case "info":    cmdInfo(db, args.join(" ")); break;
  case "stats":   cmdStats(db); break;
  default:
    console.log("usage: bun scripts/card-search.ts <sync|search|tags|creator|info|stats> [args]");
}
