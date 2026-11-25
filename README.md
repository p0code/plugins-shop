# p0code plugin shop

The catalog behind the **Shop** tab on p0code's Plugins settings page. Each plugin lives in its own
GitHub repo; this repo only lists them, pinned to a reviewed ref. p0code reads one file:

```
https://p0code.github.io/plugins-shop/index.json
```

> **Plugins run with full access to your machine.** They run inside the p0code server process, with
> the same rights as your user account: your files, your network, your credentials. Capabilities
> are declarations shown before you enable a plugin, and only some are enforced by the host. Install
> only plugins whose code you trust, Official or not.

## Official and Community

A plugin is **Official** (`"official": true`) only when its repo is owned by the
[`p0code`](https://github.com/p0code) or [`jsserve-org`](https://github.com/jsserve-org) GitHub
orgs. Every other plugin is **Community**. The build rejects an entry whose flag does not match the
repo owner, so the badge cannot be claimed.

## List a plugin

Open a PR that adds `plugins/<id>.json`, where `<id>` is your manifest's `id`:

```json
{
  "$schema": "../schema/plugin.schema.json",
  "id": "my-plugin",
  "name": "My plugin",
  "description": "One or two sentences shown in the Shop.",
  "author": { "name": "you", "url": "https://github.com/you" },
  "repository": "https://github.com/you/my-plugin",
  "ref": "0123456789abcdef0123456789abcdef01234567",
  "version": "0.1.0",
  "capabilities": ["network:outbound", "usage:read"],
  "externalServices": ["api.example.com"],
  "license": "MIT",
  "official": false,
  "homepage": "https://example.com",
  "icon": "https://example.com/icon.png",
  "screenshots": ["https://example.com/shot.png"]
}
```

- `ref` is a full commit SHA (preferred) or a tag; branches are refused. To ship an update, open a PR
  that bumps `ref` and `version`.
- `version`, `capabilities` and `externalServices` are copied from your manifest at `ref`.
- `capabilities` accepts the app's full set: `network:outbound`, `process:spawn`, `http:routes`,
  `auth:issue-device-credentials`, `orchestration:read-activity`, `usage:read`,
  `agent:instructions`, and `data:backup` (allowed ahead of its host API). Unknown capabilities are
  rejected.
- `path` is the folder holding the plugin's `package.json`, if it is not the repo root.
- `license` is an SPDX expression, or `NOASSERTION` when the repo has none.
- `homepage`, `icon` and `screenshots` are optional `https://` URLs.

The full rules are in [`schema/plugin.schema.json`](schema/plugin.schema.json).

### What the build checks

`pnpm build` validates every entry against the schema, then, for each repo it can reach on GitHub:

- `ref` exists as a commit or tag;
- the `package.json` entry (`exports["."]`, else `main`, else `src/index.ts`) contains a
  `definePlugin({ manifest: { ... } })` whose `id`, `version`, `capabilities` and `externalServices`
  match the entry.

The manifest is read without running your code, so keep those four fields as literals (the `id` may
be a string constant from a relative import). An unreachable repo is skipped with a warning.

Run it locally:

```sh
pnpm install
GITHUB_TOKEN=$(gh auth token) pnpm build   # writes dist/index.json
```

PRs are checked by GitHub Actions; merging to `main` publishes `dist/` to GitHub Pages.

## index.json

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-11-25T00:00:00.000Z",
  "plugins": [ /* entries as above, without $schema, sorted by id */ ]
}
```

`schemaVersion` changes only when an existing field changes meaning or is removed; new optional
fields may appear without a bump. The entry schema is also served at
`https://p0code.github.io/plugins-shop/plugin.schema.json`.

## License

MIT. See [LICENSE](LICENSE).
