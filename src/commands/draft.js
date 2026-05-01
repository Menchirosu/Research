import { getConfig } from "../config.js";
import { CliError, printJson } from "../lib/cli.js";
import { loadJson, saveArtifact } from "../lib/fs.js";
import { validateScanForDraft } from "../lib/validators.js";
import { normalizeThreadFlag, resolveDraftTarget } from "../lib/targets.js";
import { buildDraftFromScan } from "../lib/writer.js";

export async function runDraftCommand(flags) {
  const config = getConfig();
  const scanPath = flags.scan;

  if (!scanPath) {
    throw new CliError("Missing --scan=<path>.");
  }

  const scan = loadJson(scanPath);
  validateScanForDraft(config, scan);
  const target = await resolveDraftTarget(config, flags);
  const draft = await buildDraftFromScan(config, scan, {
    target,
    forceThread: normalizeThreadFlag(flags.thread),
  });

  const artifactPath = saveArtifact(config.paths.draftsDir, "draft", draft);
  printJson({
    artifactPath,
    draft,
  });
}
