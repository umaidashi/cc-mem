import { describe, test, expect } from "bun:test";
import { filterChunks } from "../src/filter";
import type { QAChunk } from "../src/chunker";

// ヘルパー: 指定文字数になるよう日本語テキストを生成
function pad(base: string, targetLen: number): string {
  if (base.length >= targetLen) return base.slice(0, targetLen);
  return base + "あ".repeat(targetLen - base.length);
}

describe("ADR-001: 短文フィルタ", () => {
  test("閾値未満の除外: Q='読んで' A='はい' (合計5文字) → filtered", () => {
    const chunks: QAChunk[] = [{ question: "読んで", answer: "はい" }];
    const result = filterChunks(chunks);

    expect(result.kept).toHaveLength(0);
    expect(result.filtered).toBe(1);
    expect(result.reasons.get("short")).toBe(1);
  });

  test("閾値以上の保存: Q+A 合計100文字以上 → kept", () => {
    const q = pad("Reactの状態管理について教えてください。", 50);
    const a = pad("Reactの状態管理にはuseStateやuseReducerなどのHookがあります。", 50);
    const chunks: QAChunk[] = [{ question: q, answer: a }];
    const result = filterChunks(chunks);

    expect(result.kept).toHaveLength(1);
    expect(result.filtered).toBe(0);
  });

  test("境界値 99文字: Q+A 合計99文字 → filtered", () => {
    const q = pad("質問", 49);
    const a = pad("回答", 50);
    // q(49) + a(50) = 99
    const chunks: QAChunk[] = [{ question: q, answer: a }];
    const result = filterChunks(chunks);

    expect(result.kept).toHaveLength(0);
    expect(result.filtered).toBe(1);
    expect(result.reasons.get("short")).toBe(1);
  });

  test("境界値 100文字: Q+A 合計100文字 → kept", () => {
    const q = pad("質問", 50);
    const a = pad("回答", 50);
    // q(50) + a(50) = 100
    const chunks: QAChunk[] = [{ question: q, answer: a }];
    const result = filterChunks(chunks);

    expect(result.kept).toHaveLength(1);
    expect(result.filtered).toBe(0);
  });

  test("minLength オプション: minLength=50 で合計50文字以上 → kept、49文字 → filtered", () => {
    const keptChunk: QAChunk = {
      question: pad("質問テキスト", 25),
      answer: pad("回答テキスト", 25),
    }; // 合計50文字
    const filteredChunk: QAChunk = {
      question: pad("質問テキスト", 25),
      answer: pad("回答テキスト", 24),
    }; // 合計49文字

    const result = filterChunks([keptChunk, filteredChunk], { minLength: 50 });

    expect(result.kept).toHaveLength(1);
    expect(result.kept[0]).toEqual(keptChunk);
    expect(result.filtered).toBe(1);
    expect(result.reasons.get("short")).toBe(1);
  });
});

describe("ADR-002: 軽量応答フィルタ", () => {
  test("Q軽量 + A充実 → kept（Aが充実していれば保持）", () => {
    const chunks: QAChunk[] = [
      {
        question: "続けて",
        answer:
          "了解しました。以下にReactのuseStateについて詳しく説明します。useStateは関数コンポーネントに状態管理を追加するHookです。初期値を引数に取り、現在の状態値とその更新関数のペアを返します。再レンダリング時にも状態は保持されます。",
      },
    ];
    // Q+Aの合計が100文字以上であることを確認
    expect(
      chunks[0].question.length + chunks[0].answer.length,
    ).toBeGreaterThanOrEqual(100);

    const result = filterChunks(chunks);

    expect(result.kept).toHaveLength(1);
    expect(result.filtered).toBe(0);
  });

  test("両方軽量: Q='OK' A='はい' → filtered (trivial)", () => {
    const chunks: QAChunk[] = [{ question: "OK", answer: "はい" }];
    const result = filterChunks(chunks);

    expect(result.kept).toHaveLength(0);
    expect(result.filtered).toBe(1);
    // short または trivial のいずれかで除外される
    const hasReason =
      (result.reasons.get("trivial") ?? 0) + (result.reasons.get("short") ?? 0);
    expect(hasReason).toBeGreaterThanOrEqual(1);
  });

  test("定型応答: Q='ありがとう' A='どういたしまして！他に質問があればどうぞ。' → filtered (trivial)", () => {
    const chunks: QAChunk[] = [
      {
        question: "ありがとう",
        answer: "どういたしまして！他に質問があればどうぞ。",
      },
    ];
    const result = filterChunks(chunks);

    expect(result.kept).toHaveLength(0);
    expect(result.filtered).toBe(1);
    // short または trivial で除外
    const hasReason =
      (result.reasons.get("trivial") ?? 0) + (result.reasons.get("short") ?? 0);
    expect(hasReason).toBeGreaterThanOrEqual(1);
  });

  test("通常Q&A → kept", () => {
    const chunks: QAChunk[] = [
      {
        question: "ReactのuseStateとは？",
        answer:
          "useStateはReactのHookで、関数コンポーネントに状態管理を追加します。const [state, setState] = useState(initialValue) の形で使います。",
      },
    ];
    // 合計100文字以上であることを確認
    expect(
      chunks[0].question.length + chunks[0].answer.length,
    ).toBeGreaterThanOrEqual(100);

    const result = filterChunks(chunks);

    expect(result.kept).toHaveLength(1);
    expect(result.filtered).toBe(0);
  });

  test("Q軽量 + A定型長文: Q='了解' A='かしこまりました。他にご質問があればお気軽にどうぞ。' → filtered (trivial)", () => {
    const chunks: QAChunk[] = [
      {
        question: "了解",
        answer: "かしこまりました。他にご質問があればお気軽にどうぞ。",
      },
    ];
    const result = filterChunks(chunks);

    expect(result.kept).toHaveLength(0);
    expect(result.filtered).toBe(1);
    // short または trivial で除外
    const hasReason =
      (result.reasons.get("trivial") ?? 0) + (result.reasons.get("short") ?? 0);
    expect(hasReason).toBeGreaterThanOrEqual(1);
  });
});

describe("組み合わせテスト", () => {
  test("混合入力: kept 3件、short 1件、trivial 1件", () => {
    const chunks: QAChunk[] = [
      // kept 1: 通常のQ&A
      {
        question: "ReactのuseEffectについて教えてください。",
        answer:
          "useEffectは副作用を扱うHookです。コンポーネントのレンダリング後に実行される処理を定義できます。データ取得やDOM操作などに使います。",
      },
      // kept 2: 技術的な質問
      {
        question: "TypeScriptのジェネリクスとは何ですか？",
        answer:
          "ジェネリクスは型をパラメータ化する機能です。関数やクラスを定義するときに、具体的な型を指定せず、使用時に型を決定できます。コードの再利用性が高まります。",
      },
      // short: 短文で除外
      {
        question: "読んで",
        answer: "はい",
      },
      // trivial: 軽量応答で除外
      {
        question: "ありがとう",
        answer: "どういたしまして！他に質問があればどうぞ。",
      },
      // kept 3: 通常のQ&A
      {
        question: "Gitのブランチ戦略について教えてください。",
        answer:
          "代表的なブランチ戦略にはGit FlowとGitHub Flowがあります。Git Flowはdevelop/release/featureブランチを使い分け、GitHub Flowはmainとfeatureブランチのシンプルな構成です。",
      },
    ];

    const result = filterChunks(chunks);

    expect(result.kept).toHaveLength(3);
    expect(result.filtered).toBe(2);
    expect(result.reasons.get("short")).toBe(1);
    expect(result.reasons.get("trivial")).toBe(1);
  });

  test("全除外: 全て短文チャンク → kept=0, filtered=全件", () => {
    const chunks: QAChunk[] = [
      { question: "はい", answer: "はい" },
      { question: "OK", answer: "了解" },
      { question: "うん", answer: "ええ" },
    ];

    const result = filterChunks(chunks);

    expect(result.kept).toHaveLength(0);
    expect(result.filtered).toBe(chunks.length);
  });
});
