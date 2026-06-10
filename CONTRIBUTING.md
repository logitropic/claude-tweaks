# Contributing to claude-tweaks

Thanks for your interest in contributing! This document explains how to set up a development environment, run tests, and submit a pull request.

## Code of conduct

Be respectful. We're all here to make Claude Desktop work better for 3P inference providers. Disagreements are fine, personal attacks are not.

## Development setup

You need:

- macOS (the patcher targets `Claude.app`)
- Node.js ≥ 22 (for `--experimental-strip-types`)
- Claude for Desktop installed at `/Applications/Claude.app` (or pass `--app`)

```bash
git clone https://github.com/logitropic/claude-tweaks.git
cd claude-tweaks
npm run check         # syntax-check every .ts file
```

The project intentionally has **no dependencies and no build step**. All TypeScript files use explicit `.ts` import suffixes and rely on Node's built-in type stripping.

## Project layout

```
claude-tweaks.ts        CLI entry point (parse args, dispatch, restore)
src/
  asar.ts               Minimal ASAR header reader
  patch-utils.ts        Byte-pattern patching + SHA256 helpers
  features.ts           Feature registry (TweakName union + FEATURES map)
  features/
    chrome-mcp.ts       chrome-mcp-off patcher
    computer-use.ts     computer-use-3p patcher
    connectors.ts       connectors-3p patcher
    inference.ts        inference-3p patcher
    pet.ts              pet patcher (copies runtime files to Claude.app)
  pet/
    pet-main.cjs        Injected into Claude's main process (Electron)
    pet.html            Pet renderer (single self-contained HTML file)
    dario/
      pet.json          Pet metadata (id, displayName, lines)
      spritesheet.webp  8x9 grid sprite sheet (192x208 per frame)
```

## How the patcher works

The patcher performs same-length byte replacements inside Claude's minified `app.asar` so that the file size and structure are preserved. Every patched file is also backed up as `<file>.pre-gateway-bypass.bak`.

`ElectronAsarIntegrity` SHA256 hashes inside Claude's `Info.plist` files are recomputed after each patch so Claude's own integrity check stays consistent.

## Adding a new tweak

1. Create `src/features/<name>.ts` exporting:
   - `patch<Name>(ctx: PatchContext): Buffer` — byte-patch function
   - Optional `patch<Name>Resources(app, dryRun, ensureBackup, log)` — for tweaks that drop extra files into Claude.app (see `features/pet.ts` for the pattern)
2. Add the new name to the `TweakName` union in `src/features.ts` and to the `FEATURES` map.
3. Update `isTweakName` if it has a hardcoded list of valid names.
4. Update the help text in `claude-tweaks.ts` if you want to surface the new tweak in the "What it patches" section.
5. Update `README.md` with a row in the tweaks table.

Always add a `dry-run` test path. The patcher must not write to disk if `--dry-run` is set.

## Testing

This project has no automated test suite — verification is end-to-end manual:

```bash
# Syntax check
npm run check

# Dry-run a tweak
npm run cli -- install pet --dry-run

# Real install (modifies Claude.app — make sure Claude is closed first)
npm run cli -- install pet
```

After a real install, **quit and reopen Claude** and verify the tweak behaves as expected. Use `npm run cli -- restore` to revert.

## Pull request process

1. Fork the repository and create a feature branch.
2. Make your changes.
3. Run `npm run check` and `npm run cli -- install <your-tweak> --dry-run` and make sure both pass.
4. Update `README.md` and `CONTRIBUTING.md` as needed.
5. Open a pull request with a clear description of the change and the verification steps you ran.

## Release process

`logitropic` cuts a release by:

1. Bumping the version comment in `claude-tweaks.ts` (the CLI prints the version on startup).
2. Updating `CHANGELOG.md` (when one exists).
3. Tagging the commit `vX.Y.Z` and pushing the tag — GitHub Actions (or a manual `npm publish` if the package is moved to public) handles the rest.

## Reporting issues

Open a GitHub issue with:

- macOS version and Claude for Desktop version
- Output of `npm run cli -- install <tweak> --dry-run` if applicable
- Expected vs actual behavior
