# acp-tui

A full-screen terminal client for the Agent Client Protocol (ACP), in TypeScript on Bun, built on OpenTUI (pinned exactly) with Solid. It runs in IDE integrated terminals (PhpStorm, IntelliJ IDEA, Zed) and ordinary terminals, against any ACP agent ("harness"): Auggie and Claude Code are built in.

## Workspace

A Bun workspace with three packages:

- `packages/acp-tui`: the client. `src/cli.ts` and `src/agent/` (command line, harness table, launch), `src/session/`, `src/conversation/` (the windowed list and the Markdown renderers), `src/renderer/`, `src/layout/`, `src/config/` (schema, loader, store, watcher, subcommands), `src/keys/`, `assets/grammars/` (bundled tree-sitter grammars), `scripts/` (generators, `install-cli`, `update`), `test/`.
- `packages/acp-model`: the renderer-independent session model, the ACP update reducer and the sanitiser for all agent text.
- `packages/fake-agent`: a scriptable ACP agent for tests, including hostile-output fixtures.

## Commands

- `bun install`; `bun run install-cli` installs the `acp-tui` command (Windows: [docs/install-windows.md](docs/install-windows.md)).
- `bun run test`: a parallel pass, then the `*.timing.test.ts` files serially. Do not run it on macOS (some tests reach the real pasteboard). Narrow with a path or `-t`.
- `bun run typecheck`; `bun run update` pulls and installs; `bun run test:windows` runs the suite on GitHub's Windows runner for the pushed branch.
- Configuration is documented in [docs/configuration.md](docs/configuration.md); its JSONC examples are checked by a test, so keep them valid. The setting tables come from `packages/acp-tui/src/config/schema.ts`.

## Conventions

- All agent and daemon text is sanitised before it is rendered; escape output (OSC 52, titles) comes only from acp-tui itself.
- Tests touch no real configuration (the preload points `XDG_CONFIG_HOME` and `XDG_STATE_HOME` at a temporary directory) and no live daemon.
- Timing assertions go in `*.timing.test.ts`; waits end on the outcome, never on a quiet screen.
- Pin dependencies exactly. Apache-2.0.
- British English; no em or en dashes in code, comments, messages or docs.
- Commit messages describe the change in plain terms.

See [CONTRIBUTING.md](CONTRIBUTING.md) for how changes come in.
