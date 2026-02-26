---
name: release
description: Prepare a release — bump version, update changelog, build, test, and tag. Does NOT publish automatically.
argument-hint: "<patch|minor|major>"
disable-model-invocation: true
allowed-tools: Bash(pnpm *), Bash(git *), Read, Edit
model: sonnet
---

## Release A-Eyes

Prepare a new release. This skill is user-invocable only (safety).

### Steps

1. Verify clean working tree:
   ```bash
   git status --porcelain
   ```
   If dirty, stop and report.

2. Run full quality checks:
   ```bash
   pnpm lint
   pnpm test
   pnpm build
   ```
   If any fail, stop and report.

3. Bump version based on `$ARGUMENTS` (patch/minor/major):
   ```bash
   pnpm version $ARGUMENTS --no-git-tag-version
   ```

4. Read the new version from package.json.

5. Update `docs/CHANGELOG.md`:
   - Rename `[Unreleased]` section to `[<version>] - <YYYY-MM-DD>`
   - Add a new empty `[Unreleased]` section above it
   - Add comparison link at bottom: `[<version>]: https://github.com/<owner>/<repo>/compare/v<prev>...v<version>`

6. Stage and commit:
   ```bash
   git add package.json pnpm-lock.yaml docs/CHANGELOG.md
   git commit -m "Release v<version>"
   git tag "v<version>"
   ```

7. Report the release summary but do NOT push or publish. Tell the user to run:
   ```bash
   git push && git push --tags
   pnpm publish  # if applicable
   ```
