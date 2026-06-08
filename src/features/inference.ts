import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  countBuffer,
  escapeRegExp,
  refreshIntegrity,
  replaceBufferOnce,
  type PatchContext,
} from "../patch-utils.ts";

const MAIN_NEW = Buffer.from('case"gateway":return{ok:!0}');
const MAIN_REASON =
  "expected a gateway model route referencing an Anthropic model (e.g. claude-sonnet-4-5, anthropic/claude-*). Name routes to match the underlying model.";
const UI_REASON =
  'expected a gateway model route referencing an Anthropic model (e.g. claude-sonnet-4-5, anthropic/claude-*). Name routes to match the underlying model.';
const UI_OLD =
  'case"gateway":return function(e){return Fe(e)?{ok:!0}:{ok:!1,reason:"' +
  UI_REASON +
  '"}}(t)}';
const UI_NEW = 'case"gateway":return{ok:!0};}';
const UI_PATCHED = 'case"gateway":return{ok:!0};}';
const SYSTEM_PROMPT_OLD = Buffer.from("systemPrompt:Be");
const SYSTEM_PROMPT_NEW = Buffer.from("systemPrompt:[]");

export function patchInference(ctx: PatchContext): Buffer {
  const { data, fileStart, node, dryRun, asarPath, ensureBackup, log } = ctx;
  let content = ctx.content;

  if (content.includes(MAIN_NEW)) {
    log("app.asar main validator already patched");
  } else {
    const mainOld = findMainGatewayDispatch(content, log);
    if (mainOld.length !== MAIN_NEW.length) {
      throw new Error(`Internal patch length mismatch (${mainOld.length} vs ${MAIN_NEW.length}) for ${mainOld.toString("utf8")}`);
    }
    ensureBackup(asarPath, dryRun);
    const patched = replaceBufferOnce(content, mainOld, MAIN_NEW);
    patched.copy(data, fileStart);
    content = patched;
    refreshIntegrity(node, patched);
  }

  if (content.includes(SYSTEM_PROMPT_NEW)) {
    log("app.asar Cowork systemPrompt already stripped");
  } else {
    const count = countBuffer(content, SYSTEM_PROMPT_OLD);
    if (count === 0) {
      log("skip Cowork systemPrompt patch; pattern not found in this version");
    } else {
      if (count !== 1) throw new Error(`Expected exactly one Cowork systemPrompt pattern, got ${count}`);
      ensureBackup(asarPath, dryRun);
      const patched = replaceBufferOnce(content, SYSTEM_PROMPT_OLD, SYSTEM_PROMPT_NEW);
      patched.copy(data, fileStart);
      content = patched;
      refreshIntegrity(node, patched);
      log("strip Cowork systemPrompt forwarding");
    }
  }

  return content;
}

export function patchIonDist(app: string, dryRun: boolean, ensureBackup: PatchContext["ensureBackup"], log: PatchContext["log"]) {
  const assetsDir = join(app, "Contents", "Resources", "ion-dist", "assets", "v1");
  if (!existsSync(assetsDir)) {
    log("skip ion-dist patch, assets/v1 not found");
    return;
  }
  const candidates = readdirSync(assetsDir)
    .filter((name) => name.endsWith(".js"))
    .map((name) => join(assetsDir, name))
    .filter((path) => {
      const text = readFileSync(path, "utf8");
      return text.includes(UI_REASON) || text.includes('case"gateway":return{ok:!0}');
    });

  if (candidates.length === 0) {
    log("ion-dist gateway warning chunk not found");
    return;
  }

  for (const file of candidates) {
    let text = readFileSync(file, "utf8");
    let changed = false;
    if (text.includes(UI_PATCHED)) {
      log(`ion-dist already patched: ${file}`);
    } else if (text.includes(UI_OLD)) {
      ensureBackup(file, dryRun);
      text = text.replace(UI_OLD, UI_NEW);
      log(`patch ion-dist UI validator: ${file}`);
      changed = true;
      if (!dryRun) writeFileSync(file, text);
    } else if (text.includes(UI_REASON)) {
      const uiOld = findUiGatewayDispatch(text, file, log);
      ensureBackup(file, dryRun);
      text = text.replace(uiOld, UI_NEW);
      log(`patch ion-dist UI validator: ${file}`);
      changed = true;
      if (!dryRun) writeFileSync(file, text);
    }

    const zst = `${file}.zst`;
    if (changed && existsSync(zst)) {
      ensureBackup(zst, dryRun);
      const zstd = spawnSync("zstd", ["--version"], { encoding: "utf8" });
      if (zstd.status === 0) {
        log(`recompress ${zst}`);
        if (!dryRun) {
          const result = spawnSync("zstd", ["-f", "-q", file, "-o", zst], { encoding: "utf8" });
          if (result.status !== 0) throw new Error(`zstd failed for ${file}: ${result.stderr || result.stdout}`);
        }
      } else {
        log(`zstd not found; ${zst} was not regenerated`);
      }
    }
  }
}

function findMainGatewayDispatch(content: Buffer, log: PatchContext["log"]): Buffer {
  const text = content.toString("utf8");
  const reasonIndex = text.indexOf(MAIN_REASON);
  if (reasonIndex === -1) throw new Error("Could not find main gateway verification reason text");

  const windowStart = Math.max(0, reasonIndex - 800);
  const windowEnd = Math.min(text.length, reasonIndex + 1400);
  const windowText = text.slice(windowStart, windowEnd);
  const matches = [...windowText.matchAll(/case"gateway":return [A-Za-z_$][\w$]*\([A-Za-z_$][\w$]*\)/g)];
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one gateway dispatch near main reason, got ${matches.length}`);
  }
  const oldText = matches[0][0];
  log(`main validator pattern: ${oldText}`);
  return Buffer.from(oldText);
}

function findUiGatewayDispatch(text: string, file: string, log: PatchContext["log"]): string {
  const reasonIndex = text.indexOf(UI_REASON);
  if (reasonIndex === -1) throw new Error(`Could not find UI gateway reason text: ${file}`);
  const windowText = text.slice(Math.max(0, reasonIndex - 800), Math.min(text.length, reasonIndex + 1200));
  const escapedReason = escapeRegExp(UI_REASON);
  const regex = new RegExp(
    `case"gateway":return function\\(e\\)\\{return [A-Za-z_$][\\w$]*\\(e\\)\\?\\{ok:!0\\}:\\{ok:!1,reason:"${escapedReason}"\\}\\}\\(t\\)\\}`,
    "g",
  );
  const matches = [...windowText.matchAll(regex)].map((m) => m[0]);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one UI gateway dispatch near reason, got ${matches.length}: ${file}`);
  }
  log(`UI validator pattern: ${matches[0].slice(0, 80)}...`);
  return matches[0];
}
