const STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "almost",
  "also",
  "among",
  "and",
  "are",
  "answers",
  "any",
  "anything",
  "around",
  "asks",
  "away",
  "back",
  "been",
  "before",
  "being",
  "between",
  "both",
  "built",
  "but",
  "came",
  "can",
  "cant",
  "come",
  "com",
  "could",
  "days",
  "does",
  "dont",
  "down",
  "each",
  "even",
  "every",
  "first",
  "for",
  "from",
  "full",
  "game",
  "gets",
  "give",
  "good",
  "great",
  "guide",
  "guys",
  "hang",
  "have",
  "having",
  "here",
  "how",
  "href",
  "idea",
  "into",
  "just",
  "keep",
  "know",
  "last",
  "less",
  "like",
  "look",
  "looks",
  "made",
  "make",
  "maybe",
  "more",
  "most",
  "much",
  "need",
  "only",
  "other",
  "out",
  "over",
  "pair",
  "playbook",
  "post",
  "posts",
  "prompts",
  "question",
  "really",
  "recent",
  "remember",
  "said",
  "same",
  "second",
  "session",
  "sessions",
  "share",
  "show",
  "showed",
  "signals",
  "something",
  "stopped",
  "such",
  "talk",
  "that",
  "the",
  "their",
  "them",
  "there",
  "these",
  "they",
  "thing",
  "things",
  "this",
  "those",
  "through",
  "today",
  "hot",
  "tool",
  "tools",
  "top",
  "try",
  "using",
  "used",
  "users",
  "very",
  "want",
  "what",
  "when",
  "where",
  "which",
  "while",
  "with",
  "work",
  "worked",
  "workflow",
  "workflows",
  "would",
  "www",
  "x2f",
  "years",
  "right",
  "now",
  "you",
  "your"
]);

export function extractKeywords(text, limit = 10) {
  const normalized = text
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/&[a-z0-9#]+;/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .toLowerCase();
  const words = normalized.match(/\b[a-z][a-z0-9_-]{1,}\b/g) ?? [];
  const seen = new Set();
  const keywords = [];

  for (const word of words) {
    if (STOPWORDS.has(word)) {
      continue;
    }
    if (seen.has(word)) {
      continue;
    }

    seen.add(word);
    keywords.push(word);

    if (keywords.length >= limit) {
      break;
    }
  }

  return keywords;
}

export function isMeaningfulKeyword(word) {
  return Boolean(word) && !STOPWORDS.has(word.toLowerCase());
}
