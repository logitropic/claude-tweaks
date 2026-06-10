# claude-tweaks

> Reversible macOS patcher for Claude Desktop that applies focused ASAR-level tweaks for third-party inference routing, third-party connector discovery, Computer Use experiments, Claude in Chrome control, and an optional desktop pet overlay.

![Platform: macOS](https://img.shields.io/badge/platform-macOS-111111)
![Node.js >= 22](https://img.shields.io/badge/node-%3E%3D22-339933)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)

`claude-tweaks` is a small, dependency-free CLI for advanced Claude Desktop users who need inspectable, reversible patches while experimenting with compatible third-party inference providers on macOS.

If you use Claude Desktop with Anthropic's default service, you probably do not need this project.

This project is not affiliated with Anthropic.

## Demo

[![Watch the demo on YouTube](https://img.youtube.com/vi/aYqx4Ogf-7w/maxresdefault.jpg)](https://youtu.be/aYqx4Ogf-7w)

<https://youtu.be/aYqx4Ogf-7w>

## Features

`claude-tweaks` modifies `Claude.app/Contents/Resources/app.asar` to install one tweak at a time. Each tweak is intentionally scoped and can be reverted with `claude-tweaks restore`.

| Tweak | Purpose | Notes |
|---|---|---|
| `inference-3p` | Adjusts Claude Desktop's gateway route validation, Cowork prompt forwarding check, and Electron UI gateway warning. | Intended for routing inference through compatible third-party providers. |
| `computer-use-3p` | Enables Computer Use paths that can be gated by platform, opt-out, disabled, or local permission checks. | Intended for third-party-provider experiments where Computer Use support is expected. |
| `connectors-3p` | Lets custom 3P MCP discovery import installed org-plugin connector MCP configs instead of only plugins marked enabled in Cowork settings. | Keeps tool calls on Claude Desktop's direct custom 3P MCP path and routes org-plugin remote MCP servers through OAuth; connector auth is still required. |
| `chrome-mcp-off` | Disables the Claude in Chrome MCP bridge startup and removes its tool names and bundled references from Claude Desktop. | Prevents the app from registering, exposing, or advertising `mcp__Claude_in_Chrome__*` tools. |
| `pet` | Adds a floating Codex-style desktop pet overlay with a sprite and speech bubble. | Cosmetic; works independently of the inference provider. |

The patcher also recomputes the `ElectronAsarIntegrity` SHA256 hashes stored in every `Info.plist` inside `Claude.app`, so Claude's own integrity checks stay consistent.

## Quick start

Requirements:

- macOS
- Node.js >= 22
- Claude Desktop installed at `/Applications/Claude.app`, or a custom path passed with `--app`
- Claude Desktop fully quit before patching

```bash
# Preview the patch without writing files
npx github:logitropic/claude-tweaks install inference-3p --dry-run

# Install one tweak
npx github:logitropic/claude-tweaks install inference-3p

# Install additional tweaks by running the command again
npx github:logitropic/claude-tweaks install computer-use-3p
npx github:logitropic/claude-tweaks install connectors-3p
npx github:logitropic/claude-tweaks install chrome-mcp-off
npx github:logitropic/claude-tweaks install pet
```

After installing, reopen Claude Desktop for the changes to take effect.

### From a local checkout

```bash
git clone https://github.com/logitropic/claude-tweaks.git
cd claude-tweaks
npm run cli -- install inference-3p --dry-run
npm run cli -- install inference-3p
```

## Commands

```bash
npx github:logitropic/claude-tweaks install <inference-3p|computer-use-3p|connectors-3p|chrome-mcp-off|pet> [--app /Applications/Claude.app] [--dry-run]
npx github:logitropic/claude-tweaks restore [--app /Applications/Claude.app] [--dry-run]
```

Restore reverts every tweak and restores the original `app.asar` plus backed-up `Info.plist` files:

```bash
npx github:logitropic/claude-tweaks restore
```

Backups are stored next to the original files as `<file>.pre-gateway-bypass.bak`.

## Gateway route troubleshooting

If your third-party inference setup fails with this Claude Desktop gateway validation message:

```text
expected a gateway model route referencing an Anthropic model (e.g. claude-sonnet-4-5, anthropic/claude-*). Name routes to match the underlying model.
```

the route name is being checked against Claude Desktop's built-in gateway model validator. The `inference-3p` tweak adjusts that validation path for compatible third-party provider setups, so Anthropic-compatible model routes can be tested without the desktop app blocking the request before it reaches your provider.

## Connector troubleshooting

Claude Desktop's custom 3P MCP path can connect directly to remote MCP servers listed by installed org plugins. By default, Claude only imports connector MCP configs for org plugins marked enabled in Cowork settings. The `connectors-3p` tweak changes that discovery step to use `cowork_plugins/installed_plugins.json`, so installed org-plugin connectors can appear in 3P mode without routing tool calls through Anthropic's MCP proxy. It also treats org-plugin HTTP/SSE MCP entries as OAuth-capable, allowing the desktop app to start its custom 3P OAuth flow even when the plugin's `.mcp.json` omits an explicit `oauth` object.

When Electron `safeStorage` is unavailable, Claude Desktop normally loses the dynamically registered OAuth client before the browser callback can exchange the authorization code. The `connectors-3p` tweak keeps that OAuth client and any resulting connector token in memory for the current Claude process, so the callback can complete without writing plaintext credentials to `config.json`. This is session-only: after quitting Claude, connectors that depended on that fallback may need to be authorized again.

This does not bypass connector authentication or entitlement checks on the connector provider. Servers with OAuth or bearer-token requirements still need valid auth, and plugin entries with invalid or empty URLs are still skipped by Claude Desktop's existing MCP validation.

## Claude in Chrome MCP

Claude Desktop can start a Chrome extension bridge that registers the `Claude in Chrome` MCP server and exposes tools with the `mcp__Claude_in_Chrome__` prefix. The `chrome-mcp-off` tweak patches the app startup path so this bridge is not initialized, removes the fallback allowed-tool prefix, removes hard-coded Chrome MCP tool names from session tool lists, and removes remaining bundled references to the MCP name in prompt/display strings. It does not uninstall browser extensions or delete native messaging host files; it only prevents Claude Desktop from starting, registering, exposing, or advertising that MCP bridge.

If you previously installed an experimental build that replaced the server name with a temporary placeholder, run `claude-tweaks restore` first, then install `chrome-mcp-off` again. Current builds do not carry compatibility cleanup for that placeholder.

## How it works

`claude-tweaks` reads Claude's `app.asar` (an Electron archive), parses its JSON header to locate the right file (`.vite/build/index.js` for most tweaks, `.vite/build/index.pre.js` for the pet bootstrap), applies the requested patch, recomputes the ASAR header SHA256, and patches every `Info.plist` that references the new integrity hash. Most tweaks use same-length byte-pattern replacements; `chrome-mcp-off` repacks the ASAR so Chrome MCP names can be removed instead of replaced with placeholder names.

For the `pet` tweak, it additionally copies `pet-main.cjs`, `pet.html`, and the sprite into `Claude.app/Contents/Resources/claude-pet/`, and hooks Claude's main process by replacing a benign `require("node:events"); require("process"); require("crypto");` triple in `index.pre.js` with `require(process.resourcesPath+"/claude-pet/pet-main.cjs");`.

## When to use it

The `inference-3p`, `computer-use-3p`, and `connectors-3p` tweaks are specifically for advanced workflows that route Claude Desktop requests through a third-party inference provider instead of Anthropic's own gateway. The `chrome-mcp-off` tweak is for users who want Claude Desktop to stop exposing Claude in Chrome MCP tools. If you use Claude normally, these tweaks are unnecessary.

The `pet` tweak is purely cosmetic and works regardless of the inference provider.

## Safety and compatibility

- Modifying `app.asar` is not supported by Anthropic. Claude Desktop updates may change the file layout or patch patterns.
- Run `--dry-run` first. If a pattern is missing, the patcher reports the skipped step instead of guessing.
- Keep the generated `.pre-gateway-bypass.bak` files until you have confirmed Claude Desktop still works as expected.
- This project targets macOS only. Windows and Linux support is not currently provided.

## Development

```bash
# Syntax check
npm run check

# Dry-run a tweak
npm run cli -- install pet --dry-run
```

The project uses Node's built-in TypeScript stripping (no build step, no transpiler, no dependencies). All source files are TypeScript with `.ts` extensions and import each other with explicit `.ts` suffixes.

## Contributing

Issues and pull requests are welcome. Please run `npm run check` and include the `--dry-run` output for any tweak you change or add.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, project layout, testing guidance, and the pull request process.

## License

[MIT](LICENSE)
