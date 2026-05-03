# Research Trend Threader

Repo-local CLI for:

- scanning current builder-heavy public sources
- ranking signals into a short research artifact
- drafting a short Threads thread in a human voice
- publishing through the official Threads API
- logging receipts and local post history
- running a zero-cost overnight automation loop from your own Windows machine

## Current scope

This first cut is local-first and optimized for the workflow you locked in:

- auto-post capable, but guarded by config
- broad source scanning
- media scraping only from an allowlist
- no Threads.com scraping
- short thread output, max 3 posts
- SQLite history via Node's built-in `node:sqlite`
- overnight mode with Threads-native watchlist targeting, seeded-post queue, touched ledger, and summary artifacts

## Setup

1. Copy `.env.example` to `.env`
2. Fill in your Threads app settings
3. Run a manual auth flow:

```bash
node src/callback-server.js
node src/cli.js auth url
node src/cli.js auth exchange --code=PASTE_CODE_HERE
node src/cli.js auth long-lived
```

4. Run a scan:

```bash
node src/cli.js scan --topic="hot MCPs for AI coding"
```

5. Draft a thread:

```bash
node src/cli.js draft --scan=var/artifacts/scans/<file>.json
```

6. Publish:

```bash
node src/cli.js publish --draft=var/artifacts/drafts/<file>.json
```

Or do the full pipeline:

```bash
node src/cli.js run --topic="what's hot in AI coding right now"
```

Or run the overnight scheduler-friendly flow:

```bash
node src/cli.js overnight --topic="hot AI coding workflows right now" --watchlist-file=config/threads-watchlist.json --seeded-posts-file=config/seeded-posts.json
```

Or preview the auto-harvested overnight target queue from an existing scan:

```bash
node src/cli.js targets harvest --scan=var/artifacts/scans/<file>.json --targets-file=config/overnight-targets.json
```

Or rank the current Threads watchlist by freshness, engagement, and usefulness:

```bash
node src/cli.js targets watchlist --watchlist-file=config/threads-watchlist.json
```

## Commands

- `auth url`
- `auth exchange --code=...`
- `auth long-lived`
- `auth refresh`
- `auth status`
- `overnight --topic="..."`
- `targets harvest --scan=...`
- `targets watchlist`
- `node src/callback-server.js`
- `scan --topic="..."`
- `draft --scan=...`
- `publish --draft=...`
- `run --topic="..."`
- `history`

## Notes

- Image posts use public source media URLs because the Threads API pulls the media from a public URL.
- Downloaded media is cached locally for receipts and review, but the publish step still uses the original public URL.
- GitHub source scanning is optional and works best with `GITHUB_TOKEN`.
- Overnight mode is conservative by design:
  - one fresh scan per run
  - max `1` original or quote post per run
  - max `2` reply actions per run
  - one touch per target account per rolling `24h`
  - target-based posts require `publishedAt`
  - overnight interactions are Threads-native only
  - quote/reply targets come from the Threads watchlist and seeded-post queue
  - external scan sources are support context for originals, not overnight interaction targets
  - bland overnight originals are skipped instead of being forced out

## Threads Watchlist And Seeded Posts

`config/threads-watchlist.json` is the curated list of notable Threads accounts the bot is allowed to monitor overnight.

Basic shape:

```json
{
  "accounts": [
    {
      "username": "claudeai",
      "tier": "primary",
      "lane": "ai-builder",
      "allowReplies": true,
      "enabled": true,
      "verifiedExpected": true,
      "manualWeight": 10,
      "notes": "strong Claude Code and builder-discourse source"
    }
  ]
}
```

Rules:

- `primary` accounts can be quoted overnight and can allow one-hop replies
- `secondary` accounts only get hit when the post looks active enough
- `candidate` accounts are watch-only until they earn promotion
- `maxCandidatesPerRun` caps how many fresh candidates the bot keeps per account per cycle
- `verifiedExpected` is a hint, not a hard requirement; notable means `verified OR in-lane + strong engagement`
- `manualWeight` lets you bias an account upward without breaking the evidence-based scoring
- by default the bot now prefers a rendered public Threads profile-page fallback and only hits the official discovery API if that fallback comes up empty

The watchlist report scores each enabled account using:

- fresh profile posts
- fresh replies
- weighted engagement where comments/reposts matter more than likes
- whether the account is observed as verified
- whether the account is producing quote/reply-worthy targets

Statuses currently emitted:

- `rising`
- `stable`
- `stale`
- `demotion-risk`

Recommendations currently emitted:

- `keep`
- `promote-to-secondary`
- `promote-to-primary`
- `review-primary`
- `demote-to-candidate`

Optional env:

```env
THREADS_PUBLIC_DISCOVERY_MODE=rendered-first
```

Supported values:

- `rendered-first`
- `rendered-only`
- `api-first`
- `api-only`

`config/seeded-posts.json` is the one-hop queue for exact Threads posts you want the bot to consider overnight.

Basic shape:

```json
{
  "posts": [
    {
      "id": "claude-launch-quote",
      "mode": "quote",
      "author": "claudeai",
      "url": "https://www.threads.com/@claudeai/post/...",
      "postId": "18000000000000000",
      "text": "target post text",
      "publishedAt": "2026-05-02T09:30:00Z",
      "activityScore": 2,
      "priority": 125,
      "tier": "primary",
      "allowReplies": true,
      "thresholdOverride": true,
      "active": true,
      "isReplyToUs": false,
      "reason": "fresh launch post worth hitting even before it fully moves"
    }
  ]
}
```

Rules:

- seeded posts must be real Threads permalinks with real `postId` and `publishedAt`
- `thresholdOverride: true` lets a manually seeded post bypass the usual live-activity floor for one cycle
- replies are still one-hop only overnight

## External Harvest Preview

`config/overnight-targets.json` still exists, but it is now only for previewing external scan harvests with:

```json
{
  "harvest": {
    "enabled": true,
    "providers": ["reddit", "hackernews", "github"],
    "allowedDomains": ["reddit.com", "news.ycombinator.com", "github.com"],
    "maxTargets": 8,
    "maxPerProvider": 3,
    "minimumSignalScore": 70,
    "minimumActivityScore": 1
  },
  "targets": []
}
```

How it works now:

- external harvest preview is still useful for research and original-post support
- overnight interactions no longer react directly to Reddit, Hacker News, or GitHub URLs
- if you want to inspect what the scan would have harvested from external sources, use:

```bash
node src/cli.js targets harvest --scan=var/artifacts/scans/<file>.json
```

## Windows Scheduling

The repo includes [scripts/run-overnight.ps1](C:/Users/Cocoy/source/repos/Research/scripts/run-overnight.ps1) for Task Scheduler.

Example manual run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-overnight.ps1 -Topic "hot AI coding workflows right now"
```

Recommended overnight pattern:

- create `3` scheduled tasks across your sleep window
- keep the PC on and connected
- disable sleep for those hours
- review the summary artifacts under `var/artifacts/summaries` in the morning

## GitHub Actions

If you do not want your PC on, the repo now includes [.github/workflows/overnight-threader.yml](C:/Users/Cocoy/source/repos/Research/.github/workflows/overnight-threader.yml).

What it does:

- runs `3` scheduled overnight cycles on GitHub-hosted runners
- restores persistent runtime state from a dedicated `bot-state` branch
- runs the `overnight` command
- pushes updated `var/` state back to `bot-state`
- uploads summary and receipt artifacts

Required repository secrets:

- `THREADS_APP_ID`
- `THREADS_APP_SECRET`
- `THREADS_REDIRECT_URI`
- `THREADS_ACCESS_TOKEN`
- `THREADS_LONG_LIVED_ACCESS_TOKEN`

Important:

- this works best for a **public repo**, because GitHub-hosted Actions are free there
- on a **private repo**, GitHub Actions uses your included minutes and can bill past quota
- the workflow keeps state in a separate `bot-state` branch because GitHub-hosted runners are ephemeral
- if you want Threads watchlist discovery to work reliably, your token should include `threads_profile_discovery`
- if Meta still blocks public discovery at the app level, the overnight watchlist can still work through rendered public Threads profile pages as long as a browser is available on the runner
