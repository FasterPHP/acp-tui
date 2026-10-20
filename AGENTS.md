# acp-tui

A full-screen terminal client for the Agent Client Protocol (ACP). A Bun workspace in TypeScript: `packages/acp-tui` (the client), `packages/acp-model` (the session model and sanitiser) and `packages/fake-agent` (a scriptable ACP agent for the tests).

- Install: `bun install`, then `bun run install-cli` for the `acp-tui` command (on Windows: [docs/install-windows.md](docs/install-windows.md)).
- Tests: `bun run test` (a parallel pass, then the timing tests serially); `bun run typecheck`.
- Configuration: [docs/configuration.md](docs/configuration.md).
- British English, no em or en dashes; dependencies pinned exactly; Apache-2.0.
