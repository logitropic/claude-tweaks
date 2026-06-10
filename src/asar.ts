import { readFileSync } from "node:fs";
import { refreshIntegrity, sha256 } from "./patch-utils.ts";

export type AsarNode = {
  files?: Record<string, AsarNode>;
  size?: number;
  offset?: string;
  unpacked?: boolean;
  executable?: boolean;
  link?: string;
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

export function repackAsarFile(data: Buffer, asarFile: string, nextContent: Buffer) {
  const meta = readAsarHeader(data);
  const targetParts = asarFile.split("/").filter(Boolean);
  const targetNode = getNode(meta.header, targetParts);
  if (typeof targetNode.offset !== "string" || typeof targetNode.size !== "number" || !targetNode.integrity) {
    fail(`ASAR path is not a packed file with integrity: ${asarFile}`);
  }

  const originalPayloadStart = meta.headerPickleStart + meta.headerSize;
  const payloadChunks: Buffer[] = [];
  let offset = 0;

  for (const { path, node } of packedFiles(meta.header)) {
    if (typeof node.offset !== "string" || typeof node.size !== "number") {
      fail(`ASAR packed file is missing offset or size: ${path}`);
    }
    const content =
      path === asarFile
        ? nextContent
        : Buffer.from(data.subarray(originalPayloadStart + Number(node.offset), originalPayloadStart + Number(node.offset) + node.size));
    node.offset = String(offset);
    node.size = content.length;
    if (node.integrity) refreshIntegrity(node, content);
    payloadChunks.push(content);
    offset += content.length;
  }

  const headerJson = Buffer.from(JSON.stringify(meta.header));
  const headerPadding = Buffer.alloc((4 - ((8 + headerJson.length) % 4)) % 4);
  const headerSize = 8 + headerJson.length + headerPadding.length;
  const header = Buffer.alloc(8 + headerSize);
  header.writeUInt32LE(4, 0);
  header.writeUInt32LE(headerSize, 4);
  header.writeUInt32LE(headerSize - 4, 8);
  header.writeUInt32LE(headerJson.length, 12);
  headerJson.copy(header, 16);
  headerPadding.copy(header, 16 + headerJson.length);

  return {
    data: Buffer.concat([header, ...payloadChunks]),
    headerHash: sha256(headerJson),
  };
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

function packedFiles(root: AsarNode): Array<{ path: string; node: AsarNode }> {
  const files: Array<{ path: string; node: AsarNode }> = [];
  const walk = (node: AsarNode, prefix: string) => {
    if (node.files) {
      for (const [name, child] of Object.entries(node.files)) {
        walk(child, prefix ? `${prefix}/${name}` : name);
      }
      return;
    }
    if (typeof node.offset === "string") files.push({ path: prefix, node });
  };
  walk(root, "");
  return files;
}

function fail(message: string): never {
  throw new Error(message);
}
