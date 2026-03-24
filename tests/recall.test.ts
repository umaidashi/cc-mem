import { describe, test, expect, beforeEach } from "bun:test";
import { initDb } from "../src/db/schema";
import { getRecentSessions, type RecallSession } from "../src/cli/recall";
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

describe("getRecentSessions", () => {
  let db: Database;

  beforeEach(() => {
    db = initDb(":memory:");
  });

  test("直近3セッション: 5セッション分INSERT → getRecentSessions(db) → 3件返る", () => {
    for (let i = 1; i <= 5; i++) {
      const sid = `sess_${String(i).padStart(2, "0")}`;
      insertMemory(db, sid, `Q from ${sid}`, `A from ${sid}`, `2026-03-${String(i).padStart(2, "0")} 10:00:00`);
    }

    const sessions = getRecentSessions(db);
    expect(sessions.length).toBe(3);
  });

  test("各セッションの情報: sessionId, date, count, firstQuestion, lastQuestion が正しい", () => {
    insertMemory(db, "sess-A", "First question of A", "Answer 1", "2026-03-10 09:00:00");
    insertMemory(db, "sess-A", "Second question of A", "Answer 2", "2026-03-10 09:10:00");
    insertMemory(db, "sess-A", "Third question of A", "Answer 3", "2026-03-10 09:20:00");

    const sessions = getRecentSessions(db);
    expect(sessions.length).toBe(1);

    const s = sessions[0];
    expect(s.sessionId).toBe("sess-A");
    expect(s.date).toBe("2026-03-10");
    expect(s.count).toBe(3);
    expect(s.firstQuestion).toBe("First question of A");
    expect(s.lastQuestion).toBe("Third question of A");
  });

  test("--last 1: getRecentSessions(db, 1) → 1件返る", () => {
    for (let i = 1; i <= 5; i++) {
      const sid = `sess_${String(i).padStart(2, "0")}`;
      insertMemory(db, sid, `Q from ${sid}`, `A from ${sid}`, `2026-03-${String(i).padStart(2, "0")} 10:00:00`);
    }

    const sessions = getRecentSessions(db, 1);
    expect(sessions.length).toBe(1);
    expect(sessions[0].sessionId).toBe("sess_05");
  });

  test("空DB: 空配列が返る", () => {
    const sessions = getRecentSessions(db);
    expect(sessions.length).toBe(0);
  });

  test("新しい順ソート: 最新のセッションが最初", () => {
    insertMemory(db, "old-session", "Q old", "A old", "2026-01-01 10:00:00");
    insertMemory(db, "mid-session", "Q mid", "A mid", "2026-02-15 10:00:00");
    insertMemory(db, "new-session", "Q new", "A new", "2026-03-20 10:00:00");

    const sessions = getRecentSessions(db);
    expect(sessions[0].sessionId).toBe("new-session");
    expect(sessions[1].sessionId).toBe("mid-session");
    expect(sessions[2].sessionId).toBe("old-session");
  });
});
