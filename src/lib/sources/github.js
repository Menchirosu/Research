import { fetchJson } from "../http.js";
import { extractKeywords } from "../keywords.js";

export async function collectGithubSignals(config, topic) {
  if (!config.github.token) {
    return [];
  }

  const items = await searchGithubIssues(config, topic);
  return items.map((item) => ({
    provider: "github",
    sourceType: item.pull_request ? "pull_request" : "issue_or_discussion",
    title: item.title,
    url: item.html_url,
    publishedAt: item.updated_at,
    score: 30 + Math.min(item.comments, 20),
    commentSummary: `${item.comments} comments on GitHub`,
    keywords: extractKeywords(`${item.title} ${item.body ?? ""}`),
    engagement: {
      comments: item.comments,
    },
    mediaCandidates: [],
  }));
}

async function searchGithubIssues(config, topic) {
  const queries = buildGithubQueries(topic);
  const seen = new Set();
  const items = [];

  for (const query of queries) {
    const payload = await fetchJson(
      `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&sort=updated&order=desc&per_page=${config.scan.githubLimit}`,
      {
        headers: {
          authorization: `Bearer ${config.github.token}`,
          "x-github-api-version": "2022-11-28",
        },
      }
    );

    for (const item of payload.items ?? []) {
      if (seen.has(item.html_url)) {
        continue;
      }

      seen.add(item.html_url);
      items.push(item);

      if (items.length >= config.scan.githubLimit) {
        return items;
      }
    }
  }

  return items;
}

function buildGithubQueries(topic) {
  const exact = `${topic} in:title,body (is:issue OR is:discussion)`;
  const keywords = extractKeywords(topic, 8).filter((word) => word.length >= 4);
  const keywordQuery =
    keywords.length >= 2
      ? `${keywords.map((word) => `"${word}"`).join(" OR ")} in:title,body (is:issue OR is:discussion)`
      : null;
  const laneFallback = `"codex" OR "claude code" OR "ai coding" OR "mcp" OR "plugin" OR "agent workflow" in:title,body (is:issue OR is:discussion)`;

  return [exact, keywordQuery, laneFallback].filter(Boolean);
}
