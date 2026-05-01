---
name: ai-builder-trend-scout
description: Scan current builder communities for hot skills, agents, models, MCP patterns, and workflows across Reddit, Hacker News, GitHub, and other public threads, using both posts and comments to surface what is actually useful for future projects.
disable-model-invocation: true
---

# AI Builder Trend Scout

Use this skill when the user asks what is hot, worth learning, worth copying, or worth integrating into future projects. This includes:

- agent frameworks
- MCP servers and connector patterns
- skills and reusable workflows
- AI coding tools
- model choices and routing strategies
- repo instruction systems like `AGENTS.md`, `CLAUDE.md`, rules, hooks, and prompts
- emerging product opportunities from builder communities

The point is not to summarize hype. The point is to identify what serious builders are repeatedly finding useful right now.

## Core Rule

Do not answer from memory alone when the user asks what is hot, trending, latest, or current. Use live web access and inspect **both posts and comments** when the source supports discussion. Titles are not enough.

## Default Sources

Start with builder-heavy public communities, especially:

- `r/codex`
- `r/ClaudeCode`
- `r/vibecoding`
- `r/AskVibecoders`

Then expand to other public builder-heavy discussion sources when the question is broad or when Reddit alone looks noisy:

- Hacker News threads and comments
- GitHub Discussions and high-signal Issues in relevant repos like `openai/codex`, `anthropics/claude-code`, `modelcontextprotocol`, and popular workflow/orchestration repos
- official docs or release notes only to verify claims that builders are reacting to
- selective public forums, blogs, or community posts with visible discussion when they add signal

Do not stop at one platform if the user asked for what is hot "right now" in general.

## Research Workflow

### 1. Lock the Question

Figure out which of these the user wants:

- hot skills
- hot agents
- hot AI models
- hot MCPs
- hot workflows
- project ideas created by current trends

If the user is broad, cover all of them but keep the answer ranked.

### 2. Collect Live Posts

For each chosen community or source:

- inspect `hot`
- inspect `rising` when available
- inspect `new` for fresh experiments
- optionally inspect `top` for confirmation if the current feed is noisy
- on non-Reddit sources, use the closest equivalent such as recent discussions, recent issues, show-and-tell posts, or newest comment-active threads

Capture only the posts that contain signal:

- repeated complaints
- repeated wins
- concrete tool stacks
- screenshots of working setups
- detailed how-to posts
- sharp critiques with specific failure modes

Ignore low-signal meme posts unless they expose a recurring pain point.

### 3. Read Comments

For each strong candidate post or thread:

- open the thread
- inspect top comments and the main back-and-forth
- extract what commenters confirm, dispute, or add
- note named tools, models, MCP servers, repos, scripts, prompts, and workarounds

Never treat a title as community consensus without comment evidence when comments exist. If a source has no comments, treat it as supporting evidence only, not primary proof of a trend.

### 4. Extract Trends

Cluster what you find into:

- tools people are adopting
- tools people are abandoning
- workflow patterns that reduce cost or friction
- repo setup patterns that improve agent output
- MCP patterns that are becoming normal
- model-routing patterns
- gaps that suggest a project opportunity

A trend is strong when it appears in more than one post, more than one community, or both the post and comments. Cross-platform repetition is stronger than repetition inside one subreddit.

### 5. Weight Sources

When ranking signals, weight sources roughly like this:

- highest: repeated discussion-backed signal across multiple communities
- medium: one strong thread with detailed comments plus confirmation elsewhere
- lower: single-source show-and-tell, self-promo, or vendor post without independent discussion

If a vendor claim is getting repeated by builders, separate the vendor announcement from the builder reaction.

## Output Format

Return findings in this order:

1. `Coverage`
List the sites, subreddits, feed types, and whether comments were scanned. Include the exact collection date.

2. `Hot Now`
Rank the strongest current patterns. For each one, explain why it matters in one or two sentences.

3. `Comment Reality`
State what the comment threads actually say. Separate validation from backlash, hype, sarcasm, and self-promo.

4. `What To Use`
Recommend the skills, agents, workflows, models, or MCP approaches the user should actually consider.

5. `Project Angles`
Turn the strongest signals into concrete things the user could build in future projects.

6. `Watchlist`
List weaker but promising signals that need another scan later.

7. `Sources`
Include direct links.

8. `Skill Update Ideas`
If the scan reveals a repeatable workflow or source gap worth encoding into this skill or a neighboring skill, mention it briefly.

## Decision Rules

- Prefer repeated signal over one loud viral post.
- Prefer repeated signal across platforms over repeated signal inside one community.
- Prefer comments over headlines when they disagree.
- Prefer current usefulness over novelty.
- Mark uncertainty clearly when evidence is thin.
- Use exact dates when recency matters.
- If access is partial, state what was not scanned.
- Treat self-promo, launch posts, and SEO-style blog posts as weak evidence until comments or independent threads validate them.

## Example Prompts

- `Scan Reddit and tell me what MCPs are hot for AI coding right now.`
- `Scan Reddit, Hacker News, and GitHub threads and tell me what MCPs are hot for AI coding right now.`
- `What agents and workflows look genuinely useful for my next project?`
- `What skills should I copy from current Codex and Claude Code communities?`
- `Find current model-routing patterns people are using to cut cost without losing output quality.`

## Anti-Patterns

Do not:

- summarize only feed titles
- stay trapped inside one site when the user asked for broader internet signal
- confuse self-promo with product-market proof
- pretend older posts are current trends
- overgeneralize from a single thread
- skip comments when the user asked for deeper scanning
