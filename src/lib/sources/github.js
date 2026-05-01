import { fetchJson } from "../http.js";
import { extractKeywords } from "../keywords.js";

export async function collectGithubSignals(config, topic) {
  if (!config.github.token) {
    return [];
  }

  const query = encodeURIComponent(`${topic} in:title,body is:issue OR is:discussion`);
  const url = `https://api.github.com/search/issues?q=${query}&sort=updated&order=desc&per_page=${config.scan.githubLimit}`;
  const payload = await fetchJson(url, {
    headers: {
      authorization: `Bearer ${config.github.token}`,
      "x-github-api-version": "2022-11-28",
    },
  });

  return payload.items.map((item) => ({
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
