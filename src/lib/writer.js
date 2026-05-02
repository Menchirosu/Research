import { readText } from "./fs.js";

export async function buildDraftFromScan(config, scan, options = {}) {
  const style = readText(config.paths.styleFile);
  const themes = deriveThemes(scan.sources);
  const motifs = collectMotifs(scan.sources);
  const target = options.target ?? null;
  const postCount = decidePostCount(themes, motifs, options);
  const chosenMedia = options.disableMedia ? [] : selectDraftMedia(scan.mediaCandidates, themes, postCount);

  const posts = [];
  posts.push({
    text: applyVoiceGuard(buildPrimaryPost(scan, themes, motifs, target), options),
    media: chosenMedia[0] ? [toDraftMedia(chosenMedia[0])] : [],
  });

  if (postCount >= 2) {
    posts.push({
      text: applyVoiceGuard(buildFollowUpPost(themes, motifs, target), options),
      media: chosenMedia[1] ? [toDraftMedia(chosenMedia[1])] : [],
    });
  }

  if (postCount >= 3) {
    posts.push({
      text: applyVoiceGuard(buildThirdPost(themes, motifs, target), options),
      media: chosenMedia[2] ? [toDraftMedia(chosenMedia[2])] : [],
    });
  }

  return {
    topic: scan.topic,
    createdAt: new Date().toISOString(),
    styleNotes: style.trim(),
    voiceMode: postCount === 1 ? "single-post" : postCount === 2 ? "two-post-thread" : "thread",
    runMode: options.overnightMode ? "overnight" : "default",
    target,
    analysis: {
      themeKeys: themes.map((theme) => theme.key),
      themeCount: themes.length,
      motifFlags: Object.entries(motifs)
        .filter(([, value]) => value === true)
        .map(([key]) => key),
      originalStrength: assessOriginalStrength(themes, motifs, target),
    },
    posts,
    sources: scan.sources.slice(0, 8).map((source) => ({
      provider: source.provider,
      title: source.title,
      url: source.url,
    })),
    coverage: scan.coverage,
    sourceArtifact: scan,
  };
}

function buildPrimaryPost(scan, themes, motifs, target) {
  const subject = normalizeTopic(scan.topic);
  const reaction = buildReactionPost(target, themes, motifs);
  if (reaction) {
    return reaction;
  }

  if (motifs.deletedUsers || motifs.taxes) {
    const failures = [];
    if (motifs.deletedUsers) {
      failures.push("deletes the users");
    }
    if (motifs.taxes) {
      failures.push("does the taxes wrong");
    }
    if (motifs.tokenDrain || hasTheme(themes, "cost")) {
      failures.push("eats the token meter");
    }

    return `everyone wants full ai autonomy til it ${formatFailureList(failures)}. then suddenly everybody remembers tests lmao`;
  }

  if (motifs.claudeMd && motifs.remoteCodex) {
    return "claude.md shipping in real apps and remote codex on deck btw. nobody is rawdogging code anymore";
  }

  if (hasTheme(themes, "verification") && hasTheme(themes, "cost")) {
    return "nobody wants the smartest model rn. they want the one that stops lying, stops burning money, and maybe doesnt touch prod unsupervised";
  }

  if (hasTheme(themes, "plugins") && hasTheme(themes, "agents")) {
    return "every \"agent future\" post ends in the same place btw. plugin piles, tiny control hacks, and some poor soul building a leash for the model";
  }

  if (hasTheme(themes, "verification") && hasTheme(themes, "tooling")) {
    return "ai coding discourse is just ppl asking for autonomy til the model touches something expensive";
  }

  if (hasTheme(themes, "memory")) {
    return "claude.md was the tell. ppl do not trust raw chat memory anymore";
  }

  if (motifs.guiPraise && motifs.tokenDrain) {
    return "people will forgive a lot if the app looks nice and the token meter isnt actively trying to mug them";
  }

  if (motifs.securityBlocking) {
    return "everybody wants the model to be dangerous right up until it gets nerfed or starts improvising around security. very unserious species";
  }

  const topTheme = themes[0]?.key;
  switch (topTheme) {
    case "verification":
      return "the whole vibe shifted from \"best model\" to \"cool but how do i keep this thing from doing something stupid\"";
    case "cost":
      return "half the model discourse is just budget panic wearing a lab coat";
    case "agents":
      return "ppl keep asking for more agents when what they actually want is one agent with better manners";
    case "plugins":
      return "tiny little control hacks are beating giant ai manifestos again. bleak for the platform guys";
    case "tooling":
      return "im seeing too much tool worship today. nobody cares until it survives real work";
    default:
      return `the ${subject} chatter is getting weird again. less magic talk, more leash-building`;
  }
}

function buildFollowUpPost(themes, motifs, target) {
  if (target?.mode && target.mode !== "original") {
    return buildReactionFollowUp(target, themes, motifs);
  }

  if (motifs.claudeMd) {
    return "apple shipping claude.md by accident was the funniest confirmation btw";
  }

  if (motifs.pluginList || hasTheme(themes, "plugins")) {
    return "also the plugin guys kinda won. nobody wants agent theology they want tiny cheats that keep the thing from getting stupid";
  }

  if (motifs.remoteCodex && hasTheme(themes, "agents")) {
    return "remote runs sound cool til ur babysitting a wandering shell session at 2am";
  }

  if (hasTheme(themes, "verification") && hasTheme(themes, "cost")) {
    return "the question is not \"which model wins\" anymore. its \"which one needs the least supervision\"";
  }

  if (hasTheme(themes, "verification")) {
    return "every scary story eventually becomes a backup-and-checklists story. shocking";
  }

  if (hasTheme(themes, "cost")) {
    return "every token complaint is really a control complaint if we're being honest";
  }

  if (hasTheme(themes, "tooling")) {
    return "all this model tribalism and ppl still end up duct taping the same few habits on top";
  }

  return "same movie every time. ppl want magic til the cleanup bill arrives";
}

function buildThirdPost(themes, motifs, target) {
  if (target?.mode && target.mode !== "original") {
    return "same genre of cope every time btw";
  }

  if (motifs.securityBlocking) {
    return "and then the same ppl cry when the guardrails show up. lol";
  }

  if (hasTheme(themes, "agents")) {
    return "nobody wants autonomy. they want obedience with a little initiative";
  }

  return "the hype cycle is cooked anyway";
}

function assessOriginalStrength(themes, motifs, target) {
  if (target && target.mode !== "original") {
    return "targeted";
  }

  if (
    motifs.deletedUsers ||
    motifs.taxes ||
    motifs.claudeMd ||
    motifs.remoteCodex ||
    motifs.securityBlocking ||
    (motifs.guiPraise && motifs.tokenDrain)
  ) {
    return "strong";
  }

  if (
    (hasTheme(themes, "verification") && hasTheme(themes, "cost")) ||
    (hasTheme(themes, "plugins") && hasTheme(themes, "agents")) ||
    (hasTheme(themes, "verification") && hasTheme(themes, "tooling")) ||
    (hasTheme(themes, "verification") && hasTheme(themes, "agents"))
  ) {
    return "strong";
  }

  if (themes.length >= 3) {
    return "strong";
  }

  return "weak";
}

function toDraftMedia(candidate) {
  return {
    url: candidate.url,
    source: candidate.source,
    altText: `Reference visual from ${candidate.source}`,
  };
}

function selectDraftMedia(mediaCandidates, themes, postCount) {
  return mediaCandidates
    .filter((candidate) => !candidate.url.endsWith("favicon.ico"))
    .filter((candidate) => matchesTopTheme(candidate, themes))
    .slice(0, Math.min(postCount, 1));
}

function decidePostCount(themes, motifs, options) {
  if (options.forceSinglePost || options.overnightMode) {
    return 1;
  }

  if (options.target?.mode && !options.forceThread) {
    return 1;
  }

  if (options.forceThread === "long") {
    return 3;
  }

  if (options.forceThread) {
    return 2;
  }

  if (
    motifs.deletedUsers ||
    motifs.taxes ||
    motifs.claudeMd ||
    motifs.remoteCodex ||
    (hasTheme(themes, "verification") && hasTheme(themes, "cost")) ||
    (hasTheme(themes, "plugins") && hasTheme(themes, "agents")) ||
    (hasTheme(themes, "verification") && hasTheme(themes, "tooling"))
  ) {
    return 2;
  }

  return 1;
}

function deriveThemes(sources) {
  const themeDefinitions = [
    {
      key: "memory",
      label: "memory layers",
      pattern: /\bmemory\b|\bobsidian\b|\bre-explain|\bcontext\b/i,
    },
    {
      key: "verification",
      label: "verification loops",
      pattern: /\bbenchmark\b|\btesting\b|\bvalidate\b|\bvalidation\b|\bguardrail\b|\bsecurity\b|\bdeterministic\b|\bpair of eyes\b/i,
    },
    {
      key: "cost",
      label: "token cost pressure",
      pattern: /\btoken(s)?\b|\bcost\b|\bbudget\b|\bpricing\b|\bwaste of money\b|\bdraining\b/i,
    },
    {
      key: "agents",
      label: "agent orchestration",
      pattern: /\bagent(s)?\b|\bswarm\b|\borchestrat|\bautonomous\b|\bworkflow(s)?\b/i,
    },
    {
      key: "plugins",
      label: "small extensions",
      pattern: /\bplugin(s)?\b|\bskill(s)?\b|\badd-on\b|\baddon\b|\bextension(s)?\b/i,
    },
    {
      key: "tooling",
      label: "tooling drama",
      pattern: /\bcodex\b|\bclaude code\b|\bclaude\b|\bgpt-5\.5\b|\bremote codex\b|\bgui\b|\bworkflow\b/i,
    },
  ];

  const counts = themeDefinitions.map((theme) => ({
    ...theme,
    score: 0,
  }));

  for (const source of sources) {
    const blob = `${source.title} ${source.commentSummary ?? ""}`;
    for (const theme of counts) {
      if (theme.pattern.test(blob)) {
        theme.score += source.signalScore ?? source.score;
        theme.matches = [...(theme.matches ?? []), source];
      }
    }
  }

  return counts
    .filter((theme) => theme.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((theme) => ({
      ...theme,
      matches: dedupeThemeMatches(theme.matches ?? []).slice(0, 3),
    }));
}

function collectMotifs(sources) {
  const blob = sources
    .map((source) => `${source.title} ${source.commentSummary ?? ""}`)
    .join(" ")
    .toLowerCase();

  return {
    deletedUsers: /\bdeleted all my users\b|\bdelete(?:d)? the users\b/.test(blob),
    taxes: /\bdo my taxes\b|\btaxes for me\b|\btransferred way too much\b/.test(blob),
    claudeMd: /\bclaude\.?md\b/.test(blob),
    tokenDrain: /\btokens are draining\b|\btoken(s)?\b.*\bdrain|\bwaste of money\b|\bapi is such an insane waste of money\b/.test(blob),
    pluginList: /\bplugin list\b|\btop 10 .* plugin\b/.test(blob),
    remoteCodex: /\bremote codex\b/.test(blob),
    securityBlocking: /\bblocking anything\b|\bsecurity institute\b|\bsecurity public beta\b|\bexploit-related\b/.test(blob),
    guiPraise: /\bgui\b|\bapp gui\b/.test(blob),
  };
}

function matchesTopTheme(candidate, themes) {
  if (themes.length === 0) {
    return true;
  }

  const topThemeKeys = new Set(themes.slice(0, 2).map((theme) => theme.key));
  return (candidate.signalTags ?? []).some((tag) => topThemeKeys.has(tag));
}

function normalizeTopic(topic) {
  return topic.replace(/\bright now\b/gi, "").replace(/\bhot\b/gi, "").replace(/\s+/g, " ").trim();
}

function buildReactionPost(target, themes, motifs) {
  if (!target || target.mode === "original") {
    return null;
  }

  const blob = `${target.text ?? ""} ${target.author ?? ""}`.toLowerCase();
  const directPrefix = target.mode === "reply" ? "ur " : "";

  if (/\bclaude\.?md\b|\bmemory\b|\bcontext\b/.test(blob)) {
    return target.mode === "reply"
      ? "claude.md was the tell btw"
      : "claude.md getting normalized is the funniest proof that nobody trusts raw chat memory anymore";
  }

  if (/\bautonom|\bagent(s)?\b|\bremote\b/.test(blob)) {
    return `${directPrefix}${target.mode === "reply" ? "saying autonomy like nobody is gonna be in the logs crying 3 hours later" : "every autonomy post is really just somebody asking for a cleaner babysitting job"}`;
  }

  if (/\bbest model\b|\bsmarter\b|\bwins\b|\bbetter than\b|\bmodel\b/.test(blob) && hasTheme(themes, "verification")) {
    return `${directPrefix}${target.mode === "reply" ? "still dodging the supervision part" : "model rankings are catnip for ppl who do not want to talk about supervision"}`;
  }

  if (/\bplugin(s)?\b|\bskill(s)?\b|\bextension(s)?\b/.test(blob) || motifs.pluginList) {
    return target.mode === "reply"
      ? "tiny hacks beat giant ai sermons every single time"
      : "the plugin guys keep being right and its making the grand vision people miserable";
  }

  if (/\bsecurity\b|\bguardrail\b|\bsafe\b|\bexploit\b/.test(blob) || motifs.securityBlocking) {
    return target.mode === "reply"
      ? "everybody loves dangerous models til liability starts breathing on them"
      : "everybody wants the dangerous version right up until somebody mentions guardrails";
  }

  if (/\btoken(s)?\b|\bcost\b|\bpricing\b|\bbudget\b|\bwaste of money\b/.test(blob)) {
    return `${directPrefix}${target.mode === "reply" ? "basically describing a control problem with extra billing" : "every cost take is secretly a control take now"}`;
  }

  if (/\bship\b|\bprod\b|\bvibe\b|\bworkflow\b/.test(blob) || hasTheme(themes, "verification")) {
    return target.mode === "reply"
      ? "ur describing why ppl keep rediscovering checklists the hard way"
      : "half of ai shipping discourse is just ppl trying to skip the supervision part and acting shocked when the cleanup bill lands";
  }

  if (motifs.claudeMd) {
    return "claude.md becoming normal is still the funniest part of this whole thing";
  }

  if (motifs.tokenDrain || hasTheme(themes, "cost")) {
    return "every cost take is secretly a control take now";
  }

  return target.mode === "reply"
    ? "ur kinda proving the point tbh"
    : "this whole genre of post is just ppl wanting magic without the cleanup";
}

function buildReactionFollowUp(target, themes, motifs) {
  const blob = `${target.text ?? ""} ${target.author ?? ""}`.toLowerCase();

  if (/\bclaude\.?md\b/.test(blob)) {
    return "apple accidentally shipping the file was the most honest moment in this whole cycle";
  }

  if (/\bplugin(s)?\b|\bskill(s)?\b/.test(blob)) {
    return "nobody wants ideology they want a tiny thing that stops the model from getting weird";
  }

  if (/\btoken(s)?\b|\bcost\b|\bpricing\b/.test(blob)) {
    return "the meter only hurts this much when the workflow still sucks";
  }

  if (motifs.claudeMd) {
    return "apple accidentally shipping the file was the most honest moment in this whole cycle";
  }

  if (motifs.pluginList) {
    return "nobody wants ideology they want a tiny thing that stops the model from getting weird";
  }

  if (motifs.tokenDrain) {
    return "the meter only hurts this much when the workflow still sucks";
  }

  if (hasTheme(themes, "verification")) {
    return "the ppl actually shipping all end up back at tests and guardrails anyway";
  }

  return "same movie every time btw";
}

function hasTheme(themes, key) {
  return themes.some((theme) => theme.key === key);
}

function formatFailureList(values) {
  if (values.length === 0) {
    return "goes off the rails";
  }

  if (values.length === 1) {
    return values[0];
  }

  if (values.length === 2) {
    return `${values[0]} or ${values[1]}`;
  }

  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function dedupeThemeMatches(matches) {
  const seen = new Set();
  return matches.filter((match) => {
    if (seen.has(match.url)) {
      return false;
    }

    seen.add(match.url);
    return true;
  });
}

function applyVoiceGuard(text, options) {
  if (!options.overnightMode || !text) {
    return text;
  }

  return text
    .replace(/\bmiserable\b/gi, "look silly")
    .replace(/\brawdogging\b/gi, "winging")
    .replace(/\bcrying 3 hours later\b/gi, "staring at logs 3 hours later")
    .replace(/\bvery unserious species\b/gi, "kind of unserious species")
    .replace(/\bidiot(s)?\b/gi, "chaos goblin$1");
}
