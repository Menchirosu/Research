import crypto from "node:crypto";
import path from "node:path";
import { cacheMedia } from "./media.js";
import { loadJsonIfExists, writeJson } from "./fs.js";
import { createMediaContainer, deleteThread, getContainerStatus, getProfile, listRecentThreads, publishContainer } from "./threads-api.js";

export async function publishDraft(config, draft) {
  const profile = await getProfile(config);
  const session = loadOrCreateSession(config, draft, profile);
  const publishedPosts = [...session.publishedPosts];

  for (let index = publishedPosts.length; index < draft.posts.length; index += 1) {
    const post = draft.posts[index];
    const media = post.media?.[0] ?? null;
    if (media?.url) {
      try {
        await cacheMedia(config, {
          url: media.url,
          source: media.source,
          rank: 1,
        });
      } catch {
        // Cache failure should not block publish if the public URL is still usable.
      }
    }

    const container = await createMediaContainer(config, {
      text: post.text,
      media,
      replyToId: resolveReplyTargetId(draft, publishedPosts, index),
      quotePostId: resolveQuoteTargetId(draft, index),
      replyControl: config.threads.replyControl,
    });

    await waitForContainerReady(config, container.id);
    const published = await publishWithRetry(config, container.id);
    publishedPosts.push({
      id: published.id,
      containerId: container.id,
      text: post.text,
      media,
    });
    saveSession(config, {
      ...session,
      updatedAt: new Date().toISOString(),
      publishedPosts,
    });
  }

  const enrichedPosts = await hydratePublishedPosts(config, publishedPosts);
  const completedSession = {
    ...session,
    publishedPosts: enrichedPosts,
    updatedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };
  saveSession(config, completedSession);

  return {
    topic: draft.topic,
    profile,
    publishedAt: new Date().toISOString(),
    draft,
    publishedPosts: enrichedPosts,
    publishSessionPath: session.filePath,
  };
}

export async function deletePublishedThread(config, threadId) {
  return deleteThread(config, threadId);
}

async function waitForContainerReady(config, containerId) {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      const status = await getContainerStatus(config, containerId);
      if (status.status === "FINISHED" || status.status === "PUBLISHED") {
        return status;
      }

      if (status.status === "ERROR" || status.status === "EXPIRED") {
        throw new Error(status.error_message || `Container ${containerId} is ${status.status}.`);
      }
    } catch (error) {
      if (!looksLikeContainerLag(error)) {
        throw error;
      }
    }

    await sleep(attempt < 5 ? 750 : 1500);
  }
}

async function publishWithRetry(config, containerId) {
  let lastError = null;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await publishContainer(config, containerId);
    } catch (error) {
      lastError = error;
      if (!looksLikeContainerLag(error) || attempt === 3) {
        throw error;
      }

      await sleep(1500 * (attempt + 1));
    }
  }

  throw lastError;
}

function looksLikeContainerLag(error) {
  const message = String(error?.message ?? error);
  return message.includes("requested resource does not exist") || message.includes("Hindi mahanap ang media");
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function hydratePublishedPosts(config, publishedPosts) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const recent = await listRecentThreads(config, Math.max(10, publishedPosts.length * 6));
    const byId = new Map((recent.data ?? []).map((item) => [String(item.id), item]));
    const enriched = publishedPosts.map((post) => {
      const details = byId.get(String(post.id));
      return {
        ...post,
        permalink: details?.permalink ?? null,
        shortcode: details?.shortcode ?? null,
        timestamp: details?.timestamp ?? null,
      };
    });

    if (enriched.every((post) => post.permalink || post.shortcode)) {
      return enriched;
    }

    await sleep(1000 * (attempt + 1));
  }

  return publishedPosts;
}

function loadOrCreateSession(config, draft, profile) {
  const draftHash = crypto.createHash("sha256").update(JSON.stringify(draft)).digest("hex");
  const filePath = path.join(config.paths.publishSessionsDir, `publish-${draftHash}.json`);
  const existing = loadJsonIfExists(filePath);

  if (existing && !existing.completedAt) {
    return existing;
  }

  return {
    filePath,
    draftHash,
    topic: draft.topic,
    profile,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    publishedPosts: [],
  };
}

function saveSession(config, session) {
  writeJson(session.filePath, session);
  return session;
}

function resolveReplyTargetId(draft, publishedPosts, index) {
  if (index > 0) {
    return publishedPosts.at(-1)?.id;
  }

  if (draft.target?.mode === "reply") {
    return draft.target.postId;
  }

  return null;
}

function resolveQuoteTargetId(draft, index) {
  if (index > 0) {
    return null;
  }

  return draft.target?.mode === "quote" ? draft.target.postId : null;
}
