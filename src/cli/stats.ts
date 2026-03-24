import { initDb } from "../db/schema";
import { statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export async function stats(): Promise<void> {
  const dbPath = join(homedir(), ".cc-mem", "memory.db");
  const db = initDb(dbPath);

  const total = db.query<{ count: number }, []>(
    "SELECT COUNT(*) as count FROM memories",
  ).get()!.count;

  const sessions = db.query<{ count: number }, []>(
    "SELECT COUNT(DISTINCT session_id) as count FROM memories",
  ).get()!.count;

  const withEmbedding = db.query<{ count: number }, []>(
    "SELECT COUNT(*) as count FROM memories WHERE embedding IS NOT NULL",
  ).get()!.count;

  const oldest = db.query<{ d: string | null }, []>(
    "SELECT MIN(created_at) as d FROM memories",
  ).get()!.d;

  const newest = db.query<{ d: string | null }, []>(
    "SELECT MAX(created_at) as d FROM memories",
  ).get()!.d;

  let dbSize = "N/A";
  try {
    const bytes = statSync(dbPath).size;
    if (bytes < 1024) dbSize = `${bytes} B`;
    else if (bytes < 1024 * 1024) dbSize = `${(bytes / 1024).toFixed(1)} KB`;
    else dbSize = `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  } catch {}

  console.log(`cc-mem stats`);
  console.log(`────────────────────────────`);
  console.log(`Memories:     ${total}`);
  console.log(`Sessions:     ${sessions}`);
  console.log(`With vectors: ${withEmbedding}`);
  console.log(`DB size:      ${dbSize}`);
  console.log(`Oldest:       ${oldest ?? "—"}`);
  console.log(`Newest:       ${newest ?? "—"}`);
  console.log(`DB path:      ${dbPath}`);
}
