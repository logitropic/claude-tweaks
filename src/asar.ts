import { readFileSync } from "node:fs";

export type AsarNode = {
  files?: Record<string, AsarNode>;
  size?: number;
  offset?: string;
  integrity?: {
    algorithm: "SHA256";
    hash: string;
    blockSize: number;
    blocks: string[];
  };
};

export function readAsarHeader(data: Buffer) {
  const firstPayload = data.readUInt32LE(0);
  const headerPickleStart = 4 + Math.ceil(firstPayload / 4) * 4;
  const headerSize = data.readUInt32LE(4);
  const jsonSize = data.readUInt32LE(headerPickleStart + 4);
  const jsonStart = headerPickleStart + 8;
  const jsonEnd = jsonStart + jsonSize;
  const headerBytes = data.subarray(jsonStart, jsonEnd);
  return {
    headerPickleStart,
    headerSize,
    jsonStart,
    jsonSize,
    header: JSON.parse(headerBytes.toString("utf8")) as AsarNode,
  };
}

export function getNode(root: AsarNode, pathParts: string[]): AsarNode {
  let node = root;
  for (const part of pathParts) {
    node = node.files?.[part] ?? fail(`ASAR path not found: ${pathParts.join("/")}`);
  }
  return node;
}

export function readAsarFile(asarPath: string, asarFile: string): Buffer {
  const data = readFileSync(asarPath);
  const meta = readAsarHeader(data);
  const parts = asarFile.split("/").filter(Boolean);
  const node = getNode(meta.header, parts);
  if (typeof node.offset !== "string" || typeof node.size !== "number") {
    fail(`ASAR path is not a file: ${asarFile}`);
  }
  const fileStart = meta.headerPickleStart + meta.headerSize + Number(node.offset);
  return Buffer.from(data.subarray(fileStart, fileStart + node.size));
}

export function listAsarFiles(asarPath: string): string[] {
  const data = readFileSync(asarPath);
  const meta = readAsarHeader(data);
  const files: string[] = [];
  const walk = (node: AsarNode, prefix: string) => {
    if (node.files) {
      for (const [name, child] of Object.entries(node.files)) {
        walk(child, prefix ? `${prefix}/${name}` : name);
      }
      return;
    }
    files.push(prefix);
  };
  walk(meta.header, "");
  return files;
}

function fail(message: string): never {
  throw new Error(message);
}
