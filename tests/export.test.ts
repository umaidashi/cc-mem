import { describe, test, expect, beforeEach } from "bun:test";
import { initDb } from "../src/db/schema";
import { exportMemories, type ExportEntry } from "../src/cli/export";
import type { Database } from "bun:sqlite";

function insertMemory(db: Database, sessionId: string, question: string, answer: string) {
  db.run(
    "INSERT INTO memories (session_id, question, answer) VALUES (?, ?, ?)",
    [sessionId, question, answer],
  );
}

describe("exportMemories", () => {
  let db: Database;

  beforeEach(() => {
    db = initDb(":memory:");
  });

  test("全件エクスポート: 3件INSERT → 3件の ExportEntry 配列", () => {
    insertMemory(db, "sess-1", "Q1", "A1");
    insertMemory(db, "sess-1", "Q2", "A2");
    insertMemory(db, "sess-2", "Q3", "A3");

    const entries = exportMemories(db);
    expect(entries.length).toBe(3);
    expect(entries[0].question).toBe("Q1");
    expect(entries[1].question).toBe("Q2");
    expect(entries[2].question).toBe("Q3");
  });

  test("セッションフィルタ: sessionId 指定で該当セッションのみ返る", () => {
    insertMemory(db, "sess-A", "QA1", "AA1");
    insertMemory(db, "sess-A", "QA2", "AA2");
    insertMemory(db, "sess-B", "QB1", "AB1");

    const entries = exportMemories(db, { sessionId: "sess-A" });
    expect(entries.length).toBe(2);
    expect(entries.every((e) => e.sessionId === "sess-A")).toBe(true);

    const entriesB = exportMemories(db, { sessionId: "sess-B" });
    expect(entriesB.length).toBe(1);
    expect(entriesB[0].sessionId).toBe("sess-B");
  });

  test("空DB: 空配列が返る", () => {
    const entries = exportMemories(db);
    expect(entries).toEqual([]);
  });

  test("ExportEntry のフィールド検証: embedding は含まれない", () => {
    insertMemory(db, "sess-X", "Question X", "Answer X");

    const entries = exportMemories(db);
    expect(entries.length).toBe(1);

    const entry = entries[0];

    // 必須フィールドの存在確認
    expect(typeof entry.id).toBe("number");
    expect(entry.sessionId).toBe("sess-X");
    expect(entry.question).toBe("Question X");
    expect(entry.answer).toBe("Answer X");
    expect(typeof entry.createdAt).toBe("string");
    expect(entry.createdAt.length).toBeGreaterThan(0);

    // embedding が含まれていないことを確認
    const keys = Object.keys(entry);
    expect(keys).toContain("id");
    expect(keys).toContain("sessionId");
    expect(keys).toContain("question");
    expect(keys).toContain("answer");
    expect(keys).toContain("createdAt");
    expect(keys).not.toContain("embedding");
    expect(keys.length).toBe(5);
  });
});
