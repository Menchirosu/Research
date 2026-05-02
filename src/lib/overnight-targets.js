import crypto from "node:crypto";
import { loadJsonIfExists, sanitizeFileName } from "./fs.js";

const DEFAULT_HARVEST = {
  enabled: true,
  providers: ["reddit", "hackernews", "github"],
  allowedDomains: ["reddit.com", "www.reddit.com", "news.ycombinator.com", "github.com"],
  maxTargets: 8,
  maxPerProvider: 3,
  minimumSignalScore: 70,
  minimumActivityScore: 1,
};

export function loadOvernightTargets(filePath) {
  const payload = loadJsonIfExists(filePath) ?? {};
  return {
    allowedAuthors: normalizeAllowedAuthors(payload.allowedAuthors),
    harvest: normalizeHarvestConfig(payload.harvest),
    targets: normalizeTargets(payload.targets),
  };
}

export function buildHarvestedTargets(config, scan, targetConfig) {
  const harvestConfig = targetConfig.harvest;
  if (!harvestConfig.enabled) {
    return [];
  }

  const providerCounts = new Map();
  const results = [];

  for (const source of scan.sources ?? []) {
    if (results.length >= harvestConfig.maxTargets) {
      break;
    }

    const reason = getHarvestSkipReason(config, source, harvestConfig, providerCounts);
    if (reason) {
      continue;
    }

    const target = buildHarvestTarget(source);
    if (!target) {
      continue;
    }

    results.push(target);
    providerCounts.set(source.provider, (providerCounts.get(source.provider) ?? 0) + 1);
  }

  return results;
}

export function mergeOvernightTargets(manualTargets, harvestedTargets) {
  const merged = [];
  const seen = new Set();

  for (const target of [...manualTargets, ...harvestedTargets]) {
    const key = buildTargetDedupKey(target);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(target);
  }

  return merged;
}

export function inferTargetPlatform(target) {
  const url = String(target?.url ?? "");
  if (/threads\.com|threads\.net/i.test(url)) {
    return "threads";
  }
  if (/x\.com|twitter\.com/i.test(url)) {
    return "x";
  }
  return "external";
}

function normalizeAllowedAuthors(value) {
  const platforms = ["threads", "x"];
  const normalized = Object.fromEntries(platforms.map((platform) => [platform, []]));

  if (!value || typeof value !== "object") {
    return normalized;
  }

  for (const platform of platforms) {
    normalized[platform] = Array.isArray(value[platform])
      ? value[platform].map((entry) => String(entry).trim().toLowerCase()).filter(Boolean)
      : [];
  }

  return normalized;
}

function normalizeHarvestConfig(value) {
  const config = value && typeof value === "object" ? value : {};
  return {
    enabled: config.enabled !== false,
    providers: normalizeStringList(config.providers, DEFAULT_HARVEST.providers),
    allowedDomains: normalizeStringList(config.allowedDomains, DEFAULT_HARVEST.allowedDomains),
    maxTargets: normalizePositiveInteger(config.maxTargets, DEFAULT_HARVEST.maxTargets),
    maxPerProvider: normalizePositiveInteger(config.maxPerProvider, DEFAULT_HARVEST.maxPerProvider),
    minimumSignalScore: normalizePositiveInteger(config.minimumSignalScore, DEFAULT_HARVEST.minimumSignalScore),
    minimumActivityScore: normalizePositiveInteger(config.minimumActivityScore, DEFAULT_HARVEST.minimumActivityScore),
  };
}

function normalizeTargets(targets) {
  if (!Array.isArray(targets)) {
    return [];
  }

  return targets
    .filter((target) => target && typeof target === "object")
    .map((target, index) => ({
      id: target.id ?? `target-${index + 1}`,
      mode: target.mode ?? "quote",
      platform: target.platform ?? inferTargetPlatform(target),
      author: typeof target.author === "string" ? target.author.trim() : null,
      url: typeof target.url === "string" ? target.url.trim() : null,
      postId: typeof target.postId === "string" ? target.postId.trim() : target.postId ? String(target.postId) : null,
      text: typeof target.text === "string" ? target.text.trim() : null,
      publishedAt: typeof target.publishedAt === "string" ? target.publishedAt.trim() : null,
      activityScore: Number.isFinite(target.activityScore) ? target.activityScore : 0,
      active: target.active !== false,
      isReplyToUs: target.isReplyToUs === true,
      priority: Number.isFinite(target.priority) ? target.priority : 0,
      autoHarvested: target.autoHarvested === true,
      sourceProvider: typeof target.sourceProvider === "string" ? target.sourceProvider.trim().toLowerCase() : null,
      sourceType: typeof target.sourceType === "string" ? target.sourceType.trim() : null,
      sourceHost: typeof target.sourceHost === "string" ? target.sourceHost.trim().toLowerCase() : null,
      referenceUrl: typeof target.referenceUrl === "string" ? target.referenceUrl.trim() : null,
      targetOrigin: typeof target.targetOrigin === "string" ? target.targetOrigin.trim().toLowerCase() : null,
      tier: target.tier === "secondary" ? "secondary" : "primary",
      allowReplies: target.allowReplies === true,
      thresholdOverride: target.thresholdOverride === true,
      reason: typeof target.reason === "string" ? target.reason.trim() : null,
    }));
}

function buildHarvestTarget(source) {
  if (!isHarvestableSource(source)) {
    return null;
  }

  const discussionUrl = typeof source.discussionUrl === "string" ? source.discussionUrl.trim() : null;
  const primaryUrl = typeof source.url === "string" ? source.url.trim() : null;
  const targetUrl = discussionUrl || primaryUrl;
  if (!targetUrl) {
    return null;
  }

  const provider = String(source.provider ?? "").toLowerCase();
  const sourceHost = extractHost(targetUrl);
  const referenceUrl = discussionUrl && primaryUrl && discussionUrl !== primaryUrl ? primaryUrl : null;
  const author = deriveHarvestAuthor(source, sourceHost);
  const comment = cleanCommentSummary(source.commentSummary);
  const text = [source.title, comment].filter(Boolean).join(" ").slice(0, 420);

  return {
    id: buildHarvestTargetId(provider, targetUrl),
    mode: "react",
    platform: inferTargetPlatform({ url: targetUrl }),
    author,
    url: targetUrl,
    postId: null,
    text,
    publishedAt: source.publishedAt ?? null,
    activityScore: deriveActivityScore(source),
    priority: Math.round(source.signalScore ?? source.score ?? 0),
    active: true,
    isReplyToUs: false,
    autoHarvested: true,
    sourceProvider: provider,
    sourceType: source.sourceType ?? null,
    sourceHost,
    referenceUrl,
    targetOrigin: "scan-harvested",
    tier: "secondary",
    allowReplies: false,
    thresholdOverride: false,
    reason: null,
  };
}

function isHarvestableSource(source) {
  const provider = String(source.provider ?? "").toLowerCase();
  const sourceType = String(source.sourceType ?? "").toLowerCase();

  // Repository pages are useful scan support, but they are weak overnight react targets.
  if (provider === "github" && sourceType === "repository") {
    return false;
  }

  return true;
}

function getHarvestSkipReason(config, source, harvestConfig, providerCounts) {
  const provider = String(source.provider ?? "").toLowerCase();
  if (!harvestConfig.providers.includes(provider)) {
    return "provider not allowed";
  }

  const providerCount = providerCounts.get(provider) ?? 0;
  if (providerCount >= harvestConfig.maxPerProvider) {
    return "provider cap reached";
  }

  const signalScore = Number(source.signalScore ?? source.score ?? 0);
  if (signalScore < harvestConfig.minimumSignalScore) {
    return "signal score too low";
  }

  const activityScore = deriveActivityScore(source);
  if (activityScore < harvestConfig.minimumActivityScore) {
    return "activity score too low";
  }

  const publishedAt = new Date(source.publishedAt ?? "");
  if (Number.isNaN(publishedAt.valueOf())) {
    return "missing published timestamp";
  }

  const ageHours = (config.now.getTime() - publishedAt.getTime()) / (1000 * 60 * 60);
  if (ageHours > config.posting.maxTargetAgeHours) {
    return "target is too old for overnight mode";
  }

  const targetUrl = typeof source.discussionUrl === "string" ? source.discussionUrl : source.url;
  const host = extractHost(targetUrl);
  if (!host) {
    return "missing target host";
  }

  if (!hostAllowed(host, harvestConfig.allowedDomains)) {
    return "domain not allowed";
  }

  return null;
}

function deriveActivityScore(source) {
  const engagement = source.engagement ?? {};
  const comments = Number(engagement.comments ?? 0);
  const points = Number(engagement.points ?? engagement.score ?? 0);
  const score = Number(source.signalScore ?? source.score ?? 0);

  if (comments >= 30 || points >= 80 || score >= 130) {
    return 3;
  }

  if (comments >= 10 || points >= 20 || score >= 95) {
    return 2;
  }

  return 1;
}

function deriveHarvestAuthor(source, sourceHost) {
  const provider = String(source.provider ?? "").toLowerCase();
  const sourceType = String(source.sourceType ?? "").toLowerCase();

  if (provider === "reddit") {
    const match = sourceType.match(/r\/([^:]+)/i);
    if (match) {
      return `r/${match[1].toLowerCase()}`;
    }
  }

  if (provider === "github") {
    const url = tryParseUrl(source.url);
    const owner = url?.pathname.split("/").filter(Boolean)[0];
    const repo = url?.pathname.split("/").filter(Boolean)[1];
    if (owner && repo) {
      return `${owner.toLowerCase()}/${repo.toLowerCase()}`;
    }
    if (owner) {
      return owner.toLowerCase();
    }
  }

  if (provider === "hackernews") {
    return sourceHost || "news.ycombinator.com";
  }

  return sourceHost || provider || "external";
}

function buildTargetDedupKey(target) {
  const mode = String(target.mode ?? "quote").toLowerCase();
  if (target.postId) {
    return `post:${target.postId}:${mode}`;
  }

  if (target.url) {
    return `url:${target.url.toLowerCase()}:${mode}`;
  }

  return `id:${target.id}:${mode}`;
}

function buildHarvestTargetId(provider, url) {
  const hash = crypto.createHash("sha1").update(url).digest("hex").slice(0, 10);
  return `harvest-${sanitizeFileName(provider)}-${hash}`;
}

function extractHost(value) {
  const parsed = tryParseUrl(value);
  return parsed?.hostname?.toLowerCase() ?? null;
}

function tryParseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function hostAllowed(host, allowedDomains) {
  return allowedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function cleanCommentSummary(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, 220);
}

function normalizeStringList(value, fallback) {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const normalized = value.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean);
  return normalized.length > 0 ? normalized : [...fallback];
}

function normalizePositiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
