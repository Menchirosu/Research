import { CliError } from "./cli.js";
import { initDatabase, findRecentDuplicates, getRecentBudgetUsage } from "./history.js";

export function validateScanForDraft(config, scan) {
  const independentProviders = new Set(scan.sources.map((source) => source.provider));
  if (independentProviders.size < config.scan.minimumIndependentSources) {
    throw new CliError(`Scan did not clear the minimum independent source gate (${config.scan.minimumIndependentSources}).`);
  }

  const freshAnchor = scan.sources.find((source) => getAgeHours(config, source.publishedAt) <= config.scan.anchorFreshnessHours);
  if (!freshAnchor) {
    throw new CliError(
      `Scan did not find a fresh anchor source from the last ${config.scan.anchorFreshnessHours} hours.`
    );
  }
}

export function validateDraftForPublish(config, draft, options = {}) {
  if (!draft.posts?.length) {
    throw new CliError("Draft has no posts.");
  }

  if ((draft.target?.mode === "reply" || draft.target?.mode === "quote") && !draft.target?.postId) {
    throw new CliError(`Draft target mode "${draft.target.mode}" requires a target post ID.`);
  }

  if (draft.posts.length > config.scan.maxPostsPerThread) {
    throw new CliError(`Draft exceeds max post count (${config.scan.maxPostsPerThread}).`);
  }

  validateDraftExpiry(config, draft);
  validateTargetFreshness(config, draft, options);

  const distinctProviders = new Set(draft.sources.map((source) => source.provider));
  if (distinctProviders.size < config.scan.minimumIndependentSources) {
    throw new CliError("Draft does not meet the minimum independent source gate.");
  }

  const db = initDatabase(config);
  const duplicates = findRecentDuplicates(db, draft);
  if (duplicates.length > 0) {
    throw new CliError("Draft is too similar to a recent published post.");
  }

  validateBudget(config, db, draft, options);
}

function validateDraftExpiry(config, draft) {
  const draftAgeHours = getAgeHours(config, draft.createdAt);
  const expiryHours = draft.target ? config.posting.targetDraftExpiryHours : config.posting.originalDraftExpiryHours;
  if (draftAgeHours > expiryHours) {
    throw new CliError(
      `Draft is stale (${formatHours(draftAgeHours)} old). ${draft.target ? "Target-based" : "Original"} drafts expire after ${expiryHours} hours.`
    );
  }
}

function validateTargetFreshness(config, draft, options) {
  if (!draft.target || draft.target.mode === "original") {
    return;
  }

  if (!draft.target.publishedAt) {
    throw new CliError(
      "Target is missing a published timestamp. Re-draft with --target-published-at=ISO8601 or use a target the API can timestamp."
    );
  }

  const targetAgeHours = getAgeHours(config, draft.target.publishedAt);
  const limit = options.allowOlderTarget ? config.posting.overrideTargetAgeHours : config.posting.maxTargetAgeHours;

  if (targetAgeHours > limit) {
    throw new CliError(
      `Target is too old (${formatHours(targetAgeHours)} old). Limit is ${limit} hours${options.allowOlderTarget ? " with override" : ""}.`
    );
  }
}

function validateBudget(config, db, draft, options) {
  const usage = getRecentBudgetUsage(db, config.now, config.posting.rollingWindowHours);
  const isInteraction = draft.target?.mode === "reply" || draft.target?.mode === "quote";
  const originalBudget = options.stretchBudget ? config.posting.stretchOriginalBudget : config.posting.defaultOriginalBudget;
  const interactionBudget = options.stretchBudget
    ? config.posting.stretchInteractionBudget
    : config.posting.defaultInteractionBudget;

  if (isInteraction && usage.totals.interactions >= interactionBudget) {
    throw new CliError(
      `Interaction budget exhausted for the last ${config.posting.rollingWindowHours} hours (${usage.totals.interactions}/${interactionBudget}).`
    );
  }

  if (!isInteraction && usage.totals.originals >= originalBudget) {
    throw new CliError(
      `Original-post budget exhausted for the last ${config.posting.rollingWindowHours} hours (${usage.totals.originals}/${originalBudget}).`
    );
  }
}

function getAgeHours(config, value) {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.valueOf())) {
    return Number.POSITIVE_INFINITY;
  }

  return (config.now.getTime() - timestamp.getTime()) / (1000 * 60 * 60);
}

function formatHours(value) {
  return `${Math.round(value * 10) / 10}h`;
}
