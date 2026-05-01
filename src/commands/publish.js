import { getConfig } from "../config.js";
import { CliError, printJson } from "../lib/cli.js";
import { loadJson, saveArtifact } from "../lib/fs.js";
import { initDatabase, recordPublishReceipt } from "../lib/history.js";
import { publishDraft } from "../lib/publisher.js";
import { validateDraftForPublish } from "../lib/validators.js";

export async function runPublishCommand(flags) {
  const config = getConfig();
  const draftPath = flags.draft;

  if (!draftPath) {
    throw new CliError("Missing --draft=<path>.");
  }

  const draft = loadJson(draftPath);
  validateDraftForPublish(config, draft, {
    stretchBudget: flags["stretch-budget"] === true,
    allowOlderTarget: flags["allow-older-target"] === true,
  });

  if (!config.threads.publishEnabled) {
    throw new CliError("Publishing is disabled. Set THREADS_PUBLISH_ENABLED=true in .env to allow publish.");
  }

  const receipt = await publishDraft(config, draft);
  const receiptPath = saveArtifact(config.paths.receiptsDir, "receipt", receipt);
  const db = initDatabase(config);
  recordPublishReceipt(db, receipt, receiptPath);

  printJson({
    receiptPath,
    receipt,
  });
}
