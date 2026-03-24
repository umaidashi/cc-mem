import { describe, test, expect, beforeEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { initDb } from "../src/db/schema";
import { getRelatedMemories, type RelatedMemory } from "../src/search";

let db: Database;

function insertMemory(db: Database, sessionId: string, question: string, answer: string): number {
  db.run("INSERT INTO memories (session_id, question, answer) VALUES (?, ?, ?)", [sessionId, question, answer]);
  return db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!.id;
}

function insertKey(db: Database, memoryId: number, keyType: string, keyValue: string) {
  db.run("INSERT INTO memory_keys (memory_id, key_type, key_value) VALUES (?, ?, ?)", [memoryId, keyType, keyValue]);
}

beforeEach(() => {
  db = initDb(":memory:");
});

describe("getRelatedMemories", () => {
  test("関連メモリが取得できる", () => {
    const id1 = insertMemory(db, "s1", "PR レビューの指摘事項", "型安全性の問題");
    const id2 = insertMemory(db, "s1", "エラーハンドリングの改善", "try-catch を追加");
    const id3 = insertMemory(db, "s2", "別の話題", "関係ない回答");

    // id1 と id2 が STOCK-6302 を共有
    insertKey(db, id1, "jira", "STOCK-6302");
    insertKey(db, id2, "jira", "STOCK-6302");
    insertKey(db, id3, "jira", "STOCK-9999");

    const related = getRelatedMemories(db, id1);
    expect(related).toHaveLength(1);
    expect(related[0].id).toBe(id2);
    expect(related[0].sharedKey).toBe("STOCK-6302");
    expect(related[0].sharedKeyCount).toBe(1);
  });

  test("キーを共有しないメモリは含まれない", () => {
    const id1 = insertMemory(db, "s1", "質問A", "回答A");
    const id2 = insertMemory(db, "s1", "質問B", "回答B");
    const id3 = insertMemory(db, "s2", "質問C", "回答C");

    insertKey(db, id1, "jira", "STOCK-1000");
    insertKey(db, id2, "jira", "STOCK-2000");
    insertKey(db, id3, "jira", "STOCK-3000");

    const related = getRelatedMemories(db, id1);
    expect(related).toHaveLength(0);
  });

  test("共有キー数でランク付け", () => {
    const idA = insertMemory(db, "s1", "質問A", "回答A");
    const idB = insertMemory(db, "s1", "質問B", "回答B");
    const idC = insertMemory(db, "s2", "質問C", "回答C");

    // A と B が2キー共有
    insertKey(db, idA, "jira", "STOCK-100");
    insertKey(db, idA, "jira", "STOCK-200");
    insertKey(db, idB, "jira", "STOCK-100");
    insertKey(db, idB, "jira", "STOCK-200");

    // A と C が1キー共有
    insertKey(db, idC, "jira", "STOCK-100");

    const related = getRelatedMemories(db, idA);
    expect(related).toHaveLength(2);
    expect(related[0].id).toBe(idB);
    expect(related[0].sharedKeyCount).toBe(2);
    expect(related[1].id).toBe(idC);
    expect(related[1].sharedKeyCount).toBe(1);
  });

  test("自分自身は含まれない", () => {
    const id1 = insertMemory(db, "s1", "質問", "回答");
    insertKey(db, id1, "jira", "STOCK-500");

    const related = getRelatedMemories(db, id1);
    expect(related).toHaveLength(0);
  });

  test("最大3件制限", () => {
    const idBase = insertMemory(db, "s1", "ベース質問", "ベース回答");
    insertKey(db, idBase, "jira", "STOCK-777");

    // 5件の関連メモリを作成
    for (let i = 0; i < 5; i++) {
      const id = insertMemory(db, "s1", `関連質問${i}`, `関連回答${i}`);
      insertKey(db, id, "jira", "STOCK-777");
    }

    const related = getRelatedMemories(db, idBase);
    expect(related).toHaveLength(3);
  });
});
