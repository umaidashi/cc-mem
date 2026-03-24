import { describe, test, expect, beforeEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { initDb } from "../src/db/schema";
import { extractKeys, type ExtractedKey } from "../src/keys";
import { hybridSearch } from "../src/search";
import { embed, vectorToBuffer } from "../src/embedder";

// ---------------------------------------------------------------------------
// Ollama 疎通チェック
// ---------------------------------------------------------------------------
let ollamaAvailable = false;
try {
  const res = await fetch("http://localhost:11434/api/tags");
  ollamaAvailable = res.ok;
} catch {
  ollamaAvailable = false;
}

const describeWithOllama = ollamaAvailable ? describe : describe.skip;

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

async function insertTestMemory(
  db: Database,
  sessionId: string,
  question: string,
  answer: string,
): Promise<number> {
  const text = `${question}\n${answer}`;
  const vec = await embed(text);
  const buf = vectorToBuffer(vec);
  db.run(
    "INSERT INTO memories (session_id, question, answer, embedding) VALUES (?, ?, ?, ?)",
    [sessionId, question, answer, buf],
  );
  const id = db
    .query<{ id: number }, []>("SELECT last_insert_rowid() as id")
    .get()!.id;

  // memory_keys にキーを挿入
  const keys = extractKeys(`${question}\n${answer}`);
  for (const key of keys) {
    db.run(
      "INSERT INTO memory_keys (memory_id, key_type, key_value) VALUES (?, ?, ?)",
      [id, key.type, key.value],
    );
  }

  return id;
}

// ---------------------------------------------------------------------------
// テストデータ
// ---------------------------------------------------------------------------

const QA_WITH_JIRA_1 = {
  q: "STOCK-6302 のチケットの実装方針を確認したい。stock_compositions関連のDAO処理をトランザクション管理する必要がある。",
  a: "STOCK-6302 はstock_compositionsのトランザクション管理です。現在DAO処理がトランザクション外にあるため、メイン処理と同じトランザクション内で管理するように修正します。",
};

const QA_WITH_JIRA_2 = {
  q: "STOCK-6302 のPRレビューでエラーハンドリングの指摘があった。対応方針を検討したい。",
  a: "レビュー指摘の通り、UpdateRevenuePriceがエラーを内部で握りつぶしています。errorを返すようにインターフェースを変更し、トランザクション内でロールバックされるようにします。",
};

const QA_WITHOUT_KEY = {
  q: "Goのgoroutineでの並行処理パターンについて教えてください。チャネルの使い方を詳しく知りたいです。",
  a: "goroutineはgo キーワードで起動し、チャネルで通信します。fan-out/fan-inパターンでは複数のgoroutineに仕事を分散し、結果をチャネルで集約します。selectステートメントで複数チャネルを待ち受けできます。",
};

// ---------------------------------------------------------------------------
// extractKeys 単体テスト（Ollama 不要）
// ---------------------------------------------------------------------------

describe("ADR-012: extractKeys 単体テスト", () => {
  // 1. JIRA チケット抽出
  test("JIRA チケットキーを抽出できる", () => {
    const result = extractKeys("STOCK-6302 のチケットに取り組む");
    expect(result).toEqual([{ type: "jira", value: "STOCK-6302" }]);
  });

  // 2. PR 番号抽出
  test("PR 番号を抽出できる", () => {
    const result = extractKeys("PR #2714 をレビューして");
    expect(result).toEqual([{ type: "pr", value: "#2714" }]);
  });

  // 3. GitHub PR URL 抽出
  test("GitHub PR URL を抽出できる", () => {
    const result = extractKeys(
      "https://github.com/buysell-technologies/stock-api/pull/2714 を確認",
    );
    expect(result).toEqual([
      {
        type: "github_pr",
        value: "github.com/buysell-technologies/stock-api/pull/2714",
      },
    ]);
  });

  // 4. 複数キー抽出
  test("複数のキーを同時に抽出できる", () => {
    const result = extractKeys(
      "STOCK-6302 の PR #2714 を https://github.com/buysell-technologies/stock-api/pull/2714 で確認",
    );
    expect(result).toHaveLength(3);

    const types = result.map((r) => r.type).sort();
    expect(types).toEqual(["github_pr", "jira", "pr"]);

    expect(result.find((r) => r.type === "jira")?.value).toBe("STOCK-6302");
    expect(result.find((r) => r.type === "pr")?.value).toBe("#2714");
    expect(result.find((r) => r.type === "github_pr")?.value).toBe(
      "github.com/buysell-technologies/stock-api/pull/2714",
    );
  });

  // 5. キーなし
  test("キーが含まれないテキストでは空配列を返す", () => {
    const result = extractKeys("通常のテキスト");
    expect(result).toEqual([]);
  });

  // 6. 重複排除
  test("同一キーが複数回出現しても1件のみ返す", () => {
    const result = extractKeys("STOCK-6302 について STOCK-6302 を確認");
    expect(result).toEqual([{ type: "jira", value: "STOCK-6302" }]);
  });
});

// ---------------------------------------------------------------------------
// memory_keys テーブルテスト（Ollama 不要）
// ---------------------------------------------------------------------------

describe("ADR-012: memory_keys テーブル", () => {
  let db: Database;

  beforeEach(() => {
    db = initDb(":memory:");
  });

  // 7. テーブル存在確認
  test("initDb で memory_keys テーブルが作成される", () => {
    const row = db
      .query<{ name: string }, [string]>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
      )
      .get("memory_keys");
    expect(row).toBeDefined();
    expect(row!.name).toBe("memory_keys");
  });

  // 8. CASCADE 削除
  test("memories 削除時に memory_keys も CASCADE 削除される", () => {
    // memories に INSERT
    db.run(
      "INSERT INTO memories (session_id, question, answer) VALUES (?, ?, ?)",
      ["sess_test", "テスト質問です", "テスト回答です"],
    );
    const memoryId = db
      .query<{ id: number }, []>("SELECT last_insert_rowid() as id")
      .get()!.id;

    // memory_keys に INSERT
    db.run(
      "INSERT INTO memory_keys (memory_id, key_type, key_value) VALUES (?, ?, ?)",
      [memoryId, "jira", "STOCK-6302"],
    );

    // memory_keys にレコードが存在することを確認
    const before = db
      .query<{ cnt: number }, [number]>(
        "SELECT COUNT(*) as cnt FROM memory_keys WHERE memory_id = ?",
      )
      .get(memoryId);
    expect(before!.cnt).toBe(1);

    // memories から DELETE
    db.run("DELETE FROM memories WHERE id = ?", [memoryId]);

    // memory_keys も削除されていることを確認
    const after = db
      .query<{ cnt: number }, [number]>(
        "SELECT COUNT(*) as cnt FROM memory_keys WHERE memory_id = ?",
      )
      .get(memoryId);
    expect(after!.cnt).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// キーベース検索テスト（Ollama 依存）
// ---------------------------------------------------------------------------

describeWithOllama("ADR-012: キーベース検索", () => {
  let db: Database;

  beforeEach(() => {
    db = initDb(":memory:");
  });

  // 9. JIRA キーで検索
  test("JIRA キーで検索すると該当キーを含むメモリが上位に来る", async () => {
    // 3件保存: うち2件に STOCK-6302 を含む
    await insertTestMemory(db, "sess_key_1", QA_WITH_JIRA_1.q, QA_WITH_JIRA_1.a);
    await insertTestMemory(db, "sess_key_1", QA_WITH_JIRA_2.q, QA_WITH_JIRA_2.a);
    await insertTestMemory(db, "sess_key_1", QA_WITHOUT_KEY.q, QA_WITHOUT_KEY.a);

    const results = await hybridSearch(db, "STOCK-6302", 5);

    expect(results.length).toBeGreaterThanOrEqual(2);

    // 上位2件が STOCK-6302 を含むメモリであること
    const top2 = results.slice(0, 2);
    for (const r of top2) {
      const text = `${r.question}\n${r.answer}`;
      expect(text).toContain("STOCK-6302");
    }
  });

  // 10. PR キーで検索
  test("PR キーで検索すると該当キーを含むメモリが上位に来る", async () => {
    // QA_WITH_JIRA_2 の質問に #2714 を含むバリエーションを作る
    const QA_WITH_PR = {
      q: "PR #2714 のレビューコメントに対応する。エラーハンドリングの修正が必要。",
      a: "PR #2714 ではUpdateRevenuePriceのエラーハンドリングを修正します。error型を返すインターフェースに変更し、呼び出し元でハンドリングするようにします。",
    };

    // 3件保存: うち1件に #2714 を含む
    await insertTestMemory(db, "sess_key_2", QA_WITH_PR.q, QA_WITH_PR.a);
    await insertTestMemory(db, "sess_key_2", QA_WITH_JIRA_1.q, QA_WITH_JIRA_1.a);
    await insertTestMemory(db, "sess_key_2", QA_WITHOUT_KEY.q, QA_WITHOUT_KEY.a);

    const results = await hybridSearch(db, "#2714", 5);

    expect(results.length).toBeGreaterThanOrEqual(1);

    // 上位1件が #2714 を含むメモリであること
    const top = results[0];
    const text = `${top.question}\n${top.answer}`;
    expect(text).toContain("#2714");
  });
});
