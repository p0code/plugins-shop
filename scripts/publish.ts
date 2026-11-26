// Adds or updates one release in plugins/<id>.json from a bundle.
//
//   node scripts/publish.ts --bundle ./backup-0.1.0.tgz \
//     --repo https://github.com/p0code/backup --license MIT --categories host
//
// A local bundle is copied to bundles/<id>-<version>.tgz and served from GitHub Pages; a
// release asset URL is recorded as-is. Either way the manifest inside the bundle is the
// source of truth for the id, version and capabilities. Run `pnpm build` afterwards.
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, basename } from "node:path";
import { parseArgs } from "node:util";
import { compare, readManifestFromBundle } from "./lib.ts";

const SHOP_BASE = "https://p0code.github.io/plugins-shop";

const { values } = parseArgs({
  options: {
    bundle: { type: "string" },
    repo: { type: "string" },
    license: { type: "string" },
    categories: { type: "string", default: "community" },
    tags: { type: "string", default: "" },
    "long-description": { type: "string" },
    homepage: { type: "string" },
    icon: { type: "string" },
    notes: { type: "string" },
    name: { type: "string" },
    "author-name": { type: "string", default: "p0code" },
    "author-url": { type: "string", default: "https://github.com/p0code" },
  },
});
if (!values.bundle) {
  console.error(
    "usage: node scripts/publish.ts --bundle <path|https url> --repo <github url> --license <spdx> [--categories a,b]",
  );
  process.exit(1);
}

const shopRoot = join(import.meta.dirname, "..");
const bundle = /^https:\/\//.test(values.bundle)
  ? new Uint8Array(await (await fetch(values.bundle)).arrayBuffer())
  : new Uint8Array(await readFile(values.bundle));
const manifest = readManifestFromBundle(
  bundle,
  /^https:\/\//.test(values.bundle) ? new URL(values.bundle).pathname : values.bundle,
);
if (!manifest) {
  console.error("error: the bundle has no readable manifest.json. Build a .tgz or .zip first.");
  process.exit(1);
}
const sha256 = createHash("sha256").update(bundle).digest("hex");
const id = manifest.id;
const entryPath = join(shopRoot, "plugins", `${id}.json`);

let entry: Record<string, unknown> | null = null;
try {
  entry = JSON.parse(await readFile(entryPath, "utf8")) as Record<string, unknown>;
} catch {
  entry = null;
}

if (entry === null) {
  if (!values.repo || !values.license) {
    console.error("error: a new entry needs --repo and --license.");
    process.exit(1);
  }
  const owner = new URL(values.repo).pathname.split("/")[1] ?? "";
  const official = ["p0code", "jsserve-org"].includes(owner);
  entry = {
    $schema: "../schema/plugin.schema.json",
    id,
    name: values.name ?? manifest.name ?? id,
    description: manifest.description ?? manifest.name ?? id,
    author: {
      name: values["author-name"],
      ...(values["author-url"] ? { url: values["author-url"] } : {}),
    },
    repoUrl: values.repo,
    license: values.license,
    categories: values.categories!.split(",").filter(Boolean),
    tags: values.tags!.split(",").filter(Boolean),
    latestVersion: manifest.version,
    versions: [],
    source: official ? "official" : "community",
    verified: owner === "p0code",
  };
} else {
  entry.id = id;
  if (values.name) entry.name = values.name;
}

let bundleUrl: string;
if (/^https:\/\//.test(values.bundle)) {
  bundleUrl = values.bundle;
} else {
  const file = `${id}-${manifest.version}.tgz`;
  await mkdir(join(shopRoot, "bundles"), { recursive: true });
  await copyFile(values.bundle, join(shopRoot, "bundles", file));
  bundleUrl = `${SHOP_BASE}/bundles/${file}`;
  console.log(`bundles/${file}`);
}

const versions = Array.isArray(entry.versions) ? (entry.versions as Array<Record<string, unknown>>) : [];
const version = {
  version: manifest.version,
  bundleUrl,
  sha256,
  ...(manifest.apiVersion === undefined ? {} : { apiVersion: manifest.apiVersion }),
  capabilities: manifest.capabilities,
  sizeBytes: bundle.length,
  publishedAt: new Date().toISOString(),
  ...(values.notes ? { releaseNotesUrl: values.notes } : {}),
};
entry.versions = [...versions.filter((item) => item.version !== version.version), version].sort(
  (a, b) => compare(String(a.version), String(b.version)),
);
entry.latestVersion = (entry.versions as Array<{ version: string }>).at(-1)!.version;
if (values["long-description"]) entry.longDescription = values["long-description"];
if (values.homepage) entry.homepage = values.homepage;
if (values.icon) entry.iconUrl = values.icon;

await mkdir(dirname(entryPath), { recursive: true });
await writeFile(entryPath, `${JSON.stringify(entry, null, 2)}\n`);
console.log(`plugins/${id}.json: ${manifest.version} (${basename(values.bundle)})`);
console.log("run `pnpm build` to validate and publish the catalog");
