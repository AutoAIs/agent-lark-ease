# Agent Ease for Lark

Give your agent a new reach — Feishu / Lark.

`agent-lark-ease` is the reference name for the package, CLI, state directory,
and service labels. It is a lightweight bot that bridges Feishu / Lark messenger
with your local Claude Code or Codex CLI. Run one command, scan a QR code to bind
a PersonalAgent app, and talk to your local coding agent from chat.

[中文 README](./README.zh.md)

For a product walkthrough, see the [Feishu document](https://larkcommunity.feishu.cn/docx/OaRIdFIRFoLM3xxTmKwcetHqn5e).

> **Project status:** Agent Ease for Lark (`agent-lark-ease`) began as a fork of
> [`lark-channel-bridge`](https://github.com/zarazhangrui/feishu-claude-code-bridge)
> and is now developed independently; see
> [Upgrading from `lark-channel-bridge`](#upgrading-from-lark-channel-bridge).

## What it does

- Forwards Feishu / Lark messages to local Claude Code or Codex CLI. Send a DM directly, or `@bot` in a group.
- **Streaming card**: text replies and tool calls update on one Lark card in real time. The default `interactive card` mode also shows tool panels, a stop button, and run status; `streaming markdown` and `plain text` are available in `/config`.
- **Resilient delivery**: final answers too large for one card are split across multiple cards, and card failures fall back to text. Long markdown streams pause before Feishu's ~10-minute streaming-card cutoff and deliver the final answer as a separate message.
- **COT process messages**: optionally send a process message with agent progress text and tool calls, then send the final answer separately.
- **Session continuity**: each chat, topic, or document comment thread keeps its own session.
- **Queueing and batching**: messages sent in quick succession are handled together; messages sent during a run are queued for the next turn, while commands like `/new`, `/cd`, `/ws use`, and `/stop` can interrupt the current task.
- **Multiple workspaces**: use `/cd` to switch the current project, and `/ws` to save and reuse common project directories.
- **Images and files**: send them to the bot directly, and the bridge downloads them locally for the agent.
- **Interactive cards**: `/help`, `/ws list`, and `/status` return cards with clickable buttons.

## Prerequisites

- Node.js **>= 24.0.0**
- At least one local agent installed and logged in:
  - Claude Code: `claude`, see https://docs.anthropic.com/en/docs/claude-code/quickstart
  - Codex CLI: `codex`, see https://developers.openai.com/codex/cli
- A Feishu / Lark **PersonalAgent** app. The first-run QR wizard can create and bind one for you.

## Install

```bash
npm i -g @autoais/agent-lark-ease
# or
pnpm add -g @autoais/agent-lark-ease
```

### Upgrading from `lark-channel-bridge`

Agent Ease for Lark (`agent-lark-ease`) is an independent fork of
`lark-channel-bridge`. If you previously installed the old package, stop and
unregister its daemon before installing the new one:

```bash
lark-channel-bridge stop
lark-channel-bridge unregister
npm i -g @autoais/agent-lark-ease
```

The first `agent-lark-ease` command then migrates local state automatically:

- `~/.lark-channel` is renamed to `~/.agent-lark-ease`, and
  `~/.lark-channel-workspaces` to `~/.agent-lark-ease-workspaces`.
- Absolute paths that still point into the old state root (in `config.json`
  and `workspaces.json`) are rewritten on load and persisted on the next save.
- `LARK_CHANNEL_*` environment variables remain accepted as fallbacks for
  `LARK_EASE_*`.
- Startup refuses to run while a live pre-rename bridge is still registered
  under the old state root, so the two processes cannot fight over one Feishu
  app. Set `LARK_EASE_ALLOW_LEGACY_BRIDGE=1` to override.
- Background service labels changed with the name. Reinstall the service with
  `agent-lark-ease start` (per profile) or `agent-lark-ease start --web-ui`
  (supervisor + local console).

## First run

```bash
agent-lark-ease run
```

The first run opens a QR-code wizard:

1. A QR code renders in your terminal.
2. Scan it with the Feishu / Lark app.
3. Pick or create a PersonalAgent app.
4. If prompted, choose which agent to initialize.
5. Config is written to `~/.agent-lark-ease/config.json`.

You do not need to choose a project directory up front. The bridge creates a profile-managed default working directory; after startup, send `/cd <path>` in Feishu / Lark to switch to a real project.

If you already have a PersonalAgent app, pass `--app-id` during initialization to skip app creation. The command prompts for the App Secret.

```bash
agent-lark-ease run --app-id cli_xxx
# or initialize and start the background service directly
agent-lark-ease start --app-id cli_xxx
```

For Lark global apps, add `--tenant lark`.

## Background service

Use `run` for first-run setup and foreground debugging. After the bot can send and receive messages, stop the foreground process with `Ctrl-C`, then use an OS-managed service for background operation:

```bash
agent-lark-ease start
agent-lark-ease status
agent-lark-ease stop
```

Install globally before using service commands. The daemon's launchd plist / systemd unit / Windows task records the bridge CLI path; if that path comes from an npm temp cache through `npx`, the daemon can break when the cache is cleaned. `run` is fine through `npx` as a one-shot foreground process.

Service commands install a per-profile service:

```bash
agent-lark-ease start [--profile <name>]
agent-lark-ease stop [--profile <name>]
agent-lark-ease restart [--profile <name>]
agent-lark-ease status [--profile <name>]
agent-lark-ease unregister [--profile <name>]
```

Platform mapping:
- **macOS**: launchd user agent `ai.agent-lark-ease.bot.<profile>`
- **Linux**: systemd user unit `agent-lark-ease.bot.<profile>.service`
- **Windows**: Task Scheduler task `AgentLarkEase.Bot.<profile>`, launched through a `.cmd` wrapper

Daemon logs are under `~/.agent-lark-ease/profiles/<profile>/logs/daemon/`.

### Multiple profiles: Claude and Codex

By default, the bridge starts with the currently selected profile. Use `profile use <name>` to change it. Each profile keeps its own app credentials, sessions, working directories, and logs. Create multiple profiles only when you need to connect multiple PersonalAgent apps, or run Claude and Codex as separate bots:

```bash
agent-lark-ease start --profile claude --agent claude
agent-lark-ease start --profile codex --agent codex
```

For example, to restart only the Codex bot:

```bash
agent-lark-ease restart --profile codex
agent-lark-ease status --profile codex
```

## Commands

### Host CLI

```text
agent-lark-ease run [--profile <name>] [--agent claude|codex] [--workspace <path>] [-c <config>]
agent-lark-ease migrate [--profile <name>] [--agent claude|codex]
agent-lark-ease ps
agent-lark-ease kill <id|#>
agent-lark-ease --help
```

`profile use <name>` changes the profile used by later default starts. Use these profile management commands when running separate Claude / Codex bots, connecting multiple PersonalAgent apps, or doing scripted deployment:

```bash
agent-lark-ease profile create claude --agent claude
agent-lark-ease profile create codex --agent codex
agent-lark-ease profile list
agent-lark-ease profile use <name>
agent-lark-ease profile remove <name>
agent-lark-ease profile remove <name> --purge --yes
agent-lark-ease profile export <name> [--output ./profile.json] [--force]
agent-lark-ease profile export <name> --include-secrets --yes
```

`profile remove` archives local state by default, including the active profile. If other profiles remain, the bridge switches to the next one; if it was the last profile, the root config is cleared so the same name can be created again. `--purge --yes` permanently deletes local state. `profile export` redacts app secrets by default; `--include-secrets --yes` includes sensitive config.

If a profile was created with the wrong agent kind, stop or unregister any matching background service first, then run `profile remove <name>` and recreate it with the intended `--agent`.

### Slash commands inside Feishu / Lark

| Command | Effect |
|---|---|
| `/new`, `/reset` | Clear the current session |
| `/cd <path>` | Switch working directory and reset the session |
| `/ws list` | List named workspaces |
| `/ws save <name>` | Save the current working directory as a named workspace |
| `/ws use <name>` | Switch to a named workspace |
| `/ws remove <name>` | Delete a named workspace |
| `/resume` | Resume compatible history for the same agent, working directory, and permission mode |
| `/status` | Show profile, agent, working directory, session, lark-cli identity, and run state |
| `/config` | Adjust presentation preferences, access settings, and lark-cli identity policy |
| `/invite user @name` | Allow a user to use the bot in DMs |
| `/invite admin @name` | Add an access-control admin |
| `/invite group` | Allow the current group to use the bot |
| `/invite all group` | Allow all groups the bot has joined |
| `/remove user @name`, `/remove admin @name`, `/remove group` | Remove access entries |
| `/stop` | Stop the current run, including the card stop button |
| `/timeout [N\|off\|default]` | Set or clear the current session idle watchdog |
| `/ps` | List local bridge processes |
| `/exit <id\|#>` | Stop a bridge process |
| `/reconnect` | Force a WebSocket reconnect |
| `/doctor [description]` | Run low-sensitive diagnostics |
| `/help` | Help card |

DMs do not require an @ mention. Groups and topic groups require `@bot` by default; `@all` is ignored. Cloud-doc comments in supported document types run when the bot is mentioned.

## Reply Display and COT

`/config` controls three presentation settings:

- **Message reply mode**:
  - `interactive card` (default): streams progress and the final answer on one structured card with tool panels, a stop button, and footer status. Best for long tasks.
  - `streaming markdown`: a lightweight streaming markdown card with Feishu's native typewriter effect and no buttons.
  - `plain text`: sends the finished answer once as a plain markdown post.
  New profiles default to `interactive card`. Profiles with no saved reply mode also resolve to `interactive card`; pre-0.1.27 `text` values are treated as `interactive card` until the profile is saved through `/config`.
- **Tool-call display**: controls whether tool blocks appear in the final card / markdown reply.
- **COT process message**: `off` sends only the final reply; `brief` first sends a COT message with agent progress text and tool summaries; `detailed` also includes tool args and truncated output.

When COT is enabled, the bridge splits the process view and final answer into two messages. The COT message is for tracing what the agent did; the final answer is still generated from the agent's raw text, without heuristic bridge-side filtering. If an agent emits final-answer text as ordinary stream text, that text can also appear in the COT process message.

### Card delivery and long runs

Card rendering is hardened against Feishu's size and lifetime limits:

- Progress cards stay within 50K characters, 65K bytes, and 46 top-level elements. When a card would exceed the budget, the earliest progress elements are omitted and replaced with a short notice.
- Long markdown is split at newline boundaries, with code fences closed at the end of a piece and reopened at the start of the next. Each card keeps at most two tables; later tables are demoted to fenced code blocks to avoid Feishu's table-count limit.
- If the complete final answer still does not fit on one card, it is delivered as multiple standalone cards in order.
- If card delivery fails, the bridge falls back to a plain-text reply instead of losing the answer.
- Feishu closes CardKit streaming cards about 10 minutes after creation. `streaming markdown` mode pauses the progress card at 8.5 minutes with a notice, then sends the final answer as a separate message. `interactive card` mode uses message patches and is not subject to that cutoff.

## lark-cli identity policy

Each profile uses a profile-local lark-cli directory at `~/.agent-lark-ease/profiles/<profile>/lark-cli`. The agent process receives `LARKSUITE_CLI_CONFIG_DIR` for that directory, so personal authorization in one profile is not shared with another profile.

The default policy is `bot-only`: lark-cli uses the app/bot identity and does not access personal resources. When a user authorizes personal resources such as calendar, mail, or drive, the current profile can switch to `user-default`, which keeps app identity available and also allows the authorized user identity. Owner/admin users can inspect or change this policy in `/config`; `/status` shows the current summary as `lark-cli: app` or `lark-cli: user-ready`.

## Working directories

Each profile may define a default working directory through `workspaces.default`. New profiles may be created with `--workspace <path>`; if omitted, the bridge creates a profile-managed default working directory.

This is a profile-field snippet. Do not replace the whole `config.json` with it; edit the matching profile's `workspaces` field.

```json
{
  "workspaces": {
    "default": "/Users/me/.agent-lark-ease-workspaces/claude/default"
  }
}
```

The bridge checks that a selected directory exists, is a directory, and is not an overly broad location such as `/`, the home root, a system directory, or a temp root. The working directory is only the current directory for an agent run. It is not a filesystem sandbox; actual file access still depends on the local agent process and its permission mode.

## Permission modes

The recommended user-facing profile config is `permissions.defaultAccess` and `permissions.maxAccess`. New profiles default to `full` for both values so the bridge can keep local tools, authorization flows, file writes, and other agent features fully usable. To tighten a profile, set one or both values to `workspace` or `read-only`; stricter modes can limit local tool execution, login/authorization flows, file writes, and similar capabilities.

This is a profile-field snippet. Do not replace the whole `config.json` with it; edit the matching profile's `permissions` field.

```json
{
  "permissions": {
    "defaultAccess": "full",
    "maxAccess": "full"
  }
}
```

Mode mapping:

| Bridge access | Claude permission mode | Codex mode |
|---|---|---|
| `full` | `bypassPermissions` | `danger-full-access` |
| `workspace` | `acceptEdits` | `workspace-write` |
| `read-only` | `plan` | `read-only` |

The legacy `sandbox` field is still readable for old configs. After the bridge saves the profile, it migrates that setting to canonical `permissions`.

## Data directories

| Path | Content |
|---|---|
| `~/.agent-lark-ease/config.json` | Root config with profiles and active profile |
| `~/.agent-lark-ease/active-profile` | Last selected profile |
| `~/.agent-lark-ease/profiles/<profile>/sessions.json` | Session state |
| `~/.agent-lark-ease/profiles/<profile>/sessions.json.catalog.json` | Agent-aware session catalog |
| `~/.agent-lark-ease/profiles/<profile>/workspaces.json` | Current and named workspace bindings |
| `~/.agent-lark-ease/profiles/<profile>/secrets.enc` | Profile-local encrypted secrets |
| `~/.agent-lark-ease/profiles/<profile>/lark-cli/` | Profile-local lark-cli directory |
| `~/.agent-lark-ease/profiles/<profile>/media/` | Attachment cache |
| `~/.agent-lark-ease/profiles/<profile>/logs/` | Structured run logs |
| `~/.agent-lark-ease/registry/processes.json` | Local process registry |
| `~/.agent-lark-ease/registry/locks/` | Profile and app locks |

Set `LARK_EASE_HOME=/path/to/state` to move all local bridge state. `LARK_EASE_LOG_DAYS` overrides log retention.

## Access control

**Chat access is private by default: out of the box, only *you* can use the bot in DMs and groups.** "You" = whoever created / owns the Feishu app (the person who scanned the QR to set it up). The bot figures out who the app owner is automatically from Feishu, so **solo chat use needs zero configuration** — you can DM it and `@`-mention it in any group, and everyone else's chat messages are silently ignored (no "permission denied" reply, which would only confirm the bot exists). Cloud-doc comments are document-scoped; see below.

To let other people or groups in, add them to one of three lists:

| List | Controls | Add | Remove |
|------|----------|-----|--------|
| **Allowed users** | who can DM the bot | `/invite user @them` | `/remove user @them` |
| **Allowed chats** | which groups the bot answers in (for **everyone** in them) | `/invite group` (current group) / `/invite all group` (every group the bot is in) | `/remove group` (current group) |
| **Admins** | who can change settings, and use the bot in any group | `/invite admin @them` | `/remove admin @them` |

> `/invite` and `/remove` can only be run by **you (the creator) and admins**. The `@` in the command points at the *target person* (not the bot) — the bot resolves the mention to their identity, so you never deal with raw IDs.

### Two identities that bypass everything

- **You (the creator)**: subject to no list at all — DMs, any group, every command. You **can never lock yourself out**: even if the lists get messed up, DM the bot and send `/config` to get back in. Transfer the app's ownership in the Feishu console and the bot follows the new owner automatically.
- **Admins**: can DM, run management commands like `/config`, and **bypass the allowed-chats list** — the bot answers them in any group, listed or not. Good for teammates who co-maintain the bot.

### Common setups

- **Just me** → nothing to do; this is the default.
- **Let a teammate DM the bot** → `/invite user @them`
- **Open a work group to everyone in it** → send `/invite group` inside that group
- **First-time setup, onboard every group the bot is already in** → `/invite all group` pulls them all into the list at once; trim with `/remove group` afterwards
- **Add a co-admin** → `/invite admin @them`

### Worth knowing

- Changes take effect on the **next message** — no restart needed.
- **In groups you must `@` the bot first** (DMs don't need it). That's a separate toggle (`/config` → "require @ in groups"), independent of the lists above.
- Strangers get pure silence — no reply at all. The one exception: if someone `@`-mentions the bot in a group that hasn't been opened up, the bot posts a friendly one-liner telling them an admin can run `/invite group` to enable it.
- Cloud-doc comments are document-scoped: anyone who can comment in a supported document and mention the bot can trigger a reply.

### Advanced: editing the config file directly

If you'd rather not do it inside Feishu, `/invite` and `/config` write the matching profile's `access` field in `~/.agent-lark-ease/config.json`. Empty lists mean nobody from that list, not open access. This is a profile-field snippet; do not replace the whole `config.json` with it:

```json
{
  "schemaVersion": 2,
  "profiles": {
    "claude": {
      "agentKind": "claude",
      "access": {
        "allowedUsers": ["ou_xxxxxxxxxxxxx"],
        "allowedChats": ["oc_xxxxxxxxxxxxx"],
        "admins": ["ou_xxxxxxxxxxxxx"],
        "requireMentionInGroup": true
      }
    }
  }
}
```

`allowedUsers` / `admins` take user `open_id`s; `allowedChats` takes group `chat_id`s. The easiest way to find an ID by hand: have the person message the bot (or `@` it in the group), then check the active profile's log:

```bash
grep '"event":"enter"' ~/.agent-lark-ease/profiles/<profile>/logs/bridge-$(date +%Y%m%d).jsonl | tail -5
```

Each line carries `chatId` (group / DM id) and `senderId` (user `open_id`). After a manual edit, **restart the bridge** or send `/reconnect` from an allowed admin context to apply it. For day-to-day tweaks `/invite` / `/config` are easier; direct edits are mainly for deployment scripts that pre-seed access.

## Cloud-doc comments

Cloud-doc comments do not need a separate workspace binding or document allowlist. In supported document comments, mention the bot and the bridge replies in the same thread. Comment runs reuse the document session key and fall back to the user home directory when no document cwd was previously recorded.

## FAQ

**The bot stays silent or the local CLI never replies.** Usually the local `claude` or `codex` CLI is not logged in, or the current session points to a working directory that no longer exists. Send `/status` to inspect; `/new` often fixes it by starting a fresh session.

**The agent subprocess looks frozen (card stuck on the last frame).** The bridge supports an idle watchdog: if the agent emits nothing for N minutes, the process is killed and the card is annotated with the auto-termination reason. Disabled by default. Enable with `/config` globally, or `/timeout 10` for the current session; `/timeout off` disables it for the session; `/timeout default` clears the session override.

**The agent says it cannot see an image I sent.** Upgrade to the latest version. Releases before 0.1.0 had a filename-dedup bug.

## Testing and CI

Local checks:

```bash
pnpm test
pnpm typecheck
pnpm build
```

`pnpm test` includes unit, integration, and process-level adapter tests. CI runs on Node 26 across macOS, Ubuntu, and Windows with `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm typecheck`, and `pnpm build`.

## Optional telemetry

By default the bridge reports **nothing**: no metrics, no logs leave your machine, and it pulls in zero telemetry dependencies. The hook below is inert unless you opt in.

To wire up your own monitoring, point an environment variable at a module that default-exports (or exports `createAdapter`) an `AdapterFactory`:

```bash
LARK_EASE_TELEMETRY_MODULE=your-telemetry-package agent-lark-ease start
```

That module receives every `log.*` event plus error/metric hooks and forwards them wherever you like. The interface is exported from the package root:

```ts
import type { AdapterFactory, TelemetryAdapter, TelemetryEvent } from '@autoais/agent-lark-ease';

const createAdapter: AdapterFactory = (meta) => ({
  emit(event) {/* ship event */},
  recordError(err, ctx) {/* ship exception */},
  recordMetric(name, value, tags) {/* ship metric */},
  flush(timeoutMs) {/* drain buffered events */},
});
export default createAdapter;
```

A missing module, a bad factory, or a throwing adapter all degrade to noop — telemetry can never stop the bridge from starting or break logging.

## License

[MIT](./LICENSE)

<img src="./assets/feedback-group-qr.png" alt="Feedback group QR code" width="360">
