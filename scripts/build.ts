// Validates plugins/*.json and bundles/, then writes dist/index.json for p0code's Shop tab.
// Run: pnpm build (GITHUB_TOKEN raises the GitHub API rate limit).
import { copyFile, cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { compare, LIMIT, readManifestFromBundle } from "./lib.ts";

const SCHEMA_VERSION = 2;
const SHOP_BASE = "https://p0code.github.io/plugins-shop";
const OFFICIAL_OWNERS = new Set(["p0code", "jsserve-org"]);
const VERIFIED_OWNERS = new Set(["p0code"]);

interface Version {
  version: string;
  bundleUrl: string;
  sha256: string;
  apiVersion?: number;
  capabilities: string[];
  sizeBytes: number;
  publishedAt: string;
  releaseNotesUrl?: string;
}

interface Entry {
  $schema?: string;
  id: string;
  name: string;
  description: string;
  longDescription?: string;
  author: { name: string; url?: string };
  repoUrl: string;
  homepage?: string;
  license: string;
  categories: string[];
  tags?: string[];
  iconUrl?: string;
  screenshotUrls?: string[];
  latestVersion: string;
  versions: Version[];
  source: "official" | "community";
  verified: boolean;
}

const root = join(import.meta.dirname, "..");
const schemaPath = join(root, "schema/plugin.schema.json");
const errors: string[] = [];
const warn = (message: string) => console.warn(`warning: ${message}`);

const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile(JSON.parse(await readFile(schemaPath, "utf8")));

const entries: Entry[] = [];
for (const file of (await readdir(join(root, "plugins"))).filter((f) => f.endsWith(".json"))) {
  let data: unknown;
  try {
    data = JSON.parse(await readFile(join(root, "plugins", file), "utf8"));
  } catch (cause) {
    errors.push(`${file}: invalid JSON (${String(cause)})`);
    continue;
  }
  if (!validate(data)) {
    for (const e of validate.errors ?? []) errors.push(`${file}: ${e.instancePath || "/"} ${e.message}`);
    continue;
  }
  const entry = data as Entry;
  if (file !== `${entry.id}.json`) errors.push(`${file}: must be named ${entry.id}.json`);
  const owner = new URL(entry.repoUrl).pathname.split("/")[1]!;
  if (entry.source === "official" && !OFFICIAL_OWNERS.has(owner)) {
    errors.push(`${file}: source must be community for a repo owned by ${owner}`);
  }
  if (entry.verified && !VERIFIED_OWNERS.has(owner)) {
    errors.push(`${file}: verified must be false for a repo owned by ${owner}`);
  }
  if (!entry.versions.some((version) => version.version === entry.latestVersion)) {
    errors.push(`${file}: latestVersion ${entry.latestVersion} is not one of versions`);
  }
  const highest = [...entry.versions].sort((a, b) => compare(a.version, b.version)).at(-1);
  if (highest && compare(highest.version, entry.latestVersion) !== 0) {
    errors.push(`${file}: latestVersion must be ${highest.version}`);
  }
  entries.push(entry);
}

for (const problems of await Promise.all(entries.flatMap(verifyVersions))) errors.push(...problems);

if (errors.length > 0) {
  for (const e of errors) console.error(`error: ${e}`);
  process.exit(1);
}

const plugins = entries
  .map(({ $schema: _, ...entry }) => entry)
  .sort((a, b) => a.id.localeCompare(b.id));
// `generatedAt` is the newest publishedAt in the catalog, so a rebuild is byte-identical and the
// published index.json can be compared byte-for-byte against a local build.
const generatedAt = entries
  .flatMap((entry) => entry.versions.map((version) => version.publishedAt))
  .reduce((latest, at) => (at > latest ? at : latest), "");
const out = join(root, "dist");
await mkdir(out, { recursive: true });
await writeFile(
  join(out, "index.json"),
  `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, generatedAt, plugins }, null, 2)}\n`,
);
await copyFile(schemaPath, join(out, "plugin.schema.json"));
await cp(join(root, "bundles"), join(out, "bundles"), { recursive: true, force: true });
console.log(`dist/index.json: ${plugins.length} plugin(s)`);

// Each version's bundle must exist, match its checksum and size, and hold a manifest whose
// id, version and capabilities are the ones the entry promises.
async function verifyVersions(entry: Entry): Promise<string[]> {
  const problems: string[] = [];
  for (const version of entry.versions) {
    const label = `${entry.id} ${version.version}`;
    let bytes: Uint8Array;
    if (version.bundleUrl.startsWith(`${SHOP_BASE}/`)) {
      const file = join(root, decodeURIComponent(version.bundleUrl.slice(SHOP_BASE.length + 1)));
      bytes = await readFile(file).catch(() => {
        problems.push(`${label}: ${relative(root, file)} is missing`);
        return null;
      });
      if (bytes === null) continue;
    } else {
      const response = await fetch(version.bundleUrl);
      if (!response.ok) {
        problems.push(`${label}: ${version.bundleUrl} answered HTTP ${response.status}`);
        continue;
      }
      bytes = new Uint8Array(await response.arrayBuffer());
    }
    if (bytes.length > LIMIT) {
      problems.push(`${label}: bundle exceeds 32 MiB`);
      continue;
    }
    if (createHash("sha256").update(bytes).digest("hex") !== version.sha256) {
      problems.push(`${label}: sha256 does not match the bundle`);
      continue;
    }
    if (bytes.length !== version.sizeBytes) {
      problems.push(`${label}: sizeBytes is ${version.sizeBytes}, bundle is ${bytes.length}`);
      continue;
    }
    const manifest = readManifestFromBundle(bytes, version.bundleUrl);
    if (manifest === null) {
      problems.push(`${label}: bundle has no readable manifest.json`);
      continue;
    }
    if (manifest.id !== entry.id) problems.push(`${label}: manifest id is ${manifest.id}`);
    if (manifest.version !== version.version)
      problems.push(`${label}: manifest version is ${manifest.version}`);
    if (!sameSet(manifest.capabilities, version.capabilities)) {
      problems.push(`${label}: manifest capabilities are [${manifest.capabilities.join(", ")}]`);
    }
    if ((manifest.apiVersion ?? undefined) !== version.apiVersion) {
      problems.push(`${label}: apiVersion does not match the manifest`);
    }
  }
  return problems;
}

function sameSet(left: string[], right: string[]) {
  return [...left].sort().join("\n") === [...right].sort().join("\n");
}
