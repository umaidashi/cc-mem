import type { Database } from "bun:sqlite";

export interface GcOptions {
  olderThanDays?: number; // デフォルト 90
  dryRun?: boolean;
  sessionId?: string; // 特定セッション削除
}

export interface GcResult {
  deleted: number;
  remaining: number;
}

export function runGc(db: Database, options?: GcOptions): GcResult {
  const olderThanDays = options?.olderThanDays ?? 90;
  const dryRun = options?.dryRun ?? false;
  const sessionId = options?.sessionId;

  let targetCount: number;

  if (sessionId) {
    // セッション指定削除
    const row = db.query("SELECT COUNT(*) as cnt FROM memories WHERE session_id = ?").get(sessionId) as { cnt: number };
    targetCount = row.cnt;

    if (!dryRun) {
      db.run("DELETE FROM memories WHERE session_id = ?", [sessionId]);
    }
  } else {
    // 日数指定削除
    const row = db.query(`SELECT COUNT(*) as cnt FROM memories WHERE created_at < datetime('now', '-${olderThanDays} days')`).get() as { cnt: number };
    targetCount = row.cnt;

    if (!dryRun) {
      db.run(`DELETE FROM memories WHERE created_at < datetime('now', '-${olderThanDays} days')`);
    }
  }

  const remainingRow = db.query("SELECT COUNT(*) as cnt FROM memories").get() as { cnt: number };

  return {
    deleted: dryRun ? targetCount : targetCount,
    remaining: remainingRow.cnt,
  };
}
