# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Project scaffolding: CLAUDE.md, agents, skills, docs structure
- 5 custom agents: architect, coder, reviewer, tester, security
- 6 skills: /build, /test, /lint, /mcp-test, /release, /backlog
- Project settings with permission allowlist/denylist
- Central documentation in `docs/`: CHANGELOG, VERSIONING, ARCHITECTURE
- Architecture Decision Records (ADR-001 through ADR-003)
- Backlog management via GitHub Issues (/backlog skill)

### Changed
- Toolchain switched to pnpm + Biome + Vitest + Zod (from npm + ESLint + Prettier)
