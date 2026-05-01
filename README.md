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
- overnight mode with local target allowlist, touched ledger, and summary artifacts

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
node src/cli.js overnight --topic="hot AI coding workflows right now" --targets-file=config/overnight-targets.json
```

Or preview the auto-harvested overnight target queue from an existing scan:

```bash
node src/cli.js targets harvest --scan=var/artifacts/scans/<file>.json --targets-file=config/overnight-targets.json
```

## Commands

- `auth url`
- `auth exchange --code=...`
- `auth long-lived`
- `auth refresh`
- `auth status`
- `overnight --topic="..."`
- `targets harvest --scan=...`
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
  - manual reply/quote targets come from `config/overnight-targets.json`
  - fresh scan hits are auto-harvested into safe `react` targets each run

## Overnight Targets

`config/overnight-targets.json` is the local allowlist and queue for autonomous quote/reply actions. It also controls the automatic harvest rules for fresh scan sources.

Basic shape:

```json
{
  "allowedAuthors": {
    "threads": ["claudeai", "openai"],
    "x": ["coreyganim"]
  },
  "harvest": {
    "enabled": true,
    "providers": ["reddit", "hackernews", "github"],
    "allowedDomains": ["reddit.com", "news.ycombinator.com", "github.com"],
    "maxTargets": 8,
    "maxPerProvider": 3,
    "minimumSignalScore": 70,
    "minimumActivityScore": 1
  },
  "targets": [
    {
      "id": "unique-id",
      "mode": "quote",
      "platform": "threads",
      "author": "claudeai",
      "url": "https://www.threads.com/@claudeai/post/...",
      "postId": "17878614390475240",
      "text": "target post text",
      "publishedAt": "2026-05-02T09:30:00Z",
      "activityScore": 2,
      "priority": 10,
      "active": true,
      "isReplyToUs": false
    }
  ]
}
```

Use `activityScore >= 1` for targets that are still live enough to hit overnight. Leave `active` false or remove the target when it goes stale.

How it works now:

- `targets[]` is still where native Threads `reply` and `quote` actions live, because those need real post IDs.
- each overnight run also turns fresh scan sources into temporary `react` targets automatically
- harvested targets are limited by `harvest.providers`, `harvest.allowedDomains`, freshness, and signal score
- if you want to inspect the generated queue before a scheduled run, use:

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
