import { pickMediaCandidates } from "./media.js";
import { extractKeywords, isMeaningfulKeyword } from "./keywords.js";
import { collectGithubSignals } from "./sources/github.js";
import { collectHnSignals } from "./sources/hn.js";
import { collectRedditSignals } from "./sources/reddit.js";

const HIGH_SIGNAL_DEFINITIONS = [
  {
    key: "memory",
    pattern: /\bmemory\b|\bobsidian\b|\bre-explain|\bcontext\b/i,
  },
  {
    key: "verification",
    pattern: /\bbenchmark\b|\btesting\b|\bvalidate\b|\bvalidation\b|\bguardrail\b|\bsecurity\b|\bdeterministic\b|\bpair of eyes\b/i,
  },
  {
    key: "cost",
    pattern: /\btoken(s)?\b|\bcost\b|\bbudget\b|\bpricing\b|\bwaste of money\b|\bdraining\b/i,
  },
  {
    key: "agents",
    pattern: /\bagent(s)?\b|\bswarm\b|\borchestrat|\bworkflow(s)?\b|\bautonomous\b/i,
  },
  {
    key: "plugins",
    pattern: /\bplugin(s)?\b|\bskill(s)?\b|\badd-on\b|\baddon\b|\bextension(s)?\b/i,
  },
  {
    key: "tooling",
    pattern: /\bcodex\b|\bclaude code\b|\bclaude\b|\bmcp(s)?\b|\bllm(s)?\b|\bmodel(s)?\b/i,
  },
];

const LOW_SIGNAL_TITLE_PATTERNS = [
  /\bdiscord\b/i,
  /\bcommunity feedback\b/i,
  /\bmegathread\b/i,
  /\bregister now\b/i,
  /\blooking for strangers\b/i,
  /\bfeedback on my\b/i,
  /\bi don't even know what to say\b/i,
  /\bremember the days before ai\b/i,
];

export async function runScan(config, input) {
  const topic = input.topic;
  const startedAt = new Date().toISOString();

  const [reddit, hn, github] = await Promise.allSettled([
    collectRedditSignals(config, topic),
    collectHnSignals(config, topic),
    collectGithubSignals(config, topic),
  ]);

  const providerResults = [reddit, hn, github]
    .filter((result) => result.status === "fulfilled")
    .flatMap((result) => result.value);

  const providerErrors = [reddit, hn, github]
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason?.message ?? String(result.reason));

  const sources = filterAndRankSources(config, topic, dedupeSources(providerResults));
  const mediaCandidates = await pickMediaCandidates(config, sources);
  const topSignals = rankSignals(topic, sources);

  return {
    topic,
    collectedAt: new Date().toISOString(),
    startedAt,
    providerErrors,
    sources,
    topSignals,
    mediaCandidates,
    coverage: buildCoverage(sources),
  };
}

function rankSignals(topic, sources) {
  const byKeyword = new Map();
  const normalizedTopicWords = extractKeywords(topic, 12);

  for (const source of sources) {
    for (const keyword of source.keywords) {
      if (!isMeaningfulKeyword(keyword) || normalizedTopicWords.includes(keyword)) {
        continue;
      }
      if (!byKeyword.has(keyword)) {
        byKeyword.set(keyword, {
          keyword,
          score: 0,
          mentions: 0,
          sources: [],
        });
      }

      const row = byKeyword.get(keyword);
      row.score += source.score;
      row.mentions += 1;
      row.sources.push({
        title: source.title,
        url: source.url,
        provider: source.provider,
      });
    }
  }

  return [...byKeyword.values()]
    .filter((row) => row.keyword && row.mentions >= 2)
    .sort((left, right) => right.score - left.score)
    .slice(0, 6);
}

function buildCoverage(sources) {
  const grouped = new Map();

  for (const source of sources) {
    const current = grouped.get(source.provider) ?? 0;
    grouped.set(source.provider, current + 1);
  }

  return [...grouped.entries()].map(([provider, count]) => ({
    provider,
    count,
  }));
}

function filterAndRankSources(config, topic, sources) {
  return sources
    .map((source) => annotateSource(config, topic, source))
    .filter(Boolean)
    .sort((left, right) => right.signalScore - left.signalScore || right.score - left.score);
}

function annotateSource(config, topic, source) {
  const publishedAt = source.publishedAt ? new Date(source.publishedAt) : null;
  const ageDays =
    publishedAt && !Number.isNaN(publishedAt.valueOf())
      ? (config.now.getTime() - publishedAt.getTime()) / (1000 * 60 * 60 * 24)
      : null;
  const ageHours = typeof ageDays === "number" ? ageDays * 24 : null;

  if (typeof ageDays === "number" && ageDays > config.scan.freshnessWindowDays) {
    return null;
  }

  const topicTerms = extractKeywords(topic, 12);
  const blob = `${source.title} ${source.commentSummary ?? ""} ${(source.keywords ?? []).join(" ")}`.toLowerCase();
  const signalTags = HIGH_SIGNAL_DEFINITIONS.filter((definition) => definition.pattern.test(blob)).map((definition) => definition.key);
  const topicHits = topicTerms.filter((term) => matchesTopicTerm(blob, term)).length;
  const hasLowSignalTitle = LOW_SIGNAL_TITLE_PATTERNS.some((pattern) => pattern.test(source.title));
  const recencyPenalty = typeof ageDays === "number" && ageDays > 2 ? Math.min(Math.floor(ageDays) * 4, 20) : 0;
  const recencyBoost =
    typeof ageHours !== "number"
      ? 0
      : ageHours <= config.scan.hotWindowHours
        ? 18
        : ageHours <= config.scan.anchorFreshnessHours
          ? 8
          : ageHours <= config.scan.weakSupportWindowHours
            ? 0
            : -12;
  const signalScore = source.score + signalTags.length * 18 + topicHits * 8 + recencyBoost - recencyPenalty - (hasLowSignalTitle ? 120 : 0);

  if ((signalTags.length === 0 && topicHits < 2) || signalScore < 45) {
    return null;
  }

  return {
    ...source,
    signalTags,
    signalScore,
    ageHours: typeof ageHours === "number" ? Number(ageHours.toFixed(1)) : null,
    ageDays: typeof ageDays === "number" ? Number(ageDays.toFixed(1)) : null,
  };
}

function dedupeSources(sources) {
  const byUrl = new Map();

  for (const source of sources) {
    const existing = byUrl.get(source.url);
    if (!existing || source.score > existing.score) {
      byUrl.set(source.url, source);
    }
  }

  return [...byUrl.values()];
}

function matchesTopicTerm(blob, term) {
  if (!term) {
    return false;
  }

  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\s+/g, "\\s+");
  return new RegExp(`\\b${escaped}\\b`, "i").test(blob);
}
