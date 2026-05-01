import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import { ensureRuntimeDirs, loadJsonIfExists } from "./fs.js";

export function initDatabase(config) {
  ensureRuntimeDirs(config);
  const db = new DatabaseSync(config.paths.dbFile);

  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      hook TEXT NOT NULL,
      draft_hash TEXT NOT NULL,
      published_at TEXT NOT NULL,
      source_count INTEGER NOT NULL,
      receipt_path TEXT NOT NULL,
      root_post_id TEXT,
      root_permalink TEXT,
      target_mode TEXT,
      move_type TEXT
    );
  `);

  ensureColumn(db, "posts", "root_post_id", "TEXT");
  ensureColumn(db, "posts", "root_permalink", "TEXT");
  ensureColumn(db, "posts", "target_mode", "TEXT");
  ensureColumn(db, "posts", "move_type", "TEXT");

  return db;
}

export function recordPublishReceipt(db, receipt, receiptPath) {
  const draftHash = crypto.createHash("sha256").update(JSON.stringify(receipt.draft)).digest("hex");
  const targetMode = receipt.draft?.target?.mode ?? "original";
  const moveType = classifyMoveType(targetMode);
  const statement = db.prepare(`
    INSERT INTO posts (id, topic, hook, draft_hash, published_at, source_count, receipt_path, root_post_id, root_permalink, target_mode, move_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  statement.run(
    crypto.randomUUID(),
    receipt.topic,
    receipt.draft.posts[0]?.text ?? "",
    draftHash,
    receipt.publishedAt,
    receipt.draft.sources.length,
    receiptPath,
    receipt.publishedPosts[0]?.id ?? null,
    receipt.publishedPosts[0]?.permalink ?? null,
    targetMode,
    moveType
  );
}

export function findRecentDuplicates(db, draft, limit = 10) {
  const hook = draft.posts[0]?.text ?? "";
  const statement = db.prepare(`
    SELECT hook, published_at, receipt_path
    FROM posts
    ORDER BY published_at DESC
    LIMIT ?
  `);

  const rows = statement.all(limit);
  return rows.filter((row) => similarityScore(row.hook, hook) >= 0.8);
}

export function getHistorySummary(db) {
  const countRow = db.prepare("SELECT COUNT(*) AS count FROM posts").get();
  const rows = db
    .prepare(`
    SELECT hook, topic, published_at, receipt_path
    , root_post_id, root_permalink
      FROM posts
      ORDER BY published_at DESC
      LIMIT 20
    `)
    .all();

  return {
    totalPosts: countRow.count,
    recent: rows.map((row) => {
      if (row.root_permalink || !row.receipt_path) {
        return row;
      }

      const receipt = loadJsonIfExists(row.receipt_path);
      return {
        ...row,
        root_post_id: row.root_post_id ?? receipt?.publishedPosts?.[0]?.id ?? null,
        root_permalink: receipt?.publishedPosts?.[0]?.permalink ?? null,
      };
    }),
  };
}

export function getRecentBudgetUsage(db, now, windowHours = 24) {
  const cutoff = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  const rows = db
    .prepare(`
      SELECT published_at, receipt_path, target_mode, move_type, hook
      FROM posts
      ORDER BY published_at DESC
    `)
    .all();

  const recentRows = rows.filter((row) => {
    const publishedAt = new Date(row.published_at);
    return !Number.isNaN(publishedAt.valueOf()) && publishedAt >= cutoff;
  });

  const enriched = recentRows.map((row) => {
    const receipt = row.receipt_path ? loadJsonIfExists(row.receipt_path) : null;
    const targetMode = row.target_mode ?? receipt?.draft?.target?.mode ?? "original";
    const moveType = row.move_type ?? classifyMoveType(targetMode);
    return {
      ...row,
      target_mode: targetMode,
      move_type: moveType,
    };
  });

  return {
    windowHours,
    cutoff: cutoff.toISOString(),
    totals: {
      originals: enriched.filter((row) => row.move_type === "original").length,
      interactions: enriched.filter((row) => row.move_type === "interaction").length,
      overall: enriched.length,
    },
    recent: enriched,
  };
}

function similarityScore(left, right) {
  if (!left || !right) {
    return 0;
  }

  const leftWords = new Set(left.toLowerCase().split(/\W+/).filter(Boolean));
  const rightWords = new Set(right.toLowerCase().split(/\W+/).filter(Boolean));
  const overlap = [...leftWords].filter((word) => rightWords.has(word)).length;
  const total = new Set([...leftWords, ...rightWords]).size;
  return total === 0 ? 0 : overlap / total;
}

function ensureColumn(db, tableName, columnName, columnType) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const exists = columns.some((column) => column.name === columnName);
  if (!exists) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`);
  }
}

function classifyMoveType(targetMode) {
  return targetMode === "reply" || targetMode === "quote" ? "interaction" : "original";
}
