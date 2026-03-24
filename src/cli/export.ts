import type { Database } from "bun:sqlite";
import { initDb } from "../db/schema";

export interface ExportOptions {
  sessionId?: string;
}

export interface ExportEntry {
  id: number;
  sessionId: string;
  question: string;
  answer: string;
  createdAt: string;
}

export function exportMemories(db: Database, options?: ExportOptions): ExportEntry[] {
  const hasSession = options?.sessionId !== undefined;
  const sql = hasSession
    ? "SELECT id, session_id, question, answer, created_at FROM memories WHERE session_id = ? ORDER BY id"
    : "SELECT id, session_id, question, answer, created_at FROM memories ORDER BY id";

  const params = hasSession ? [options!.sessionId] : [];
  const rows = db.query(sql).all(...params) as {
    id: number;
    session_id: string;
    question: string;
    answer: string;
    created_at: string;
  }[];

  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    question: row.question,
    answer: row.answer,
    createdAt: row.created_at,
  }));
}

export async function exportCmd(sessionId?: string): Promise<void> {
  const db = initDb();
  const entries = exportMemories(db, sessionId ? { sessionId } : undefined);
  console.log(JSON.stringify(entries, null, 2));
}
