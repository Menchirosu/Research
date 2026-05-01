import { getConfig } from "../config.js";
import { CliError, printJson } from "../lib/cli.js";
import { envFileExists, readEnvFile, upsertEnvValues } from "../lib/env.js";
import { ensureRuntimeDirs } from "../lib/fs.js";
import {
  buildAuthorizationUrl,
  exchangeCodeForToken,
  exchangeShortLivedForLongLivedToken,
  getProfile,
  getTokenStatus,
  refreshLongLivedToken,
} from "../lib/threads-api.js";

export async function runAuthCommand(subcommand, flags) {
  const config = getConfig();
  ensureRuntimeDirs(config);

  switch (subcommand) {
    case "url":
      printJson({
        authorizationUrl: buildAuthorizationUrl(config),
      });
      return;

    case "exchange": {
      const code = flags.code;
      if (!code) {
        throw new CliError("Missing --code for auth exchange.");
      }

      const tokenPayload = await exchangeCodeForToken(config, code);
      upsertEnvValues(config.paths.envFile, {
        THREADS_ACCESS_TOKEN: tokenPayload.access_token ?? "",
      });

      printJson({
        message: "Stored THREADS_ACCESS_TOKEN in .env",
        tokenPayload,
      });
      return;
    }

    case "refresh": {
      const token = config.threads.longLivedAccessToken;
      if (!token) {
        throw new CliError("No long-lived access token found in .env.");
      }

      const refreshed = await refreshLongLivedToken(config, token);
      upsertEnvValues(config.paths.envFile, {
        THREADS_LONG_LIVED_ACCESS_TOKEN: refreshed.access_token ?? token,
      });

      printJson({
        message: "Stored THREADS_LONG_LIVED_ACCESS_TOKEN in .env",
        refreshed,
      });
      return;
    }

    case "long-lived": {
      const token = config.threads.accessToken;
      if (!token) {
        throw new CliError("No short-lived access token found in .env. Run auth exchange first.");
      }

      const exchanged = await exchangeShortLivedForLongLivedToken(config, token);
      upsertEnvValues(config.paths.envFile, {
        THREADS_LONG_LIVED_ACCESS_TOKEN: exchanged.access_token ?? "",
      });

      printJson({
        message: "Stored THREADS_LONG_LIVED_ACCESS_TOKEN in .env",
        exchanged,
      });
      return;
    }

    case "status": {
      const envValues = envFileExists(config.paths.envFile) ? readEnvFile(config.paths.envFile) : {};
      const tokenStatus = getTokenStatus(config);
      let profile = null;

      if (tokenStatus.hasToken) {
        try {
          profile = await getProfile(config);
        } catch (error) {
          profile = {
            error: error.message,
          };
        }
      }

      printJson({
        envFile: config.paths.envFile,
        envKeysPresent: Object.keys(envValues),
        tokenStatus,
        profile,
      });
      return;
    }

    default:
      throw new CliError("Usage: auth <url|exchange|long-lived|refresh|status>");
  }
}
