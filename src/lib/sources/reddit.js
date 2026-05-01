import { fetchJson } from "../http.js";
import { extractKeywords } from "../keywords.js";

export async function collectRedditSignals(config, topic) {
  const feeds = ["hot", "new"];
  const results = [];
  const seenPermalinks = new Set();

  for (const subreddit of config.scan.redditSubreddits) {
    for (const feed of feeds) {
      const url = `https://www.reddit.com/r/${subreddit}/${feed}.json?raw_json=1&limit=${config.scan.redditLimitPerFeed}`;
      let children = [];

      try {
        const payload = await fetchJson(url);
        children = payload.data?.children ?? [];
      } catch {
        continue;
      }

      const matches = children
        .map((child) => child.data)
        .filter((post) => {
          const textBlob = `${post.title} ${post.selftext ?? ""}`.toLowerCase();
          return matchesTopic(textBlob, topic);
        })
        .slice(0, config.scan.redditThreadFetchPerFeed);

      for (const post of matches) {
        if (seenPermalinks.has(post.permalink)) {
          continue;
        }

        seenPermalinks.add(post.permalink);

        let topComments = [];

        if ((post.num_comments ?? 0) > 0) {
          try {
            const thread = await fetchJson(`https://www.reddit.com${post.permalink}.json?raw_json=1&limit=5`);
            const commentListing = thread[1]?.data?.children ?? [];
            topComments = commentListing
              .map((entry) => entry.data?.body ?? "")
              .filter(Boolean)
              .slice(0, 4);
          } catch {
            topComments = [];
          }
        }

        results.push({
          provider: "reddit",
          sourceType: `r/${subreddit}:${feed}`,
          title: post.title,
          url: `https://www.reddit.com${post.permalink}`,
          publishedAt: new Date(post.created_utc * 1000).toISOString(),
          score: 20 + Math.min(post.score ?? 0, 50) + Math.min(post.num_comments ?? 0, 30),
          commentSummary: topComments.join(" ").slice(0, 280),
          keywords: extractKeywords(`${post.title} ${topComments.join(" ")}`),
          engagement: {
            score: post.score ?? 0,
            comments: post.num_comments ?? 0,
          },
          mediaCandidates: buildRedditMediaCandidates(post),
        });
      }
    }
  }

  return results;
}

function matchesTopic(text, topic) {
  const words = extractKeywords(topic, 12);
  if (words.length === 0) {
    return true;
  }

  const hasTopicWord = words.some((word) => text.includes(word));
  if (hasTopicWord) {
    return true;
  }

  return /\b(agent|workflow|plugin|memory|token|benchmark|testing|validation|security|api|prompt|model|codex|claude|mcp|skill)\b/i.test(text);
}

function buildRedditMediaCandidates(post) {
  const candidates = [];

  if (typeof post.url_overridden_by_dest === "string") {
    const value = post.url_overridden_by_dest;
    if (/\.(png|jpe?g|webp)$/i.test(value)) {
      candidates.push({
        url: value,
        source: "reddit-linked-image",
        rank: 3,
      });
    }
    if (/youtu\.be|youtube\.com/i.test(value)) {
      const match = value.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
      if (match) {
        candidates.push({
          url: `https://i.ytimg.com/vi/${match[1]}/hqdefault.jpg`,
          source: "youtube-thumbnail",
          rank: 3,
        });
      }
    }
    if (/github\.com/i.test(value)) {
      candidates.push({
        url: `${value.replace(/\/$/, "")}/social-preview.png`,
        source: "github-social-preview",
        rank: 2,
      });
    }
  }

  return candidates;
}
