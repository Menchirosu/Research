import crypto from "node:crypto";
import { loadJsonIfExists, sanitizeFileName } from "./fs.js";
import { listPublicProfilePosts } from "./threads-api.js";

export function loadThreadsWatchlist(filePath) {
  const payload = loadJsonIfExists(filePath) ?? {};
  const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];

  return {
    accounts: accounts
      .filter((account) => account && typeof account === "object")
      .map((account) => ({
        username: String(account.username ?? "").trim().replace(/^@/, "").toLowerCase(),
        tier: account.tier === "secondary" ? "secondary" : "primary",
        lane: typeof account.lane === "string" ? account.lane.trim() : "ai-builder",
        allowReplies: account.allowReplies === true,
        enabled: account.enabled !== false,
      }))
      .filter((account) => account.username),
  };
}

export function loadSeededPosts(filePath) {
  const payload = loadJsonIfExists(filePath) ?? {};
  const posts = Array.isArray(payload.posts) ? payload.posts : [];

  return {
    posts: posts
      .filter((post) => post && typeof post === "object")
      .map((post, index) => ({
        id: post.id ?? `seeded-post-${index + 1}`,
        mode: post.mode === "reply" ? "reply" : "quote",
        platform: "threads",
        author: typeof post.author === "string" ? post.author.trim().replace(/^@/, "").toLowerCase() : null,
        url: typeof post.url === "string" ? post.url.trim() : null,
        postId: typeof post.postId === "string" ? post.postId.trim() : post.postId ? String(post.postId) : null,
        text: typeof post.text === "string" ? post.text.trim() : null,
        publishedAt: typeof post.publishedAt === "string" ? post.publishedAt.trim() : null,
        activityScore: Number.isFinite(post.activityScore) ? post.activityScore : 1,
        active: post.active !== false,
        isReplyToUs: post.isReplyToUs === true,
        priority: Number.isFinite(post.priority) ? post.priority : 110,
        targetOrigin: "seeded",
        sourceProvider: "threads",
        sourceType: "seeded-post",
        sourceHost: "www.threads.com",
        tier: post.tier === "secondary" ? "secondary" : "primary",
        allowReplies: post.allowReplies === true || post.mode === "reply",
        thresholdOverride: post.thresholdOverride === true,
        reason: typeof post.reason === "string" ? post.reason.trim() : null,
      }))
      .filter((post) => post.author && post.url && post.postId && post.publishedAt),
  };
}

export async function buildWatchlistTargets(config, watchlist) {
  const results = [];
  const errors = [];

  for (const account of watchlist.accounts ?? []) {
    if (!account.enabled) {
      continue;
    }

    try {
      const posts = await listPublicProfilePosts(config, account.username, 5);
      for (const post of posts) {
        const built = buildTargetsFromWatchlistPost(config, account, post);
        results.push(...built);
      }
    } catch (error) {
      errors.push({
        username: account.username,
        error: String(error?.message ?? error),
      });
    }
  }

  return {
    targets: dedupeTargets(results),
    errors,
  };
}

function buildTargetsFromWatchlistPost(config, account, post) {
  if (!post?.id || !post?.permalink || !post?.timestamp) {
    return [];
  }

  const ageHours = getAgeHours(config.now, post.timestamp);
  if (!Number.isFinite(ageHours) || ageHours > config.posting.maxTargetAgeHours) {
    return [];
  }

  const base = {
    platform: "threads",
    author: String(post.username ?? account.username).trim().replace(/^@/, "").toLowerCase(),
    url: String(post.permalink).trim(),
    postId: String(post.id),
    text: typeof post.text === "string" ? post.text.trim() : null,
    publishedAt: String(post.timestamp),
    activityScore: deriveWatchlistActivity(account, post),
    active: true,
    isReplyToUs: false,
    priority: deriveWatchlistPriority(account, post),
    targetOrigin: "watchlist",
    sourceProvider: "threads",
    sourceType: "profile_post",
    sourceHost: "www.threads.com",
    tier: account.tier,
    allowReplies: account.allowReplies,
    thresholdOverride: false,
    reason: null,
  };

  const targets = [
    {
      ...base,
      id: buildTargetId(account.username, post.id, "quote"),
      mode: "quote",
    },
  ];

  if (
    account.allowReplies &&
    account.tier === "primary" &&
    post.has_replies === true &&
    ageHours <= config.posting.overnightPrimaryReplyMaxAgeHours
  ) {
    targets.push({
      ...base,
      id: buildTargetId(account.username, post.id, "reply"),
      mode: "reply",
      priority: base.priority - 5,
    });
  }

  return targets;
}

function deriveWatchlistActivity(account, post) {
  const base = account.tier === "primary" ? 2 : 1;
  return post.has_replies === true ? Math.min(base + 1, 3) : base;
}

function deriveWatchlistPriority(account, post) {
  const base = account.tier === "primary" ? 140 : 105;
  return base + (post.has_replies === true ? 10 : 0) + (post.is_verified === true ? 5 : 0);
}

function dedupeTargets(targets) {
  const seen = new Set();
  const results = [];

  for (const target of targets) {
    const key = `${target.mode}:${target.postId}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    results.push(target);
  }

  return results;
}

function buildTargetId(username, postId, mode) {
  const hash = crypto.createHash("sha1").update(`${username}:${postId}:${mode}`).digest("hex").slice(0, 10);
  return `threads-${sanitizeFileName(username)}-${mode}-${hash}`;
}

function getAgeHours(now, value) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.valueOf())) {
    return Number.POSITIVE_INFINITY;
  }

  return (now.getTime() - timestamp.getTime()) / (1000 * 60 * 60);
}
