import { getConfig } from "../config.js";
import { CliError, printJson } from "../lib/cli.js";
import { saveArtifact } from "../lib/fs.js";
import { runScan } from "../lib/scan.js";

export async function runScanCommand(flags) {
  const config = getConfig();
  const topic = flags.topic;

  if (!topic) {
    throw new CliError("Missing --topic=\"...\".");
  }

  const scan = await runScan(config, {
    topic,
  });
  const artifactPath = saveArtifact(config.paths.scansDir, "scan", scan);

  printJson({
    artifactPath,
    scan,
  });
}
