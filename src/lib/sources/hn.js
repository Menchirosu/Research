import { fetchJson } from "../http.js";
import { extractKeywords } from "../keywords.js";

export async function collectHnSignals(config, topic) {
  const query = encodeURIComponent(topic);
  const searchUrl = `https://hn.algolia.com/api/v1/search_by_date?query=${query}&tags=story&hitsPerPage=${config.scan.hnLimit}`;
  const payload = await fetchJson(searchUrl);

  const stories = await Promise.all(
    payload.hits.map(async (hit) => {
      const itemUrl = `https://hn.algolia.com/api/v1/items/${hit.objectID}`;
      const item = await fetchJson(itemUrl);
      const topComments = (item.children ?? []).slice(0, 4).map((child) => child.text ?? "").filter(Boolean);
      return {
        provider: "hackernews",
        sourceType: "story",
        title: hit.title,
        url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
        discussionUrl: `https://news.ycombinator.com/item?id=${hit.objectID}`,
        publishedAt: hit.created_at,
        score: 35 + Math.min(hit.points ?? 0, 40) + Math.min(hit.num_comments ?? 0, 25),
        commentSummary: topComments.join(" ").replace(/<[^>]+>/g, " ").trim().slice(0, 280),
        keywords: extractKeywords(`${hit.title} ${topComments.join(" ")}`),
        engagement: {
          points: hit.points ?? 0,
          comments: hit.num_comments ?? 0,
        },
        mediaCandidates: buildHnMediaCandidates(hit),
      };
    })
  );

  return stories;
}

function buildHnMediaCandidates(hit) {
  if (!hit.url) {
    return [];
  }

  try {
    const url = new URL(hit.url);
    return [
      {
        url: `${url.origin}/favicon.ico`,
        source: "hackernews-linked-site",
        rank: 4,
      },
    ];
  } catch {
    return [];
  }
}
