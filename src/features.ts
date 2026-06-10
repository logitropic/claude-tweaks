import { patchComputerUse } from "./features/computer-use.ts";
import { patchConnectors } from "./features/connectors.ts";
import { patchInference, patchIonDist } from "./features/inference.ts";
import { patchPet, patchPetResources } from "./features/pet.ts";
import type { PatchContext } from "./patch-utils.ts";

export type TweakName = "inference-3p" | "computer-use-3p" | "connectors-3p" | "pet";

export type Feature = {
  label: TweakName;
  asarFile?: string;
  patchIndexJs: (ctx: PatchContext) => Buffer;
  patchAfterAsar?: (app: string, dryRun: boolean, ensureBackup: PatchContext["ensureBackup"], log: PatchContext["log"]) => void;
};

export const FEATURES: Record<TweakName, Feature> = {
  "inference-3p": {
    label: "inference-3p",
    patchIndexJs: patchInference,
    patchAfterAsar: patchIonDist,
  },
  "computer-use-3p": {
    label: "computer-use-3p",
    patchIndexJs: patchComputerUse,
  },
  "connectors-3p": {
    label: "connectors-3p",
    patchIndexJs: patchConnectors,
  },
  pet: {
    label: "pet",
    asarFile: ".vite/build/index.pre.js",
    patchIndexJs: patchPet,
    patchAfterAsar: patchPetResources,
  },
};

export function isTweakName(value: string | undefined): value is TweakName {
  return value === "inference-3p" || value === "computer-use-3p" || value === "connectors-3p" || value === "pet";
}
