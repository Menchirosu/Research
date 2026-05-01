import { CliError } from "./cli.js";
import { getThreadDetails } from "./threads-api.js";

export async function resolveDraftTarget(config, flags) {
  const replyToId = normalizeFlag(flags["reply-to-id"]);
  const quotePostId = normalizeFlag(flags["quote-post-id"]);
  const targetText = normalizeFlag(flags["target-text"]);
  const targetAuthor = normalizeFlag(flags["target-author"]);
  const targetUrl = normalizeFlag(flags["target-url"]);
  const targetPublishedAt = normalizeFlag(flags["target-published-at"]);

  if (replyToId && quotePostId) {
    throw new CliError("Use only one of --reply-to-id or --quote-post-id.");
  }

  const postId = replyToId || quotePostId || null;
  const mode = replyToId ? "reply" : quotePostId ? "quote" : targetText || targetAuthor || targetUrl ? "react" : "original";
  if (mode === "original") {
    return null;
  }

  let fetched = null;
  let fetchError = null;

  if (postId) {
    try {
      fetched = await getThreadDetails(config, postId);
    } catch (error) {
      fetchError = String(error?.message ?? error);
    }
  }

  return {
    mode,
    postId,
    text: targetText ?? fetched?.text ?? null,
    author: targetAuthor ?? fetched?.username ?? null,
    url: targetUrl ?? fetched?.permalink ?? null,
    publishedAt: targetPublishedAt ?? fetched?.timestamp ?? null,
    fetchError,
  };
}

export function normalizeThreadFlag(value) {
  if (!value || value === true) {
    return null;
  }

  if (value === "3" || value === "long") {
    return "long";
  }

  return "short";
}

function normalizeFlag(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
