# p0code plugin shop

The catalog behind the **Shop** tab on p0code's Plugins settings page. Each plugin lives in its own
GitHub repo; this repo lists installable releases, pinned by SHA-256. p0code reads one file:

```
https://p0code.github.io/plugins-shop/index.json
```

> **Plugins run with full access to your machine.** They run inside the p0code server process, with
> the same rights as your user account: your files, your network, your credentials. Capabilities
> are declarations shown before you enable a plugin, and only some are enforced by the host. Install
> only plugins whose code you trust, Official or not.

## What the host does with an entry

Catalog entries are metadata. Before any plugin code runs, p0code downloads the bundle, checks its
SHA-256 against `sha256`, reads `manifest.json` and refuses a bundle whose id, version, capabilities
or `apiVersion` differ from the entry, then asks you to consent to every declared capability. An
entry's version list is also filtered by `apiVersion`, so an old p0code never installs a release it
cannot run.

`verified` means the repo is owned by [`p0code`](https://github.com/p0code). It is a publisher
badge, not a security audit. `source` is `official` for `p0code` and `jsserve-org` repos and
`community` for everything else. The build rejects an entry that claims either badge without the
matching owner.

## Entry format

`plugins/<id>.json` follows [`schema/plugin.schema.json`](schema/plugin.schema.json):

```json
{
  "$schema": "../schema/plugin.schema.json",
  "id": "sleep-guard",
  "name": "Sleep Guard",
  "description": "One or two sentences shown on the card.",
  "longDescription": "A paragraph shown on the detail page.",
  "author": { "name": "you", "url": "https://github.com/you" },
  "repoUrl": "https://github.com/you/sleep-guard",
  "homepage": "https://github.com/you/sleep-guard",
  "license": "MIT",
  "categories": ["host"],
  "tags": ["power"],
  "iconUrl": "https://example.com/icon.png",
  "screenshotUrls": ["https://example.com/shot.png"],
  "latestVersion": "0.1.0",
  "versions": [
    {
      "version": "0.1.0",
      "bundleUrl": "https://p0code.github.io/plugins-shop/bundles/sleep-guard-0.1.0.tgz",
      "sha256": "0123...cdef",
      "capabilities": ["network:outbound"],
      "sizeBytes": 12345,
      "publishedAt": "2026-11-27T00:00:00.000Z"
    }
  ],
  "source": "community",
  "verified": false
}
```

- `versions` is append-only; `latestVersion` must be the newest one.
- `bundleUrl` is an HTTPS `.tgz` or `.zip` whose root (or `dist/`) holds `manifest.json` and
  `plugin.mjs`. It can be a GitHub release asset or a file in this repo's `bundles/` folder.
- `sha256` covers the bundle bytes. `sizeBytes` must match too.
- `capabilities` must equal the manifest's capabilities; `apiVersion`, when present, must equal the
  manifest's. The build reads both out of the bundle and refuses a mismatch.

## Publishing a release

Build the plugin the way the p0code installer expects (`manifest.json` + `plugin.mjs`, zipped as
`.tgz` or `.zip`), then add it:

```sh
pnpm install
node scripts/publish.ts \
  --bundle ./sleep-guard-0.1.0.tgz \
  --repo https://github.com/p0code/sleep-guard \
  --license MIT \
  --categories host,power \
  --long-description "Keeps the p0code server awake while agents work."
pnpm build   # validates bundles, checksums and manifests; writes dist/index.json
```

`publish.ts` reads the manifest inside the bundle, computes the checksum and size, copies a local
bundle to `bundles/<id>-<version>.tgz` and updates (or creates) `plugins/<id>.json`. Pass a release
asset URL instead of a path to leave the file on the plugin repo:

```sh
node scripts/publish.ts --bundle https://github.com/you/plugin/releases/download/v1.2.0/plugin.tgz \
  --repo https://github.com/you/plugin --license MIT --categories community
```

The build fetches remote bundles and reruns the same checks. PRs are checked by GitHub Actions;
merging to `main` publishes `dist/` (including `bundles/`) to GitHub Pages.

## Current entries

`backup`, `obsidian-shared-memory` and `t3-connect-bridge` have prebuilt bundles in `bundles/`;
`tokscale-auto-publish`, `sleep-guard`, `vercel` and `cloudflare` point at GitHub release assets.
Add a new release with `publish.ts` and `pnpm build` once its bundle is built.

## index.json

```json
{
  "schemaVersion": 2,
  "generatedAt": "2026-11-27T00:00:00.000Z",
  "plugins": [ /* entries as above, without $schema, sorted by id */ ]
}
```

`schemaVersion` changes only when an existing field changes meaning or is removed. The entry schema
is also served at `https://p0code.github.io/plugins-shop/plugin.schema.json`.
