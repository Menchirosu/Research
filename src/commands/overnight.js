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
    targetsFile: typeof flags["targets-file"] === "string" ? flags["targets-file"] : config.paths.overnightTargetsFile,
    stretchBudget: flags["stretch-budget"] === true,
    allowOlderTarget: flags["allow-older-target"] === true,
  });

  printJson(result);
}
