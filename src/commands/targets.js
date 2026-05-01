import { getConfig } from "../config.js";
import { CliError, printJson } from "../lib/cli.js";
import { loadJson, saveArtifact } from "../lib/fs.js";
import { buildHarvestedTargets, loadOvernightTargets, mergeOvernightTargets } from "../lib/overnight-targets.js";
import { runScan } from "../lib/scan.js";

export async function runTargetsCommand(subcommand, flags) {
  if (subcommand !== "harvest") {
    throw new CliError('Unknown targets subcommand. Use "targets harvest".');
  }

  const config = getConfig();
  const targetsFile = typeof flags["targets-file"] === "string" ? flags["targets-file"] : config.paths.overnightTargetsFile;
  const targetConfig = loadOvernightTargets(targetsFile);

  let scan = null;
  let scanPath = null;
  let topic = null;

  if (typeof flags.scan === "string") {
    scanPath = flags.scan;
    scan = loadJson(scanPath);
    topic = scan.topic ?? null;
  } else if (typeof flags.topic === "string") {
    topic = flags.topic;
    scan = await runScan(config, {
      topic,
    });
    scanPath = saveArtifact(config.paths.scansDir, "scan", scan);
  } else {
    throw new CliError('Use "targets harvest" with either --scan=<path> or --topic="...".');
  }

  const harvestedTargets = buildHarvestedTargets(config, scan, targetConfig);
  const mergedTargets = mergeOvernightTargets(targetConfig.targets, harvestedTargets);
  const preview = {
    generatedAt: new Date().toISOString(),
    topic,
    scanPath,
    targetsFile,
    harvest: targetConfig.harvest,
    targetSummary: {
      manual: targetConfig.targets.length,
      harvested: harvestedTargets.length,
      total: mergedTargets.length,
    },
    harvestedTargets,
    mergedTargets,
  };

  const artifactPath = saveArtifact(config.paths.summariesDir, "overnight-targets", preview);
  printJson({
    artifactPath,
    preview,
  });
}
