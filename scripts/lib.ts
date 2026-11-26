// Shared by build.ts and publish.ts: version order and manifest extraction from a bundle.
import { inflateRawSync, gunzipSync } from "node:zlib";

export const LIMIT = 32 * 1024 * 1024;

export interface Manifest {
  id: string;
  name?: string;
  description?: string;
  version: string;
  capabilities: string[];
  apiVersion?: number;
}

export function compare(left: string, right: string) {
  const parse = (value: string) => {
    const [main = "", ...pre] = value.replace(/^v/, "").split("-");
    return {
      numbers: main.split(".").map((part) => {
        const number = Number.parseInt(part, 10);
        return Number.isSafeInteger(number) ? number : 0;
      }),
      prerelease: pre.flatMap((part) => part.split(".")),
    };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.numbers.length, b.numbers.length); index++) {
    const difference = (a.numbers[index] ?? 0) - (b.numbers[index] ?? 0);
    if (difference !== 0) return difference;
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
    const one = a.prerelease[index];
    const two = b.prerelease[index];
    if (one === undefined) return -1;
    if (two === undefined) return 1;
    const numericOne = Number(one);
    const numericTwo = Number(two);
    if (Number.isSafeInteger(numericOne) && Number.isSafeInteger(numericTwo)) {
      if (numericOne !== numericTwo) return numericOne - numericTwo;
    } else if (one !== two) return one < two ? -1 : 1;
  }
  return 0;
}

export function readManifestFromBundle(bytes: Uint8Array, name: string): Manifest | null {
  const files = name.endsWith(".tgz") || name.endsWith(".tar.gz") ? tarFiles(bytes) : zipFiles(bytes);
  const file = files.get("manifest.json");
  if (!file) return null;
  const value: unknown = JSON.parse(file.toString("utf8"));
  if (typeof value !== "object" || value === null) return null;
  const manifest = value as Partial<Manifest>;
  if (
    typeof manifest.id !== "string" ||
    typeof manifest.version !== "string" ||
    !Array.isArray(manifest.capabilities)
  )
    return null;
  return {
    id: manifest.id,
    ...(typeof manifest.name === "string" ? { name: manifest.name } : {}),
    ...(typeof manifest.description === "string" ? { description: manifest.description } : {}),
    version: manifest.version,
    capabilities: manifest.capabilities,
    ...(typeof manifest.apiVersion === "number" ? { apiVersion: manifest.apiVersion } : {}),
    ...(typeof manifest.unofficial === "boolean" ? { unofficial: manifest.unofficial } : {}),
  } as Manifest;
}

function tarFiles(bytes: Uint8Array): Map<string, Buffer> {
  const tar = gunzipSync(bytes, { maxOutputLength: LIMIT });
  const files = new Map<string, Buffer>();
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) break;
    const path = header.subarray(0, 100).toString().split("\0")[0]!;
    const prefix = header.subarray(345, 500).toString().split("\0")[0]!;
    const size = Number.parseInt(header.subarray(124, 136).toString().replace(/\0/g, "").trim(), 8);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length)
      throw new Error("invalid tar");
    if ((header[156] === 0 || header[156] === 48) && (prefix || path).endsWith("manifest.json")) {
      files.set("manifest.json", tar.subarray(offset + 512, offset + 512 + size));
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

/** Reads only manifest.json from a zip, via its central directory. */
function zipFiles(bytes: Uint8Array): Map<string, Buffer> {
  const buffer = Buffer.from(bytes);
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error("invalid zip");
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let index = 0; index < count; index++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("invalid zip directory");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (name.endsWith("manifest.json")) {
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const data = buffer.subarray(start, start + compressedSize);
      files.set("manifest.json", method === 0 ? data : inflateRawSync(data));
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}
