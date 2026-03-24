import { describe, test, expect, beforeEach } from "bun:test";
import { initDb } from "../src/db/schema";
import { runGc } from "../src/cli/gc";
import type { Database } from "bun:sqlite";

function insertMemory(
  db: Database,
  sessionId: string,
  question: string,
  answer: string,
  createdAt: string,
) {
  db.run(
    "INSERT INTO memories (session_id, question, answer, created_at) VALUES (?, ?, ?, ?)",
    [sessionId, question, answer, createdAt],
  );
}

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

describe("runGc", () => {
  let db: Database;

  beforeEach(() => {
    db = initDb(":memory:");
  });

  test("日数指定削除: 100日前と10日前のデータ → olderThanDays=90 → 100日前だけ削除", () => {
    insertMemory(db, "sess-old", "Old question", "Old answer", daysAgo(100));
    insertMemory(db, "sess-new", "New question", "New answer", daysAgo(10));

    const result = runGc(db, { olderThanDays: 90 });

    expect(result.deleted).toBe(1);
    expect(result.remaining).toBe(1);

    // 残っているのは新しい方
    const rows = db.query("SELECT session_id FROM memories").all() as { session_id: string }[];
    expect(rows.length).toBe(1);
    expect(rows[0].session_id).toBe("sess-new");
  });

  test("セッション指定削除: 2セッション → sessionId で1つ削除 → もう1つは残る", () => {
    insertMemory(db, "sess-A", "Q1", "A1", daysAgo(5));
    insertMemory(db, "sess-A", "Q2", "A2", daysAgo(4));
    insertMemory(db, "sess-B", "Q3", "A3", daysAgo(3));

    const result = runGc(db, { sessionId: "sess-A" });

    expect(result.deleted).toBe(2);
    expect(result.remaining).toBe(1);

    const rows = db.query("SELECT session_id FROM memories").all() as { session_id: string }[];
    expect(rows.length).toBe(1);
    expect(rows[0].session_id).toBe("sess-B");
  });

  test("dry-run: 削除対象件数は返すが実際には削除しない", () => {
    insertMemory(db, "sess-old", "Q old", "A old", daysAgo(100));
    insertMemory(db, "sess-new", "Q new", "A new", daysAgo(10));

    const result = runGc(db, { olderThanDays: 90, dryRun: true });

    expect(result.deleted).toBe(1);
    expect(result.remaining).toBe(2); // 削除されていないので2件のまま

    // 実際にはデータは残っている
    const rows = db.query("SELECT COUNT(*) as cnt FROM memories").get() as { cnt: number };
    expect(rows.cnt).toBe(2);
  });

  test("空DB: deleted=0, remaining=0", () => {
    const result = runGc(db);

    expect(result.deleted).toBe(0);
    expect(result.remaining).toBe(0);
  });

  test("全件対象: olderThanDays=0 → 全件削除", () => {
    insertMemory(db, "sess-1", "Q1", "A1", daysAgo(1));
    insertMemory(db, "sess-2", "Q2", "A2", daysAgo(2));
    insertMemory(db, "sess-3", "Q3", "A3", daysAgo(3));

    const result = runGc(db, { olderThanDays: 0 });

    expect(result.deleted).toBe(3);
    expect(result.remaining).toBe(0);
  });
});
