import { fetchJson } from "../http.js";
import { extractKeywords } from "../keywords.js";

export async function collectGithubSignals(config, topic) {
  if (!config.github.token) {
    return [];
  }

  const issueItems = await searchGithubIssues(config, topic);
  if (issueItems.length > 0) {
    return issueItems.map((item) => ({
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

  const repositories = await searchGithubRepositories(config, topic);
  return repositories
    .filter(isUsefulGithubRepository)
    .map((item) => ({
      provider: "github",
      sourceType: "repository",
      title: item.full_name,
      url: item.html_url,
      publishedAt: item.updated_at,
      score: 35 + Math.min(item.stargazers_count ?? 0, 25) + Math.min(item.open_issues_count ?? 0, 10),
      commentSummary: `${item.stargazers_count ?? 0} stars. ${(item.description ?? "").trim()}`.slice(0, 280),
      keywords: extractKeywords(`${item.full_name} ${item.description ?? ""}`),
      engagement: {
        stars: item.stargazers_count ?? 0,
        openIssues: item.open_issues_count ?? 0,
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

async function searchGithubRepositories(config, topic) {
  const queries = buildGithubRepositoryQueries(topic);
  const seen = new Set();
  const items = [];

  for (const query of queries) {
    const payload = await fetchJson(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=updated&order=desc&per_page=${config.scan.githubLimit}`,
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
  const keywordFallbacks = extractKeywords(topic, 8)
    .filter((word) => word.length >= 4)
    .slice(0, 3)
    .map((word) => `"${word}" in:title,body (is:issue OR is:discussion)`);
  const laneFallbacks = ["codex", "claude code", "mcp", "plugin", "agent workflow"].map(
    (term) => `"${term}" in:title,body (is:issue OR is:discussion)`
  );

  return [exact, ...keywordFallbacks, ...laneFallbacks];
}

function buildGithubRepositoryQueries(topic) {
  const exact = `"${topic}" in:name,description,readme`;
  const keywordFallbacks = extractKeywords(topic, 8)
    .filter((word) => word.length >= 4)
    .slice(0, 3)
    .map((word) => `"${word}" in:name,description,readme`);
  const laneFallbacks = ["codex", "claude code", "mcp", "plugin", "agent workflow"].map(
    (term) => `"${term}" in:name,description,readme`
  );

  return [exact, ...keywordFallbacks, ...laneFallbacks];
}

function isUsefulGithubRepository(item) {
  const stars = Number(item.stargazers_count ?? 0);
  const openIssues = Number(item.open_issues_count ?? 0);
  const blob = `${item.full_name ?? ""} ${item.description ?? ""}`.toLowerCase();
  const strongLanePattern =
    /\bcodex\b|\bclaude\b|\bmcp\b|\bplugin\b|\bbenchmark\b|\btesting\b|\bvalidation\b|\bsecurity\b|\btoken\b|\bprompt\b|\bllm\b/;

  if (!strongLanePattern.test(blob)) {
    return false;
  }

  return stars >= 3 || openIssues >= 1;
}
