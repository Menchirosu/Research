import { CliError } from "./cli.js";
import { fetchJson } from "./http.js";

export function buildAuthorizationUrl(config) {
  requireAuthConfig(config);
  const url = new URL(config.threads.authorizationHost);
  url.searchParams.set("client_id", config.threads.appId);
  url.searchParams.set("redirect_uri", config.threads.redirectUri);
  url.searchParams.set("scope", config.threads.scopes.join(","));
  url.searchParams.set("response_type", "code");
  return url.toString();
}

export async function exchangeCodeForToken(config, code) {
  requireAuthConfig(config);
  const url = new URL(`${config.threads.apiHost}/oauth/access_token`);
  url.searchParams.set("client_id", config.threads.appId);
  url.searchParams.set("client_secret", config.threads.appSecret);
  url.searchParams.set("code", code);
  url.searchParams.set("grant_type", "authorization_code");
  url.searchParams.set("redirect_uri", config.threads.redirectUri);
  return fetchJson(url.toString(), {
    method: "POST",
  });
}

export async function refreshLongLivedToken(config, accessToken) {
  const url = new URL(`${config.threads.apiHost}/refresh_access_token`);
  url.searchParams.set("grant_type", "th_refresh_token");
  url.searchParams.set("access_token", accessToken);
  return fetchJson(url.toString());
}

export async function exchangeShortLivedForLongLivedToken(config, accessToken) {
  requireAuthConfig(config);
  const url = new URL(`${config.threads.apiHost}/access_token`);
  url.searchParams.set("grant_type", "th_exchange_token");
  url.searchParams.set("client_secret", config.threads.appSecret);
  url.searchParams.set("access_token", accessToken);
  return fetchJson(url.toString());
}

export async function getProfile(config) {
  const token = getBearerToken(config);
  const url = new URL(`${config.threads.apiHost}/me`);
  url.searchParams.set("fields", "id,username,threads_profile_picture_url,threads_biography");
  url.searchParams.set("access_token", token);
  return fetchJson(url.toString());
}

export async function createMediaContainer(config, input) {
  const token = getBearerToken(config);
  const url = new URL(`${config.threads.apiHost}/me/threads`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("reply_control", input.replyControl ?? "everyone");

  if (input.replyToId) {
    url.searchParams.set("reply_to_id", input.replyToId);
  }

  if (input.quotePostId) {
    url.searchParams.set("quote_post_id", input.quotePostId);
  }

  if (input.media?.url) {
    url.searchParams.set("media_type", "IMAGE");
    url.searchParams.set("image_url", input.media.url);
    url.searchParams.set("alt_text", input.media.altText || "Referenced source image");
    if (input.text) {
      url.searchParams.set("text", input.text);
    }
  } else {
    url.searchParams.set("media_type", "TEXT");
    url.searchParams.set("text", input.text);
  }

  return fetchJson(url.toString(), {
    method: "POST",
  });
}

export async function publishContainer(config, containerId) {
  const token = getBearerToken(config);
  const url = new URL(`${config.threads.apiHost}/me/threads_publish`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("creation_id", containerId);
  return fetchJson(url.toString(), {
    method: "POST",
  });
}

export async function getContainerStatus(config, containerId) {
  const token = getBearerToken(config);
  const url = new URL(`${config.threads.apiHost}/${containerId}`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("fields", "id,status,error_message");
  return fetchJson(url.toString());
}

export async function getThreadDetails(config, threadId) {
  const token = getBearerToken(config);
  const url = new URL(`${config.threads.apiHost}/${threadId}`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("fields", "id,username,text,permalink,shortcode,timestamp,is_quote_post,is_reply,quoted_post,replied_to");
  return fetchJson(url.toString());
}

export async function listRecentThreads(config, limit = 10) {
  const token = getBearerToken(config);
  const url = new URL(`${config.threads.apiHost}/me/threads`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("fields", "id,permalink,username,text,timestamp,shortcode,media_type,has_replies");
  url.searchParams.set("limit", String(limit));
  return fetchJson(url.toString());
}

export async function deleteThread(config, threadId) {
  const token = getBearerToken(config);
  const url = new URL(`${config.threads.apiHost}/${threadId}`);
  url.searchParams.set("access_token", token);
  return fetchJson(url.toString(), {
    method: "DELETE",
  });
}

export function getTokenStatus(config) {
  const token = config.threads.longLivedAccessToken || config.threads.accessToken;
  return {
    hasToken: Boolean(token),
    usingLongLivedToken: Boolean(config.threads.longLivedAccessToken),
    scopes: config.threads.scopes,
  };
}

function getBearerToken(config) {
  const token = config.threads.longLivedAccessToken || config.threads.accessToken;
  if (!token) {
    throw new CliError("No Threads access token found. Run auth exchange first.");
  }
  return token;
}

function requireAuthConfig(config) {
  if (!config.threads.appId || !config.threads.appSecret || !config.threads.redirectUri) {
    throw new CliError("Missing THREADS_APP_ID, THREADS_APP_SECRET, or THREADS_REDIRECT_URI in .env.");
  }
}
