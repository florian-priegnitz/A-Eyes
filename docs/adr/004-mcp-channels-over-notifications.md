# ADR-004: MCP Channels over Standard Notifications for Push

## Status
Accepted (2026-04-22)

## Context
The Ambient Awareness roadmap (#27 lsp-tap, #28 sec-tap, #29 mcp-unity upstream PR) depends on a server-initiated push channel so MCP servers can deliver events to Claude Code without the agent polling. Issue #25 was opened to validate which MCP push mechanism Claude Code actually consumes before committing implementation work.

Two candidate mechanisms were tested end-to-end:

1. **Standard MCP notifications** — `notifications/message` (logging) and `notifications/resources/updated` (resource change). Part of the MCP base spec; any SDK supports them.
2. **Claude channels** — `notifications/claude/channel` under the `experimental: { "claude/channel": {} }` server capability. Claude-specific extension requiring the client flag `--dangerously-load-development-channels server:<name>`.

Test harnesses: `scripts/push-test-server.mjs` emits both standard notifications every 5s; `scripts/channel-test-server.mjs` emits channel notifications every 10s plus on a tool invocation. Both registered via `claude mcp add`.

## Decision
Ambient Awareness servers (#27/#28/#29) will deliver events as **`notifications/claude/channel`**, not as standard MCP notifications.

## Findings
- **Claude Code v2.1.58**: neither `notifications/message` nor `notifications/resources/updated` surface to the model. The notifications are delivered on the wire but the client drops them silently. An agent turn has to be initiated by the user before any MCP output reaches the model, so standard notifications cannot be the basis for ambient push.
- **Claude Code v2.1.80+**: `notifications/claude/channel` is delivered to the model mid-turn as a `<channel source="…">` message, provided the channel is explicitly loaded with `--dangerously-load-development-channels`. The model acknowledges and reacts within the same or next turn.

## Rationale
- **Channels are the only mechanism Claude Code actually consumes** at the time of writing. Building on standard notifications would work against any spec-conformant MCP client *except* Claude Code — which is the target client.
- The `experimental` capability gate is acceptable because the Ambient Awareness roadmap is explicitly Claude-Code-targeted (lsp-tap and sec-tap ship inside the a-eyes ecosystem, not as generic MCP servers).
- Standard notifications may still be emitted in parallel for non-Claude MCP clients later, but cannot be the primary transport.

## Consequences
- **Minimum client version**: 2.1.80. Any consumer project using #27/#28/#29 must bump its `claude` CLI. Documented in each feature's README.
- **Activation flag required**: users must opt in via `--dangerously-load-development-channels server:<name>`. This becomes part of the install/setup instructions (setup tool will surface it for the relevant servers).
- **Experimental capability**: if Anthropic renames or removes `notifications/claude/channel`, all three downstream features break. Accepted risk — no viable alternative today. A version-probe in `check_status` should surface incompatibility early.
- **Test scripts stay in-repo** (`scripts/push-test-server.mjs`, `scripts/channel-test-server.mjs`) so that the experiment is reproducible when the client evolves.
- **Issue #25 can be closed** with this ADR as closure reference.

## Alternatives Considered
- **Polling from Claude**: agent-initiated tool calls on a schedule. Rejected — defeats the "ambient" requirement, wastes tokens on idle checks, and cannot deliver low-latency signals (e.g. LSP diagnostic changes).
- **Out-of-band webhooks (ntfy etc.)**: considered for coarse-grained alerts. Keeps its place for cross-device phone notifications, but cannot inject context into the running turn. Not a replacement for channels.
- **Wait for MCP spec to add push**: the spec has no roadmap for push as of 2026-04. Blocking on it would indefinitely park #27/#28/#29.

## References
- Issue #25 — validation
- Issue #27 — lsp-tap
- Issue #28 — sec-tap
- Issue #29 — mcp-unity upstream contribution
- `scripts/push-test-server.mjs` — standard-notification test harness (negative result)
- `scripts/channel-test-server.mjs` — channel test harness (positive result)
