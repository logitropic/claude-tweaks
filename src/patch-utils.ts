import { createHash } from "node:crypto";
import type { AsarNode } from "./asar.ts";

export type PatchContext = {
  data: Buffer;
  content: Buffer;
  fileStart: number;
  node: AsarNode;
  dryRun: boolean;
  asarPath: string;
  ensureBackup: (path: string, dryRun: boolean) => void;
  log: (message: string) => void;
};

export function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function fixedLengthBuffer(value: string, length: number): Buffer {
  if (value.length > length) throw new Error(`Replacement is longer than original (${value.length} > ${length})`);
  return Buffer.from(value + " ".repeat(length - value.length));
}

export function refreshIntegrity(node: AsarNode, content: Buffer) {
  if (!node.integrity) throw new Error("ASAR node does not include integrity");
  const blockSize = node.integrity.blockSize;
  node.integrity.hash = sha256(content);
  node.integrity.blocks = [];
  for (let i = 0; i < content.length; i += blockSize) {
    node.integrity.blocks.push(sha256(content.subarray(i, i + blockSize)));
  }
}

export function patchSameLengthPattern(options: PatchContext & {
  oldBytes: Buffer;
  newBytes: Buffer;
  alreadyBytes: Buffer;
  label: string;
}): Buffer {
  const { data, content, fileStart, node, dryRun, asarPath, ensureBackup, log, oldBytes, newBytes, alreadyBytes, label } =
    options;
  if (oldBytes.length !== newBytes.length) throw new Error(`${label}: replacement length mismatch`);
  if (content.includes(alreadyBytes)) {
    log(`app.asar already patched: ${label}`);
    return content;
  }
  const count = countBuffer(content, oldBytes);
  if (count === 0) {
    log(`skip ${label}; pattern not found in this version`);
    return content;
  }
  if (count !== 1) throw new Error(`${label}: expected exactly one pattern, got ${count}`);
  ensureBackup(asarPath, dryRun);
  const patched = replaceBufferOnce(content, oldBytes, newBytes);
  patched.copy(data, fileStart);
  refreshIntegrity(node, patched);
  log(label);
  return patched;
}

export function patchAllSameLengthPattern(options: PatchContext & {
  oldBytes: Buffer;
  newBytes: Buffer;
  alreadyBytes: Buffer;
  label: string;
}): Buffer {
  const { data, content, fileStart, node, dryRun, asarPath, ensureBackup, log, oldBytes, newBytes, alreadyBytes, label } =
    options;
  if (oldBytes.length !== newBytes.length) throw new Error(`${label}: replacement length mismatch`);
  if (content.includes(alreadyBytes) && countBuffer(content, oldBytes) === 0) {
    log(`app.asar already patched: ${label}`);
    return content;
  }
  const count = countBuffer(content, oldBytes);
  if (count === 0) {
    log(`skip ${label}; pattern not found in this version`);
    return content;
  }
  ensureBackup(asarPath, dryRun);
  const patched = replaceBufferAll(content, oldBytes, newBytes);
  patched.copy(data, fileStart);
  refreshIntegrity(node, patched);
  log(`${label}${count > 1 ? ` (${count} matches)` : ""}`);
  return patched;
}

export function countBuffer(buffer: Buffer, needle: Buffer) {
  let count = 0;
  let offset = 0;
  while (true) {
    const index = buffer.indexOf(needle, offset);
    if (index === -1) return count;
    count++;
    offset = index + needle.length;
  }
}

export function replaceBufferOnce(buffer: Buffer, oldBytes: Buffer, newBytes: Buffer) {
  const index = buffer.indexOf(oldBytes);
  if (index === -1) throw new Error("replaceBufferOnce pattern not found");
  return Buffer.concat([buffer.subarray(0, index), newBytes, buffer.subarray(index + oldBytes.length)]);
}

export function replaceBufferAll(buffer: Buffer, oldBytes: Buffer, newBytes: Buffer) {
  if (oldBytes.length !== newBytes.length) throw new Error("replaceBufferAll replacement length mismatch");
  const chunks: Buffer[] = [];
  let index = 0;
  let count = 0;
  while (true) {
    const match = buffer.indexOf(oldBytes, index);
    if (match === -1) {
      chunks.push(buffer.subarray(index));
      break;
    }
    chunks.push(buffer.subarray(index, match), newBytes);
    index = match + oldBytes.length;
    count++;
  }
  if (count === 0) throw new Error("replaceBufferAll pattern not found");
  return Buffer.concat(chunks);
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
