import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ensureDir, sanitizeFileName } from "./fs.js";

export async function harvestPublicWatchlistPosts(config, account) {
  const profile = await browsePublicThreadsProfile(config, account.username, {
    includeReplies: account.allowReplies,
  });

  return {
    posts: profile.posts,
    diagnostics: profile.diagnostics,
  };
}

export async function browsePublicThreadsProfile(config, username, options = {}) {
  const normalizedUsername = normalizeThreadsUsername(username);
  const includeReplies = options.includeReplies !== false;
  const tabs = includeReplies ? ["threads", "replies"] : ["threads"];
  const posts = [];
  const diagnostics = [];

  for (const tab of tabs) {
    const result = renderThreadsPage(
      config,
      buildProfileUrl(normalizedUsername, tab),
      `${sanitizeFileName(normalizedUsername)}-${tab}-rendered.html`,
      {
        username: normalizedUsername,
        tab,
      }
    );

    diagnostics.push({
      username: normalizedUsername,
      tab,
      status: result.status,
      error: result.error ?? null,
      cachePath: result.cachePath ?? null,
      postCount: result.posts?.length ?? 0,
    });

    if (result.status !== "ok") {
      continue;
    }

    posts.push(...result.posts);
  }

  const deduped = dedupePosts(posts);
  return {
    username: normalizedUsername,
    profileUrl: buildProfileUrl(normalizedUsername, "threads"),
    posts: deduped,
    profilePosts: deduped.filter((post) => post.sourceType === "rendered_profile_post"),
    replyPosts: deduped.filter((post) => post.sourceType === "rendered_profile_reply"),
    diagnostics,
    verifiedObserved: deduped.some((post) => post.is_verified === true),
  };
}

export async function browsePublicThreadsPost(config, url) {
  const normalizedUrl = normalizeThreadsPostUrl(url);
  const result = renderThreadsPage(
    config,
    normalizedUrl,
    `threads-post-${sanitizeFileName(normalizedUrl)}.html`,
    {
      tab: "post",
      focusPermalink: normalizedUrl,
    }
  );

  const diagnostics = [
    {
      url: normalizedUrl,
      status: result.status,
      error: result.error ?? null,
      cachePath: result.cachePath ?? null,
      postCount: result.posts?.length ?? 0,
    },
  ];

  if (result.status !== "ok") {
    return {
      url: normalizedUrl,
      rootPost: null,
      relatedPosts: [],
      posts: [],
      diagnostics,
      verifiedObserved: false,
    };
  }

  const rootPost = pickRootPost(normalizedUrl, result.posts) ?? extractFocusedPostFromHtml(result.html, normalizedUrl);
  const relatedPosts = result.posts.filter((post) => post.permalink !== rootPost?.permalink);

  return {
    url: normalizedUrl,
    rootPost,
    relatedPosts,
    posts: result.posts,
    diagnostics,
    verifiedObserved: result.posts.some((post) => post.is_verified === true),
  };
}

export async function discoverPublicThreadsProfiles(config, accounts, options = {}) {
  const limit = Number.isFinite(options.limit) ? Math.max(1, Number(options.limit)) : 10;
  const profiles = [];
  const notablePosts = [];

  for (const account of accounts) {
    const profile = await browsePublicThreadsProfile(config, account.username, {
      includeReplies: account.allowReplies === true,
    });

    const rankedPosts = rankNotablePosts(config, profile.posts, account).slice(0, account.maxCandidatesPerRun ?? 2);
    profiles.push({
      username: account.username,
      tier: account.tier ?? "candidate",
      lane: account.lane ?? "ai-builder",
      enabled: account.enabled !== false,
      profileUrl: profile.profileUrl,
      verifiedExpected: account.verifiedExpected ?? null,
      verifiedObserved: profile.verifiedObserved,
      notes: account.notes ?? null,
      postCount: profile.posts.length,
      freshPostCount: profile.posts.filter((post) => isFreshEnough(config, post.timestamp)).length,
      replyPostCount: profile.replyPosts.length,
      diagnostics: profile.diagnostics,
      topPosts: rankedPosts.slice(0, 3),
    });

    for (const post of rankedPosts) {
      notablePosts.push(post);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    mode: "threads-discovery",
    accounts: sortProfiles(profiles),
    posts: sortNotablePosts(notablePosts).slice(0, limit),
  };
}

function renderThreadsPage(config, url, cacheFileName, options = {}) {
  const browser = resolveBrowserExecutable(config);
  if (!browser) {
    return {
      status: "error",
      error: "No supported browser executable found for Threads watchlist rendering.",
      posts: [],
    };
  }

  const cachePath = path.join(config.paths.cacheDir, cacheFileName);
  ensureDir(path.dirname(cachePath));

  const args = [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${path.join(config.paths.cacheDir, "threads-browser-profile")}`,
    "--virtual-time-budget=8000",
    url,
  ];

  if (process.platform === "linux") {
    args.unshift("--disable-dev-shm-usage");
    args.unshift("--no-sandbox");
  }

  args.splice(args.length - 1, 0, "--dump-dom");

  const rendered = spawnSync(browser, args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });

  if (rendered.error) {
    return {
      status: "error",
      error: String(rendered.error.message ?? rendered.error),
      posts: [],
      cachePath,
    };
  }

  if (rendered.status !== 0 || !rendered.stdout) {
    return {
      status: "error",
      error: `Browser render failed with status ${rendered.status ?? "unknown"}: ${String(
        rendered.stderr ?? ""
      ).slice(0, 400)}`,
      posts: [],
      cachePath,
    };
  }

  const html = rendered.stdout;
  fs.writeFileSync(cachePath, html, "utf8");

  return {
    status: "ok",
    posts: extractRenderedPosts(html, options),
    cachePath,
    html,
  };
}

function resolveBrowserExecutable(config) {
  if (config.threads.browserPath && fs.existsSync(config.threads.browserPath)) {
    return config.threads.browserPath;
  }

  const candidates = process.platform === "win32"
    ? [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      ]
    : [
        "google-chrome",
        "google-chrome-stable",
        "chromium-browser",
        "chromium",
        "chrome",
        "microsoft-edge",
      ];

  for (const candidate of candidates) {
    if (process.platform === "win32") {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
      continue;
    }

    const check = spawnSync(candidate, ["--version"], {
      encoding: "utf8",
      timeout: 5000,
    });
    if (check.status === 0) {
      return candidate;
    }
  }

  return null;
}

function buildProfileUrl(username, tab) {
  const base = `https://www.threads.com/@${username}`;
  return tab === "replies" ? `${base}/replies` : base;
}

function extractRenderedPosts(html, options = {}) {
  const usernameFilter = options.username ? normalizeThreadsUsername(options.username) : null;
  const tab = options.tab ?? "threads";
  const focusPermalink = options.focusPermalink ? normalizeThreadsPostUrl(options.focusPermalink) : null;
  const mediaIdMap = extractMediaIdMap(html);
  const renderHtml = stripNonContentBlocks(html);
  const permalinkPattern = /\/@([A-Za-z0-9._]+)\/post\/([A-Za-z0-9_-]+)/g;
  const matches = [...renderHtml.matchAll(permalinkPattern)];
  const seen = new Set();
  const posts = [];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const username = normalizeThreadsUsername(match[1] ?? "");
    const shortcode = match[2] ?? null;
    if (!shortcode || !username) {
      continue;
    }

    if (usernameFilter && username !== usernameFilter) {
      continue;
    }

    const permalink = `https://www.threads.com/@${username}/post/${shortcode}`;
    const postKey = `${username}:${shortcode}`;
    if (seen.has(postKey)) {
      continue;
    }

    seen.add(postKey);

    const snippetStart = match.index ?? 0;
    const snippetEnd = matches[index + 1]?.index ?? Math.min(renderHtml.length, snippetStart + 40000);
    const snippet = extractArticleSnippet(renderHtml, snippetStart, snippetEnd);
    const publishedAt = matchGroup(snippet, /datetime="([^"]+)"/);

    if (!publishedAt) {
      continue;
    }

    const metrics = {
      likeCount: extractMetric(snippet, "Like"),
      commentCount: extractMetric(snippet, "Comment"),
      repostCount: extractMetric(snippet, "Repost"),
      shareCount: extractMetric(snippet, "Share"),
    };

    const contentHtml = extractContentSlice(snippet);
    const text = normalizeRenderedText(contentHtml);
    const isReplyTab = tab === "replies";
    const isReplying = /Replying to\s*@/i.test(text);
    const isRoot = focusPermalink ? normalizeThreadsPostUrl(permalink) === focusPermalink : false;

    posts.push({
      id: mediaIdMap.get(shortcode) ?? shortcode,
      shortcode,
      permalink,
      username,
      text: text || null,
      timestamp: publishedAt,
      has_replies: metrics.commentCount > 0,
      is_verified: true,
      sourceType:
        tab === "post"
          ? "rendered_post_page"
          : isReplyTab
            ? "rendered_profile_reply"
            : "rendered_profile_post",
      tab,
      isReplying,
      isRoot,
      ...metrics,
    });
  }

  return posts;
}

function extractContentSlice(snippet) {
  const start = snippet.indexOf("</time></a>");
  const likeIndex = snippet.indexOf('aria-label="Like"');
  const commentIndex = snippet.indexOf('aria-label="Comment"');
  const end = [likeIndex, commentIndex].filter((value) => value >= 0).sort((left, right) => left - right)[0] ?? -1;
  if (start < 0 || end < 0 || end <= start) {
    return snippet;
  }

  return snippet.slice(start + "</time></a>".length, end);
}

function normalizeRenderedText(html) {
  const cleaned = html
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<svg[\s\S]*$/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<title[\s\S]*?<\/title>/gi, " ")
    .replace(/<template[\s\S]*?<\/template>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#039;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned
    .replace(/^More\s+/i, "")
    .replace(/\bLike\s+\d+.*$/i, "")
    .trim();
}

function extractMetric(snippet, label) {
  const raw = matchGroup(
    snippet,
    new RegExp(`aria-label="${label}"[\\s\\S]{0,2200}?>([0-9][0-9.,KMB]*)</span>`, "i")
  );
  return parseMetricValue(raw);
}

function parseMetricValue(value) {
  if (!value) {
    return 0;
  }

  const normalized = value.replace(/,/g, "").trim().toUpperCase();
  const match = normalized.match(/^([0-9]*\.?[0-9]+)([KMB])?$/);
  if (!match) {
    return 0;
  }

  const amount = Number(match[1]);
  const suffix = match[2];
  if (!Number.isFinite(amount)) {
    return 0;
  }

  if (suffix === "K") {
    return Math.round(amount * 1_000);
  }
  if (suffix === "M") {
    return Math.round(amount * 1_000_000);
  }
  if (suffix === "B") {
    return Math.round(amount * 1_000_000_000);
  }

  return Math.round(amount);
}

function matchGroup(value, pattern) {
  const match = value.match(pattern);
  return match?.[1] ?? null;
}

function dedupePosts(posts) {
  const seen = new Set();
  const results = [];

  for (const post of posts) {
    const key = `${post.sourceType}:${post.permalink}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    results.push(post);
  }

  return results;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeThreadsPostUrl(value) {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

function normalizeThreadsUsername(value) {
  return String(value ?? "").trim().replace(/^@/, "").toLowerCase();
}

function extractMediaIdMap(html) {
  const map = new Map();
  const scriptPattern = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  const codePattern = /"code":"([A-Za-z0-9_-]+)"/g;

  for (const scriptMatch of html.matchAll(scriptPattern)) {
    const scriptBody = scriptMatch[1] ?? "";
    for (const match of scriptBody.matchAll(codePattern)) {
      const shortcode = match[1] ?? null;
      if (!shortcode || map.has(shortcode)) {
        continue;
      }

      const codeIndex = match.index ?? 0;
      const windowStart = Math.max(0, codeIndex - 250_000);
      const windowEnd = Math.min(scriptBody.length, codeIndex + 1_000);
      const windowSlice = scriptBody.slice(windowStart, windowEnd);
      const anchorIndex = windowSlice.lastIndexOf('"post":{"id":"');
      const scopedSlice = windowSlice.slice(anchorIndex >= 0 ? anchorIndex : 0);
      const interactionMediaId = lastMatchGroup(scopedSlice, /XDTTextPostAppMediaInfo:(\d+)/g);
      const postPk = matchGroup(scopedSlice, /"post":\{"id":"\d+_\d+"[\s\S]{0,1200}?"pk":"(\d+)"/);
      const rawId = matchGroup(scopedSlice, /"post":\{"id":"(\d+_\d+)"/);
      const mediaId = interactionMediaId ?? postPk ?? rawId;

      if (mediaId) {
        map.set(shortcode, mediaId);
      }
    }
  }

  return map;
}

function stripNonContentBlocks(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<template[\s\S]*?<\/template>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

function lastMatchGroup(value, pattern) {
  const matches = [...value.matchAll(pattern)];
  const last = matches.at(-1);
  return last?.[1] ?? null;
}

function extractArticleSnippet(html, fallbackStart, fallbackEnd) {
  const articleStart = html.lastIndexOf("<article", fallbackStart);
  if (articleStart >= 0) {
    const articleEnd = html.indexOf("</article>", fallbackStart);
    if (articleEnd > articleStart) {
      return html.slice(articleStart, articleEnd + "</article>".length);
    }
  }

  return html.slice(fallbackStart, fallbackEnd);
}

function pickRootPost(url, posts) {
  const normalizedUrl = normalizeThreadsPostUrl(url);
  return posts.find((post) => normalizeThreadsPostUrl(post.permalink) === normalizedUrl)
    ?? posts.find((post) => post.isRoot)
    ?? null;
}

function rankNotablePosts(config, posts, account) {
  return [...posts]
    .filter((post) => isFreshEnough(config, post.timestamp))
    .map((post) => ({
      account: account.username,
      tier: account.tier ?? "candidate",
      lane: account.lane ?? "ai-builder",
      notableScore: computeNotableScore(config, post, account),
      ...post,
    }))
    .sort((left, right) => {
      return (
        right.notableScore - left.notableScore ||
        Date.parse(right.timestamp) - Date.parse(left.timestamp) ||
        right.commentCount - left.commentCount ||
        right.repostCount - left.repostCount
      );
    });
}

function computeNotableScore(config, post, account) {
  const ageHours = getAgeHours(config.now, post.timestamp);
  const freshnessBonus = Math.max(0, 60 - Math.round(ageHours * 2));
  const engagementScore =
    Number(post.commentCount ?? 0) * 5 +
    Number(post.repostCount ?? 0) * 4 +
    Number(post.shareCount ?? 0) * 2 +
    Number(post.likeCount ?? 0) / 10;
  const tierBonus = account.tier === "primary" ? 20 : account.tier === "secondary" ? 10 : 0;
  const replyPenalty = post.isReplying ? 8 : 0;
  const noteWeight = Number(account.manualWeight ?? 0);
  return Math.max(0, Math.round(freshnessBonus + engagementScore + tierBonus + noteWeight - replyPenalty));
}

function isFreshEnough(config, timestamp) {
  return getAgeHours(config.now, timestamp) <= config.posting.maxTargetAgeHours;
}

function getAgeHours(now, value) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.valueOf())) {
    return Number.POSITIVE_INFINITY;
  }

  return (now.getTime() - timestamp.getTime()) / (1000 * 60 * 60);
}

function sortProfiles(profiles) {
  return [...profiles].sort((left, right) => {
    return (
      (right.topPosts[0]?.notableScore ?? 0) - (left.topPosts[0]?.notableScore ?? 0) ||
      right.freshPostCount - left.freshPostCount ||
      right.postCount - left.postCount ||
      left.username.localeCompare(right.username)
    );
  });
}

function sortNotablePosts(posts) {
  return [...posts].sort((left, right) => {
    return (
      right.notableScore - left.notableScore ||
      Date.parse(right.timestamp) - Date.parse(left.timestamp) ||
      right.commentCount - left.commentCount
    );
  });
}

function extractFocusedPostFromHtml(html, focusPermalink) {
  const url = new URL(focusPermalink);
  const match = url.pathname.match(/^\/@([^/]+)\/post\/([A-Za-z0-9_-]+)/);
  if (!match) {
    return null;
  }

  const username = normalizeThreadsUsername(match[1]);
  const shortcode = match[2];
  const mediaIdMap = extractMediaIdMap(html);
  const windowSlice = extractShortcodeWindow(html, shortcode);
  const description =
    decodeHtmlEntities(matchGroup(html, /<meta\s+property="og:description"\s+content="([^"]*)"/i) ?? "") ||
    decodeHtmlEntities(matchGroup(html, /<meta\s+name="description"\s+content="([^"]*)"/i) ?? "") ||
    null;
  const takenAtRaw = matchGroup(windowSlice, /"taken_at":(\d+)/);
  const likeCount = Number(matchGroup(windowSlice, /"like_count":(\d+)/) ?? 0);
  const commentCount = Number(matchGroup(windowSlice, /"direct_reply_count":(\d+)/) ?? 0);
  const repostCount = Number(matchGroup(windowSlice, /"repost_count":(\d+)/) ?? 0);
  const shareCount = Number(matchGroup(windowSlice, /"quote_count":(\d+)/) ?? 0);
  const observedUsername =
    normalizeThreadsUsername(matchGroup(windowSlice, /"user":\{[\s\S]{0,800}?"username":"([^"]+)"/) ?? "") || username;
  const isVerified = /<meta\s+property="og:title"\s+content="[^"]+\(@[^)]+\) on Threads"/i.test(html);

  return {
    id: mediaIdMap.get(shortcode) ?? shortcode,
    shortcode,
    permalink: focusPermalink,
    username: observedUsername,
    text: description,
    timestamp: takenAtRaw ? new Date(Number(takenAtRaw) * 1000).toISOString() : null,
    has_replies: commentCount > 0,
    is_verified: isVerified,
    sourceType: "rendered_post_page_root",
    tab: "post",
    isReplying: false,
    isRoot: true,
    likeCount,
    commentCount,
    repostCount,
    shareCount,
  };
}

function extractShortcodeWindow(html, shortcode) {
  const codeIndex = html.indexOf(`"code":"${shortcode}"`);
  if (codeIndex < 0) {
    return "";
  }

  const start = Math.max(0, codeIndex - 25_000);
  const end = Math.min(html.length, codeIndex + 25_000);
  return html.slice(start, end);
}

function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replace(/&#039;/gi, "'")
    .replace(/&quot;/gi, "\"")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\r/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
