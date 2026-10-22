# Testing acp-tui

Thank you for trying acp-tui. This guide says what is worth trying in the first week, which keys your IDE keeps for itself, how to change a few settings, what is known not to work, and how to report what you find. Installing is covered in the [README](../README.md) (Linux and macOS) and [install-windows.md](install-windows.md) (Windows).

## What to try

Use it for real work for a few days, in the terminal you would normally use (a PhpStorm or IntelliJ terminal, Zed, or a plain terminal). In particular:

- A real task with several tool calls: read the tool cards, expand one, and answer a permission card when it asks.
- Copy and paste: select text in the conversation and copy it, then paste into the prompt box (including a long paste and a path).
- Find in the conversation, in a long session.
- The session list (`acp-tui -r`, or from the palette) and resuming a session; `acp-tui -c` to continue the last one.
- The command palette (`?` in an empty prompt box) and the harness's own commands (`/`).
- The `@` file picker in the prompt box.
- A theme change in your IDE or terminal, followed by Ctrl+L so that acp-tui re-reads the colours.
- Resizing the window, and scrolling a long conversation with the wheel and the scroll bar.
- Code in answers: PHP, Java, Kotlin, XML, JSON, YAML, Python, SQL and shell are highlighted.

Anything that looks wrong, feels slow or surprises you is worth a report, including how the conversation looks.

## Keys

F1 shows the keys. The ones you will use most:

| Key | Does |
| --- | --- |
| Enter | Sends the prompt |
| Shift+Enter | Newline in the prompt box (Ctrl+J where the terminal passes it) |
| Esc Esc | Interrupts the agent |
| Ctrl+D | Leaves; the session is kept |
| Ctrl+C | Copies the selection (it does nothing otherwise) |
| Ctrl+V | Pastes |
| Ctrl+F or F3 | Finds in the conversation |
| `?` / `/` | acp-tui's commands / the harness's commands (in an empty prompt box) |
| Shift+Tab, Ctrl+T | Cycle the mode and the thinking level |
| Ctrl+L | Re-reads the terminal's colours after a theme change |

JetBrains and Zed terminals keep some keys for themselves, so they never reach acp-tui. Use the alternative:

| In | Key kept | Use instead |
| --- | --- | --- |
| PhpStorm, IntelliJ | Ctrl+F (the terminal's find bar) | F3, or find from the palette |
| PhpStorm, IntelliJ | Ctrl+V, Ctrl+Shift+V | the IDE's own paste (it works), or Alt+V |
| PhpStorm, IntelliJ | Shift+F3 | Shift+Enter in the find bar |
| PhpStorm, IntelliJ on macOS | Cmd+Z, Cmd+Shift+Z, Cmd+X | Ctrl+Z, Ctrl+Y, Ctrl+X |
| Zed | Ctrl+P | `?` in an empty prompt box |
| Zed | Ctrl+T, F1, Ctrl+J | the palette; Shift+Enter |

The full table, with Windows Terminal, is under "Keys the IDE terminals keep" in [configuration.md](configuration.md).

## Configuration basics

`bun run install-cli` created `config.jsonc` with the `auggie` harness and every setting at its default (`acp-tui config --path` prints where it is). Without a configuration file (if you never ran `install-cli`, or deleted the file) acp-tui behaves as if it held that default: plain `acp-tui` starts Auggie, and `acp-tui claude` says that `claude` is not configured and to uncomment its entry. A harness works only once it has an entry under `agent_servers`: to try Claude Code or OpenCode, remove the `//` in front of its line. If your file names a default harness without an entry (an older file may say `"default_agent": "claude"`), plain `acp-tui` stops with `default harness 'claude' is not configured` and says where to copy the entry from. Edit it while acp-tui runs: a saved change applies within a second. `acp-tui config --check` reports mistakes with file, line and column. Three settings worth knowing:

- `mouse`: `"full"`, `"wheel"` or `"off"`. Use `"off"` to let the terminal select text itself.
- `density`: how much of each turn's tool calls is shown.
- `attention.signal`: `"none"` stops the bell (see Known limitations).

Everything else is in [configuration.md](configuration.md).

## Known limitations

- Auggie sends no usage or cost, so the cost and context gauges show nothing with it.
- There is no Effort pill with Auggie: it offers no reasoning effort setting over ACP.
- Auggie's built-in slash commands such as `/mcp` are not offered over ACP.
- After an IDE theme change, press Ctrl+L: the IDEs do not tell terminal programs about it.
- The attention bell rings while a JetBrains IDE has focus, because its terminal never reports focus. Set `attention.signal` to `"none"` to stop it.
- An emoji with a skin tone typed in the prompt box puts the cursor a few columns off. The text itself is right.
- The kept keys above were measured in PhpStorm on Linux, Zed, and Windows Terminal, not in every IDE and platform.
- Links open in the browser only where the platform's opener works.
- Auggie 1.x has not been checked; acp-tui tells you when that is the one running.

## Reporting

Use the issue forms: [bug](https://github.com/FasterPHP/acp-tui/issues/new?template=bug.yml) or [feedback](https://github.com/FasterPHP/acp-tui/issues/new?template=feedback.yml). For a bug, please include:

- the output of `acp-tui --version` and of `auggie --version`;
- your IDE and its version, and which terminal engine you use (classic or reworked, in the IDE's terminal settings), or the terminal program;
- your OS and shell;
- a screenshot if it is about how something looks;
- the crash report, if acp-tui crashed: the exit text names its path (a file under acp-tui's state directory, `crashes/`);
- on request, a debug log. Set `ACP_TUI_LOG` for one run, then attach the file:

```sh
ACP_TUI_LOG=~/acp-tui.log acp-tui
```

```powershell
$env:ACP_TUI_LOG="$HOME\acp-tui.log"; acp-tui
```

The log holds method names, IDs and timings, never your prompts or the agent's text, but it does hold directory paths: look at it before you share it.

If you run `npm install -g @augmentcode/auggie@0.36.0` with npm 11, it may warn that `node-pty`'s install script was not run. That is harmless for acp-tui.

## Privacy

acp-tui sends nothing anywhere itself: it has no telemetry and makes no network calls of its own (its syntax grammars are bundled). Network traffic comes from other programs:

- the harness: Auggie talks to Augment;
- `bunx`, which fetches `claude-agent-acp` the first time a `claude` harness entry runs;
- `bun install` and `bun run update`;
- your browser, when you open a link.

What acp-tui writes on your machine:

- the configuration file (and themes you add);
- the session index, `sessions.jsonl` in acp-tui's state directory: each session's title (the agent's title, or the first line of your first prompt), its directory and its times;
- terminal-title slot files, for restoring your tab title;
- exports, when you ask for one;
- the debug log, only when `ACP_TUI_LOG` is set;
- crash reports, in the state directory under `crashes/`: the version lines, the error and stack, and the last 200 log events (never prompt or message text).
