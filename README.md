# acp-tui

A full-screen terminal client for the [Agent Client Protocol](https://agentclientprotocol.com) (ACP), built to be pleasant to live in inside the integrated terminals of PhpStorm, IntelliJ IDEA and Zed (it also runs in any modern terminal). It talks to an ACP agent, which it calls a harness: Auggie works out of the box, and Claude Code, OpenCode, Codex and others are one uncommented line of configuration away. One interface, whichever harness you choose.

It gives you a windowed conversation that stays fast over thousands of items, rendered Markdown with highlighted code, tool cards and permission prompts you cannot mistake for agent text, find, selection and copy, a session list with resume, a command palette, themes that follow your terminal's colours, and a configuration file with live reload.

This is a preview for testers. Expect rough edges, and please report them (see [Feedback](#feedback)).

## Requirements

- git
- [Bun](https://bun.sh) 1.3.14 or later
- Node.js 20 or later, for Auggie (an npm package)
- An Augment account, to log in to Auggie. (To use Claude Code instead you need a Claude Code login; see the configuration guide.)

## Install on Linux and macOS

```sh
git clone https://github.com/FasterPHP/acp-tui.git
cd acp-tui
bun install
bun run install-cli
npm install -g @augmentcode/auggie@0.36.0
auggie login
```

`bun run install-cli` writes a small `acp-tui` command into `~/.local/bin` that runs this checkout, and creates `~/.config/acp-tui/config.jsonc` with the `auggie` harness and every setting at its default. You can also run the checkout without installing it, as `bun packages/acp-tui/src/cli.ts`: with no configuration file acp-tui behaves as if it held that default, so it starts Auggie. If it warns that `~/.local/bin` is not on your `PATH`, add it in your shell's start-up file:

```sh
export PATH="$HOME/.local/bin:$PATH"
```

`npm install -g` may print a warning that `node-pty`'s install script was not run. It is harmless for acp-tui.

Auggie 0.36.0 is the version acp-tui has been checked with.

## Install on Windows

See [docs/install-windows.md](docs/install-windows.md).

## First run

```sh
cd path/to/your/project
acp-tui
```

acp-tui starts a session in the directory you launched it from, so choose the directory by where you start it. The first time Auggie sees a directory it asks whether it may index it: answer in the permission card. Your home directory is never indexed.

- Ctrl+D leaves. Your session is kept and can be resumed.
- `acp-tui -c` continues the last session in this directory; `acp-tui -r` lists sessions to resume.
- To use Claude Code, remove the `//` in front of the `claude` line under `agent_servers` in your configuration file (`acp-tui config --path` prints where it is), then run `acp-tui claude`. Every harness needs an entry there; the others (OpenCode, Codex and more) are commented examples too.
- `?` in an empty prompt box opens acp-tui's commands, `/` the harness's, and F1 shows the keys.
- `acp-tui --help` lists the options and `acp-tui --version` says what you run.

If Auggie is not installed, or you have not logged in, acp-tui says so and what to run. If your configuration file names a default harness that has no entry, plain `acp-tui` says so and where to copy the entry from.

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

- [docs/testing.md](docs/testing.md): the tester guide
- [docs/configuration.md](docs/configuration.md): every setting, themes, glyph sets, keys and layouts
- [docs/install-windows.md](docs/install-windows.md): Windows
- [CONTRIBUTING.md](CONTRIBUTING.md) and [CHANGELOG.md](CHANGELOG.md)

## Licence

Apache-2.0 (see [LICENSE](LICENSE) and [NOTICE](NOTICE)). Copyright 2026 Marcus Don.
