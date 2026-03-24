import type { QAChunk } from "../chunker";
import { config } from "../config";

export interface FilterResult {
  kept: QAChunk[];
  filtered: number;
  reasons: Map<string, number>;
}

const TRIVIAL_Q_PATTERN =
  /^(はい|OK|ok|おk|続けて|お願い(します)?|いいね|よろしく|ありがとう(ございます)?|了解|承知(しました)?|うん|ええ|頼む|やって|それで)[\s。！!]*$/i;

const TRIVIAL_A_PATTERN =
  /^(はい|OK|了解(しました|です)?|承知(しました|です)?|わかりました|かしこまりました|どういたしまして[！!。]?.*|他に(質問|ご質問)があれば.*|お役に立てて.*|ご不明な点があれば.*)[\s。！!]*$/i;

export function filterChunks(
  chunks: QAChunk[],
  options?: { minLength?: number },
): FilterResult {
  const minLength = options?.minLength ?? config.minChunkLength;

  const kept: QAChunk[] = [];
  const reasons = new Map<string, number>();

  for (const chunk of chunks) {
    const isTrivialQ = TRIVIAL_Q_PATTERN.test(chunk.question);
    const isTrivialA = TRIVIAL_A_PATTERN.test(chunk.answer);
    const isShort = chunk.question.length + chunk.answer.length < minLength;

    // trivial check first (Q AND A both match)
    if (isTrivialQ && isTrivialA) {
      reasons.set("trivial", (reasons.get("trivial") ?? 0) + 1);
      continue;
    }

    // short check
    if (isShort) {
      reasons.set("short", (reasons.get("short") ?? 0) + 1);
      continue;
    }

    kept.push(chunk);
  }

  return {
    kept,
    filtered: chunks.length - kept.length,
    reasons,
  };
}
