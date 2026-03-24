import { describe, test, expect, beforeEach } from "bun:test";
import { initDb } from "../src/db/schema";
import { getSessionLogs, type SessionLog } from "../src/cli/log";
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

describe("getSessionLogs", () => {
  let db: Database;

  beforeEach(() => {
    db = initDb(":memory:");
  });

  test("デフォルト10セッション: 15セッション分INSERTし、getSessionLogs(db) → 10件返る", () => {
    for (let i = 1; i <= 15; i++) {
      const sid = `session-${String(i).padStart(2, "0")}`;
      insertMemory(db, sid, `Q from ${sid}`, `A from ${sid}`, `2026-03-${String(i).padStart(2, "0")} 10:00:00`);
    }

    const logs = getSessionLogs(db);
    expect(logs.length).toBe(10);
  });

  test("--last 5: getSessionLogs(db, 5) → 5件返る", () => {
    for (let i = 1; i <= 15; i++) {
      const sid = `session-${String(i).padStart(2, "0")}`;
      insertMemory(db, sid, `Q from ${sid}`, `A from ${sid}`, `2026-03-${String(i).padStart(2, "0")} 10:00:00`);
    }

    const logs = getSessionLogs(db, 5);
    expect(logs.length).toBe(5);
  });

  test("新しい順ソート: セッションが created_at の降順", () => {
    insertMemory(db, "old-session", "Q old", "A old", "2026-01-01 10:00:00");
    insertMemory(db, "mid-session", "Q mid", "A mid", "2026-02-15 10:00:00");
    insertMemory(db, "new-session", "Q new", "A new", "2026-03-20 10:00:00");

    const logs = getSessionLogs(db);
    expect(logs[0].sessionId).toBe("new-session");
    expect(logs[1].sessionId).toBe("mid-session");
    expect(logs[2].sessionId).toBe("old-session");
  });

  test("各セッションの情報: sessionId, date, count, questions が正しい", () => {
    insertMemory(db, "sess-A", "First question", "Answer 1", "2026-03-10 09:00:00");
    insertMemory(db, "sess-A", "Second question", "Answer 2", "2026-03-10 09:10:00");
    insertMemory(db, "sess-A", "Third question", "Answer 3", "2026-03-10 09:20:00");
    insertMemory(db, "sess-A", "Fourth question", "Answer 4", "2026-03-10 09:30:00");

    const logs = getSessionLogs(db);
    expect(logs.length).toBe(1);

    const s = logs[0];
    expect(s.sessionId).toBe("sess-A");
    expect(s.date).toBe("2026-03-10");
    expect(s.count).toBe(4);
    expect(s.questions).toEqual(["First question", "Second question", "Third question"]);
  });

  test("空DB: 0件返る", () => {
    const logs = getSessionLogs(db);
    expect(logs.length).toBe(0);
  });
});
