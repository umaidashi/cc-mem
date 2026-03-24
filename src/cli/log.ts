import type { Database } from "bun:sqlite";
import { initDb } from "../db/schema";

export interface SessionLog {
  sessionId: string;
  date: string;
  count: number;
  questions: string[]; // 最初3件のQ
}

export function getSessionLogs(
  db: Database,
  limit: number = 10,
): SessionLog[] {
  // 1. セッションごとの件数と最新の created_at を取得、新しい順
  const sessions = db
    .query<{ session_id: string; cnt: number; latest: string }, [number]>(
      `
    SELECT session_id, COUNT(*) as cnt, MAX(created_at) as latest
    FROM memories
    GROUP BY session_id
    ORDER BY latest DESC
    LIMIT ?
  `,
    )
    .all(limit);

  // 2. 各セッションの最初3件のQを取得
  return sessions.map((s) => {
    const questions = db
      .query<{ question: string }, [string]>(
        `SELECT question FROM memories WHERE session_id = ? ORDER BY id ASC LIMIT 3`,
      )
      .all(s.session_id)
      .map((r) => r.question);

    return {
      sessionId: s.session_id,
      date: s.latest.slice(0, 10),
      count: s.cnt,
      questions,
    };
  });
}

export async function log(limit: number = 10): Promise<void> {
  const db = initDb();

  const logs = getSessionLogs(db, limit);

  if (logs.length === 0) {
    console.log("No memories stored yet.");
    return;
  }

  console.log(
    `cc-mem log (${logs.length} sessions)\n────────────────────────────`,
  );

  for (const s of logs) {
    console.log(`\n${s.sessionId} | ${s.date} | ${s.count} memories`);
    for (const q of s.questions) {
      const truncated = q.length > 60 ? q.slice(0, 60) + "..." : q;
      console.log(`  → ${truncated}`);
    }
  }
}
