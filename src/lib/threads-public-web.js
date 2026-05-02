import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ensureDir, sanitizeFileName } from "./fs.js";

export async function harvestPublicWatchlistPosts(config, account) {
  const targets = [];
  const diagnostics = [];
  const tabs = account.allowReplies ? ["threads", "replies"] : ["threads"];

  for (const tab of tabs) {
    const result = renderThreadsProfileTab(config, account.username, tab);
    diagnostics.push({
      username: account.username,
      tab,
      status: result.status,
      error: result.error ?? null,
      cachePath: result.cachePath ?? null,
      postCount: result.posts?.length ?? 0,
    });

    if (result.status !== "ok") {
      continue;
    }

    for (const post of result.posts) {
      targets.push({
        ...post,
        username: account.username,
      });
    }
  }

  return {
    posts: dedupePosts(targets),
    diagnostics,
  };
}

function renderThreadsProfileTab(config, username, tab) {
  const browser = resolveBrowserExecutable(config);
  if (!browser) {
    return {
      status: "error",
      error: "No supported browser executable found for Threads watchlist rendering.",
      posts: [],
    };
  }

  const url = buildProfileUrl(username, tab);
  const cachePath = path.join(
    config.paths.cacheDir,
    `${sanitizeFileName(username)}-${tab}-rendered.html`
  );
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
    posts: extractRenderedPosts(html, username, tab),
    cachePath,
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

function extractRenderedPosts(html, username, tab) {
  const mediaIdMap = extractMediaIdMap(html);
  const renderHtml = stripNonContentBlocks(html);
  const permalinkPattern = new RegExp(`/@${escapeRegExp(username)}/post/([A-Za-z0-9_-]+)`, "g");
  const matches = [...renderHtml.matchAll(permalinkPattern)];
  const seen = new Set();
  const posts = [];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const postId = match[1];
    if (!postId || seen.has(postId)) {
      continue;
    }

    seen.add(postId);

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

    posts.push({
      id: mediaIdMap.get(postId) ?? postId,
      shortcode: postId,
      permalink: `https://www.threads.com/@${username}/post/${postId}`,
      username,
      text: text || null,
      timestamp: publishedAt,
      has_replies: metrics.commentCount > 0,
      is_verified: true,
      sourceType: isReplyTab ? "rendered_profile_reply" : "rendered_profile_post",
      tab,
      isReplying,
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
    const key = `${post.sourceType}:${post.id}`;
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

function extractMediaIdMap(html) {
  const map = new Map();
  const scriptPattern = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  const pkPattern = /"id":"(\d+_\d+)"[\s\S]{0,800}?"pk":"(\d+)"[\s\S]{0,4000}?"code":"([A-Za-z0-9_-]+)"/g;
  const idPattern = /"id":"(\d+_\d+)"[\s\S]{0,4000}?"code":"([A-Za-z0-9_-]+)"/g;

  for (const scriptMatch of html.matchAll(scriptPattern)) {
    const scriptBody = scriptMatch[1] ?? "";
    for (const match of scriptBody.matchAll(pkPattern)) {
      const mediaId = match[2];
      const shortcode = match[3];
      if (mediaId && shortcode && !map.has(shortcode)) {
        map.set(shortcode, mediaId);
      }
    }

    for (const match of scriptBody.matchAll(idPattern)) {
      const mediaId = match[1];
      const shortcode = match[2];
      if (mediaId && shortcode && !map.has(shortcode)) {
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
