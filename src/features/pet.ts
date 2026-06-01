import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixedLengthBuffer, patchSameLengthPattern, type PatchContext } from "../patch-utils.ts";

const PET_HOOK_OLD = Buffer.from('require("node:events");require("process");require("crypto");');
const PET_HOOK_NEW = fixedLengthBuffer('require(process.resourcesPath+"/claude-pet/pet-main.cjs");', PET_HOOK_OLD.length);
const PET_DIR_NAME = "claude-pet";
const SPRITE_NAME = "codex-spritesheet-v4.webp";

export function patchPet(ctx: PatchContext): Buffer {
  return patchSameLengthPattern({
    ...ctx,
    oldBytes: PET_HOOK_OLD,
    newBytes: PET_HOOK_NEW,
    alreadyBytes: PET_HOOK_NEW,
    label: "install Claude Pet bootstrap hook",
  });
}

export function patchPetResources(
  app: string,
  dryRun: boolean,
  ensureBackup: PatchContext["ensureBackup"],
  log: PatchContext["log"],
) {
  const resourcesDir = join(app, "Contents", "Resources");
  const petDir = join(resourcesDir, PET_DIR_NAME);
  const sourceDir = dirname(fileURLToPath(import.meta.url));
  const payloadDir = join(sourceDir, "..", "pet");
  const petSourceDir = process.env.CLAUDE_TWEAK_PET_DIR ?? join(payloadDir, "dario");

  log(`install pet resources into ${petDir}`);
  if (!dryRun) mkdirSync(petDir, { recursive: true });

  copyPayloadFile(join(payloadDir, "pet-main.cjs"), join(petDir, "pet-main.cjs"), dryRun, ensureBackup, log);
  copyPayloadFile(join(payloadDir, "pet.html"), join(petDir, "pet.html"), dryRun, ensureBackup, log);
  copyPetSprite(petSourceDir, join(petDir, SPRITE_NAME), dryRun, ensureBackup, log);

  const marker = join(petDir, ".claude-tweaks-pet");
  if (!dryRun) writeFileSync(marker, "created by claude-tweaks pet\n");
}

function copyPayloadFile(
  source: string,
  target: string,
  dryRun: boolean,
  ensureBackup: PatchContext["ensureBackup"],
  log: PatchContext["log"],
) {
  if (!existsSync(source)) throw new Error(`Missing pet payload: ${source}`);
  if (existsSync(target)) ensureBackup(target, dryRun);
  log(`copy pet payload ${target}`);
  if (!dryRun) writeFileSync(target, readFileSync(source));
}

function copyPetSprite(
  petSourceDir: string,
  target: string,
  dryRun: boolean,
  ensureBackup: PatchContext["ensureBackup"],
  log: PatchContext["log"],
) {
  const metadataPath = join(petSourceDir, "pet.json");
  const spritePath = resolveSpritePath(petSourceDir, metadataPath);
  if (existsSync(target)) ensureBackup(target, dryRun);
  log(`copy pet sprite ${spritePath} -> ${target}`);
  if (!dryRun) writeFileSync(target, readFileSync(spritePath));
}

function resolveSpritePath(petSourceDir: string, metadataPath: string): string {
  if (!existsSync(metadataPath)) throw new Error(`Missing pet metadata: ${metadataPath}`);
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as { spritesheetPath?: string };
  const spritesheetPath = metadata.spritesheetPath ?? "spritesheet.webp";
  const spritePath = join(petSourceDir, spritesheetPath);
  if (!existsSync(spritePath)) throw new Error(`Missing pet spritesheet: ${spritePath}`);
  return spritePath;
}
