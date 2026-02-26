# Versioning

A-Eyes follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Version Format

```
MAJOR.MINOR.PATCH
```

- **MAJOR** — Breaking changes to MCP tool interface (renamed tools, changed parameters)
- **MINOR** — New MCP tools or features (new capture options, new tools like `list_windows`)
- **PATCH** — Bug fixes, performance improvements, internal refactors

## Pre-1.0 Convention

While in `0.x.y`:
- `0.MINOR.0` — New features, may include breaking changes
- `0.x.PATCH` — Bug fixes only

## Release Process

1. Use `/release <patch|minor|major>` skill
2. Skill bumps `package.json`, updates `docs/CHANGELOG.md`, creates git tag
3. Manual push + publish after review

## Changelog Rules

Every PR/commit should include a changelog entry under `[Unreleased]` in one of these categories:

- **Added** — New features
- **Changed** — Changes to existing features
- **Deprecated** — Features that will be removed
- **Removed** — Removed features
- **Fixed** — Bug fixes
- **Security** — Vulnerability fixes
