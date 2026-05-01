import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, {
    recursive: true,
  });
}

export function ensureRuntimeDirs(config) {
  ensureDir(config.paths.scansDir);
  ensureDir(config.paths.draftsDir);
  ensureDir(config.paths.receiptsDir);
  ensureDir(config.paths.summariesDir);
  ensureDir(config.paths.publishSessionsDir);
  ensureDir(config.paths.mediaCacheDir);
  ensureDir(config.paths.ledgersDir);
  ensureDir(path.dirname(config.paths.dbFile));
}

export function saveArtifact(baseDir, prefix, payload) {
  ensureDir(baseDir);
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const fileName = `${prefix}-${timestamp}-${crypto.randomUUID().slice(0, 8)}.json`;
  const filePath = path.join(baseDir, fileName);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
  return filePath;
}

export function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function loadJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return loadJson(filePath);
}

export function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

export function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

export function sanitizeFileName(value) {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}
