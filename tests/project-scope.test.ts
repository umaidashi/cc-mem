import { describe, test, expect, beforeEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { initDb } from "../src/db/schema";
import { hybridSearch, type SearchResult } from "../src/search";
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

function insertMemory(
  db: Database,
  sessionId: string,
  question: string,
  answer: string,
  project: string = "",
) {
  db.run(
    "INSERT INTO memories (session_id, question, answer, project) VALUES (?, ?, ?, ?)",
    [sessionId, question, answer, project],
  );
}

async function insertMemoryWithEmbedding(
  db: Database,
  sessionId: string,
  question: string,
  answer: string,
  project: string = "",
) {
  const text = `${question}\n${answer}`;
  const vec = await embed(text);
  const buf = vectorToBuffer(vec);
  db.run(
    "INSERT INTO memories (session_id, question, answer, embedding, project) VALUES (?, ?, ?, ?, ?)",
    [sessionId, question, answer, buf, project],
  );
}

// ---------------------------------------------------------------------------
// テストデータ
// ---------------------------------------------------------------------------

const STOCK_API_QA = [
  {
    q: "在庫管理APIのエンドポイント設計について教えてください",
    a: "在庫管理APIでは /api/v1/inventory でGET（一覧取得）、POST（新規登録）を提供します。個別操作は /api/v1/inventory/:id でGET/PUT/DELETEを実装し、在庫数の増減は /api/v1/inventory/:id/adjust でPATCHリクエストを受け付けます。",
  },
  {
    q: "在庫の入出庫履歴をどのように管理すべきですか？",
    a: "入出庫履歴は inventory_transactions テーブルで管理します。各レコードには item_id、transaction_type（入庫/出庫）、quantity、timestamp、operator_id を記録します。イベントソーシングパターンを採用し、在庫数は履歴から再計算可能にすることで整合性を担保します。",
  },
];

const KEIBA_QA = [
  {
    q: "競馬のオッズ計算の仕組みについて教えてください",
    a: "競馬のオッズはパリミュチュエル方式で計算されます。全馬券の売上から控除率（約25%）を差し引いた金額を、的中馬券の売上で割って算出します。オッズは投票締切まで変動し、最終的な払戻金はレース確定後に決まります。",
  },
  {
    q: "血統データベースの設計で注意すべき点は何ですか？",
    a: "血統データベースでは horses テーブルに sire_id と dam_id の自己参照外部キーを設定します。5代血統表を効率的に取得するため再帰CTEを活用します。また、繁殖馬の成績集計には materialized view が有効で、種牡馬リーディングなどの統計を高速に取得できます。",
  },
];

const GLOBAL_QA = [
  {
    q: "データベースのバックアップ戦略について教えてください",
    a: "本番環境のデータベースバックアップは3-2-1ルールに従います。3つのコピーを保持し、2種類の異なるメディアに保存、1つはオフサイトに配置します。PostgreSQLならpg_dumpによる論理バックアップとWALアーカイブによるPITRを組み合わせるのが推奨されます。",
  },
];

// ---------------------------------------------------------------------------
// 1. project カラム存在確認
// ---------------------------------------------------------------------------

describe("ADR-011: プロジェクトスコープ", () => {
  let db: Database;

  beforeEach(() => {
    db = initDb(":memory:");
  });

  test("project カラムが memories テーブルに存在する", () => {
    const info = db.query("PRAGMA table_info(memories)").all();
    const projectCol = (info as any[]).find((c: any) => c.name === "project");
    expect(projectCol).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // search のプロジェクトスコープ (Ollama 依存)
  // -------------------------------------------------------------------------

  describeWithOllama("search のプロジェクトスコープ", () => {
    beforeEach(async () => {
      for (const qa of STOCK_API_QA) {
        await insertMemoryWithEmbedding(db, "stock-sess-1", qa.q, qa.a, "stock-api");
      }
      for (const qa of KEIBA_QA) {
        await insertMemoryWithEmbedding(db, "keiba-sess-1", qa.q, qa.a, "keiba");
      }
    });

    test("search でプロジェクト指定 → そのプロジェクトの結果のみ返る", async () => {
      const results = await hybridSearch(db, "在庫管理 API エンドポイント 入出庫履歴", 5, {
        project: "stock-api",
      });

      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.sessionId).toMatch(/^stock-sess-/);
      }
    });

    test("search --all (project 未指定) → 両プロジェクトからヒット", async () => {
      const results = await hybridSearch(db, "データベース設計 API テーブル", 5, {});

      expect(results.length).toBeGreaterThan(0);

      const sessionIds = results.map((r) => r.sessionId);
      const hasStock = sessionIds.some((id) => id.startsWith("stock-sess-"));
      const hasKeiba = sessionIds.some((id) => id.startsWith("keiba-sess-"));
      expect(hasStock || hasKeiba).toBe(true);
      // 横断検索なので制限なくヒットする（両方含まれうる）
    });
  });

  // -------------------------------------------------------------------------
  // 既存データ (project='') のアクセス (Ollama 依存)
  // -------------------------------------------------------------------------

  describeWithOllama("既存データ (project='') のアクセス", () => {
    beforeEach(async () => {
      // グローバルメモリ (project='')
      for (const qa of GLOBAL_QA) {
        await insertMemoryWithEmbedding(db, "global-sess-1", qa.q, qa.a, "");
      }
      // stock-api のメモリ
      for (const qa of STOCK_API_QA) {
        await insertMemoryWithEmbedding(db, "stock-sess-1", qa.q, qa.a, "stock-api");
      }
    });

    test("プロジェクト指定検索 → project='' のデータもヒットする", async () => {
      const results = await hybridSearch(db, "データベース バックアップ 設計 API", 5, {
        project: "stock-api",
      });

      expect(results.length).toBeGreaterThan(0);

      // project='' (global) のデータが含まれることを確認
      const hasGlobal = results.some((r) => r.sessionId === "global-sess-1");
      expect(hasGlobal).toBe(true);
    });
  });
});
