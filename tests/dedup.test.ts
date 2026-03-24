import { describe, test, expect, beforeEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { initDb } from "../src/db/schema";
import { embed, vectorToBuffer, cosineSimilarity } from "../src/embedder";
import { dedup } from "../src/dedup";
import type { QAChunk } from "../src/chunker";

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

/** DB にメモリを1件挿入する */
async function insertMemory(db: Database, chunk: QAChunk): Promise<void> {
  const text = `${chunk.question}\n${chunk.answer}`;
  const vec = await embed(text);
  const buf = vectorToBuffer(vec);
  db.run(
    "INSERT INTO memories (session_id, question, answer, embedding) VALUES (?, ?, ?, ?)",
    ["test_session", chunk.question, chunk.answer, buf],
  );
}

/** チャンクに embedding を付与するヘルパー */
async function withEmbedding(
  chunk: QAChunk,
): Promise<{ chunk: QAChunk; embedding: Float32Array }> {
  const text = `${chunk.question}\n${chunk.answer}`;
  const vec = await embed(text);
  return { chunk, embedding: vec };
}

// ---------------------------------------------------------------------------
// テストケース
// ---------------------------------------------------------------------------

describeWithOllama("ADR-003: 重複排除", () => {
  let db: Database;

  beforeEach(() => {
    db = initDb(":memory:");
  });

  // 1. 空DB → 全件保存
  test("空DBに3件渡すと全件がuniqueになる", async () => {
    const chunks = await Promise.all([
      withEmbedding({
        question: "TypeScriptとは？",
        answer: "TypeScriptはJavaScriptに型システムを追加した言語です。",
      }),
      withEmbedding({
        question: "Bunとは？",
        answer: "BunはJavaScript/TypeScriptのランタイムで、高速な実行環境です。",
      }),
      withEmbedding({
        question: "Rustとは？",
        answer: "Rustはメモリ安全性を重視したシステムプログラミング言語です。",
      }),
    ]);

    const result = await dedup(db, chunks);

    expect(result.unique.length).toBe(3);
    expect(result.duplicateCount).toBe(0);
  });

  // 2. 完全一致の重複
  test("完全一致のチャンクは重複として検出される", async () => {
    const chunk: QAChunk = {
      question: "TypeScriptとは？",
      answer: "TypeScriptはJavaScriptに型システムを追加した言語です。",
    };

    // DB に事前投入
    await insertMemory(db, chunk);

    // 同一内容で dedup
    const input = [await withEmbedding(chunk)];
    const result = await dedup(db, input);

    expect(result.unique.length).toBe(0);
    expect(result.duplicateCount).toBe(1);
  });

  // 3. 類似だが異なるQ&A
  test("同じ質問でも回答が異なれば保存される", async () => {
    // DB に事前投入
    await insertMemory(db, {
      question: "Pythonのリスト内包表記とは？",
      answer: "リスト内包表記は[x for x in range(10)]のような記法です。",
    });

    // 異なる回答で dedup
    const input = [
      await withEmbedding({
        question: "Pythonのリスト内包表記とは？",
        answer:
          "リスト内包表記はリストを簡潔に生成するためのPython独自の構文で、フィルタリングやネストも可能です。",
      }),
    ];
    const result = await dedup(db, input);

    expect(result.unique.length).toBe(1);
    expect(result.duplicateCount).toBe(0);
  });

  // 4. embedding なし → チェックスキップ（Ollama 不要だがテストグループ内なのでそのまま）
  test("embeddingがnullのチャンクはチェックスキップでuniqueに含まれる", async () => {
    // DB にデータを入れておく
    await insertMemory(db, {
      question: "TypeScriptとは？",
      answer: "TypeScriptはJavaScriptに型システムを追加した言語です。",
    });

    const input: Array<{ chunk: QAChunk; embedding: Float32Array | null }> = [
      {
        chunk: {
          question: "何かの質問",
          answer: "何かの回答",
        },
        embedding: null,
      },
    ];

    const result = await dedup(db, input);

    expect(result.unique.length).toBe(1);
    expect(result.duplicateCount).toBe(0);
  });

  // 5. 重複混在
  test("5件中2件が既存と重複、3件が新規 → unique=3, duplicateCount=2", async () => {
    // DB に2件保存
    const existing1: QAChunk = {
      question: "Dockerとは？",
      answer: "Dockerはコンテナ型仮想化プラットフォームです。",
    };
    const existing2: QAChunk = {
      question: "Kubernetesとは？",
      answer: "KubernetesはコンテナオーケストレーションのOSSです。",
    };
    await insertMemory(db, existing1);
    await insertMemory(db, existing2);

    // 5件渡す（2件は既存と同一、3件は新規）
    const input = await Promise.all([
      withEmbedding(existing1), // 重複
      withEmbedding(existing2), // 重複
      withEmbedding({
        question: "GraphQLとは？",
        answer: "GraphQLはAPIのためのクエリ言語です。",
      }),
      withEmbedding({
        question: "gRPCとは？",
        answer: "gRPCはGoogleが開発した高性能RPCフレームワークです。",
      }),
      withEmbedding({
        question: "WebSocketとは？",
        answer: "WebSocketは双方向通信を実現するプロトコルです。",
      }),
    ]);

    const result = await dedup(db, input);

    expect(result.unique.length).toBe(3);
    expect(result.duplicateCount).toBe(2);
  });

  // 6. 閾値変更
  test("threshold=0.99にすると類似チャンクも保存される", async () => {
    // DB に投入
    const original: QAChunk = {
      question: "Pythonのデコレータとは？",
      answer:
        "デコレータは関数やクラスを修飾するための構文で、@記号を使って適用します。",
    };
    await insertMemory(db, original);

    // 微妙に異なる（言い回し違い）チャンク
    const similar: QAChunk = {
      question: "Pythonのデコレータとは？",
      answer:
        "デコレータは関数やクラスに追加機能を付与する仕組みで、@記号で適用します。ログ出力や認証チェックなどに使われます。",
    };

    const input = [await withEmbedding(similar)];

    // まずデフォルト閾値(0.95)での類似度を確認
    const originalVec = await embed(
      `${original.question}\n${original.answer}`,
    );
    const similarVec = input[0].embedding!;
    const similarity = cosineSimilarity(originalVec, similarVec);

    // 類似度が 0.95〜0.99 の範囲にあることを前提とする
    // （もしこの範囲外ならテストデータの調整が必要）
    console.log(`類似度: ${similarity}`);

    // threshold=0.99 では重複と見なされないので保存される
    const result = await dedup(db, input, { threshold: 0.99 });

    expect(result.unique.length).toBe(1);
    expect(result.duplicateCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Ollama 不要のテスト（embedding=null のケースのみ）
// ---------------------------------------------------------------------------

describe("ADR-003: 重複排除 (Ollama不要)", () => {
  let db: Database;

  beforeEach(() => {
    db = initDb(":memory:");
  });

  test("embeddingがnullのチャンクはDBにデータがあってもuniqueに含まれる", async () => {
    // embedding なしで DB に直接挿入（embedding カラムは NULL）
    db.run(
      "INSERT INTO memories (session_id, question, answer) VALUES (?, ?, ?)",
      ["test_session", "既存の質問", "既存の回答"],
    );

    const input: Array<{ chunk: QAChunk; embedding: Float32Array | null }> = [
      {
        chunk: { question: "新しい質問", answer: "新しい回答" },
        embedding: null,
      },
    ];

    const result = await dedup(db, input);

    expect(result.unique.length).toBe(1);
    expect(result.duplicateCount).toBe(0);
  });
});
