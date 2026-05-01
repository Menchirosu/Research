import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ensureDir, sanitizeFileName } from "./fs.js";

export async function pickMediaCandidates(config, sources) {
  const ranked = sources
    .flatMap((source) =>
      (source.mediaCandidates ?? []).map((candidate) => ({
        ...candidate,
        sourceTitle: source.title,
        sourceUrl: source.url,
        signalScore: source.signalScore ?? source.score,
        signalTags: source.signalTags ?? [],
      }))
    )
    .filter((candidate) => isAllowedMediaUrl(config, candidate.url))
    .sort((left, right) => left.rank - right.rank || right.signalScore - left.signalScore);

  const unique = [];
  const seen = new Set();

  for (const candidate of ranked) {
    if (seen.has(candidate.url)) {
      continue;
    }

    seen.add(candidate.url);
    unique.push(candidate);
  }

  return unique.slice(0, 3);
}

export async function cacheMedia(config, candidate) {
  ensureDir(config.paths.mediaCacheDir);
  const extension = inferExtension(candidate.url);
  const fileName = `${sanitizeFileName(candidate.source)}-${crypto.randomUUID().slice(0, 8)}${extension}`;
  const filePath = path.join(config.paths.mediaCacheDir, fileName);
  const response = await fetch(candidate.url, {
    headers: {
      "user-agent": "research-trend-threader/0.1",
    },
  });

  if (!response.ok) {
    throw new Error(`Unable to download media ${candidate.url}: ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(filePath, bytes);
  return filePath;
}

export function isAllowedMediaUrl(config, value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();

    if (config.scan.blockedDomains.includes(hostname)) {
      return false;
    }

    return config.scan.mediaAllowlist.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function inferExtension(url) {
  const pathname = new URL(url).pathname.toLowerCase();
  if (pathname.endsWith(".png")) {
    return ".png";
  }
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) {
    return ".jpg";
  }
  if (pathname.endsWith(".webp")) {
    return ".webp";
  }
  return ".bin";
}
