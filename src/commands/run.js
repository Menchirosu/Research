import { getConfig } from "../config.js";
import { CliError, printJson } from "../lib/cli.js";
import { saveArtifact } from "../lib/fs.js";
import { initDatabase, recordPublishReceipt } from "../lib/history.js";
import { publishDraft } from "../lib/publisher.js";
import { runScan } from "../lib/scan.js";
import { normalizeThreadFlag, resolveDraftTarget } from "../lib/targets.js";
import { validateDraftForPublish, validateScanForDraft } from "../lib/validators.js";
import { buildDraftFromScan } from "../lib/writer.js";

export async function runRunCommand(flags) {
  const config = getConfig();
  const topic = flags.topic;

  if (!topic) {
    throw new CliError("Missing --topic=\"...\".");
  }

  const scan = await runScan(config, {
    topic,
  });
  validateScanForDraft(config, scan);
  const scanPath = saveArtifact(config.paths.scansDir, "scan", scan);

  const target = await resolveDraftTarget(config, flags);
  const draft = await buildDraftFromScan(config, scan, {
    target,
    forceThread: normalizeThreadFlag(flags.thread),
  });
  const draftPath = saveArtifact(config.paths.draftsDir, "draft", draft);

  validateDraftForPublish(config, draft, {
    stretchBudget: flags["stretch-budget"] === true,
    allowOlderTarget: flags["allow-older-target"] === true,
  });

  if (!config.threads.publishEnabled) {
    printJson({
      message: "Publish disabled. Generated artifacts only.",
      scanPath,
      draftPath,
      draft,
    });
    return;
  }

  const receipt = await publishDraft(config, draft);
  const receiptPath = saveArtifact(config.paths.receiptsDir, "receipt", receipt);
  const db = initDatabase(config);
  recordPublishReceipt(db, receipt, receiptPath);

  printJson({
    scanPath,
    draftPath,
    receiptPath,
    receipt,
  });
}
