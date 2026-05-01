import { getConfig } from "../config.js";
import { printJson } from "../lib/cli.js";
import { getHistorySummary, initDatabase } from "../lib/history.js";

export async function runHistoryCommand() {
  const config = getConfig();
  const db = initDatabase(config);
  printJson(getHistorySummary(db));
}
