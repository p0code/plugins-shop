# Contributing

This repo is the plugin catalog behind the **Shop** tab in p0code. It only lists plugins and pins
them to a reviewed ref; the plugin code lives in each plugin's own repo.

Adding a plugin or fixing an entry is a normal PR here. Contributions are welcome, but I'm one busy
person, so reviews and replies can take a while — please be patient and don't ping repeatedly. A
single bump after a couple of weeks is fine.

## Setup

```sh
pnpm install
GITHUB_TOKEN=$(gh auth token) pnpm build   # writes dist/index.json
```

`pnpm build` is the check here: it validates every entry against `schema/plugin.schema.json`, checks
the pinned refs and enforces the Official flag. PRs are also checked by GitHub Actions.

## What makes a PR easy to land

- One plugin or one fix per PR.
- Keep entries sorted by id, and keep `schemaVersion` alone unless a field actually changes meaning.
- Conventional-commit-ish messages (`feat: ...`, `fix: ...`, `docs: ...`).
- No drive-by refactors or reformatting.

## License

MIT. By contributing you agree that your work is released under the MIT license. See
[LICENSE](LICENSE).
