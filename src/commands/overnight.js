import { getConfig } from "../config.js";
import { CliError, printJson } from "../lib/cli.js";
import { runOvernightCycle } from "../lib/overnight.js";

export async function runOvernightCommand(flags) {
  const config = getConfig();
  const topic = flags.topic;

  if (!topic) {
    throw new CliError("Missing --topic=\"...\".");
  }

  const result = await runOvernightCycle(config, {
    topic,
    watchlistFile:
      typeof flags["watchlist-file"] === "string" ? flags["watchlist-file"] : config.paths.threadsWatchlistFile,
    seededPostsFile:
      typeof flags["seeded-posts-file"] === "string" ? flags["seeded-posts-file"] : config.paths.seededPostsFile,
    stretchBudget: flags["stretch-budget"] === true,
    allowOlderTarget: flags["allow-older-target"] === true,
  });

  printJson(result);
}
