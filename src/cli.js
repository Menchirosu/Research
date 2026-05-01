#!/usr/bin/env node

import { runAuthCommand } from "./commands/auth.js";
import { runDeleteCommand } from "./commands/delete.js";
import { runDraftCommand } from "./commands/draft.js";
import { runHistoryCommand } from "./commands/history.js";
import { runOvernightCommand } from "./commands/overnight.js";
import { runPublishCommand } from "./commands/publish.js";
import { runRunCommand } from "./commands/run.js";
import { runScanCommand } from "./commands/scan.js";
import { runTargetsCommand } from "./commands/targets.js";
import { CliError, parseArgs, printJson, printUsage } from "./lib/cli.js";

async function main() {
  const { command, subcommand, flags } = parseArgs(process.argv.slice(2));

  switch (command) {
    case "auth":
      return runAuthCommand(subcommand, flags);
    case "scan":
      return runScanCommand(flags);
    case "overnight":
      return runOvernightCommand(flags);
    case "draft":
      return runDraftCommand(flags);
    case "delete":
      return runDeleteCommand(flags);
    case "publish":
      return runPublishCommand(flags);
    case "run":
      return runRunCommand(flags);
    case "targets":
      return runTargetsCommand(subcommand, flags);
    case "history":
      return runHistoryCommand(flags);
    case "help":
    case undefined:
      printUsage();
      return;
    default:
      throw new CliError(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  if (error instanceof CliError) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  console.error(error);
  process.exitCode = 1;
});
