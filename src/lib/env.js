import fs from "node:fs";

export function envFileExists(envFile) {
  return fs.existsSync(envFile);
}

export function readEnvFile(envFile) {
  if (!fs.existsSync(envFile)) {
    return {};
  }

  const lines = fs.readFileSync(envFile, "utf8").split(/\r?\n/);
  const values = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator < 0) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    values[key] = value;
  }

  return values;
}

export function upsertEnvValues(envFile, nextValues) {
  const existing = readEnvFile(envFile);
  const merged = {
    ...existing,
    ...nextValues,
  };

  const output = Object.entries(merged)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  fs.writeFileSync(envFile, `${output}\n`, "utf8");
}
