// Validates plugins/*.json and writes dist/index.json for p0code's Shop tab.
// Run: pnpm build (GITHUB_TOKEN raises the GitHub API rate limit).
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const SCHEMA_VERSION = 1;
const OFFICIAL_OWNERS = new Set(["p0code", "jsserve-org"]);

interface Entry {
  $schema?: string;
  id: string;
  repository: string;
  path?: string;
  ref: string;
  version: string;
  capabilities: string[];
  externalServices: string[];
  official: boolean;
  [key: string]: unknown;
}

interface Manifest {
  id: string;
  version: string;
  capabilities: string[];
  externalServices: string[];
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
  const owner = new URL(entry.repository).pathname.split("/")[1]!;
  if (entry.official !== OFFICIAL_OWNERS.has(owner)) {
    errors.push(`${file}: official must be ${!entry.official} for a repo owned by ${owner}`);
  }
  entries.push(entry);
}

for (const problems of await Promise.all(entries.map(verifyRemote))) errors.push(...problems);

if (errors.length > 0) {
  for (const e of errors) console.error(`error: ${e}`);
  process.exit(1);
}

const plugins = entries
  .map(({ $schema: _, ...entry }) => entry)
  .sort((a, b) => a.id.localeCompare(b.id));
const out = join(root, "dist");
await mkdir(out, { recursive: true });
await writeFile(
  join(out, "index.json"),
  `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, generatedAt: new Date().toISOString(), plugins }, null, 2)}\n`,
);
await copyFile(schemaPath, join(out, "plugin.schema.json"));
console.log(`dist/index.json: ${plugins.length} plugin(s)`);

// The pinned ref must exist and the manifest there must match the entry.
// An unreachable repo only warns, so an outage does not block the catalog.
async function verifyRemote(entry: Entry): Promise<string[]> {
  const [owner, repo] = new URL(entry.repository).pathname.slice(1).split("/");
  const base = `/repos/${owner}/${repo}`;
  const repoResponse = await github(base).catch(() => null);
  if (!repoResponse?.ok) {
    warn(`${entry.id}: ${entry.repository} not reachable, skipped ref and manifest checks`);
    return [];
  }

  const isSha = /^[0-9a-f]{40}$/.test(entry.ref);
  const refResponse = await github(
    isSha ? `${base}/commits/${entry.ref}` : `${base}/git/ref/tags/${entry.ref}`,
  );
  if (!refResponse.ok) return [`${entry.id}: ref ${entry.ref} is not a commit SHA or tag in ${entry.repository}`];

  const read = async (file: string) => {
    const response = await github(`${base}/contents/${file}?ref=${encodeURIComponent(entry.ref)}`, "raw");
    return response.ok ? response.text() : null;
  };
  const dir = entry.path ?? "";
  const pkg = await read(posix.join(dir, "package.json"));
  if (pkg === null) return [`${entry.id}: no package.json at ${dir || "repo root"} at ${entry.ref}`];
  const entryFile = posix.join(dir, packageEntry(JSON.parse(pkg)));
  const source = await read(entryFile);
  if (source === null) return [`${entry.id}: ${entryFile} missing at ${entry.ref}`];

  const constants = new Map<string, string>();
  const sources = [source];
  for (const [, spec] of source.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)) {
    const imported = await read(posix.join(posix.dirname(entryFile), spec!));
    if (imported !== null) sources.push(imported);
  }
  for (const text of sources) {
    for (const [, name, value] of text.matchAll(/(?:^|\n)\s*(?:export\s+)?const\s+([\w$]+)\s*=\s*["']([^"']*)["']/g)) {
      constants.set(name!, value!);
    }
  }

  const manifest = readManifest(source, constants);
  if (manifest === null) return [`${entry.id}: no statically readable manifest in ${entryFile} at ${entry.ref}`];

  const problems: string[] = [];
  const same = (a: string[], b: string[]) => [...a].sort().join("\n") === [...b].sort().join("\n");
  if (manifest.id !== entry.id) problems.push(`id is ${manifest.id} in the manifest`);
  if (manifest.version !== entry.version) problems.push(`version is ${manifest.version} in the manifest`);
  if (!same(manifest.capabilities, entry.capabilities)) {
    problems.push(`capabilities are [${manifest.capabilities.join(", ")}] in the manifest`);
  }
  if (!same(manifest.externalServices, entry.externalServices)) {
    problems.push(`externalServices are [${manifest.externalServices.join(", ")}] in the manifest`);
  }
  return problems.map((p) => `${entry.id}: ${p} at ${entry.ref}`);
}

function github(path: string, accept: "json" | "raw" = "json"): Promise<Response> {
  const token = process.env.GITHUB_TOKEN;
  return fetch(`https://api.github.com${path}`, {
    headers: {
      accept: accept === "raw" ? "application/vnd.github.raw" : "application/vnd.github+json",
      "user-agent": "p0code-plugins-shop",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
}

function packageEntry(pkg: { exports?: unknown; main?: unknown }): string {
  const dot = typeof pkg.exports === "object" && pkg.exports !== null
    ? (pkg.exports as Record<string, unknown>)["."]
    : pkg.exports;
  if (typeof dot === "string") return dot;
  if (typeof dot === "object" && dot !== null) {
    const target = (dot as Record<string, unknown>).import ?? (dot as Record<string, unknown>).default;
    if (typeof target === "string") return target;
  }
  return typeof pkg.main === "string" ? pkg.main : "src/index.ts";
}

// Reads `manifest: { ... }` from source without running it. Values must be literals,
// except the id, which may name a string constant.
function readManifest(source: string, constants: Map<string, string>): Manifest | null {
  const start = source.search(/\bmanifest\s*:\s*\{/);
  if (start === -1) return null;
  let depth = 0;
  let block = "";
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}" && --depth === 0) {
      block = source.slice(start, i + 1);
      break;
    }
  }
  const scalar = (key: string) => {
    const m = block.match(new RegExp(`\\b${key}\\s*:\\s*(?:"([^"]*)"|'([^']*)'|([\\w$]+))`));
    return m ? (m[1] ?? m[2] ?? constants.get(m[3]!) ?? null) : null;
  };
  const list = (key: string) => {
    const m = block.match(new RegExp(`\\b${key}\\s*:\\s*\\[([^\\]]*)\\]`));
    if (!m) return null;
    const literals = /"([^"]*)"|'([^']*)'/g;
    if (m[1]!.replace(literals, "").replace(/\/\/.*$/gm, "").replace(/[\s,]/g, "") !== "") return null;
    return [...m[1]!.matchAll(literals)].map((x) => (x[1] ?? x[2])!);
  };
  const id = scalar("id");
  const version = scalar("version");
  const capabilities = list("capabilities");
  const externalServices = list("externalServices");
  if (id === null || version === null || capabilities === null || externalServices === null) return null;
  return { id, version, capabilities, externalServices };
}
