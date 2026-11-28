# acp-tui

A terminal client for the [Agent Client Protocol](https://agentclientprotocol.com) (ACP) that works with any ACP agent: Claude Code, Codex, OpenCode, Auggie, Gemini CLI and others. acp-tui calls the agent program it launches a harness, and gives every harness the same interface, so changing harness changes nothing else.

It is designed for minimal distraction and built to be pleasant to live in inside the integrated terminals of PhpStorm, IntelliJ IDEA and Zed (it also runs in any modern terminal). It fills the terminal pane while it runs, like an editor, and leaves the pane as it was when you exit.

By default the conversation shows the agent's answers, with tool calls, thoughts and plans folded into one-line summaries you can open. It is fully configurable: themes, glyphs, keys, the layout and the status row, from a configuration file with live reload.

It gives you a conversation that stays fast over thousands of items, rendered Markdown with highlighted code, tool cards and permission prompts you cannot mistake for agent text, find, selection and copy, a session list with resume, a command palette, and themes that follow your terminal's colours.

<!-- Screenshots go here. -->

**Status:** an early release, used every day and still changing; please report what you find (see [Feedback](#feedback)).

## Requirements

- git
- [Bun](https://bun.sh) 1.3.14 or later
- One harness (below). Most are npm packages, which need Node.js.

## Install on Linux and macOS

Install your harness and log in to it first:

| Harness | Install | Name to pass | Checked |
| --- | --- | --- | --- |
| Claude Code | [Claude Code](https://code.claude.com/docs), logged in; acp-tui runs the `claude-agent-acp` adapter through `bunx` | `claude` | yes (adapter 0.94.0) |
| Codex | `npm install -g @agentclientprotocol/codex-acp` | `codex` | not yet |
| OpenCode | `npm install -g @opencode/cli`, then `opencode auth login` | `opencode` | yes (1.19 and 2.1) |
| Auggie | `npm install -g @augmentcode/auggie` (Node 20.6 or later), then `auggie auth login` | `auggie` | yes (1.2 and 0.37) |
| Gemini CLI | `npm install -g @google/gemini-cli`, then run `gemini` once to sign in | `gemini` | not yet |

Then install acp-tui, naming your harness:

```sh
git clone https://github.com/FasterPHP/acp-tui.git
cd acp-tui
bun install
bun run install-cli --harness claude
```

`bun run install-cli` writes a small `acp-tui` command into `~/.local/bin` that runs this checkout, and creates `~/.config/acp-tui/config.jsonc` with every setting at its default and the harness you named in effect. Name several to have them all, with the first as the default (`--harness claude,codex`), or choose the default with `--default <name>`. Without `--harness` the file has `auggie`. If a configuration file already exists it is never replaced: install-cli says what to add to it instead.

If it warns that `~/.local/bin` is not on your `PATH`, add it in your shell's start-up file:

```sh
export PATH="$HOME/.local/bin:$PATH"
```

You can also run the checkout without installing it, as `bun packages/acp-tui/src/cli.ts`: with no configuration file acp-tui behaves as if it held the default, so it starts Auggie.

Anything that speaks ACP can be a harness: the configuration file lists more examples (Copilot, Cursor, Goose, Qwen Code, pi), each one uncommented line away. [docs/harnesses.md](docs/harnesses.md) has notes on particular harnesses.

## Install on Windows

See [docs/install-windows.md](docs/install-windows.md).

## First run

```sh
cd path/to/your/project
acp-tui
```

acp-tui starts a session in the directory you launched it from, so choose the directory by where you start it.

- Ctrl+D leaves, whatever the prompt box holds. Your session is kept and can be resumed, and an unsent draft is kept with it (Delete deletes forward).
- `acp-tui -c` continues the last session in this directory; `acp-tui -r` lists sessions to resume.
- `acp-tui <name>` starts another configured harness. To add one later, remove the `//` in front of its line under `agent_servers` in your configuration file (`acp-tui config --path` prints where it is); every harness needs an entry there.
- `?` in an empty prompt box opens acp-tui's commands, `/` the harness's, and F1 shows the keys.
- `acp-tui --help` lists the options and `acp-tui --version` says what you run.

If the harness is not installed, or you have not logged in, acp-tui says so and what to run. If your configuration file names a default harness that has no entry, plain `acp-tui` says so and where to copy the entry from.

## Updating

```sh
cd path/to/acp-tui
bun run update
```

This runs `git pull --ff-only` and then `bun install` if the lock file changed, and says what it did. It refuses a checkout with local changes or one that cannot be fast-forwarded.

## Uninstalling

```sh
cd path/to/acp-tui
bun run install-cli --uninstall
```

removes the command. Your configuration (`~/.config/acp-tui`) and acp-tui's state (`~/.local/state/acp-tui`: the session index and any crash reports) stay until you delete them; deleting the checkout removes the program.

## Feedback

The [tester guide](docs/testing.md) says what to try and how to report it. Use the [issue forms](https://github.com/FasterPHP/acp-tui/issues/new/choose) for a bug or for feedback, and attach the output of `acp-tui --version`.

## More

- [docs/harnesses.md](docs/harnesses.md): notes on particular harnesses
- [docs/testing.md](docs/testing.md): the tester guide
- [docs/configuration.md](docs/configuration.md): every setting, themes, glyph sets, keys and layouts
- [docs/install-windows.md](docs/install-windows.md): Windows
- [CONTRIBUTING.md](CONTRIBUTING.md) and [CHANGELOG.md](CHANGELOG.md)

## Licence

Apache-2.0 (see [LICENSE](LICENSE) and [NOTICE](NOTICE)). Copyright 2026 Marcus Don.
