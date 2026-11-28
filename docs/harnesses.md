# Harness notes

acp-tui works the same way with every ACP harness. This page collects what is particular to some of them. Every harness needs an entry under `agent_servers` in your configuration file; `bun run install-cli --harness <name>` writes it for you in a new file, and [configuration.md](configuration.md#harnesses) lists every example with its command and source.

"Checked" below means run for real with acp-tui, logged in, at the versions named. A harness that is not yet checked may well work: please report what you find.

## Claude Code

Checked with `claude-agent-acp` 0.94.0, the version the `claude` entry pins.

- The entry runs the adapter through `bunx`, which comes with Bun and downloads it on first use; that is why its start-up timeout is 120 seconds.
- It uses your Claude Code login, so install Claude Code and sign in once before you start it.
- While it runs, the terminal tab reads `claude` rather than the directory's name: Claude Code names the tab itself.
- To choose the model, add `"env": { "ANTHROPIC_MODEL": "opus" }` to the entry.

## Codex

Not yet checked. The `codex` entry runs `codex-acp` (`npm install -g @agentclientprotocol/codex-acp`).

## OpenCode

Checked with OpenCode 1.19 and 2.1. Install it with `npm install -g @opencode/cli` (or see opencode.ai/docs) and log in once with `opencode auth login`. The entry runs `opencode acp`: without `acp` OpenCode starts its own terminal interface, which acp-tui recognises and stops.

## Auggie

Checked with Auggie 1.2.x and 0.37.x.

- Install 1.x with `npm install -g @augmentcode/auggie` (Node 20.6 or later) and log in with `auggie auth login`. To stay on 0.x, install `@augmentcode/auggie@v0-release` and log in with `auggie login`. The one `auggie` entry runs either: acp-tui recognises the generation when Auggie starts, and names the right login command if you are not logged in.
- `npm install -g` may print a warning that `node-pty`'s install script was not run. It is harmless for acp-tui.
- The first time Auggie 1.x sees a directory it asks whether it may index it: answer in the question card. Your home directory is never indexed.
- Auggie 1.x asks for no permission unless it is given rules; [configuration.md](configuration.md#harnesses) says how to be asked before it runs commands or changes files.

## Gemini CLI

Not yet checked. The `gemini` entry runs `gemini --acp` (`--experimental-acp` is the older, deprecated name). Install it with `npm install -g @google/gemini-cli` (Node 20 or later) and run `gemini` once to sign in. Since 18 June 2026 Gemini CLI serves Gemini Code Assist enterprise accounts only; free and Google One accounts moved to Antigravity CLI.
