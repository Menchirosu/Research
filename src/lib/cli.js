export class CliError extends Error {}

export function parseArgs(argv) {
  const [command, subcommandOrFlag, ...rest] = argv;
  const flags = {};
  let subcommand = undefined;
  const remaining = [];

  if (subcommandOrFlag && !subcommandOrFlag.startsWith("--")) {
    subcommand = subcommandOrFlag;
  } else if (subcommandOrFlag) {
    remaining.push(subcommandOrFlag);
  }

  for (const item of [...remaining, ...rest]) {
    if (!item.startsWith("--")) {
      continue;
    }

    const [key, ...valueParts] = item.slice(2).split("=");
    flags[key] = valueParts.length ? valueParts.join("=") : true;
  }

  return {
    command,
    subcommand,
    flags,
  };
}

export function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

export function printUsage() {
  console.log(`Usage:
  node src/cli.js auth url
  node src/cli.js auth exchange --code=...
  node src/cli.js auth long-lived
  node src/cli.js auth refresh
  node src/cli.js auth status
  node src/cli.js overnight --topic="..." [--watchlist-file=config/threads-watchlist.json] [--seeded-posts-file=config/seeded-posts.json] [--stretch-budget] [--allow-older-target]
  node src/cli.js targets harvest --scan=var/artifacts/scans/<file>.json [--targets-file=config/overnight-targets.json]
  node src/cli.js targets harvest --topic="..." [--targets-file=config/overnight-targets.json]
  node src/cli.js targets watchlist [--watchlist-file=config/threads-watchlist.json]
  node src/cli.js scan --topic="..."
  node src/cli.js draft --scan=var/artifacts/scans/<file>.json [--target-text="..."] [--target-author="..."] [--target-url="..."] [--target-published-at=ISO8601] [--reply-to-id=<id>|--quote-post-id=<id>] [--thread=2|3]
  node src/cli.js delete --id=<thread_id>
  node src/cli.js publish --draft=var/artifacts/drafts/<file>.json [--stretch-budget] [--allow-older-target]
  node src/cli.js run --topic="..." [--target-text="..."] [--target-author="..."] [--target-url="..."] [--target-published-at=ISO8601] [--reply-to-id=<id>|--quote-post-id=<id>] [--thread=2|3] [--stretch-budget] [--allow-older-target]
  node src/cli.js history`);
}
