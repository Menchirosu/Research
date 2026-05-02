import path from "node:path";
import { fileURLToPath } from "node:url";
import { readEnvFile } from "./lib/env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

export function getConfig() {
  const envFile = path.join(repoRoot, ".env");
  const env = readEnvFile(envFile);

  const runtimeDir = path.join(repoRoot, "var");

  return {
    repoRoot,
    now: new Date(),
    paths: {
      envFile,
      runtimeDir,
      scansDir: path.join(runtimeDir, "artifacts", "scans"),
      draftsDir: path.join(runtimeDir, "artifacts", "drafts"),
      receiptsDir: path.join(runtimeDir, "artifacts", "receipts"),
      summariesDir: path.join(runtimeDir, "artifacts", "summaries"),
      publishSessionsDir: path.join(runtimeDir, "artifacts", "publish-sessions"),
      mediaCacheDir: path.join(runtimeDir, "cache", "media"),
      ledgersDir: path.join(runtimeDir, "ledgers"),
      dbFile: path.join(runtimeDir, "db", "history.sqlite"),
      styleFile: path.join(repoRoot, "config", "threads-style.md"),
      overnightTargetsFile: path.join(repoRoot, "config", "overnight-targets.json"),
      overnightTargetsExampleFile: path.join(repoRoot, "config", "overnight-targets.example.json"),
      threadsWatchlistFile: path.join(repoRoot, "config", "threads-watchlist.json"),
      seededPostsFile: path.join(repoRoot, "config", "seeded-posts.json"),
    },
    threads: {
      apiHost: "https://graph.threads.net",
      authorizationHost: "https://threads.net/oauth/authorize",
      appId: env.THREADS_APP_ID ?? "",
      appSecret: env.THREADS_APP_SECRET ?? "",
      redirectUri: env.THREADS_REDIRECT_URI ?? "http://localhost:8787/callback",
      scopes: (
        env.THREADS_SCOPES ??
        "threads_basic,threads_content_publish,threads_manage_insights,threads_profile_discovery"
      )
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      accessToken: env.THREADS_ACCESS_TOKEN ?? "",
      longLivedAccessToken: env.THREADS_LONG_LIVED_ACCESS_TOKEN ?? "",
      publishEnabled: String(env.THREADS_PUBLISH_ENABLED ?? "false").toLowerCase() === "true",
      replyControl: env.THREADS_REPLY_CONTROL ?? "everyone",
    },
    github: {
      token: env.GITHUB_TOKEN ?? "",
    },
    scan: {
      redditSubreddits: ["codex", "ClaudeCode", "vibecoding", "AskVibecoders"],
      redditLimitPerFeed: 8,
      redditThreadFetchPerFeed: 4,
      hnLimit: 10,
      githubLimit: 6,
      hotWindowHours: 24,
      anchorFreshnessHours: 72,
      weakSupportWindowHours: 24 * 7,
      mediaAllowlist: [
        "github.com",
        "raw.githubusercontent.com",
        "user-images.githubusercontent.com",
        "youtube.com",
        "img.youtube.com",
        "i.ytimg.com",
        "developers.facebook.com",
        "openai.com",
        "anthropic.com",
      ],
      blockedDomains: ["threads.net", "www.threads.net", "threads.com", "www.threads.com"],
      minimumIndependentSources: 2,
      freshnessWindowDays: 7,
      maxPostsPerThread: 3,
    },
    posting: {
      rollingWindowHours: 24,
      defaultOriginalBudget: 3,
      defaultInteractionBudget: 12,
      stretchOriginalBudget: 4,
      stretchInteractionBudget: 20,
      originalDraftExpiryHours: 12,
      targetDraftExpiryHours: 4,
      idealTargetWindowHours: 24,
      maxTargetAgeHours: 48,
      overrideTargetAgeHours: 24 * 7,
      overnightRunsPerWindow: 3,
      overnightMaxPostActionsPerRun: 1,
      overnightMaxReplyActionsPerRun: 2,
      overnightAutoReactMinimumPriority: 90,
      overnightAutoReactMinimumActivity: 2,
      overnightPrimaryReplyMaxAgeHours: 24,
    },
  };
}
