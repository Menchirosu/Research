import crypto from "node:crypto";
import { loadJsonIfExists, sanitizeFileName } from "./fs.js";
import { harvestPublicWatchlistPosts } from "./threads-public-web.js";
import { listPublicProfilePosts } from "./threads-api.js";

export function loadThreadsWatchlist(filePath) {
  const payload = loadJsonIfExists(filePath) ?? {};
  const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];

  return {
    accounts: accounts
      .filter((account) => account && typeof account === "object")
      .map((account) => ({
        username: String(account.username ?? "").trim().replace(/^@/, "").toLowerCase(),
        tier: normalizeTier(account.tier),
        lane: typeof account.lane === "string" ? account.lane.trim() : "ai-builder",
        allowReplies: account.allowReplies === true,
        enabled: account.enabled !== false,
        profileUrl:
          typeof account.profileUrl === "string" && account.profileUrl.trim()
            ? account.profileUrl.trim()
            : `https://www.threads.com/@${String(account.username ?? "").trim().replace(/^@/, "").toLowerCase()}`,
        maxCandidatesPerRun: Number.isFinite(account.maxCandidatesPerRun)
          ? Math.max(1, Math.min(5, Number(account.maxCandidatesPerRun)))
          : 2,
        verifiedExpected: typeof account.verifiedExpected === "boolean" ? account.verifiedExpected : null,
        manualWeight: Number.isFinite(account.manualWeight) ? Number(account.manualWeight) : 0,
        notes: typeof account.notes === "string" ? account.notes.trim() : null,
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
  const accounts = [];

  for (const account of watchlist.accounts ?? []) {
    if (!account.enabled) {
      continue;
    }

    const discovery = await discoverAccountPosts(config, account);
    for (const post of discovery.posts.slice(0, account.maxCandidatesPerRun)) {
      const built = buildTargetsFromWatchlistPost(config, account, post);
      results.push(...built);
    }
    accounts.push(evaluateWatchlistAccount(config, account, discovery.posts, results));

    if (discovery.errors.length > 0 && discovery.posts.length === 0) {
      errors.push({
        username: account.username,
        errors: discovery.errors,
        fallbackDiagnostics: discovery.diagnostics,
      });
    }
  }

  return {
    targets: dedupeTargets(results),
    accounts: sortWatchlistReports(accounts),
    errors,
  };
}

export async function buildWatchlistReport(config, watchlist) {
  const discovery = await buildWatchlistTargets(config, watchlist);
  return {
    generatedAt: new Date().toISOString(),
    mode: "threads-watchlist-report",
    counts: {
      accounts: watchlist.accounts.filter((account) => account.enabled).length,
      targets: discovery.targets.length,
      errors: discovery.errors.length,
    },
    accounts: discovery.accounts,
    targets: discovery.targets,
    errors: discovery.errors,
  };
}

async function discoverAccountPosts(config, account) {
  const mode = String(config.threads.publicDiscoveryMode ?? "rendered-first").toLowerCase();
  const diagnostics = [];
  const errors = [];

  const tryRendered = async () => {
    const rendered = await harvestPublicWatchlistPosts(config, account);
    diagnostics.push(...rendered.diagnostics);
    if (rendered.posts.length > 0) {
      return rendered.posts;
    }

    errors.push({
      source: "rendered",
      message: "No public posts were extracted from the rendered profile view.",
    });
    return [];
  };

  const tryApi = async () => {
    try {
      return await listPublicProfilePosts(config, account.username, 5);
    } catch (error) {
      errors.push({
        source: "api",
        message: String(error?.message ?? error),
      });
      return [];
    }
  };

  let posts = [];
  if (mode === "api-first") {
    posts = await tryApi();
    if (posts.length === 0) {
      posts = await tryRendered();
    }
  } else if (mode === "api-only") {
    posts = await tryApi();
  } else {
    posts = await tryRendered();
    if (posts.length === 0 && mode !== "rendered-only") {
      posts = await tryApi();
    }
  }

  return {
    posts,
    diagnostics,
    errors,
  };
}

function buildTargetsFromWatchlistPost(config, account, post) {
  if (account.tier === "candidate") {
    return [];
  }

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
    isVerified: post.is_verified === true,
    isReplyToUs: false,
    priority: deriveWatchlistPriority(account, post),
    targetOrigin: "watchlist",
    sourceProvider: "threads",
    sourceType: post.sourceType ?? "profile_post",
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
  const base = account.tier === "primary" ? 2 : account.tier === "secondary" ? 1 : 0;
  const visibleEngagement =
    Number(post.commentCount ?? 0) +
    Number(post.repostCount ?? 0) +
    Number(post.likeCount ?? 0) / 25;
  const bonus = visibleEngagement >= 8 ? 2 : visibleEngagement >= 2 ? 1 : 0;
  return Math.max(base, Math.min(base + bonus, 4));
}

function deriveWatchlistPriority(account, post) {
  const base = account.tier === "primary" ? 140 : account.tier === "secondary" ? 112 : 90;
  const replyPenalty = post.sourceType === "rendered_profile_reply" ? 15 : 0;
  const engagementBonus =
    Number(post.commentCount ?? 0) >= 5 || Number(post.repostCount ?? 0) >= 3 || Number(post.likeCount ?? 0) >= 100
      ? 10
      : 0;
  return (
    base +
    Number(account.manualWeight ?? 0) +
    (post.has_replies === true ? 10 : 0) +
    (post.is_verified === true ? 5 : 0) +
    engagementBonus -
    replyPenalty
  );
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

function evaluateWatchlistAccount(config, account, posts, allTargets) {
  const freshPosts = posts.filter((post) => isFreshPost(config, post.timestamp));
  const freshProfilePosts = freshPosts.filter((post) => post.sourceType === "rendered_profile_post");
  const freshReplyPosts = freshPosts.filter((post) => post.sourceType === "rendered_profile_reply");
  const visibleEngagement = freshPosts.reduce((total, post) => total + weightedEngagement(post), 0);
  const engagementScore = Math.min(100, Math.round(visibleEngagement));
  const observedVerified = posts.some((post) => post.is_verified === true);
  const accountTargets = allTargets.filter((target) => target.author === account.username);
  const quoteTargetCount = accountTargets.filter((target) => target.mode === "quote").length;
  const replyTargetCount = accountTargets.filter((target) => target.mode === "reply").length;
  const promotionScore = computePromotionScore(account, {
    observedVerified,
    freshProfilePosts: freshProfilePosts.length,
    freshReplyPosts: freshReplyPosts.length,
    engagementScore,
    quoteTargetCount,
    replyTargetCount,
  });
  const demotionRisk = computeDemotionRisk({
    freshProfilePosts: freshProfilePosts.length,
    freshReplyPosts: freshReplyPosts.length,
    engagementScore,
  });

  return {
    username: account.username,
    tier: account.tier,
    lane: account.lane,
    enabled: account.enabled,
    verifiedExpected: account.verifiedExpected,
    verifiedObserved: observedVerified,
    notes: account.notes,
    profileUrl: account.profileUrl,
    freshProfilePosts: freshProfilePosts.length,
    freshReplyPosts: freshReplyPosts.length,
    harvestedPosts: posts.length,
    quoteTargetCount,
    replyTargetCount,
    engagementScore,
    promotionScore,
    demotionRisk,
    status: classifyWatchlistStatus(account, {
      freshProfilePosts: freshProfilePosts.length,
      freshReplyPosts: freshReplyPosts.length,
      engagementScore,
      promotionScore,
      demotionRisk,
    }),
    recommendation: classifyWatchlistRecommendation(account, {
      promotionScore,
      demotionRisk,
      freshProfilePosts: freshProfilePosts.length,
      quoteTargetCount,
    }),
    latestFreshPost: describeLatestFreshPost(freshPosts),
  };
}

function describeLatestFreshPost(posts) {
  const latest = [...posts].sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))[0];
  if (!latest) {
    return null;
  }

  return {
    permalink: latest.permalink,
    publishedAt: latest.timestamp,
    sourceType: latest.sourceType,
    likeCount: latest.likeCount ?? 0,
    commentCount: latest.commentCount ?? 0,
    repostCount: latest.repostCount ?? 0,
    shareCount: latest.shareCount ?? 0,
    text: latest.text ? latest.text.slice(0, 220) : null,
  };
}

function computePromotionScore(account, input) {
  let score = 0;
  if (input.observedVerified || account.verifiedExpected === true) {
    score += 25;
  }
  if (input.freshProfilePosts > 0) {
    score += 30;
  }
  if (input.freshReplyPosts > 0) {
    score += 10;
  }
  if (input.quoteTargetCount > 0) {
    score += 10;
  }
  if (input.replyTargetCount > 0) {
    score += 5;
  }

  score += Math.min(20, Math.round(input.engagementScore / 5));
  score += Math.min(10, Math.max(0, Number(account.manualWeight ?? 0)));
  return Math.max(0, Math.min(100, score));
}

function computeDemotionRisk(input) {
  if (input.freshProfilePosts === 0 && input.freshReplyPosts === 0) {
    return "high";
  }
  if (input.freshProfilePosts === 0 || input.engagementScore < 15) {
    return "medium";
  }
  return "low";
}

function classifyWatchlistStatus(account, input) {
  if (input.freshProfilePosts === 0 && input.freshReplyPosts === 0) {
    return "stale";
  }
  if (input.promotionScore >= 75) {
    return "rising";
  }
  if (input.demotionRisk === "high") {
    return "demotion-risk";
  }
  return "stable";
}

function classifyWatchlistRecommendation(account, input) {
  if (account.tier === "candidate" && input.promotionScore >= 65 && input.freshProfilePosts > 0) {
    return "promote-to-secondary";
  }
  if (account.tier === "secondary" && input.promotionScore >= 80 && input.freshProfilePosts > 0 && input.quoteTargetCount > 0) {
    return "promote-to-primary";
  }
  if (account.tier === "primary" && input.demotionRisk === "high") {
    return "review-primary";
  }
  if (account.tier === "secondary" && input.demotionRisk === "high") {
    return "demote-to-candidate";
  }
  return "keep";
}

function weightedEngagement(post) {
  return (
    Number(post.commentCount ?? 0) * 4 +
    Number(post.repostCount ?? 0) * 3 +
    Number(post.shareCount ?? 0) * 2 +
    Number(post.likeCount ?? 0) / 20
  );
}

function isFreshPost(config, timestamp) {
  const ageHours = getAgeHours(config.now, timestamp);
  return Number.isFinite(ageHours) && ageHours <= config.posting.maxTargetAgeHours;
}

function sortWatchlistReports(accounts) {
  return [...accounts].sort((left, right) => {
    return (
      right.promotionScore - left.promotionScore ||
      right.engagementScore - left.engagementScore ||
      right.freshProfilePosts - left.freshProfilePosts ||
      right.quoteTargetCount - left.quoteTargetCount ||
      left.username.localeCompare(right.username)
    );
  });
}

function normalizeTier(value) {
  if (value === "candidate") {
    return "candidate";
  }
  if (value === "secondary") {
    return "secondary";
  }
  return "primary";
}

function getAgeHours(now, value) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.valueOf())) {
    return Number.POSITIVE_INFINITY;
  }

  return (now.getTime() - timestamp.getTime()) / (1000 * 60 * 60);
}
