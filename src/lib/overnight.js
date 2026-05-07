import path from "node:path";
import { saveArtifact, loadJsonIfExists, writeJson } from "./fs.js";
import { initDatabase, recordPublishReceipt } from "./history.js";
import { inferTargetPlatform, mergeOvernightTargets } from "./overnight-targets.js";
import { publishDraft } from "./publisher.js";
import { runScan } from "./scan.js";
import {
  buildDiscoveredQueueFromTargets,
  buildWatchlistTargets,
  loadDiscoveredPosts,
  loadSeededPosts,
  loadThreadsWatchlist,
  saveDiscoveredPosts,
} from "./threads-targets.js";
import { validateDraftForPublish, validateScanForDraft } from "./validators.js";
import { buildDraftFromScan } from "./writer.js";

const ERROR_BUCKETS = ["config", "state", "scan", "discovery", "ranking", "draft", "publish", "persist"];

export async function runOvernightCycle(config, options) {
  const startedAt = new Date().toISOString();
  const db = initDatabase(config);
  const watchlistFile = options.watchlistFile ?? config.paths.threadsWatchlistFile;
  const seededPostsFile = options.seededPostsFile ?? config.paths.seededPostsFile;
  const discoveredPostsFile = options.discoveredPostsFile ?? config.paths.discoveredPostsFile;
  const watchlist = loadThreadsWatchlist(watchlistFile);
  const seededPosts = loadSeededPosts(seededPostsFile);
  const previousDiscoveredPosts = loadDiscoveredPosts(discoveredPostsFile);
  const touchedLedger = loadTouchedLedger(config);
  const priorHealthLedger = loadHealthLedger(config);
  const errorBuckets = createEmptyErrorBuckets();

  let scan = null;
  let scanPath = null;
  let scanWarning = null;
  let scanFailure = null;
  let watchlistDiscovery = { targets: [], accounts: [], errors: [] };
  let discoveredQueue = {
    generatedAt: new Date().toISOString(),
    mode: "threads-discovered-queue",
    sourceAccounts: [],
    roots: [],
    diagnostics: [],
    posts: [],
  };
  let mergedDiscoveredQueue = { ...discoveredQueue };
  let combinedTargets = mergeOvernightTargets(seededPosts.posts, previousDiscoveredPosts.posts);
  let evaluation = { eligible: [], skipped: [] };
  let selectedPostTarget = null;
  let selectedReplyTargets = [];
  const actions = [];
  let summary = null;
  let summaryPath = null;

  try {
    try {
      scan = await runScan(config, {
        topic: options.topic,
      });
      scanPath = saveArtifact(config.paths.scansDir, "scan", scan);
    } catch (error) {
      scanFailure = String(error?.message ?? error);
      addBucketError(errorBuckets, "scan", scanFailure);
    }

    if (!scanFailure && scan) {
      try {
        validateScanForDraft(config, scan);
      } catch (error) {
        scanWarning = String(error?.message ?? error);
        addBucketError(errorBuckets, "scan", scanWarning);
      }
    }

    try {
      watchlistDiscovery = await buildWatchlistTargets(config, watchlist);
      if ((watchlistDiscovery.errors ?? []).length > 0) {
        for (const discoveryError of watchlistDiscovery.errors) {
          addBucketError(
            errorBuckets,
            "discovery",
            `Watchlist discovery issue for @${discoveryError.username}: ${formatDiscoveryErrors(discoveryError.errors)}`
          );
        }
      }
    } catch (error) {
      addBucketError(errorBuckets, "discovery", String(error?.message ?? error));
      watchlistDiscovery = { targets: [], accounts: [], errors: [] };
    }

    try {
      discoveredQueue = await buildDiscoveredQueueFromTargets(
        config,
        watchlistDiscovery.targets.filter((target) => target.mode === "quote"),
        {
          excludedAuthors: watchlist.accounts.map((account) => account.username),
        }
      );
    } catch (error) {
      addBucketError(errorBuckets, "discovery", String(error?.message ?? error));
      discoveredQueue = {
        generatedAt: new Date().toISOString(),
        mode: "threads-discovered-queue",
        sourceAccounts: [],
        roots: [],
        diagnostics: [],
        posts: [],
      };
    }

    mergedDiscoveredQueue = {
      ...discoveredQueue,
      posts: mergeOvernightTargets(previousDiscoveredPosts.posts, discoveredQueue.posts)
        .filter((target) => isFreshDiscoveredTarget(config, target.publishedAt))
        .slice(0, config.posting.discoveredMaxTargetsPerRun),
    };
    try {
      saveDiscoveredPosts(discoveredPostsFile, mergedDiscoveredQueue);
    } catch (error) {
      throw createHardFailure("state", `Failed to save discovered queue: ${String(error?.message ?? error)}`);
    }

    combinedTargets = mergeOvernightTargets(
      mergeOvernightTargets(seededPosts.posts, watchlistDiscovery.targets),
      mergedDiscoveredQueue.posts
    );
    evaluation = evaluateTargets(config, combinedTargets, touchedLedger);
    selectedPostTarget = pickPostTarget(config, evaluation.eligible);
    selectedReplyTargets = pickReplyTargets(config, evaluation.eligible, touchedLedger, selectedPostTarget);

    if (scanFailure || (!scan && (selectedPostTarget || selectedReplyTargets.length > 0))) {
      summary = buildOvernightSummary({
        config,
        options,
        startedAt,
        watchlistFile,
        seededPostsFile,
        discoveredPostsFile,
        scanPath,
        scanWarning,
        scanFailure: scanFailure ?? "Scan failed before drafting could start.",
        scan,
        watchlist,
        seededPosts,
        watchlistDiscovery,
        mergedDiscoveredQueue,
        combinedTargets,
        evaluation,
        selectedPostTarget,
        selectedReplyTargets,
        actions,
        errorBuckets,
        statusOverride: "degraded",
      });
      finalizeHealthAndState(config, summary, touchedLedger, priorHealthLedger, []);
      summaryPath = saveArtifact(config.paths.summariesDir, "overnight-summary", summary);
      return { summaryPath, summary };
    }

    if (selectedPostTarget) {
      const action = await executeAction(config, db, scan, {
        topic: options.topic,
        scanPath,
        kind: selectedPostTarget.mode === "quote" ? "quote" : "react",
        target: selectedPostTarget,
        stretchBudget: options.stretchBudget,
        allowOlderTarget: options.allowOlderTarget,
      });
      actions.push(action);
      if (action.status === "skipped" && action.error) {
        addBucketError(errorBuckets, action.errorStage ?? "draft", action.error);
      }
    } else if (!scanWarning) {
      const action = await executeAction(config, db, scan, {
        topic: options.topic,
        scanPath,
        kind: "original",
        target: null,
        stretchBudget: options.stretchBudget,
        allowOlderTarget: options.allowOlderTarget,
      });
      actions.push(action);
      if (action.status === "skipped" && action.error) {
        addBucketError(errorBuckets, action.errorStage ?? "draft", action.error);
      }
    }

    for (const target of selectedReplyTargets) {
      const action = await executeAction(config, db, scan, {
        topic: options.topic,
        scanPath,
        kind: "reply",
        target,
        stretchBudget: options.stretchBudget,
        allowOlderTarget: options.allowOlderTarget,
      });
      actions.push(action);
      if (action.status === "skipped" && action.error) {
        addBucketError(errorBuckets, action.errorStage ?? "draft", action.error);
      }
    }

    const ledgerEntries = buildLedgerEntries(actions);
    summary = buildOvernightSummary({
      config,
      options,
      startedAt,
      watchlistFile,
      seededPostsFile,
      discoveredPostsFile,
      scanPath,
      scanWarning,
      scanFailure,
      scan,
      watchlist,
      seededPosts,
      watchlistDiscovery,
      mergedDiscoveredQueue,
      combinedTargets,
      evaluation,
      selectedPostTarget,
      selectedReplyTargets,
      actions,
      errorBuckets,
    });
    finalizeHealthAndState(config, summary, touchedLedger, priorHealthLedger, ledgerEntries);
    summaryPath = saveArtifact(config.paths.summariesDir, "overnight-summary", summary);
    return { summaryPath, summary };
  } catch (error) {
    const stage = error?.stage && ERROR_BUCKETS.includes(error.stage) ? error.stage : "state";
    addBucketError(errorBuckets, stage, String(error?.message ?? error));

    summary = buildOvernightSummary({
      config,
      options,
      startedAt,
      watchlistFile,
      seededPostsFile,
      discoveredPostsFile,
      scanPath,
      scanWarning,
      scanFailure,
      scan,
      watchlist,
      seededPosts,
      watchlistDiscovery,
      mergedDiscoveredQueue,
      combinedTargets,
      evaluation,
      selectedPostTarget,
      selectedReplyTargets,
      actions,
      errorBuckets,
      statusOverride: "failed",
      hardFailure: {
        stage,
        message: String(error?.message ?? error),
      },
    });

    try {
      summaryPath = saveArtifact(config.paths.summariesDir, "overnight-summary", summary);
    } catch {
      // Last-chance failure summary persistence should not mask the original error.
    }

    error.summaryPath = summaryPath ?? null;
    throw error;
  }
}

async function executeAction(config, db, scan, options) {
  let draft;
  try {
    draft = await buildDraftFromScan(config, scan, {
      target: options.target,
      overnightMode: true,
      forceSinglePost: true,
      disableMedia: true,
    });
  } catch (error) {
    return {
      kind: options.kind,
      status: "skipped",
      errorStage: "draft",
      error: String(error?.message ?? error),
      target: options.target,
    };
  }

  if (options.kind === "original" && draft.analysis?.originalStrength !== "strong") {
    return {
      kind: options.kind,
      status: "skipped",
      errorStage: "draft",
      error: "Overnight original was too bland to post without a strong Threads target.",
      target: options.target,
    };
  }

  let draftPath;
  try {
    draftPath = saveArtifact(config.paths.draftsDir, "draft", draft);
  } catch (error) {
    throw createHardFailure("state", `Failed to save draft artifact: ${String(error?.message ?? error)}`);
  }

  try {
    validateDraftForPublish(config, draft, {
      stretchBudget: options.stretchBudget,
      allowOlderTarget: options.allowOlderTarget,
    });
  } catch (error) {
    return {
      kind: options.kind,
      status: "skipped",
      draftPath,
      errorStage: "draft",
      error: String(error?.message ?? error),
      target: options.target,
    };
  }

  if (!config.threads.publishEnabled) {
    return {
      kind: options.kind,
      status: "drafted",
      draftPath,
      target: options.target,
    };
  }

  let receipt;
  try {
    receipt = await publishDraft(config, draft);
  } catch (error) {
    throw createHardFailure("publish", `Failed to publish selected ${options.kind} action: ${String(error?.message ?? error)}`);
  }

  let receiptPath;
  try {
    receiptPath = saveArtifact(config.paths.receiptsDir, "receipt", receipt);
    recordPublishReceipt(db, receipt, receiptPath);
  } catch (error) {
    throw createHardFailure("state", `Failed to persist publish receipt: ${String(error?.message ?? error)}`);
  }

  return {
    kind: options.kind,
    status: "published",
    draftPath,
    receiptPath,
    publishedAt: receipt.publishedAt,
    receipt,
    target: options.target,
  };
}

function evaluateTargets(config, targets, touchedLedger) {
  const eligible = [];
  const skipped = [];

  for (const target of targets) {
    const reason = getTargetSkipReason(config, target, touchedLedger);
    if (reason) {
      skipped.push({
        target,
        reason,
      });
      continue;
    }

    eligible.push(target);
  }

  return {
    eligible: eligible.sort(compareTargets),
    skipped,
  };
}

function getTargetSkipReason(config, target, touchedLedger) {
  if (!target.active) {
    return "inactive";
  }

  if (target.platform !== "threads") {
    return "overnight interactions are threads-native only";
  }

  if (!target.author) {
    return "missing author";
  }

  if (!target.publishedAt) {
    return "missing published timestamp";
  }

  if (target.mode !== "react" && !target.postId) {
    return "missing post id";
  }

  if (target.isReplyToUs) {
    return "second-hop replies are disabled overnight";
  }

  if (target.activityScore < 1 && !(target.targetOrigin === "seeded" && target.thresholdOverride === true)) {
    return "target is not marked as live enough";
  }

  const author = target.author.toLowerCase().replace(/^@/, "");
  if (target.targetOrigin === "watchlist") {
    if (target.mode === "reply" && (!target.allowReplies || target.tier !== "primary")) {
      return "watchlist reply target is not allowed for this account tier";
    }
  } else if (target.targetOrigin === "discovered") {
    if (target.mode !== "quote") {
      return "discovered targets are quote-only overnight";
    }
    if ((target.activityScore ?? 0) < 2) {
      return "discovered target is not active enough";
    }
    if ((target.priority ?? 0) < config.posting.discoveredMinimumPriority) {
      return "discovered target priority is too low";
    }
  } else if (target.targetOrigin === "seeded") {
    // Seeded posts are explicitly approved for one-hop overnight use.
  } else {
    return "target is not from the Threads watchlist, discovered queue, or seeded-post queue";
  }

  const targetAgeHours = ageHours(config.now, target.publishedAt);
  if (!Number.isFinite(targetAgeHours) || targetAgeHours > config.posting.maxTargetAgeHours) {
    return "target is too old for overnight mode";
  }

  if (target.targetOrigin === "discovered" && targetAgeHours > config.posting.discoveredTargetWindowHours) {
    return "discovered target is outside the random-notable freshness window";
  }

  if (target.targetOrigin === "watchlist" && target.tier === "secondary" && target.activityScore < 2) {
    return "secondary watchlist post is not active enough yet";
  }

  if (hasTouchedAuthorRecently(config, touchedLedger, author, target.platform)) {
    return "author was already touched in the last 24 hours";
  }

  return null;
}

function pickPostTarget(config, targets) {
  const quotes = targets.filter((target) => target.mode === "quote");
  if (quotes[0]) {
    return quotes[0];
  }

  const manualReacts = targets.filter((target) => target.mode === "react" && !target.autoHarvested);
  if (manualReacts[0]) {
    return manualReacts[0];
  }

  const harvestedReacts = targets.filter((target) => target.mode === "react" && target.autoHarvested);
  const strongHarvestedReact = harvestedReacts.find((target) => isStrongAutoReactTarget(config, target));
  return strongHarvestedReact ?? null;
}

function pickReplyTargets(config, targets, touchedLedger, selectedPostTarget) {
  const chosenAuthors = new Set();
  if (selectedPostTarget?.author) {
    chosenAuthors.add(selectedPostTarget.author.toLowerCase().replace(/^@/, ""));
  }

  const replies = [];
  for (const target of targets) {
    if (target.mode !== "reply") {
      continue;
    }

    const normalizedAuthor = target.author.toLowerCase().replace(/^@/, "");
    if (chosenAuthors.has(normalizedAuthor)) {
      continue;
    }

    if (hasTouchedAuthorRecently(config, touchedLedger, normalizedAuthor, target.platform)) {
      continue;
    }

    replies.push(target);
    chosenAuthors.add(normalizedAuthor);

    if (replies.length >= config.posting.overnightMaxReplyActionsPerRun) {
      break;
    }
  }

  return replies;
}

function compareTargets(left, right) {
  const modeRank = {
    quote: 0,
    react: 1,
    reply: 2,
  };

  return (
    (modeRank[left.mode] ?? 99) - (modeRank[right.mode] ?? 99) ||
    right.priority - left.priority ||
    right.activityScore - left.activityScore ||
    ageSortValue(left.publishedAt) - ageSortValue(right.publishedAt)
  );
}

function isStrongAutoReactTarget(config, target) {
  const priority = Number(target.priority ?? 0);
  const activity = Number(target.activityScore ?? 0);
  const provider = String(target.sourceProvider ?? "").toLowerCase();
  const sourceType = String(target.sourceType ?? "").toLowerCase();

  if (provider === "github" && sourceType === "repository") {
    return false;
  }

  return (
    priority >= config.posting.overnightAutoReactMinimumPriority &&
    activity >= config.posting.overnightAutoReactMinimumActivity
  );
}

function ageSortValue(value) {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.valueOf()) ? Number.POSITIVE_INFINITY : -timestamp.valueOf();
}

function hasTouchedAuthorRecently(config, ledger, author, platform) {
  const normalizedAuthor = author.toLowerCase().replace(/^@/, "");
  const cutoff = new Date(config.now.getTime() - config.posting.rollingWindowHours * 60 * 60 * 1000);

  return (ledger.entries ?? []).some((entry) => {
    const touchedAt = new Date(entry.touchedAt);
    return (
      !Number.isNaN(touchedAt.valueOf()) &&
      touchedAt >= cutoff &&
      String(entry.platform ?? "").toLowerCase() === String(platform ?? "").toLowerCase() &&
      String(entry.author ?? "").toLowerCase().replace(/^@/, "") === normalizedAuthor
    );
  });
}

function pruneLedgerEntries(config, entries) {
  const cutoff = new Date(config.now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return entries.filter((entry) => {
    const touchedAt = new Date(entry.touchedAt);
    return !Number.isNaN(touchedAt.valueOf()) && touchedAt >= cutoff;
  });
}

function ageHours(now, value) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.valueOf())) {
    return Number.POSITIVE_INFINITY;
  }

  return (now.getTime() - timestamp.getTime()) / (1000 * 60 * 60);
}

function isFreshDiscoveredTarget(config, publishedAt) {
  const timestamp = new Date(publishedAt);
  if (Number.isNaN(timestamp.valueOf())) {
    return false;
  }

  return (config.now.getTime() - timestamp.getTime()) / (1000 * 60 * 60) <= config.posting.discoveredTargetWindowHours;
}

function loadTouchedLedger(config) {
  return loadJsonIfExists(buildTouchedLedgerPath(config)) ?? {
    updatedAt: null,
    entries: [],
  };
}

function writeTouchedLedger(config, payload) {
  writeJson(buildTouchedLedgerPath(config), payload);
}

function buildTouchedLedgerPath(config) {
  return path.join(config.paths.ledgersDir, "overnight-touched.json");
}

function loadHealthLedger(config) {
  return loadJsonIfExists(buildHealthLedgerPath(config)) ?? {
    updatedAt: null,
    consecutiveByStage: {},
    lastStatus: null,
  };
}

function writeHealthLedger(config, payload) {
  writeJson(buildHealthLedgerPath(config), payload);
}

function buildHealthLedgerPath(config) {
  return path.join(config.paths.ledgersDir, "overnight-health.json");
}

function finalizeHealthAndState(config, summary, touchedLedger, priorHealthLedger, ledgerEntries) {
  const nextTouchedLedger = {
    ...touchedLedger,
    entries: pruneLedgerEntries(config, [...(touchedLedger.entries ?? []), ...ledgerEntries]),
    updatedAt: new Date().toISOString(),
  };

  try {
    writeTouchedLedger(config, nextTouchedLedger);
  } catch (error) {
    throw createHardFailure("state", `Failed to persist touched ledger: ${String(error?.message ?? error)}`);
  }

  const nextHealthLedger = updateHealthLedger(config, priorHealthLedger, summary.errorBuckets, summary.health.status);
  summary.health.repeatedDegradations = summarizeRepeatedDegradations(config, nextHealthLedger);
  summary.health.needsAttention = summary.health.repeatedDegradations.length > 0;
  summary.health.morningReport = buildMorningReport(summary);

  try {
    writeHealthLedger(config, nextHealthLedger);
  } catch (error) {
    throw createHardFailure("state", `Failed to persist overnight health ledger: ${String(error?.message ?? error)}`);
  }
}

function buildLedgerEntries(actions) {
  const ledgerEntries = [];

  for (const action of actions) {
    if (action.status !== "published" || !action.target?.author) {
      continue;
    }

    ledgerEntries.push({
      touchedAt: action.publishedAt,
      author: action.target.author,
      platform: action.target.platform ?? inferTargetPlatform(action.target),
      mode: action.kind,
      targetUrl: action.target.url ?? null,
      targetPostId: action.target.postId ?? null,
      rootPostId: action.receipt?.publishedPosts?.[0]?.id ?? null,
      rootPermalink: action.receipt?.publishedPosts?.[0]?.permalink ?? null,
    });
  }

  return ledgerEntries;
}

function buildOvernightSummary(input) {
  const healthStatus = input.statusOverride ?? deriveHealthStatus(input.errorBuckets, input.hardFailure);
  const providerErrors = input.scan?.providerErrors ?? [];
  const providerDiagnostics = input.scan?.providerDiagnostics ?? [];

  return {
    mode: "overnight",
    topic: input.options.topic,
    startedAt: input.startedAt,
    completedAt: new Date().toISOString(),
    publishEnabled: input.config.threads.publishEnabled,
    watchlistFile: input.watchlistFile,
    seededPostsFile: input.seededPostsFile,
    discoveredPostsFile: input.discoveredPostsFile,
    scanPath: input.scanPath,
    scanWarning: input.scanWarning,
    error: input.scanFailure ?? input.hardFailure?.message ?? null,
    hardFailure: input.hardFailure ?? null,
    status: healthStatus === "success" ? "success" : healthStatus === "failed" ? "failed" : "degraded",
    caps: {
      runsPerWindow: input.config.posting.overnightRunsPerWindow,
      maxPostActionsPerRun: input.config.posting.overnightMaxPostActionsPerRun,
      maxReplyActionsPerRun: input.config.posting.overnightMaxReplyActionsPerRun,
      rollingWindowHours: input.config.posting.rollingWindowHours,
      originalBudget: input.options.stretchBudget
        ? input.config.posting.stretchOriginalBudget
        : input.config.posting.defaultOriginalBudget,
      interactionBudget: input.options.stretchBudget
        ? input.config.posting.stretchInteractionBudget
        : input.config.posting.defaultInteractionBudget,
    },
    sourceCount: input.scan?.sources?.length ?? 0,
    providerErrors,
    providerDiagnostics,
    coverage: input.scan?.coverage ?? [],
    targetSummary: {
      watchlistAccounts: input.watchlist.accounts.length,
      seeded: input.seededPosts.posts.length,
      watchlistTargets: input.watchlistDiscovery.targets.length,
      discovered: input.mergedDiscoveredQueue.posts.length,
      harvested: input.mergedDiscoveredQueue.posts.length,
      total: input.combinedTargets.length,
      eligible: input.evaluation.eligible.length,
      skipped: input.evaluation.skipped.length,
    },
    watchlistAccounts: input.watchlistDiscovery.accounts ?? [],
    discoveryErrors: input.watchlistDiscovery.errors,
    discoveredTargets: input.watchlistDiscovery.targets,
    discoveredQueue: input.mergedDiscoveredQueue,
    selected: {
      postTarget: input.selectedPostTarget,
      replyTargets: input.selectedReplyTargets,
    },
    actions: input.actions,
    skippedTargets: input.evaluation.skipped,
    touchedLedgerPath: buildTouchedLedgerPath(input.config),
    errorBuckets: input.errorBuckets,
    health: {
      status: healthStatus,
      scan: classifyScanHealth(input.scanPath, input.scanWarning, input.scanFailure),
      discovery: classifyStageHealth(input.errorBuckets, ["discovery", "ranking"]),
      draft: classifyStageHealth(input.errorBuckets, ["draft"]),
      publish: classifyStageHealth(input.errorBuckets, ["publish"]),
      state: classifyStageHealth(input.errorBuckets, ["state", "persist"]),
      needsAttention: false,
      repeatedDegradations: [],
      morningReport: null,
    },
  };
}

function classifyScanHealth(scanPath, scanWarning, scanFailure) {
  if (scanFailure) {
    return "degraded";
  }
  if (!scanPath) {
    return "skipped";
  }
  return scanWarning ? "degraded" : "ok";
}

function classifyStageHealth(errorBuckets, stages) {
  return stages.some((stage) => (errorBuckets[stage] ?? []).length > 0) ? "degraded" : "ok";
}

function createEmptyErrorBuckets() {
  return Object.fromEntries(ERROR_BUCKETS.map((bucket) => [bucket, []]));
}

function addBucketError(buckets, stage, message) {
  const normalizedStage = ERROR_BUCKETS.includes(stage) ? stage : "state";
  const normalizedMessage = String(message ?? "").trim();
  if (!normalizedMessage) {
    return;
  }

  if (!(buckets[normalizedStage] ?? []).includes(normalizedMessage)) {
    buckets[normalizedStage].push(normalizedMessage);
  }
}

function deriveHealthStatus(errorBuckets, hardFailure) {
  if (hardFailure) {
    return "failed";
  }

  const degraded = ERROR_BUCKETS.some((bucket) => (errorBuckets[bucket] ?? []).length > 0);
  return degraded ? "degraded" : "success";
}

function updateHealthLedger(config, priorHealthLedger, errorBuckets, status) {
  const next = {
    updatedAt: new Date().toISOString(),
    lastStatus: status,
    consecutiveByStage: {},
  };

  for (const stage of ERROR_BUCKETS) {
    const hadError = (errorBuckets[stage] ?? []).length > 0;
    next.consecutiveByStage[stage] = hadError ? Number(priorHealthLedger.consecutiveByStage?.[stage] ?? 0) + 1 : 0;
  }

  if (status === "success") {
    for (const stage of ERROR_BUCKETS) {
      next.consecutiveByStage[stage] = 0;
    }
  }

  return next;
}

function summarizeRepeatedDegradations(config, healthLedger) {
  const threshold = config.posting.overnightNeedsAttentionThreshold;
  return ERROR_BUCKETS.flatMap((stage) => {
    const count = Number(healthLedger.consecutiveByStage?.[stage] ?? 0);
    if (count < threshold) {
      return [];
    }

    return {
      stage,
      consecutiveRuns: count,
    };
  });
}

function buildMorningReport(summary) {
  return {
    scanned: Boolean(summary.scanPath),
    discoveredTargets: Number(summary.targetSummary?.discovered ?? 0),
    posted: summary.actions.some((action) => action.status === "published"),
    degradedStages: ERROR_BUCKETS.filter((stage) => (summary.errorBuckets?.[stage] ?? []).length > 0),
    needsAttention: summary.health.repeatedDegradations,
  };
}

function createHardFailure(stage, message) {
  const error = new Error(message);
  error.stage = stage;
  return error;
}

function formatDiscoveryErrors(errors) {
  if (!Array.isArray(errors) || errors.length === 0) {
    return "unknown discovery error";
  }

  return errors.map((entry) => String(entry?.message ?? entry)).join("; ");
}
