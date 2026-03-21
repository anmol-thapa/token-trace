# TokenTrace Findings

## How the Proxy Works

TokenTrace runs a local HTTP proxy on `localhost:3001`. AI coding tools are configured to send their API calls through this proxy instead of directly to Anthropic/OpenAI. The proxy forwards requests transparently, buffers the response, extracts token usage from the SSE stream, and logs it — without adding any latency.

## Claude Code

- Configured via `ANTHROPIC_BASE_URL` in `~/.claude/settings.json`
- Uses the Messages API (`/v1/messages`) with SSE streaming
- Token usage is in the `message_start` event (input) and `message_delta` event (output)
- Responses were compressed (gzip) by default — had to strip `Accept-Encoding` from upstream headers so the proxy can read the raw SSE text

## OpenAI Codex CLI

- Configured via `openai_base_url` at the top level of `~/.codex/config.toml` (must be before any `[section]` headers or TOML puts it in the wrong section)
- Also set `OPENAI_BASE_URL` in `[shell_environment_policy.set]` as a fallback
- Uses the **Responses API** (`/v1/responses`), not Chat Completions
  - The Responses API does **not** support `stream_options.include_usage` — that's Chat Completions only. Injecting it causes a 400 error.
  - Token usage comes natively in the `response.completed` SSE event under `response.usage.input_tokens` / `output_tokens`
- Requires an OpenAI API key with the `api.responses.write` scope explicitly enabled (keys created before this scope existed will get 401)
- Codex CLI sends `GET /responses` for polling and `POST /responses` for new completions

## The Hidden Token Cost of AI Agents

When a Codex session with only 4 short messages ("hi") shows **12k input tokens per request**, the conversation itself is ~50 tokens. The remaining ~11,950 tokens are:

- A large system prompt describing agent behavior and rules
- Full JSON schemas for every tool (bash, file read/write, search, grep, etc.)
- Shell environment state, memory files, and loaded rules

This overhead is sent on **every single API call**, regardless of how short the user's message is. The API is stateless — there is no persistent context on the server side.

This is the core value proposition of TokenTrace: it makes this invisible waste visible. Users assume they're paying for their prompts. In reality, the agent framework itself dominates token consumption from the first message.

## The Stateless API Problem

All major AI APIs (Anthropic Messages, OpenAI Chat Completions, OpenAI Responses) are stateless. Every request must include the full conversation history. As a session grows:

- Turn 1: system prompt + tools + 1 message
- Turn 10: system prompt + tools + 10 messages
- Turn 50: system prompt + tools + 50 messages (approaching context limit)

Each turn re-sends everything before it. Long agentic sessions compound this dramatically — a 100-turn session sends roughly 50x more total tokens than a 2-turn session with the same content per message.

Some mitigation strategies exist (prompt caching, context summarization, message pruning) but most tools don't use them aggressively.

## What Doesn't Work

- **Claude macOS desktop app**: Connects to `claude.ai` (web service) via OAuth, not the Anthropic API. `ANTHROPIC_BASE_URL` has no effect. Cannot be intercepted without a full MITM HTTPS proxy.
- **Codex with ChatGPT subscription auth**: When Codex is logged in via `codex auth` (OAuth/ChatGPT Pro subscription), the OAuth token doesn't carry `api.responses.write` scope. Setting a custom base URL forces it into API key mode which then fails with 401. Only works with a standard OpenAI API key that has the right scopes.

## Proxy Implementation Notes

- Strip `Accept-Encoding` from upstream requests to prevent compressed responses
- Prepend `/v1` to paths that omit it (Codex sends `/responses`, API expects `/v1/responses`)
- Only inject `stream_options: { include_usage: true }` for Chat Completions, not Responses API
- Provider detection: path-based first (`/messages` → Anthropic, `/chat/completions` or `/responses` → OpenAI), then API key prefix (`sk-ant-` → Anthropic, `sk-` → OpenAI)
