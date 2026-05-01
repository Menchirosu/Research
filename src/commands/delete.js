import { getConfig } from "../config.js";
import { CliError, printJson } from "../lib/cli.js";
import { deletePublishedThread } from "../lib/publisher.js";

export async function runDeleteCommand(flags) {
  const config = getConfig();
  const threadId = flags.id;

  if (!threadId) {
    throw new CliError("Missing --id=<thread_id>.");
  }

  const result = await deletePublishedThread(config, threadId);
  printJson({
    deleted: threadId,
    result,
  });
}
