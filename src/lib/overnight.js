import path from "node:path";
import { saveArtifact, loadJsonIfExists, writeJson } from "./fs.js";
import { initDatabase, recordPublishReceipt } from "./history.js";
import { buildHarvestedTargets, inferTargetPlatform, loadOvernightTargets, mergeOvernightTargets } from "./overnight-targets.js";
import { publishDraft } from "./publisher.js";
import { runScan } from "./scan.js";
import { validateDraftForPublish, validateScanForDraft } from "./validators.js";
import { buildDraftFromScan } from "./writer.js";

export async function runOvernightCycle(config, options) {
  const startedAt = new Date().toISOString();
  const db = initDatabase(config);
  const targetFile = options.targetsFile ?? config.paths.overnightTargetsFile;
  const targetConfig = loadOvernightTargets(targetFile);
  const touchedLedger = loadTouchedLedger(config);
  let scan = null;
  let scanPath = null;
  let scanError = null;

  try {
    scan = await runScan(config, {
      topic: options.topic,
    });
    scanPath = saveArtifact(config.paths.scansDir, "scan", scan);
    validateScanForDraft(config, scan);
  } catch (error) {
    scanError = String(error?.message ?? error);
  }

  if (scanError) {
    const summary = {
      mode: "overnight",
      topic: options.topic,
      startedAt,
      completedAt: new Date().toISOString(),
      publishEnabled: config.threads.publishEnabled,
      targetsFile: targetFile,
      scanPath,
      status: "soft-failed",
      error: scanError,
      providerErrors: scan?.providerErrors ?? [],
      providerDiagnostics: scan?.providerDiagnostics ?? [],
      coverage: scan?.coverage ?? [],
      sourceCount: scan?.sources?.length ?? 0,
      caps: {
        runsPerWindow: config.posting.overnightRunsPerWindow,
        maxPostActionsPerRun: config.posting.overnightMaxPostActionsPerRun,
        maxReplyActionsPerRun: config.posting.overnightMaxReplyActionsPerRun,
      },
      targetSummary: {
        manual: targetConfig.targets.length,
        harvested: 0,
        total: targetConfig.targets.length,
        eligible: 0,
        skipped: 0,
      },
      actions: [],
      skippedTargets: [],
      touchedLedgerPath: buildTouchedLedgerPath(config),
    };

    const summaryPath = saveArtifact(config.paths.summariesDir, "overnight-summary", summary);
    return {
      summaryPath,
      summary,
    };
  }

  const harvestedTargets = buildHarvestedTargets(config, scan, targetConfig);
  const combinedTargets = mergeOvernightTargets(targetConfig.targets, harvestedTargets);
  const evaluation = evaluateTargets(config, combinedTargets, targetConfig.allowedAuthors, targetConfig.harvest, touchedLedger);
  const selectedPostTarget = pickPostTarget(config, evaluation.eligible);
  const selectedReplyTargets = pickReplyTargets(config, evaluation.eligible, touchedLedger, selectedPostTarget);

  const actions = [];
  const ledgerEntries = [];

  if (selectedPostTarget) {
    actions.push(
      await executeAction(config, db, scan, {
        topic: options.topic,
        scanPath,
        kind: selectedPostTarget.mode === "quote" ? "quote" : "react",
        target: selectedPostTarget,
        stretchBudget: options.stretchBudget,
        allowOlderTarget: options.allowOlderTarget,
      })
    );
  } else {
    actions.push(
      await executeAction(config, db, scan, {
        topic: options.topic,
        scanPath,
        kind: "original",
        target: null,
        stretchBudget: options.stretchBudget,
        allowOlderTarget: options.allowOlderTarget,
      })
    );
  }

  for (const target of selectedReplyTargets) {
    actions.push(
      await executeAction(config, db, scan, {
        topic: options.topic,
        scanPath,
        kind: "reply",
        target,
        stretchBudget: options.stretchBudget,
        allowOlderTarget: options.allowOlderTarget,
      })
    );
  }

  for (const action of actions) {
    if (action.status !== "published") {
      continue;
    }

    if (action.target?.author) {
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
  }

  const nextLedger = {
    ...touchedLedger,
    entries: pruneLedgerEntries(config, [...(touchedLedger.entries ?? []), ...ledgerEntries]),
    updatedAt: new Date().toISOString(),
  };
  writeTouchedLedger(config, nextLedger);

  const summary = {
    mode: "overnight",
    topic: options.topic,
    startedAt,
    completedAt: new Date().toISOString(),
    publishEnabled: config.threads.publishEnabled,
    targetsFile: targetFile,
    scanPath,
    caps: {
      runsPerWindow: config.posting.overnightRunsPerWindow,
      maxPostActionsPerRun: config.posting.overnightMaxPostActionsPerRun,
      maxReplyActionsPerRun: config.posting.overnightMaxReplyActionsPerRun,
      rollingWindowHours: config.posting.rollingWindowHours,
      originalBudget: options.stretchBudget ? config.posting.stretchOriginalBudget : config.posting.defaultOriginalBudget,
      interactionBudget: options.stretchBudget ? config.posting.stretchInteractionBudget : config.posting.defaultInteractionBudget,
    },
    targetSummary: {
      manual: targetConfig.targets.length,
      harvested: harvestedTargets.length,
      total: combinedTargets.length,
      eligible: evaluation.eligible.length,
      skipped: evaluation.skipped.length,
    },
    harvestedTargets,
    selected: {
      postTarget: selectedPostTarget,
      replyTargets: selectedReplyTargets,
    },
    actions,
    skippedTargets: evaluation.skipped,
    touchedLedgerPath: buildTouchedLedgerPath(config),
  };

  const summaryPath = saveArtifact(config.paths.summariesDir, "overnight-summary", summary);
  return {
    summaryPath,
    summary,
  };
}

async function executeAction(config, db, scan, options) {
  try {
    const draft = await buildDraftFromScan(config, scan, {
      target: options.target,
      overnightMode: true,
      forceSinglePost: true,
      disableMedia: true,
    });
    const draftPath = saveArtifact(config.paths.draftsDir, "draft", draft);

    validateDraftForPublish(config, draft, {
      stretchBudget: options.stretchBudget,
      allowOlderTarget: options.allowOlderTarget,
    });

    if (!config.threads.publishEnabled) {
      return {
        kind: options.kind,
        status: "drafted",
        draftPath,
        target: options.target,
      };
    }

    const receipt = await publishDraft(config, draft);
    const receiptPath = saveArtifact(config.paths.receiptsDir, "receipt", receipt);
    recordPublishReceipt(db, receipt, receiptPath);

    return {
      kind: options.kind,
      status: "published",
      draftPath,
      receiptPath,
      publishedAt: receipt.publishedAt,
      receipt,
      target: options.target,
    };
  } catch (error) {
    return {
      kind: options.kind,
      status: "skipped",
      error: String(error?.message ?? error),
      target: options.target,
    };
  }
}

function evaluateTargets(config, targets, allowedAuthors, harvestConfig, touchedLedger) {
  const eligible = [];
  const skipped = [];

  for (const target of targets) {
    const reason = getTargetSkipReason(config, target, allowedAuthors, harvestConfig, touchedLedger);
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

function getTargetSkipReason(config, target, allowedAuthors, harvestConfig, touchedLedger) {
  if (!target.active) {
    return "inactive";
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

  if (target.activityScore < 1) {
    return "target is not marked as live enough";
  }

  const author = target.author.toLowerCase().replace(/^@/, "");
  if (target.autoHarvested) {
    if (!isAllowedHarvestTarget(target, harvestConfig)) {
      return "harvested target is outside the overnight harvest allowlist";
    }
  } else {
    const allowlist = allowedAuthors[target.platform] ?? [];
    if (!allowlist.includes(author)) {
      return "author is not on the overnight allowlist";
    }
  }

  const targetAgeHours = ageHours(config.now, target.publishedAt);
  if (!Number.isFinite(targetAgeHours) || targetAgeHours > config.posting.maxTargetAgeHours) {
    return "target is too old for overnight mode";
  }

  if (hasTouchedAuthorRecently(config, touchedLedger, author, target.platform)) {
    return "author was already touched in the last 24 hours";
  }

  return null;
}

function isAllowedHarvestTarget(target, harvestConfig) {
  if (!harvestConfig?.enabled) {
    return false;
  }

  const provider = String(target.sourceProvider ?? "").toLowerCase();
  const host = String(target.sourceHost ?? "").toLowerCase();

  if (!harvestConfig.providers.includes(provider)) {
    return false;
  }

  return harvestConfig.allowedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
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
