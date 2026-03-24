import type { Database } from "bun:sqlite";
import { initDb } from "../db/schema";

export interface RecallSession {
  sessionId: string;
  date: string;
  count: number;
  firstQuestion: string;
  lastQuestion: string;
}

function truncate(text: string, maxLen: number = 60): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}

export function getRecentSessions(db: Database, limit: number = 3): RecallSession[] {
  const rows = db
    .query(
      `SELECT session_id, COUNT(*) as cnt, MAX(created_at) as latest,
              MIN(id) as first_id, MAX(id) as last_id
       FROM memories
       GROUP BY session_id
       ORDER BY latest DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{
    session_id: string;
    cnt: number;
    latest: string;
    first_id: number;
    last_id: number;
  }>;

  if (rows.length === 0) return [];

  const getQuestion = db.query("SELECT question FROM memories WHERE id = ?");

  return rows.map((row) => {
    const firstQ = getQuestion.get(row.first_id) as { question: string } | null;
    const lastQ = getQuestion.get(row.last_id) as { question: string } | null;

    return {
      sessionId: row.session_id,
      date: row.latest.slice(0, 10),
      count: row.cnt,
      firstQuestion: firstQ?.question ?? "",
      lastQuestion: lastQ?.question ?? "",
    };
  });
}

export async function recall(limit: number = 3): Promise<void> {
  const db = initDb();
  const sessions = getRecentSessions(db, limit);

  if (sessions.length === 0) return;

  const lines: string[] = [];
  lines.push("## Recent Memory (cc-mem)");
  lines.push("");

  for (const s of sessions) {
    lines.push(`### ${s.sessionId} (${s.date}, ${s.count} memories)`);
    lines.push(`- Started: ${truncate(s.firstQuestion)}`);
    lines.push(`- Latest: ${truncate(s.lastQuestion)}`);
    lines.push("");
  }

  lines.push('> Search past memories: `cc-mem search "query"`');

  console.log(lines.join("\n"));
}
