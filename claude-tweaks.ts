#!/usr/bin/env -S node --experimental-strip-types
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { getNode, readAsarHeader } from "./src/asar.ts";
import { FEATURES, isTweakName, type TweakName } from "./src/features.ts";
import { sha256 } from "./src/patch-utils.ts";

const DEFAULT_APP = "/Applications/Claude.app";
type Command =
  | { kind: "install"; tweak: TweakName; app: string; dryRun: boolean }
  | { kind: "restore"; app: string; dryRun: boolean };

function usage(): never {
  console.log(`Usage:
  claude-tweaks install <inference-3p|computer-use-3p|pet> [--app /Applications/Claude.app] [--dry-run]
  claude-tweaks restore [--app /Applications/Claude.app] [--dry-run]

Legacy/direct invocation:
  ./claude-tweaks.ts [--app /Applications/Claude.app] [--dry-run]
  ./claude-tweaks.ts inference-3p [--app /Applications/Claude.app] [--dry-run]
  ./claude-tweaks.ts computer-use-3p [--app /Applications/Claude.app] [--dry-run]
  ./claude-tweaks.ts pet [--app /Applications/Claude.app] [--dry-run]
  ./claude-tweaks.ts --restore [--app /Applications/Claude.app] [--dry-run]

What it patches:
  - inference-3p: gateway route verification, Cowork prompt forwarding, Electron UI gateway warning, ElectronAsarIntegrity hashes
  - computer-use-3p: Computer Use feature, opt-out, disabled, and TCC gates, plus ElectronAsarIntegrity hashes
  - pet: floating Codex mascot overlay for Claude, plus ElectronAsarIntegrity hashes
  - restore: backups created by this tool
`);
  process.exit(2);
}

function parseArgs() {
  const args = process.argv.slice(2);
  let app = DEFAULT_APP;
  let dryRun = false;
  let restore = false;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--app") app = args[++i] ?? usage();
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--restore") restore = true;
    else if (arg === "-h" || arg === "--help") usage();
    else positional.push(arg);
  }

  if (restore) {
    if (positional.length > 0) usage();
    return { kind: "restore", app, dryRun } satisfies Command;
  }

  if (positional.length === 0) {
    return { kind: "install", tweak: "inference-3p", app, dryRun } satisfies Command;
  }

  if (positional[0] === "install") {
    const tweak = positional[1];
    if (!isTweakName(tweak) || positional.length !== 2) usage();
    return { kind: "install", tweak, app, dryRun } satisfies Command;
  }

  if (positional[0] === "restore") {
    if (positional.length !== 1) usage();
    return { kind: "restore", app, dryRun } satisfies Command;
  }

  if (isTweakName(positional[0]) && positional.length === 1) {
    return { kind: "install", tweak: positional[0], app, dryRun } satisfies Command;
  }

  usage();
}

function backupPath(path: string): string {
  return `${path}.pre-gateway-bypass.bak`;
}

function ensureBackup(path: string, dryRun: boolean) {
  const backup = backupPath(path);
  if (existsSync(backup)) return;
  log(`backup ${path} -> ${backup}`);
  if (!dryRun) writeFileSync(backup, readFileSync(path));
}

function restoreFile(path: string, dryRun: boolean) {
  const backup = backupPath(path);
  if (!existsSync(backup)) {
    log(`skip restore, no backup: ${backup}`);
    return;
  }
  log(`restore ${path} <- ${backup}`);
  if (!dryRun) writeFileSync(path, readFileSync(backup));
}

function log(message: string) {
  console.log(`[claude-tweaks] ${message}`);
}

function fail(message: string): never {
  throw new Error(message);
}

function patchAsar(app: string, dryRun: boolean, tweak: TweakName): string {
  const asarPath = join(app, "Contents", "Resources", "app.asar");
  if (!existsSync(asarPath)) fail(`Missing ${asarPath}`);

  const data = Buffer.from(readFileSync(asarPath));
  const meta = readAsarHeader(data);
  const feature = FEATURES[tweak];
  const asarFile = feature.asarFile ?? ".vite/build/index.js";
  const indexNode = getNode(meta.header, asarFile.split("/"));
  if (typeof indexNode.offset !== "string" || typeof indexNode.size !== "number" || !indexNode.integrity) {
    fail(`ASAR ${asarFile} node does not include offset, size, and integrity`);
  }

  const fileStart = meta.headerPickleStart + meta.headerSize + Number(indexNode.offset);
  const fileEnd = fileStart + indexNode.size;
  let content = Buffer.from(data.subarray(fileStart, fileEnd));
  content = feature.patchIndexJs({
    data,
    content,
    fileStart,
    node: indexNode,
    dryRun,
    asarPath,
    ensureBackup,
    log,
  });

  const newHeaderJson = Buffer.from(JSON.stringify(meta.header));
  if (newHeaderJson.length !== meta.jsonSize) {
    fail(`ASAR header size changed (${meta.jsonSize} -> ${newHeaderJson.length}); refusing in-place rewrite`);
  }
  newHeaderJson.copy(data, meta.jsonStart);
  const headerHash = sha256(newHeaderJson);

  log(`new ElectronAsarIntegrity header hash: ${headerHash}`);
  if (!dryRun) writeFileSync(asarPath, data);
  return headerHash;
}
function walkFiles(root: string, out: string[] = []) {
  if (!existsSync(root)) return out;
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    const st = statSync(path);
    if (st.isDirectory()) walkFiles(path, out);
    else out.push(path);
  }
  return out;
}

function updateInfoPlists(app: string, headerHash: string, dryRun: boolean) {
  const contents = join(app, "Contents");
  const plistFiles = walkFiles(contents).filter((path) => basename(path) === "Info.plist");
  let updated = 0;
  for (const plist of plistFiles) {
    const text = readFileSync(plist, "utf8");
    if (!text.includes("ElectronAsarIntegrity") || !text.includes("Resources/app.asar")) continue;
    const next = text.replace(
      /(<key>Resources\/app\.asar<\/key>\s*<dict>[\s\S]*?<key>hash<\/key>\s*<string>)[a-f0-9]{64}(<\/string>)/,
      `$1${headerHash}$2`,
    );
    if (next === text && !text.includes(headerHash)) fail(`Could not update ElectronAsarIntegrity in ${plist}`);
    if (next !== text) {
      updated++;
      ensureBackup(plist, dryRun);
      log(`update ElectronAsarIntegrity in ${plist}`);
      if (!dryRun) writeFileSync(plist, next);
    }
  }
  log(`Info.plist files updated: ${updated}`);
}

function restore(app: string, dryRun: boolean) {
  restoreFile(join(app, "Contents", "Resources", "app.asar"), dryRun);
  restorePetResources(app, dryRun);

  const contents = join(app, "Contents");
  for (const file of walkFiles(contents)) {
    if (file.endsWith(".pre-gateway-bypass.bak")) continue;
    const backup = backupPath(file);
    if (existsSync(backup)) restoreFile(file, dryRun);
  }
}

function restorePetResources(app: string, dryRun: boolean) {
  const petDir = join(app, "Contents", "Resources", "claude-pet");
  const marker = join(petDir, ".claude-tweaks-pet");
  if (!existsSync(petDir)) return;
  if (!existsSync(marker)) {
    log(`skip pet resource cleanup, marker not found: ${petDir}`);
    return;
  }
  log(`remove pet resources: ${petDir}`);
  if (!dryRun) rmSync(petDir, { recursive: true, force: true });
}

function main() {
  const command = parseArgs();
  const { app, dryRun } = command;
  if (!existsSync(app)) fail(`App not found: ${app}`);

  if (command.kind === "restore") {
    restore(app, dryRun);
    log("restore complete");
    return;
  }

  const tweak = command.tweak;
  const feature = FEATURES[tweak];
  log(`install ${feature.label}`);
  const hash = patchAsar(app, dryRun, tweak);
  updateInfoPlists(app, hash, dryRun);
  feature.patchAfterAsar?.(app, dryRun, ensureBackup, log);
  log(dryRun ? "dry run complete" : "patch complete; quit and reopen Claude");
}

main();
