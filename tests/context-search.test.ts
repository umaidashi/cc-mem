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
  return db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!
    .id;
}

// ---------------------------------------------------------------------------
// テストデータ
// ---------------------------------------------------------------------------

const PYTHON_QA = [
  {
    q: "Pythonの基本的なデータ型について教えて",
    a: "Pythonの基本的なデータ型には int, float, str, list, dict, tuple, set などがあります。intは整数、floatは浮動小数点数、strは文字列を表します。listは可変長の配列、dictはキーと値のペア、tupleは不変のシーケンス、setは重複なしの集合です。",
  },
  {
    q: "リスト内包表記の使い方は？",
    a: "リスト内包表記は [式 for 変数 in イテラブル] の形式で使います。条件付きの場合は [式 for 変数 in イテラブル if 条件] となります。例えば [x**2 for x in range(10) if x % 2 == 0] は0から9の偶数の二乗のリストを生成します。ネストも可能です。",
  },
  {
    q: "Pythonのデコレータについて詳しく教えて",
    a: "デコレータは関数やクラスを修飾する構文で、@記号を使います。関数デコレータは別の関数を引数に取り、新しい関数を返す高階関数です。例えば @staticmethod や @classmethod は組み込みデコレータです。自作デコレータではfunctools.wrapsを使うのが推奨されます。",
  },
  {
    q: "asyncioの使い方は？",
    a: "asyncioはPythonの非同期I/Oフレームワークです。async def で非同期関数を定義し、await で非同期処理の完了を待ちます。asyncio.run() でイベントループを起動し、asyncio.gather() で複数のコルーチンを並行実行できます。ネットワークI/Oに特に有効です。",
  },
  {
    q: "Pythonのテストフレームワークは？",
    a: "pytestが最も人気のあるPythonテストフレームワークです。シンプルなassert文でテストを書け、フィクスチャやパラメータ化テストなど豊富な機能があります。標準ライブラリのunittestも利用可能で、クラスベースのテスト記述が特徴です。noseは開発終了しています。",
  },
];

// ---------------------------------------------------------------------------
// テストケース
// ---------------------------------------------------------------------------

describeWithOllama("ADR-006: --context 検索オプション", () => {
  let db: Database;

  beforeEach(() => {
    db = initDb(":memory:");
  });

  // -----------------------------------------------------------------------
  // 1. context なし → 既存動作と同じ
  // -----------------------------------------------------------------------
  test("context なし → 結果に context が undefined", async () => {
    // セッション sess_A に3件保存
    for (const qa of PYTHON_QA.slice(0, 3)) {
      await insertTestMemory(db, "sess_A", qa.q, qa.a);
    }

    const results = await hybridSearch(db, "Pythonデコレータ", 5);

    expect(results.length).toBeGreaterThan(0);

    // context オプションなしの場合、context は undefined
    for (const r of results) {
      expect(r.context).toBeUndefined();
    }
  });

  // -----------------------------------------------------------------------
  // 2. context あり → 前後2件を返す
  // -----------------------------------------------------------------------
  test("context あり → 前後2件の Q&A が含まれる", async () => {
    // セッション sess_B に5件保存 (Q1〜Q5)
    const ids: number[] = [];
    for (const qa of PYTHON_QA) {
      const id = await insertTestMemory(db, "sess_B", qa.q, qa.a);
      ids.push(id);
    }

    // Q3 (デコレータ) にヒットするクエリで検索
    const results = await hybridSearch(db, "Pythonデコレータ", 5, {
      withContext: true,
    });

    expect(results.length).toBeGreaterThan(0);

    // sess_B の結果を検索（ランキングは保証できないので find で探す）
    const hit = results.find((r) => r.sessionId === "sess_B" && r.id === ids[2]);
    expect(hit).toBeDefined();

    if (!hit) return; // 型ガード

    expect(hit.context).toBeDefined();
    expect(Array.isArray(hit.context)).toBe(true);

    const befores = hit.context!.filter((c) => c.position === "before");
    const afters = hit.context!.filter((c) => c.position === "after");

    // before: Q1, Q2 (最大2件)
    expect(befores.length).toBe(2);
    // before の質問テキストが Q1, Q2 を含む
    expect(befores.some((c) => c.question === PYTHON_QA[0].q)).toBe(true);
    expect(befores.some((c) => c.question === PYTHON_QA[1].q)).toBe(true);

    // after: Q4, Q5 (最大2件)
    expect(afters.length).toBe(2);
    expect(afters.some((c) => c.question === PYTHON_QA[3].q)).toBe(true);
    expect(afters.some((c) => c.question === PYTHON_QA[4].q)).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 3. セッション先頭がヒット → before がない
  // -----------------------------------------------------------------------
  test("セッション先頭がヒット → before なし、after のみ", async () => {
    // sess_C に3件保存: Q1(検索対象), Q2, Q3
    // Q1 をヒットさせるため、Q1 だけのキーワードで検索しやすいデータ構成にする
    const sessC_data = [
      {
        q: "Pythonの基本的なデータ型について教えて",
        a: "Pythonの基本的なデータ型には int, float, str, list, dict, tuple, set などがあります。intは整数、floatは浮動小数点数、strは文字列を表します。listは可変長の配列、dictはキーと値のペア、tupleは不変のシーケンス、setは重複なしの集合です。",
      },
      {
        q: "リスト内包表記の使い方は？",
        a: "リスト内包表記は [式 for 変数 in イテラブル] の形式で使います。条件付きの場合は [式 for 変数 in イテラブル if 条件] となります。例えば [x**2 for x in range(10) if x % 2 == 0] は0から9の偶数の二乗のリストを生成します。ネストも可能です。",
      },
      {
        q: "Pythonのデコレータについて詳しく教えて",
        a: "デコレータは関数やクラスを修飾する構文で、@記号を使います。関数デコレータは別の関数を引数に取り、新しい関数を返す高階関数です。例えば @staticmethod や @classmethod は組み込みデコレータです。自作デコレータではfunctools.wrapsを使うのが推奨されます。",
      },
    ];

    const ids: number[] = [];
    for (const qa of sessC_data) {
      const id = await insertTestMemory(db, "sess_C", qa.q, qa.a);
      ids.push(id);
    }

    // Q1 (基本的なデータ型) にヒットするクエリ
    const results = await hybridSearch(db, "Python基本データ型 int float str", 5, {
      withContext: true,
    });

    expect(results.length).toBeGreaterThan(0);

    // sess_C の先頭レコードを探す
    const hit = results.find((r) => r.sessionId === "sess_C" && r.id === ids[0]);
    expect(hit).toBeDefined();

    if (!hit) return;

    expect(hit.context).toBeDefined();

    const befores = hit.context!.filter((c) => c.position === "before");
    const afters = hit.context!.filter((c) => c.position === "after");

    // before は0件（先頭なので前がない）
    expect(befores.length).toBe(0);

    // after は2件（Q2, Q3）
    expect(afters.length).toBe(2);
    expect(afters.some((c) => c.question === sessC_data[1].q)).toBe(true);
    expect(afters.some((c) => c.question === sessC_data[2].q)).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 4. 異なるセッションの Q&A が混ざらない
  // -----------------------------------------------------------------------
  test("異なるセッションの Q&A が context に混入しない", async () => {
    // sess_D に2件
    const sessD_data = [
      {
        q: "Rustのライフタイムとは？",
        a: "Rustのライフタイムは参照が有効である期間を示すアノテーションです。コンパイラが参照の有効性を静的に検証するために使います。'a のように記述し、関数シグネチャやstruct定義で使用します。借用チェッカーと連携して動作します。",
      },
      {
        q: "Rustの所有権システムについて",
        a: "Rustの所有権システムはメモリ安全性をコンパイル時に保証する仕組みです。各値は一つの所有者を持ち、所有者がスコープを離れると値は破棄されます。moveセマンティクスとborrowルールにより、データ競合やダングリング参照を防ぎます。",
      },
    ];

    // sess_E に2件
    const sessE_data = [
      {
        q: "Go言語のgoroutineとは？",
        a: "goroutineはGo言語の軽量スレッドです。go キーワードで関数呼び出しの前に付けることで新しいgoroutineを起動できます。OSスレッドよりはるかに軽量で、数千〜数百万のgoroutineを同時に実行できます。チャネルで通信します。",
      },
      {
        q: "Go言語のインターフェースについて",
        a: "Go言語のインターフェースは暗黙的に実装される型システムの機能です。メソッドシグネチャの集合を定義し、そのメソッドを全て実装した型は自動的にインターフェースを満たします。ダックタイピングに似た柔軟性を提供します。",
      },
    ];

    const sessDIds: number[] = [];
    for (const qa of sessD_data) {
      const id = await insertTestMemory(db, "sess_D", qa.q, qa.a);
      sessDIds.push(id);
    }

    const sessEIds: number[] = [];
    for (const qa of sessE_data) {
      const id = await insertTestMemory(db, "sess_E", qa.q, qa.a);
      sessEIds.push(id);
    }

    // sess_D の Q1 (ライフタイム) にヒットするクエリ
    const results = await hybridSearch(db, "Rustライフタイム借用チェッカー", 5, {
      withContext: true,
    });

    expect(results.length).toBeGreaterThan(0);

    // sess_D のヒットを探す
    const hit = results.find(
      (r) => r.sessionId === "sess_D" && r.id === sessDIds[0],
    );
    expect(hit).toBeDefined();

    if (!hit) return;

    expect(hit.context).toBeDefined();

    // context 内のすべてのアイテムが sess_D のIDであること
    // sess_E のIDが混入していないことを検証
    for (const ctx of hit.context!) {
      expect(sessEIds).not.toContain(ctx.id);
    }

    // after に sess_D の Q2 のみ含まれる（before はなし、先頭なので）
    const befores = hit.context!.filter((c) => c.position === "before");
    const afters = hit.context!.filter((c) => c.position === "after");

    expect(befores.length).toBe(0);
    expect(afters.length).toBe(1);
    expect(afters[0].question).toBe(sessD_data[1].q);
  });
});
