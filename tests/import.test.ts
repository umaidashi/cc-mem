import { describe, test, expect, afterEach, beforeEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Database } from "bun:sqlite";
import { importSessions } from "../src/cli/import";
import { initDb } from "../src/db/schema";

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

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

function createTestDir(): string {
  const dir = join(tmpdir(), `cc-mem-import-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createTestDbPath(): string {
  return join(tmpdir(), `cc-mem-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
}

/**
 * セッションログの JSONL を生成する。
 * Q&A の内容はエスケープ不要な平文テキストを前提とする。
 */
function makeSessionJsonl(qaPairs: Array<{ q: string; a: string }>): string {
  return qaPairs
    .map(
      ({ q, a }) =>
        JSON.stringify({ type: "user", message: { content: q } }) +
        "\n" +
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: a }] },
        }),
    )
    .join("\n");
}

/**
 * プロジェクトディレクトリにセッション JSONL を配置する。
 * Claude のプロジェクトディレクトリ構造:
 *   projectsDir/<project-name>/<session-id>.jsonl
 */
function placeSession(
  projectsDir: string,
  projectName: string,
  sessionFileName: string,
  content: string,
): void {
  const projectDir = join(projectsDir, projectName);
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, sessionFileName), content, "utf-8");
}

// 100文字以上の Q&A ペアのテストデータ
const LONG_QA_1 = {
  q: "ReactのuseStateフックについて詳しく教えてください。関数コンポーネントでの状態管理の基本的な使い方を知りたいです。",
  a: "useStateはReactの基本的なHookで、関数コンポーネントに状態管理を追加します。const [state, setState] = useState(initialValue) の形式で使い、setStateを呼ぶとコンポーネントが再レンダリングされます。初期値には任意の値を渡せます。",
};

const LONG_QA_2 = {
  q: "TypeScriptのジェネリクス型について教えてください。具体的なユースケースと基本的な書き方を知りたいです。",
  a: "ジェネリクスは型をパラメータ化する機能です。function identity<T>(arg: T): T のように定義し、呼び出し時に型が決定されます。配列操作やAPIレスポンスの型付けなど、再利用可能な型安全コードを書くときに便利です。",
};

const LONG_QA_3 = {
  q: "Dockerコンテナのネットワーク設定について教えてください。コンテナ間通信の基本的な方法を知りたいです。",
  a: "Dockerではbridge, host, noneなどのネットワークドライバが利用できます。docker-composeを使うと同一ネットワーク内のコンテナはサービス名で名前解決できます。ポートマッピングで外部からのアクセスも制御できます。",
};

// ---------------------------------------------------------------------------
// テスト本体
// ---------------------------------------------------------------------------

let testDir: string;
let testDbPath: string;

beforeEach(() => {
  testDir = createTestDir();
  testDbPath = createTestDbPath();
  // CC_MEM_DB_PATH を一時ファイルに向ける
  process.env.CC_MEM_DB_PATH = testDbPath;
});

afterEach(() => {
  // 一時ディレクトリの削除
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
  // 一時 DB ファイルの削除
  if (existsSync(testDbPath)) {
    rmSync(testDbPath, { force: true });
  }
  // WAL/SHM ファイルも削除
  for (const suffix of ["-wal", "-shm"]) {
    const p = testDbPath + suffix;
    if (existsSync(p)) {
      rmSync(p, { force: true });
    }
  }
  delete process.env.CC_MEM_DB_PATH;
});

// =========================================================================
// 1. 基本取り込み
// =========================================================================
describe("ADR-005: import コマンド", () => {
  test("基本取り込み: 2プロジェクト各1セッション → sessionsFound=2, totalSaved > 0", async () => {
    // project-alpha にセッション1つ
    placeSession(
      testDir,
      "project-alpha",
      "session-aaa.jsonl",
      makeSessionJsonl([LONG_QA_1]),
    );
    // project-beta にセッション1つ
    placeSession(
      testDir,
      "project-beta",
      "session-bbb.jsonl",
      makeSessionJsonl([LONG_QA_2]),
    );

    const result = await importSessions({ projectsDir: testDir, dbPath: testDbPath });

    expect(result.sessionsFound).toBe(2);
    expect(result.sessionsProcessed).toBe(2);
    expect(result.totalSaved).toBeGreaterThan(0);
  });

  // =========================================================================
  // 2. subagents 除外
  // =========================================================================
  test("subagents 除外: subagents/ 配下の JSONL は処理されない", async () => {
    // 通常のセッション
    placeSession(
      testDir,
      "my-project",
      "session-main.jsonl",
      makeSessionJsonl([LONG_QA_1]),
    );
    // subagents 配下（処理されるべきでない）
    const subagentsDir = join(testDir, "my-project", "subagents");
    mkdirSync(subagentsDir, { recursive: true });
    writeFileSync(
      join(subagentsDir, "agent-001.jsonl"),
      makeSessionJsonl([LONG_QA_2]),
      "utf-8",
    );

    const result = await importSessions({ projectsDir: testDir, dbPath: testDbPath });

    // subagents のファイルはカウントに含まれない
    expect(result.sessionsFound).toBe(1);
    expect(result.sessionsProcessed).toBe(1);
  });

  // =========================================================================
  // 3. --dry-run
  // =========================================================================
  test("dry-run: 件数は返すが DB には書き込まれない", async () => {
    placeSession(
      testDir,
      "dry-run-project",
      "session-dry.jsonl",
      makeSessionJsonl([LONG_QA_1, LONG_QA_2]),
    );

    const result = await importSessions({
      projectsDir: testDir,
      dryRun: true,
    });

    // セッションは見つかり、処理対象として件数が返る
    expect(result.sessionsFound).toBe(1);
    expect(result.sessionsProcessed).toBe(1);
    expect(result.totalSaved + result.totalFiltered).toBeGreaterThan(0);

    // DB を直接開いて memories テーブルが空であることを確認
    const db = initDb(testDbPath);
    try {
      const row = db.query("SELECT COUNT(*) as cnt FROM memories").get() as {
        cnt: number;
      };
      expect(row.cnt).toBe(0);
    } finally {
      db.close();
    }
  });

  // =========================================================================
  // 4. --project フィルタ
  // =========================================================================
  test("projectFilter: stock-api のみ処理される", async () => {
    placeSession(
      testDir,
      "stock-api",
      "session-stock.jsonl",
      makeSessionJsonl([LONG_QA_1]),
    );
    placeSession(
      testDir,
      "category-api",
      "session-cat.jsonl",
      makeSessionJsonl([LONG_QA_2]),
    );
    placeSession(
      testDir,
      "keiba",
      "session-keiba.jsonl",
      makeSessionJsonl([LONG_QA_3]),
    );

    const result = await importSessions({
      projectsDir: testDir,
      dbPath: testDbPath,
      projectFilter: "stock",
    });

    // stock-api のセッションのみ処理される
    expect(result.sessionsFound).toBe(1);
    expect(result.sessionsProcessed).toBe(1);
    expect(result.totalSaved).toBeGreaterThan(0);
  });

  // =========================================================================
  // 5. 冪等性（Ollama 必要 - embedding で重複判定するため）
  // =========================================================================
  const describeWithOllama = ollamaAvailable ? describe : describe.skip;

  describeWithOllama("冪等性 (要 Ollama)", () => {
    test("同じデータで2回 import → 2回目は totalDuplicates > 0, totalSaved = 0", async () => {
      placeSession(
        testDir,
        "idempotent-project",
        "session-idem.jsonl",
        makeSessionJsonl([LONG_QA_1, LONG_QA_2]),
      );

      // 1回目: 正常に取り込み
      const result1 = await importSessions({ projectsDir: testDir, dbPath: testDbPath });
      expect(result1.totalSaved).toBeGreaterThan(0);

      // 2回目: 同じデータで再実行 → 重複排除が効く
      const result2 = await importSessions({ projectsDir: testDir, dbPath: testDbPath });
      expect(result2.totalDuplicates).toBeGreaterThan(0);
      expect(result2.totalSaved).toBe(0);
    });
  });

  // =========================================================================
  // 6. 空ディレクトリ
  // =========================================================================
  test("空ディレクトリ: JSONL なし → sessionsFound=0, totalSaved=0", async () => {
    // testDir は存在するが JSONL ファイルがない
    const result = await importSessions({ projectsDir: testDir, dbPath: testDbPath });

    expect(result.sessionsFound).toBe(0);
    expect(result.sessionsProcessed).toBe(0);
    expect(result.totalSaved).toBe(0);
    expect(result.totalFiltered).toBe(0);
    expect(result.totalDuplicates).toBe(0);
  });
});
