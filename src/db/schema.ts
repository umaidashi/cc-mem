import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { config } from "../config";

const DEFAULT_DB_PATH = join(homedir(), ".cc-mem", "memory.db");

export function initDb(dbPath: string = config.dbPath ?? DEFAULT_DB_PATH): Database {
  // 親ディレクトリを自動作成
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath, { create: true });

  // WALモード有効化
  db.run("PRAGMA journal_mode = WAL");

  // memories テーブル
  db.run(`
    CREATE TABLE IF NOT EXISTS memories (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      question   TEXT NOT NULL,
      answer     TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      embedding  BLOB
    )
  `);

  // FTS5 全文検索テーブル (trigram)
  db.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts
    USING fts5(
      question,
      answer,
      content=memories,
      content_rowid=id,
      tokenize="trigram"
    )
  `);

  // トリガー: INSERT 時に FTS へ同期
  db.run(`
    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories
    BEGIN
      INSERT INTO memories_fts(rowid, question, answer)
      VALUES (new.id, new.question, new.answer);
    END
  `);

  // トリガー: DELETE 時に FTS から削除
  db.run(`
    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories
    BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, question, answer)
      VALUES ('delete', old.id, old.question, old.answer);
    END
  `);

  return db;
}
