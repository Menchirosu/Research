import { getConfig } from "../config.js";
import { CliError, printJson } from "../lib/cli.js";
import { loadJson, saveArtifact } from "../lib/fs.js";
import { buildHarvestedTargets, loadOvernightTargets, mergeOvernightTargets } from "../lib/overnight-targets.js";
import { runScan } from "../lib/scan.js";
import { buildWatchlistReport, loadThreadsWatchlist } from "../lib/threads-targets.js";
import {
  browsePublicThreadsPost,
  browsePublicThreadsProfile,
  discoverPublicThreadsProfiles,
} from "../lib/threads-public-web.js";

export async function runTargetsCommand(subcommand, flags) {
  if (subcommand === "harvest") {
    return runTargetsHarvest(flags);
  }

  if (subcommand === "watchlist") {
    return runTargetsWatchlist(flags);
  }

  if (subcommand === "profile") {
    return runTargetsProfile(flags);
  }

  if (subcommand === "post") {
    return runTargetsPost(flags);
  }

  if (subcommand === "discover") {
    return runTargetsDiscover(flags);
  }

  throw new CliError('Unknown targets subcommand. Use "targets harvest", "targets watchlist", "targets profile", "targets post", or "targets discover".');
}

async function runTargetsHarvest(flags) {
  const config = getConfig();
  const targetsFile = typeof flags["targets-file"] === "string" ? flags["targets-file"] : config.paths.overnightTargetsFile;
  const targetConfig = loadOvernightTargets(targetsFile);

  let scan = null;
  let scanPath = null;
  let topic = null;

  if (typeof flags.scan === "string") {
    scanPath = flags.scan;
    scan = loadJson(scanPath);
    topic = scan.topic ?? null;
  } else if (typeof flags.topic === "string") {
    topic = flags.topic;
    scan = await runScan(config, {
      topic,
    });
    scanPath = saveArtifact(config.paths.scansDir, "scan", scan);
  } else {
    throw new CliError('Use "targets harvest" with either --scan=<path> or --topic="...".');
  }

  const harvestedTargets = buildHarvestedTargets(config, scan, targetConfig);
  const mergedTargets = mergeOvernightTargets(targetConfig.targets, harvestedTargets);
  const preview = {
    generatedAt: new Date().toISOString(),
    topic,
    scanPath,
    targetsFile,
    harvest: targetConfig.harvest,
    targetSummary: {
      manual: targetConfig.targets.length,
      harvested: harvestedTargets.length,
      total: mergedTargets.length,
    },
    harvestedTargets,
    mergedTargets,
  };

  const artifactPath = saveArtifact(config.paths.summariesDir, "overnight-targets", preview);
  printJson({
    artifactPath,
    preview,
  });
}

async function runTargetsWatchlist(flags) {
  const config = getConfig();
  const watchlistFile =
    typeof flags["watchlist-file"] === "string" ? flags["watchlist-file"] : config.paths.threadsWatchlistFile;
  const watchlist = loadThreadsWatchlist(watchlistFile);
  const report = await buildWatchlistReport(config, watchlist);
  const artifactPath = saveArtifact(config.paths.summariesDir, "threads-watchlist", report);

  printJson({
    artifactPath,
    report,
  });
}

async function runTargetsProfile(flags) {
  const config = getConfig();
  const username = typeof flags.username === "string" ? flags.username.trim() : "";
  if (!username) {
    throw new CliError('Use "targets profile" with --username=<threads_username>.');
  }

  const profile = await browsePublicThreadsProfile(config, username, {
    includeReplies: flags["no-replies"] !== true,
  });
  const artifactPath = saveArtifact(config.paths.summariesDir, "threads-profile", profile);
  printJson({
    artifactPath,
    profile,
  });
}

async function runTargetsPost(flags) {
  const config = getConfig();
  const url = typeof flags.url === "string" ? flags.url.trim() : "";
  if (!url) {
    throw new CliError('Use "targets post" with --url=https://www.threads.com/@.../post/....');
  }

  const post = await browsePublicThreadsPost(config, url);
  const artifactPath = saveArtifact(config.paths.summariesDir, "threads-post", post);
  printJson({
    artifactPath,
    post,
  });
}

async function runTargetsDiscover(flags) {
  const config = getConfig();
  const watchlistFile =
    typeof flags["watchlist-file"] === "string" ? flags["watchlist-file"] : config.paths.threadsWatchlistFile;
  const watchlist = loadThreadsWatchlist(watchlistFile);
  const usernames = parseUsernames(flags.usernames);
  const accounts = buildDiscoveryAccounts(watchlist.accounts, usernames);
  if (accounts.length === 0) {
    throw new CliError('Use "targets discover" with --usernames=a,b,c or provide a non-empty watchlist file.');
  }

  const limit = Number.isFinite(Number(flags.limit)) ? Number(flags.limit) : 10;
  const report = await discoverPublicThreadsProfiles(config, accounts, {
    limit,
  });
  const artifactPath = saveArtifact(config.paths.summariesDir, "threads-discovery", report);
  printJson({
    artifactPath,
    report,
  });
}

function parseUsernames(value) {
  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim().replace(/^@/, "").toLowerCase())
    .filter(Boolean);
}

function buildDiscoveryAccounts(existingAccounts, usernames) {
  if (usernames.length === 0) {
    return existingAccounts.filter((account) => account.enabled);
  }

  const byUsername = new Map(
    existingAccounts.map((account) => [
      account.username,
      {
        ...account,
      },
    ])
  );
  const accounts = [];

  for (const username of usernames) {
    if (byUsername.has(username)) {
      accounts.push(byUsername.get(username));
      continue;
    }

    accounts.push({
      username,
      tier: "candidate",
      lane: "ai-builder",
      allowReplies: true,
      enabled: true,
      maxCandidatesPerRun: 2,
      verifiedExpected: null,
      manualWeight: 0,
      notes: "ad hoc discovery account",
      profileUrl: `https://www.threads.com/@${username}`,
    });
  }

  return accounts.filter((account) => account.enabled);
}
