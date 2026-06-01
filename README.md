# claude-tweaks

> A patcher for [Claude for Desktop](https://claude.com/download) on macOS that adds tweaks via in-place modification of the app's `app.asar` bundle.

**Recommended only when using third-party (3P) inference providers.** If you use Claude with Anthropic's default API, you don't need any of these tweaks.

## What it does

`claude-tweaks` modifies `Claude.app/Contents/Resources/app.asar` to install one or more of these tweaks. Each tweak is a small, well-scoped change that can be reverted with `claude-tweaks restore`.

| Tweak | What it does |
|---|---|
| `inference-3p` | Bypasses the Claude gateway route verification, the Cowork prompt forwarding check, and the Electron UI gateway warning. **Required when routing inference through a 3P provider.** |
| `computer-use-3p` | Unlocks the Computer Use feature even when it is gated behind the platform, opt-out, disabled, or TCC permission checks. **Required when using Computer Use through a 3P provider.** |
| `pet` | Adds a floating Codex-style mascot overlay (sprite + speech bubble) that reacts to Claude activity. Cosmetic. |

The patcher also recomputes the `ElectronAsarIntegrity` SHA256 hashes stored in every `Info.plist` inside `Claude.app`, so Claude's own integrity checks stay consistent.

## Install

You need macOS, Node.js ≥ 22 (for `--experimental-strip-types`), and a Claude for Desktop install at `/Applications/Claude.app` (or pass `--app` to point elsewhere).

```bash
# Recommended: install via npx without cloning
npx claude-tweaks install inference-3p
npx claude-tweaks install pet
npx claude-tweaks install computer-use-3p

# Combine
npx claude-tweaks install inference-3p pet
```

After installing, **quit and reopen Claude** for the changes to take effect.

### Dry run

Preview what the patcher will do without touching any files:

```bash
npx claude-tweaks install inference-3p --dry-run
```

### Restore

Revert every tweak and restore the original `app.asar` plus all backed-up `Info.plist` files:

```bash
npx claude-tweaks restore
```

Backups are stored as `<file>.pre-gateway-bypass.bak` next to the original.

## How it works

`claude-tweaks` reads Claude's `app.asar` (an Electron archive), parses its JSON header to locate the right file (`.vite/build/index.pre.js` for the main tweaks), performs a same-length byte-pattern replacement to inject the new code, recomputes the header SHA256, and patches every `Info.plist` that references the new integrity hash.

For the `pet` tweak, it additionally copies `pet-main.cjs`, `pet.html`, and the sprite into `Claude.app/Contents/Resources/claude-pet/`, and hooks Claude's main process by replacing a benign `require("node:events"); require("process"); require("crypto");` triple in `index.pre.js` with `require(process.resourcesPath+"/claude-pet/pet-main.cjs");`.

## Why only with a 3P inference provider?

The `inference-3p` and `computer-use-3p` tweaks are specifically for routing Claude's requests through a third-party inference provider instead of Anthropic's own API gateway. If you use Claude normally, none of these tweaks are needed and the patched Claude will behave the same as the unpatched one.

The `pet` tweak is purely cosmetic and works regardless of the inference provider.

## Caveats

- **Modifying `app.asar` is not supported by Anthropic.** Future Claude updates may break the patcher or change the file layout. If a Claude update breaks the patcher, the affected `dry-run` will report `skip ... pattern not found` and no changes will be made.
- **Backup first.** The patcher creates `.pre-gateway-bypass.bak` files for every modified file. Keep them until you've confirmed Claude still works as expected.
- **macOS only.** The patcher targets `Claude.app` on macOS. Windows and Linux support is not provided.

## Development

```bash
# Syntax check
npm run check

# Dry-run a tweak
npm run cli -- install pet --dry-run
```

The project uses Node's built-in TypeScript stripping (no build step, no transpiler, no dependencies). All source files are TypeScript with `.ts` extensions and import each other with explicit `.ts` suffixes.

## License

[MIT](LICENSE)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
