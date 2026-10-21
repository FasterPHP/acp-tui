# Configuring acp-tui

How to change what acp-tui looks like and how it behaves: the configuration file, the optional project file, themes, glyph sets, key bindings and layouts, and the commands that help you write them.

Every JSONC example in this guide is run through `acp-tui config --check` by a test (`packages/acp-tui/test/docs/configuration-examples.test.ts`), so they load as written. The setting tables are generated from the schema in `packages/acp-tui/src/config/schema.ts`; `acp-tui config --print-default` prints the same settings with the same descriptions as a ready-to-edit file, and is the authority if this page and the program ever disagree.

## Contents

1. [Quick start](#quick-start)
2. [The files and where they live](#the-files-and-where-they-live)
3. [The project file and its limits](#the-project-file-and-its-limits)
4. [Precedence and the command line](#precedence-and-the-command-line)
5. [Mistakes: what acp-tui does and what it tells you](#mistakes-what-acp-tui-does-and-what-it-tells-you)
6. [Live reload](#live-reload)
7. [Settings](#settings)
8. [Themes](#themes)
9. [Glyph sets](#glyph-sets)
10. [Keys](#keys)
11. [Layouts](#layouts)
12. [The `config` and `glyphs` subcommands](#the-config-and-glyphs-subcommands)
13. [Installing the `acp-tui` command](#installing-the-acp-tui-command)
14. [Following the terminal's colours](#following-the-terminals-colours)
15. [Diagnostic environment variables](#diagnostic-environment-variables)
16. [Appendix: theme tokens](#appendix-theme-tokens)

## Quick start

`bun run install-cli` ([Installing the `acp-tui` command](#installing-the-acp-tui-command)) creates `~/.config/acp-tui/config.jsonc` with every setting commented at its default, so there is a file to edit straight away:

```sh
$EDITOR ~/.config/acp-tui/config.jsonc      # change what you want, delete the rest if you like
acp-tui config --check                      # problems with file, line and column
acp-tui config --print-default              # the commented defaults again, at any time
```

Without `install-cli` (or after deleting the file), create it with `mkdir -p ~/.config/acp-tui && acp-tui config --print-default > ~/.config/acp-tui/config.jsonc`. On Windows the file is `%APPDATA%\acp-tui\config.jsonc` instead ([The files and where they live](#the-files-and-where-they-live)); `acp-tui config --path` prints where it is on any system. Leave acp-tui running while you edit: a saved change applies to the whole screen within a second. A missing file is fine; every setting then has its default.

The printed file opens with a short guide in sections (making changes, validating changes, live reload, project files, editor completion). Its lines that are not commented out are in effect, and each holds the built-in default, so the file as printed changes nothing until you edit a value. Its commented-out lines are not in effect: some show the value used while a setting is absent (the layout, the per-terminal table, the modules), and the rest are examples, each introduced by `Example, not active`, such as the agents under `agent_servers`. A setting whose values need explaining lists each value once with its meaning:

```
  // Mouse policy:
  // "full" - acp-tui handles clicks, drags and the wheel, and Shift+drag selects text in the
  //   terminal
  // "wheel" - acp-tui handles only the wheel, and clicks and drags do nothing
  // "off" - the terminal keeps the mouse: a drag selects its text, and the wheel does nothing in
  //   acp-tui
  // F2 switches between this policy and "off" while acp-tui runs.
  "mouse": "full",
```

A first file might be as small as this:

```jsonc config
{
  // keyboard only: leave the mouse to the terminal
  "mouse": "off",
  // open sessions with each turn's tool calls behind one line
  "density": "focus",
}
```

## The files and where they live

| What | Where |
| --- | --- |
| Your configuration | `$XDG_CONFIG_HOME/acp-tui/config.jsonc`, else `~/.config/acp-tui/config.jsonc` (an `XDG_CONFIG_HOME` that is not an absolute path is ignored); on Windows, else `%APPDATA%\acp-tui\config.jsonc` |
| Your themes | `themes/<name>.jsonc` beside it |
| A project's overrides | `.acp-tui.jsonc`, found as described below |
| The session index | `$XDG_STATE_HOME/acp-tui/sessions.jsonl`, else `~/.local/state/acp-tui/sessions.jsonl` (state, not configuration); on Windows, else `%LOCALAPPDATA%\acp-tui\sessions.jsonl` |

On Windows the configuration is in the roaming `%APPDATA%` (usually `C:\Users\<you>\AppData\Roaming`), so it follows you to another machine in a domain with roaming profiles, while the session index stays on the machine in `%LOCALAPPDATA%` (`C:\Users\<you>\AppData\Local`). `XDG_CONFIG_HOME` and `XDG_STATE_HOME`, when set to an absolute path, still win there, as everywhere.

`acp-tui config --path` prints the first three and whether each exists. The files are JSONC, as in Zed's settings: comments and trailing commas are allowed, so an `agent_servers` entry copies across from Zed unchanged. Setting names are in snake case, grouped in objects where the schema groups them (`exit.print`, `attention.long_turn_seconds`).

For completion and validation in PhpStorm or Zed, point the file at the JSON Schema with a `$schema` key (accepted and ignored by acp-tui): `acp-tui config --print-schema` prints it, and the checkout holds `packages/acp-tui/schema/config.schema.json` and `theme.schema.json`, generated from the same schema and kept equal to it by a test.

A UTF-8 byte order mark at the start of your file, a project file or a theme file, which Notepad on older Windows and Windows PowerShell 5.1's `Out-File -Encoding utf8` write, is ignored: the file reads exactly as it would without one.

```jsonc config
{
  "$schema": "file:///home/you/src/acp-tui/packages/acp-tui/schema/config.schema.json",
  "density": "compact",
}
```

## The project file and its limits

acp-tui also reads the nearest `.acp-tui.jsonc` from the session directory upwards, stopping at the root of the git work tree that holds it (found by looking for `.git`, with no `git` process), or at the session directory itself outside a work tree, and never above your home directory. The session directory is the directory argument when you give one (`acp-tui ../repo-b` reads `repo-b`'s file), else the directory you launched from. Only the nearest file is read: project files do not stack.

It has the same format as your file and the same checks, and it overrides yours for the settings it may set. It exists for presentation and behaviour that belong to a repository (a larger conversation floor, an ASCII glyph set, a density). Because a cloned repository is not trusted, it is limited by a deny-list, each entry with its reason:

| A project file cannot set | Why |
| --- | --- |
| `agent_servers`, `default_agent_server` | Defining or choosing a harness is choosing what runs; a cloned repository must not make acp-tui run an arbitrary program |
| `clipboard` | A repository should not decide where copied text goes |
| `terminals` | It could turn OSC 8 links on for a terminal whose behaviour has not been checked |
| `keys` in the `card` and `elicitation` contexts | It could otherwise bind a common key to `allow always` |

A theme is named, never given as a path, so a project file cannot make acp-tui read a file outside your `themes/` directory. Each denied key is reported as not allowed in a project file and ignored; the rest of the file applies. There is no trust prompt: with these limits a project file cannot run, send or copy anything.

```jsonc project
{
  "density": "verbose",
  "glyphs": "ascii",
  "layout": { "conversation_min_rows": 14 },
}
```

## Precedence and the command line

From lowest to highest: the built-in default, your file, the project file (for the settings it may set), then a command-line option of the same name for that run. Objects merge key by key (so a project file that sets `attention.long_turn_seconds` keeps your `attention.signal`); arrays and other values are replaced whole.

Four command-line options are per-run overrides of settings, with the same names:

| Option | Setting |
| --- | --- |
| `--mouse full\|wheel\|off` | `mouse` |
| `--wheel-lines <n>` | `wheel_lines` |
| `--exit-print summary\|none\|last-answer\|transcript` | `exit.print` |
| `--clipboard auto\|host\|osc52\|none` | `clipboard` |

A setting given on the command line is pinned for the run: editing the file never changes it. `--spike` no longer exists; an old launcher that still passes it is accepted, the value is ignored and a notice tells you to reinstall the command (see [Installing](#installing-the-acp-tui-command)).

## Mistakes: what acp-tui does and what it tells you

acp-tui always starts, whatever state the files are in.

- **Validation is per section.** A top-level section with an invalid value (`theme`, `layout`, `keys`, and so on) keeps its last good value, which is its default at start-up, while every other section applies. A file with a JSONC syntax error contributes nothing until it parses.
- **Smaller units where they exist.** An invalid `agent_servers` entry is reported by name and cannot be launched, while the valid ones stay; a theme file is checked token by token; a key binding is checked on its own; an invalid glyph override is left out and the set's own glyph stays.
- **Unknown names are warnings**, not errors, so a file written for a newer acp-tui still loads. They are ignored, with the closest known name suggested.
- **Every problem names the file, line and column, the setting's path, what was found and what is allowed.**

```
config.jsonc:3:12: error: mouse takes "full", "wheel" or "off", not "sometimes"
config.jsonc:4:3: warning: wheel_line is not a known setting and is ignored (did you mean wheel_lines?)
```

Problems reach you three ways: a notice in the prompt box's top border each time a file is loaded (the first problem and the count; when it is too long for the border it ends with where to read it in full, such as `(see ? configuration)`), the `config` mark in the status row (`config 2`, hidden while there are none), and the `Configuration problems` entry in the command palette (Ctrl+P, or `?` in an empty prompt box, then type `configuration`), which lists every problem with its place, one row each, and, when the selected row is cut short, shows the rest of its message under the list. `acp-tui config --check` prints them in the shell.

One command line does fail on a broken file: `acp-tui fake` where `fake` is defined only in a file that does not parse exits non-zero, naming the file problem, rather than starting some other harness.

Harness commands are read only from your own file, and only if neither the file nor its directory can be written by another user or is owned by another user; otherwise `agent_servers` is refused with a problem saying why, and only the built-in harness is available.

On Windows a file's mode says nothing about who can write it, so the rule there is about the owner and the place instead: the file and its directory must each be owned by you, by the Administrators group (which owns what you create from an elevated window) or by SYSTEM, and must lie in your profile (`%USERPROFILE%`), in `XDG_CONFIG_HOME` or in `%APPDATA%\acp-tui` (a company that redirects `%APPDATA%` to a network share is covered by the last). A file owned by another account, or one outside all three, such as elsewhere on a network share or under `C:\ProgramData`, has its `agent_servers` refused with a problem naming the owner or the place. If Windows cannot say who owns the file, acp-tui treats it as yours, and with `ACP_TUI_LOG` set it writes a `config_owner_unknown` event to the debug log.

## Live reload

acp-tui watches your file, the `themes/` directory and the project file, including files an editor replaces by rename, and reloads within a second of a change (a save is debounced by 150 ms, and a save that changes nothing does nothing). Layout, theme, glyphs, keys and behaviour then apply to the whole screen, history included, with your reading position and focus kept. Edits made while a selection, the find bar or a permission card is open leave them as they are; an armed two-press state (interrupt, detach) is disarmed when the key map changes.

Exceptions and rules:

- **`terminals.<id>.hyperlinks` applies from the next start.** The renderer fixes whether OSC 8 links are written when it starts. A reload that changes it for your terminal changes nothing on screen and shows the notice `hyperlinks applies from the next start`. Every other setting, `wheel_lines` and `strikethrough` in the same table included, reloads live.
- **A `mouse` change can be refused while the terminal is busy** (start-up or a suspend). It is tried once more on the next frame; if the terminal still refuses, the policy in use is kept and a notice says so. Saving the file again retries.
- **The running harness is never touched.** Changes to `agent_servers` and `default_agent_server` apply to the next session you start; the harness list in the session list shows the new set at once.
- **`density` switches only when the setting itself changed**, so editing the theme does not undo a `v` you pressed.
- **No call expands itself.** A failed tool call keeps its own line with `✗` in every density but `verbose` (which expands every call), and you expand it with Enter, a click or Ctrl+O. The status row marks the density only when it differs from your `density` setting, so with the default `focus` it marks `compact` and `verbose`, and with `"density": "compact"` it marks `focus` and `verbose`.
- **A setting given on the command line stays as given** (see above).

## Settings

Defaults are shown as they are in `acp-tui config --print-default`. "Whole number from 1" means an integer of at least 1.

### Harnesses

acp-tui calls the program it launches and talks to over ACP a **harness**: Claude Code through `claude-agent-acp`, Auggie, OpenCode, Codex. A harness together with a model is the agent you talk to. ACP, Zed and JetBrains call the harness an agent, which is why the setting below is `agent_servers` (Zed's name, so an entry copies across from Zed's settings unchanged) and the one that picks among them `default_agent_server`. Before 17 October 2026 that was `default_agent`, which is still accepted: `acp-tui config --check` prints a notice suggesting the new name, and when both are set the new one wins and a warning says the old one is ignored. Name a harness on the command line first (`acp-tui auggie`, `acp-tui auggie -r`) or with `--harness <name>`; `-a` and `--agent` are kept as aliases of `--harness`.

| Setting | Values | Default | What it does |
| --- | --- | --- | --- |
| `agent_servers` | object of harnesses | `{}` | Harnesses by name (Zed calls them agent servers, hence the key), launched with a harness name or `--harness <name>`. Entries have Zed's shape, so they copy across from Zed's settings. Read only from your own file, never from a project file. |
| `default_agent_server` | string | `"auggie"` | The harness launched without a harness name or command: `"auggie"` or `"claude"` (both built in) or the name of an `agent_servers` entry. The older name default_agent is still accepted. |

Each `agent_servers` entry takes `command` (the program: a name is looked up on the `PATH` only, the entry's own `PATH` when its `env` sets one, and never in the session directory, so a repository cannot slip in a program of the same name; a path, with a slash or on Windows a backslash or a drive letter, is used as written), `args` (an array of strings) and `env` (strings added to acp-tui's own environment for the harness); a `"type": "custom"` key, which Zed writes, is accepted and ignored. The harness runs in the session directory, so use absolute paths in `args`. An entry of a built-in name replaces the built-in one.

**Telling a harness from a directory and a command.** The first argument is the harness when it names one (a built-in harness, `auggie` or `claude`, or an `agent_servers` entry), even when a directory of that name exists: write `./name` for the directory. Then at most one argument, the directory. A command after `--` is launched as given (an "ad hoc" harness) and wins over a harness name. A lone word that names no harness, no directory and no command on the `PATH` is an error before anything starts. The subcommands `config` and `glyphs` come first: a harness named like one is reached with `--harness config`, and `acp-tui config --check` warns about such a name, and about one that starts with `-`. `-r` is `--resume` and `-c` is `--continue`, as in Claude Code; they are not combined (`-rc` is an unknown option).

```jsonc config
{
  "agent_servers": {
    "codex": { "command": "codex-acp", "args": [], "env": {} },
    "opencode": { "command": "opencode", "args": ["acp"] },
  },
  "default_agent_server": "codex",
}
```

Three harnesses are built in. `auggie` runs `auggie --acp` from your `PATH`, so install it first (`npm install -g @augmentcode/auggie@0.36.0`, which needs Node 20 or later, then run `auggie login` once); it is the default for now, so plain `acp-tui` starts Auggie. `opencode` runs `opencode acp` from your `PATH`: install OpenCode with `npm install -g @opencode/cli` (or follow opencode.ai/docs) and log in once with `opencode auth login`; `acp-tui opencode` starts it, instead of OpenCode's own terminal interface. `claude` runs `@agentclientprotocol/claude-agent-acp@0.94.0` with the Bun that runs acp-tui (`bun x --bun ...`) and uses your Claude Code login; `acp-tui claude` starts it. The session list offers a built-in harness under "New session with" only when its program is found on the `PATH`. If `auggie` or `opencode` is not installed, starting it says so and gives the install command; if you are not logged in, acp-tui says the harness needs you to log in (run `auggie login` or `opencode auth login` in a terminal, then start acp-tui again). Auggie 1.x has not been checked with acp-tui, and a notice says so when it is the one running. An entry named `auggie`, `claude` or `opencode` replaces the built-in one, for example to pin another version or to add environment variables (Claude Code reads `ANTHROPIC_MODEL` to choose the model). The commented default carries one example per harness below, each with the source its command was checked against on 13 October 2026; install the harness before you uncomment it. To start Claude by default, set `"default_agent_server": "claude"`.

The other names in the table are examples, not harnesses: `acp-tui gemini` (or `--harness gemini`) does not run `gemini` as a command, since that would start the program's own terminal interface. It stops and says the harness is not configured, naming your configuration file and, for an example without an environment, the command that does run it (`acp-tui -- gemini --acp`). To use one, uncomment its entry in `agent_servers` (or copy its line from the table), then name it. A directory of that name still wins (`acp-tui goose` in a directory holding `goose/` starts there), and `acp-tui gemini --acp`, with arguments, is still an ad hoc command.

| Name in the example | Harness | Command | Source |
| --- | --- | --- | --- |
| `claude` | Claude Code through claude-agent-acp (a built-in entry) | `bunx @agentclientprotocol/claude-agent-acp@0.94.0` | npm `@agentclientprotocol/claude-agent-acp`; `ANTHROPIC_MODEL`: code.claude.com/docs/en/settings |
| `codex` | OpenAI Codex through codex-acp (`npm install -g @agentclientprotocol/codex-acp`) | `codex-acp` | github.com/agentclientprotocol/codex-acp |
| `opencode` | OpenCode (a built-in entry; `npm install -g @opencode/cli`, then `opencode auth login`) | `opencode acp` | opencode.ai/docs/acp |
| `deepseek` | DeepSeek, through OpenCode | `opencode acp`, with `OPENCODE_CONFIG` naming an OpenCode config that sets `"model"` to a DeepSeek model | opencode.ai/docs/providers, opencode.ai/docs/config |
| `auggie` | Augment Code's Auggie (the built-in default; `npm install -g @augmentcode/auggie@0.36.0`, then `auggie login`) | `auggie --acp` | docs.augmentcode.com/cli/acp |
| `pi` | The pi coding agent through pi-acp (`npm install -g pi-acp`, with `pi` on the `PATH`) | `pi-acp` | github.com/svkozak/pi-acp |
| `gemini` | Google's Gemini CLI | `gemini --acp` | geminicli.com/docs/cli/acp-mode |
| `qwen` | Qwen Code | `qwen --acp` | qwenlm.github.io/qwen-code-docs (Zed integration) |
| `copilot` | GitHub Copilot CLI | `copilot --acp` | github.blog changelog, 28 January 2026 |
| `cursor` | Cursor's CLI, whose command is `agent` | `agent acp` | cursor.com/docs/cli/acp |
| `goose` | Goose | `goose acp` | goose-docs.ai/docs/guides/acp-clients |

Auggie reports its models in the older ACP model state, so acp-tui shows its current model in the `Model` pill and lists its models in the picker; its `--model` flag or its settings choose the model it starts with. It takes its reasoning effort only as a start-up option, `--reasoning-effort <effort>` (one of `none`, `low`, `medium`, `high`, `xhigh`, `max` or `dynamic`), and offers no effort setting over ACP, so acp-tui draws no `Effort` pill for it and Ctrl+T says the harness offers no thinking levels. Choose the effort in the entry's `args`, as the example below does with `"args": ["--acp", "--reasoning-effort", "high"]`.

A model or provider without an ACP agent of its own, such as DeepSeek, is reached through an ACP harness that supports it: connect DeepSeek in OpenCode (`/connect`), then give an `agent_servers` entry its own OpenCode configuration file through `OPENCODE_CONFIG`:

```jsonc config
{
  "agent_servers": {
    "claude": { "command": "bunx", "args": ["@agentclientprotocol/claude-agent-acp@0.94.0"], "env": { "ANTHROPIC_MODEL": "opus" } },
    "auggie": { "command": "auggie", "args": ["--acp", "--reasoning-effort", "high"] },
    "pi": { "command": "pi-acp", "args": [] },
    "deepseek": { "command": "opencode", "args": ["acp"], "env": { "OPENCODE_CONFIG": "/home/you/.config/opencode/deepseek.json" } },
  },
}
```

To run your own Claude Code instead of the one the adapter ships with, point the adapter at it with `CLAUDE_CODE_EXECUTABLE`. The adapter then starts that Claude Code, so the model names and descriptions in the model picker follow it (they are the harness's own; acp-tui does not rewrite them). This suits you if you keep Claude Code current yourself:

```jsonc config
{
  "agent_servers": {
    "claude": { "command": "bunx", "args": ["--bun", "@agentclientprotocol/claude-agent-acp@0.94.0"], "env": { "CLAUDE_CODE_EXECUTABLE": "/home/you/.local/bin/claude" } },
  },
}
```

Replace the path with the output of `command -v claude`.

### Screen and terminals

| Setting | Values | Default | What it does |
| --- | --- | --- | --- |
| `mouse` | `"full"`, `"wheel"`, `"off"` | `"full"` | Mouse policy: `"full"` - acp-tui handles clicks, drags and the wheel (in every list, the palette, the pickers, the `@` file picker and the session list, a click on a row does what Enter does and pointing at a row selects it), and Shift+drag selects text in the terminal; `"wheel"` - acp-tui handles only the wheel, and clicks and drags do nothing; `"off"` - the terminal keeps the mouse: a drag selects its text, and the wheel does nothing in acp-tui. F2 switches between this policy and `"off"` while acp-tui runs. |
| `wheel_lines` | whole number from 1 or `null` | `null` | Rows scrolled per wheel event in every terminal; null uses the per-terminal table. |
| `terminals` | object keyed by terminal | `{}` | Per-terminal values over the built-in table (below). |

`terminals` is keyed by `jetbrains` (both PhpStorm terminals, and IntelliJ's on Windows), `zed`, `ghostty`, `kitty`, `wezterm`, `iterm2`, `windows-terminal` and `default` (any other terminal). The terminal is recognised from `TERMINAL_EMULATOR`, then `TERM_PROGRAM`, then `TERM`, then `WT_SESSION` (Windows Terminal; last, because an IDE started from it inherits `WT_SESSION`). Each entry takes:

| Setting | Values | What it does |
| --- | --- | --- |
| `terminals.<id>.wheel_lines` | whole number from 1 | Rows scrolled per wheel event in this terminal. The top-level `wheel_lines` overrides every terminal. |
| `terminals.<id>.strikethrough` | `"sgr9"`, `"overlay"`, `"colour"` | How struck-through text is drawn: `"sgr9"` - the terminal's own line through the text; `"overlay"` - a combining stroke character, U+0336, after each character; `"colour"` - no line: struck text is told apart by its colour and italic. |
| `terminals.<id>.hyperlinks` | boolean | Whether links are written as OSC 8 hyperlinks, which the terminal makes clickable. Applies from the next start. |

Unset values keep the built-in ones (`config --print-default` lists them as comments). Which emoji sequences a terminal draws at another width than acp-tui lays out (`emoji`) and whether it opens URL-like text itself on a click (`detectsUrls`) are measured facts, not preferences, and are not configurable; a new terminal gets a row of the built-in table after it has been measured.

```jsonc config
{
  "terminals": {
    // two rows per wheel notch in Zed, and no OSC 8 links there
    "zed": { "wheel_lines": 2, "hyperlinks": false },
    // PhpStorm: faster wheel
    "jetbrains": { "wheel_lines": 5 },
  },
}
```

### Exit, clipboard and selection

| Setting | Values | Default | What it does |
| --- | --- | --- | --- |
| `exit.print` | `"summary"`, `"none"`, `"last-answer"`, `"transcript"` | `"summary"` | What is printed below the command line on exit: `"summary"` - the command that resumes the session, when it can be resumed; `"none"` - nothing; `"last-answer"` - that command, then the agent's last answer as plain text; `"transcript"` - that command, then the whole conversation as plain text. |
| `clipboard` | `"auto"`, `"host"`, `"osc52"`, `"none"` | `"auto"` | Where copied text goes: `"auto"` - the system clipboard, else through the terminal by OSC 52; `"host"` - only the system clipboard (Wayland or X11 on Linux, the pasteboard on macOS, the Windows clipboard); `"osc52"` - only through the terminal by OSC 52, which also works over SSH; `"none"` - nowhere: copying is turned off. |
| `selection.copy_on_release` | boolean | `true` | Releasing a drag copies the selection; with false the selection stays highlighted until it is copied with Ctrl+C. |

The host clipboard is `wl-copy` or `xclip` on Linux (with a display) and `pbcopy` on macOS, each falling back to OpenTUI's own backend; Ctrl+V reads it (through `pbpaste` on macOS) under `auto` and `host` only.

On Windows the host clipboard is the Windows clipboard, written and read by OpenTUI's own backend with no helper program, and what you copy stays on it after acp-tui exits. The toast reads `copied N chars to the Windows clipboard`. Over SSH there is no host clipboard (it would be the remote machine's), so copying goes through the terminal by OSC 52. Windows Terminal honours OSC 52, so `"osc52"` works there too, but IntelliJ IDEA's terminal ignores it: leave `clipboard` at `"auto"` (or `"host"`) to copy from IntelliJ.

### The prompt box

| Setting | Values | Default | What it does |
| --- | --- | --- | --- |
| `prompt.cursor` | `"block_at_end"`, `"bar"`, `"block"` | `"block_at_end"` | The shape of the cursor in the prompt box: `"block_at_end"` - a bar inside the text and a block after its end, so the terminal's hollow unfocused block shows when the cursor is at the end; `"bar"` - a bar everywhere; `"block"` - a block everywhere. |

The default keeps a block where you normally type, at the end of the draft, because a block is the one shape PhpStorm's terminals (reworked and classic) draw differently, as a hollow outline, when the window does not have focus: a bar looks the same either way there, and neither engine tells acp-tui about focus, so a window you are not typing into can only be told by its block. A block inside the text looked like a selected character, so a bar shows there. Zed reports focus, so acp-tui writes the terminal's own default cursor (which Zed draws hollow) while another window has focus, and the prompt box's shape again when focus returns, whatever `prompt.cursor` says. The cursor is blinking, as OpenTUI's default is, and the terminal's own shape is restored on every way of leaving acp-tui. A change to the setting applies within a second of saving the file:

```jsonc config
{
  "prompt": { "cursor": "bar" }
}
```

### Conversation

| Setting | Values | Default | What it does |
| --- | --- | --- | --- |
| `density` | `"compact"`, `"verbose"`, `"focus"` | `"focus"` | How much of the conversation a session starts by showing: `"compact"` - one line per tool call, thought or plan, runs of reads and searches grouped, failures included; `"verbose"` - everything expanded, nothing grouped; `"focus"` - each turn's tool calls, thoughts and plans behind one line, leaving the messages. The `v` key in the conversation cycles them. |
| `interrupt` | `"double"`, `"single"` | `"double"` | How Esc interrupts a running turn: `"double"` - the first Esc arms the interrupt and a second Esc cancels the turn; `"single"` - one Esc cancels the turn. |
| `markdown.heading_markers` | boolean | `false` | Show a heading's `#` markers, muted, before its text. |
| `markdown.table_min_column_width` | whole number from 3 | `10` | The column width below which a table switches to the record layout. |
| `markdown.code_wrap` | `"word"`, `"prose"`, `"column"` | `"word"` | How long lines in code blocks break: `"word"` - at the last space that fits, in every block; `"prose"` - at spaces in `text`, `txt`, `plaintext`, `plain`, `markdown` and `md` blocks only and at the column elsewhere; `"column"` - at the column, mid-word, in every block (how code blocks were drawn before). A word longer than a row always breaks at the column. A broken row of a code block ends with the continuation mark; a prose block shows none. Copying always gives each line unbroken. |
| `tool_output.snippet_rows` | whole number from 3 | `10` | Rows of a tool call's output shown in its expanded card. |
| `cards.padding.rows` | `0`, `1` | `1` | Blank rows at the top and the bottom of a card (a user message, an expanded thought, tool call or plan, the permission and question cards) and of a code block in an agent's answer. |
| `cards.padding.columns` | whole number from 1 to 3 | `2` | Blank columns between a card's edge and its content, on both sides, and the same inset in a code block in an agent's answer. Two columns look as wide as one row is tall. A user message's accent bar is its first column, with the padding after it. |

With `interrupt` `single`, the Esc that would arm an interrupt cancels the turn instead. Every other meaning of Esc (closing the palette, the find bar or a selection, leaving the conversation or a card) is unchanged and never cancels, so a stray Esc that closes something cannot interrupt your agent.

**Command results.** An expanded tool card shows the result of a shell command, when the agent reports it in one of two known shapes (Auggie's `launch-process` text with `<return-code>` and `<output>` lines, and `claude-agent-acp`'s `Exit code <n>` failure), as `Output: <output>` (or `Output:` and each output line indented two cells) and `Return code: <n>`; the labels are drawn in the `tool.result.label` token, which follows `muted` unless a theme sets it. Output over `tool_output.snippet_rows` rows is cut to its last rows and the return code stays visible below them. A failed command's collapsed line shows `exit <n>`. A call that carries no content but does carry a raw output text (Auggie's successful commands) shows that text in the same way. Anything else is drawn as the agent sent it.

**Card padding.** The user's messages, the expanded thoughts, tool calls and plans, and the permission and question cards keep their text inside a padding of blank cells in the card's fill; vertical padding is whole rows, never half rows. Two columns at the sides, the default, look as wide as one row is tall. A code block in an agent's answer takes the same padding on its own fill, its language label as far in from the right edge as the code is from the left; a code block inside a card draws none, the card's padding serving. The padding rows are decoration: copying, find and export never see them. For the narrower sides acp-tui had before 15 October 2026:

```jsonc config
{
  "cards": { "padding": { "columns": 1 } }
}
```

**Spacing in short panes.** Blank rows keep the conversation's neighbours apart: one above the activity bar's line, one above and one below a permission or question card, and one between the conversation and the prompt box in a layout without the activity bar; with the card's padding rows and the prompt box's padding row (below its text), they are spacing, not content. When the rows run short they give way one at a time, in this order, before the card's content is cut or the conversation goes below four rows: the row below the card, the row above the card, the activity bar's blank row, the row above the prompt box (in a layout without the activity bar), the card's padding rows, the prompt box's padding row. The card's content here is its title, its options and the first two rows of its preview; a longer preview takes the rows left (scroll it, or grow the card with Ctrl+O). So in PhpStorm's 63x21 pane a four-option permission request shows its title, two preview rows and the options with no blank rows, and a tall pane keeps every blank row. The activity bar's line keeps its row at every height, and the blank row above it is drawn at rest only where the conversation keeps its floor (`layout.conversation_min_rows`) with it, before a second empty text row in the prompt box (or while a card is docked): at 63x22 the prompt box rests at one text row with the blank row and the line above it and the conversation has 12 rows, at 63x21 the blank row gives way and the conversation keeps its 12 rows, and at 61x20 (Zed) the conversation has 11.

**Cost and usage.** The `cost` and `usage` status modules show what the agent reports through ACP's `usage_update`: the cumulative session cost, and the context used and its size (the prompt box's gauge). An update that leaves the cost out keeps the cost already shown. An agent that reports no usage shows neither: Auggie 0.36.0 sends none, so with Auggie the status row has no cost and the prompt box no context gauge.

### Attention

| Setting | Values | Default | What it does |
| --- | --- | --- | --- |
| `attention.signal` | `"bell"`, `"osc9"`, `"osc777"`, `"none"` | `"bell"` | How acp-tui asks for attention, while the pane is unfocused, when a permission request opens or a long turn ends: `"bell"` - the terminal bell; `"osc9"` - a desktop notification, in terminals that support OSC 9; `"osc777"` - a desktop notification, in terminals that support OSC 777; `"none"` - nothing. |
| `attention.long_turn_seconds` | whole number from 1 | `30` | A turn longer than this many seconds is signalled when it ends. |

**The bell in JetBrains terminals.** PhpStorm's and IntelliJ's terminals never report whether they have focus, so acp-tui cannot tell that you are looking at it and the bell rings even then. If that bothers you, switch the signal off:

```jsonc config
{
  "attention": { "signal": "none" },
}
```

```jsonc config
{
  "interrupt": "single",
  "attention": { "signal": "osc9", "long_turn_seconds": 10 },
  "exit": { "print": "transcript" },
  "selection": { "copy_on_release": false },
  "markdown": { "heading_markers": true, "table_min_column_width": 8 },
  "tool_output": { "snippet_rows": 20 },
  "clipboard": "host",
  "wheel_lines": 2,
}
```

### The busy indicator

From the moment you send a prompt until the response, a segment sweeps back and forth along the left of the prompt box's top border. Its track is a share of the border's width, so on a wide pane it is long enough to see across the room, and one pass always takes 1.5 seconds (a track too short for that many frames is swept faster, never slower). Every frame moves the segment the same distance after the same interval: half a cell at a time, so even a short track moves smoothly. While a permission request waits it stands still as the heavy line in the `warning` colour, whatever the style.

| Setting | Values | Default | What it does |
| --- | --- | --- | --- |
| `busy.track_percent` | whole number from 5 to 50 | `40` | The share of the prompt box's top border, in per cent, that the busy indicator's track takes; at least 10 cells, and never so much that less than 12 columns are left for a notice. The segment is a fifth of the track, at least 3 cells. |
| `busy.style` | `gap`, `colour` or `border` | `gap` | How the segment is drawn. `gap`: a moving gap in the border's line, drawn in blank cells, so it needs no colour, looks the same under the flat theme and on a light or dark background, and reads on a focused and an unfocused frame alike. `colour`: the heavy line `━` in the `busy` token's colour. `border`: the heavy line in the frame's own colour (`accent` while the prompt box has focus, `muted` otherwise). |

```jsonc config
{
  // a shorter sweep, drawn as the heavy line in the busy colour (the busy indicator of day-one-feedback)
  "busy": { "track_percent": 25, "style": "colour" },
}
```

To choose a style, run a turn that takes a while and save the file with each of `gap`, `colour` and `border`: the change applies within a second, a running turn included, so you can watch the segment change. The half-cell steps are box-drawing half lines: a segment's ends are `╼` and `╾`, a gap's `╴` and `╶` (the glyph names `busy.segment.lead`, `busy.segment.trail`, `busy.gap.lead` and `busy.gap.trail`; see [Glyph sets](#glyph-sets)). The `ascii` set leaves them empty, and so can a glyph override: with an empty half glyph the segment moves by whole cells.

```jsonc config
{
  // whole-cell steps for the gap, whatever the glyph set
  "glyphs": { "overrides": { "busy.gap.lead": "", "busy.gap.trail": "" } },
}
```

The colour of the `colour` style is the `busy` theme token (see [Themes](#themes)); `acp-tui config --check` tells you where a colour of your own would be hard to read.

### The activity bar

One line above the prompt box shows the tool calls in progress (`2 running: Search for Route::get`), the plan's progress and `awaiting permission`. The line keeps its row for the whole session, blank until something has run, so a tool call starting or finishing never moves the conversation. When the last running call finishes while the turn still runs, the line stays for a moment: it shows the finished call, its `✓` (or `✗` if it failed) and its title in the `muted` colour, in the same row, and then goes blank. A call that starts, a plan or a permission request replaces it at once, and the end of the turn ends it. The line does not fade: the muted colour says "done" at once and costs no frames.

| Setting | Values | Default | What it does |
| --- | --- | --- | --- |
| `activity.linger_seconds` | number from 0 to 5 | `1.5` | How many seconds the activity line shows the finished call muted, after the last tool call in progress finishes while the turn still runs, before it goes blank (the line keeps its row either way); 0 turns the linger off. |

```jsonc config
{
  // a shorter linger, for calls that come close together
  "activity": { "linger_seconds": 1 },
}
```

A project file may set it. A change applies the next time a call finishes.

### The terminal title

The title of the terminal tab (PhpStorm's tab, Zed's sidebar) is the name of the session directory, so a row of tabs reads as the repositories they work in. When several acp-tui instances run in the same directory name, the second shows ` 2`, the third ` 3`, and so on; each keeps its number for its whole run. While a permission request waits, the glyph set's title marker leads the title. The title is held on one line and cut to 60 columns.

| Setting | Values | Default | What it does |
| --- | --- | --- | --- |
| `title.format` | format | `"{dir}{counter}"` | The terminal title, a template over `{dir}` (the session directory's name), `{counter}` (empty for the first instance showing that name, ` 2`, ` 3` for the next ones), `{agent}` (the agent's name) and `{title}` (the agent's session title, empty until it sends one). Literal text directly before an empty placeholder is dropped with it, spaces are collapsed and the ends trimmed. |

The title no longer carries the agent's own session title by default (`claude-agent-acp` sends one; Auggie never does). To bring it back:

```jsonc config
{
  "title": { "format": "{dir}{counter} · {title}" },
}
```

Before 14 October 2026 the title read `acp-tui | <session title>`, or `acp-tui | <agent> | <directory>` while there was no title. `"acp-tui | {title}"` gives the first shape back; `"acp-tui | {agent} | {dir}"` the second.

### The slash menu

`/` in an empty prompt box opens the slash menu. It lists the agent's own commands first (what the agent advertises with `available_commands_update`), then a group `acp-tui` with acp-tui's commands under slash names: `/model`, `/mode`, `/effort`, `/sessions`, `/find`, `/export`, `/help` and `/exit` (detach). Each is listed only while it can run (no `/effort` unless the agent offers a thinking level) and is left out when the agent advertises a command of the same name, which keeps the name. Choosing one runs it, as it does from the command palette; the key that does the same is shown beside it.

Typing one of these names as a whole prompt and sending it runs the command instead of sending the text, unless the agent advertises that name; with anything else on the line (`/model sonnet`) the text is sent to the agent as usual.

acp-tui can only offer what the agent advertises. Auggie 0.36.0 advertises just its custom commands (from `.augment/commands` and its skills) over ACP, and keeps its built-ins, `/mcp` among them, in its own terminal interface, where a `/mcp` typed here would reach it as ordinary text. Run `auggie` itself for those.

### Theme, glyphs, layout and keys

These four are large enough for their own sections: [`theme`](#themes), [`glyphs`](#glyph-sets), [`keys`](#keys) and [`layout`](#layouts).

| Setting | Values | Default | What it does |
| --- | --- | --- | --- |
| `theme.name` | name | `"default"` | The theme: `default` (built in) or a file `themes/<name>.jsonc` in the configuration directory. |
| `theme.flat` | boolean | `false` | Always draw the flat style (no background fills; cards by their frames), whatever the terminal answers. |
| `theme.surface_contrast` | number 0.5 to 2 | `1` | Scales every derived surface's lightness step from the background, within the 40 per cent cap: 1 is the default step, and 1.2 makes cards stronger. Multiplies a theme file's own `surface_contrast`. |
| `theme.tokens` | object of token values | `{}` | Token values applied over the theme, last. |
| `glyphs.set` | `"unicode"`, `"ascii"`, `"nerd-font"` | `"unicode"` | The glyph set: `"unicode"` - symbols that common terminal fonts have; `"ascii"` - plain ASCII characters only; `"nerd-font"` - Nerd Font icons for tool kinds and statuses, which needs a Nerd Font in the terminal. |
| `glyphs.overrides` | object | `{}` | Single glyphs replaced by name, such as `"list.bullet.1": "▸"`. |
| `layout.margins.top` | whole number 1 to 3 | unset | Blank rows above everything. |
| `layout.margins.bottom` | whole number 1 to 3 | unset | Blank rows below everything. |
| `layout.screen` | array of regions | unset | The regions from top to bottom; omitted keeps the default layout's. |
| `layout.prompt.pills` | array | unset | The pills in the prompt box's bottom border, in order: `mode`, `model`, `thought_level`. The model pill also shows a harness's older model state, as Auggie reports its models. |
| `layout.prompt.right` | array of modules | unset | Modules on the right of the prompt box's bottom border. |
| `layout.modules` | object keyed by module | unset | Module settings: `format`, `priority`, `hide_when_empty`. |
| `layout.conversation_min_rows` | whole number 4 to 30 | `12` | Conversation rows kept when the prompt box's resting height is chosen. |
| `layout.scrollbar` | boolean | `true` | Draw the conversation's scroll bar. |
| `keys` | object keyed by context | `{}` | Key bindings by context, over the built-in key map. |

`theme` and `glyphs` also accept a bare name (`"theme": "mine"`, `"glyphs": "ascii"`).

## Themes

Text in acp-tui follows the terminal's own palette (indexed colours and the terminal's default foreground), so an Omarchy or IDE theme switch recolours it at once. The surfaces behind cards, selections and diffs are derived from the background and foreground the terminal reports. A theme changes either.

### Theme files

`theme.name` chooses the theme: the built-in `default`, or `themes/<name>.jsonc` in the configuration directory. A theme file holds:

| Key | Meaning |
| --- | --- |
| `tokens` | Token values (see below). |
| `light`, `dark` | Each holds `tokens`, applied over the file's `tokens` when the terminal reports a light or a dark background. The background is light when the CIE L\* of its reported colour is 50 or more; with no report, neither section applies. |
| `extends` | The name of another theme to start from (the built-in `default` at the root). A cycle, or a name with no file, leaves the previous theme in use with a problem. |
| `surface_contrast` | A number from 0.5 to 2, default 1, scaling the derived surfaces (below). |

Resolution is: the `extends` chain from its root (each file's `tokens`, then its `light` or `dark` section), then the configuration's inline `theme.tokens`, last. The `light` or `dark` section is chosen again whenever acp-tui re-reads the terminal's colours (see [Following the terminal's colours](#following-the-terminals-colours)).

```jsonc theme mine
{
  // start from the built-in theme
  "extends": "default",
  // a stronger card fill, on light and dark themes alike
  "surface_contrast": 1.2,
  "tokens": {
    // running tools, and the status row's running, in magenta
    "tool.running": 5,
    // a colour with an attribute: the tool index, bright black and italic
    "tool.index": { "color": 8, "italic": true },
    // a literal colour, which stops following the terminal's palette
    "diff.add": "#2e7d32",
  },
  // light backgrounds only
  "light": { "tokens": { "tool.duration": 4 } },
  // dark backgrounds only
  "dark": { "tokens": { "warning": { "color": 3, "bold": true } } },
}
```

```jsonc config
{ "theme": "mine" }
```

The configuration can name a theme and still adjust it, because inline `theme.tokens` apply last (here a finished tool's ok mark is cyan and everything else follows `quiet`):

```jsonc theme quiet
{
  "tokens": { "muted": 8, "hint": 8 },
}
```

```jsonc config
{
  "theme": {
    "name": "quiet",
    "surface_contrast": 1.2,
    "tokens": { "tool.ok": 6 },
  },
}
```

### Token values

Every token is named in the catalogue ([Appendix](#appendix-theme-tokens)); the theme file's JSON Schema lists them for completion, with what each one styles. A token takes:

- an ANSI palette index from 0 to 255 (the terminal applies its own palette, so the colour follows the terminal's theme);
- `"default"`, the terminal's own foreground (or background, for a surface token);
- a `"#rrggbb"` colour, which stops following the palette;
- for a surface token only, `"derived"`: the default, computed from the terminal's colours;
- or an object, `{ "color": ..., "bold": true, "dim": true, "italic": true, "underline": true }`, a colour with attributes. A colour omitted keeps the one the token would otherwise have.

No other attribute can be set, so a theme cannot make acp-tui write escape sequences outside the safe set (strikethrough comes only from the Markdown renderer and the terminal table).

A theme is checked token by token and a rejected token keeps the value it would otherwise have. An unknown token is reported with the closest known name; a value of the wrong kind (such as `"derived"` on a text token) with what the token takes; a retired token with its replacement (`surface.selected` is replaced by `surface.cursor` and `surface.selection`; `markdown.heading` by `markdown.heading.1` to `markdown.heading.6`).

### Surface contrast

`surface_contrast`, in a theme file or in `theme`, multiplies the lightness step (CIE L\*) between the background and every derived surface that is stepped from it: the status row, the cards, the overlay, user messages, code, the faint fill beside the cursor, the scroll bar and the permission card's grey step. The four highlights (`surface.cursor`, `surface.selection`, `find.current`, `find.other`) are placed beyond those fills, with their own minimum gap from one another, so they move with them; the diff fills are a mix of the diff hue and do not change. 1.2 is the factor that makes cards read stronger on a light theme. The theme file's value and the configuration's multiply, within 0.5 to 2. The derivation's caps always hold, whatever the factor: a stepped fill never goes past 40 per cent of the lightness distance from the background to the foreground, and the four highlights never past 50 per cent, so turning the factor up cannot erase the text. The minimum separations between the highlights, and between the selected permission option and its card, hold too.

### Flat style

`theme.flat: true` draws the flat fallback whatever the terminal answers: no background fills, cards by their frames, the cursor and selection in inverse video. The permission card keeps its warning frame and marker. Text keeps its colours: the background the terminal reports still chooses the light or dark look (the default theme's light-background colours, a theme's `light` or `dark` section). `false` leaves it to the terminal: the flat style is used only where the terminal gives no colour reply or no truecolour. The setting is live.

```jsonc config
{ "theme": { "flat": true } }
```

### Legibility

`acp-tui config --check` resolves the theme in use against the recorded palettes the default theme is tested on (PhpStorm Islands Dark and Islands Light, Zed One Light, One Dark and Ayu Light, Solarized Light) and warns, token by token, about text below 3:1 (2:1 for muted tokens), naming the token, the palette and the ratio. Pinned `#rrggbb` surfaces are checked against the default foreground at 4.5:1. These are warnings and do not reject the theme, because the recorded palettes are not yours.

```jsonc theme dim-duration warns
{
  // ANSI 11 (bright yellow) is 1.88:1 on Zed One Light: --check warns
  "tokens": { "tool.duration": 11 },
}
```

### The permission card's protections

A theme can recolour the permission card but cannot make it something agent text can sit on or imitate. These rules hold under any theme, glyph set and layout (design section 8):

- `surface.permission` cannot be `"default"`; a value that would remove the fill is replaced by the derived one, with a problem.
- A pinned `#rrggbb` surface (including `surface.code` and `surface.overlay`) may not resolve within 3 L\* of the card's fill, and a pinned card fill may not resolve within 3 L\* of any other surface; a violating pinned value is replaced by the derived one, with a problem. Two derived surfaces are not compared under that rule, since replacing a value by the derived one cannot separate them; instead the derivation itself keeps every derived surface except `surface.permission.selected` at least 3 apart from the derived card by CIEDE2000 colour difference (lightness, chroma and hue together) at every `surface_contrast` from 0.5 to 2 (checked in steps of 0.1), a margin the theme tests check on the recorded palettes, and the card keeps its warm hue, its frame and its marker as well. `surface.permission.selected` always differs from `surface.permission`.
- The permission marker glyph is used by no other glyph of the set, and the frame glyphs cannot be blank ([Glyph sets](#glyph-sets)).
- A layout must keep exactly one `card` region ([Layouts](#layouts)), and has no option that hides, restyles or moves the card.
- A project file cannot bind keys in the `card` and `elicitation` contexts, and the 300 ms guard that stops a stray key from answering a new request is not a setting.
- Under the flat style the card has no fill and keeps its frame and marker.

A pinned card fill is allowed, as long as it is kept apart from the other fills. A pinned colour suits one kind of background, so give it in the `dark` or `light` section it belongs to:

```jsonc theme card-pinned
{
  "dark": { "tokens": { "surface.permission": "#4a3a1a" } },
}
```

Pinning two surfaces to the same colour is not: the pinned code fill is replaced by the derived one (the card keeps its pin), and `config --check` reports an error.

```jsonc theme card-same-fill fails
{
  "tokens": { "surface.permission": "#3a2f24", "surface.code": "#3a2f24" },
}
```

## Glyph sets

`glyphs.set` chooses what acp-tui draws its chrome, gutters, bullets, borders and markers with:

| Set | Meaning |
| --- | --- |
| `unicode` | The default: glyphs present in JetBrains Mono and Lilex (the fonts of PhpStorm and Zed), apart from `◦` and `✗`, which Zed draws from a fallback font. |
| `ascii` | The fallback: a form for every glyph, for a terminal or font that draws too little. |
| `nerd-font` | Opt-in: Nerd Font icons for the tool kinds and for `ok`, `fail` and `running`; `unicode` for everything else. |

A bare name works for the set alone:

```jsonc config
{ "glyphs": "ascii" }
```

`glyphs.overrides` replaces single glyphs by name. A name is a group, a dot and the glyph's name, and `acp-tui glyphs --test` prints every glyph of every set by name so you can see which ones your terminal's font draws. The groups are: `gutter`, `tool.kind`, `tool.status`, `spinner`, `thought`, `plan`, `separator`, `card`, `cursor`, `scrollbar`, `list.bullet` (levels `1` to `4`), `task`, `heading.rule`, `table`, `quote`, `code`, `footnote`, `superscript`, `subscript`, `frame`, `permission`, `busy`, `splash` and `title`.

```jsonc config
{
  "glyphs": {
    "set": "unicode",
    "overrides": {
      "list.bullet.1": "▸",
      "tool.status.ok": "+",
      "busy.segment": "=",
    },
  },
}
```

### Validation

An invalid override is reported at its own line and column as a warning and left out, and the set's glyph stays. Every glyph must be:

- printable: no control, format, surrogate or line-separator character (private-use characters are allowed, since Nerd Font icons live there);
- the width its name requires, one cell for most, measured as OpenTUI draws it and as the layout counts it, which must agree (so `✅` for `tool.status.ok` is refused: two cells where one is required, and `❤` is refused because OpenTUI draws it two cells wide and the layout counts one);
- for the permission marker, used by no other glyph of the set, so agent text drawn with the set's other glyphs never shows it in a list or gutter. The title marker (the terminal title) follows the permission marker and is exempt, because the title is never drawn in screen cells. The frame glyphs and the marker cannot be blank.

```sh
acp-tui glyphs --test          # all three sets
acp-tui glyphs --test nerd-font
```

## Keys

`keys` holds bindings per context: `global`, `prompt`, `conversation`, `card`, `elicitation`, `overlay`, `find` and `selection`. Each entry maps a key to the camelCase ID of an action in that context, or to `null` to remove the binding. The action IDs of each context are listed in the commented default (`acp-tui config --print-default`) and completed by the JSON Schema; the command palette (Ctrl+P) lists the actions with their current keys, and F1 shows key help.

Keys are written as key help shows them: `ctrl+q`, `shift+tab`, `f3`, `alt+v`, `pgup`, `esc`, `enter`; case and the order of modifiers do not matter, and `esc`, `enter`, `pgup`, `pgdn`, `alt` and `option` are accepted for `escape`, `return`, `pageup`, `pagedown` and `meta`.

A configured key replaces the default binding of the same key in that context; other default keys of the action stay, and `null` removes a binding. Every hint, notice, splash line and key help entry shows the keys that result.

The palette and key help show a key beside an entry only when that key does exactly that entry, and the key column holds the key alone. Where the keys of a group work is in the group's heading, when that is one place only: `Conversation (shortcuts apply while selected)`, `Prompt (shortcuts apply while selected)`, `Permission (shortcuts apply while it is open)`; the headings of groups whose keys work from any focus (`Session`, `Selection`, `Anywhere`) say nothing. An entry that cannot act at once is drawn muted and neither Enter nor a click runs it: `Interrupt the turn` while no turn runs, `Clear the selection`, `Copy the selection` and `Cut the selection` with nothing to act on; the keyboard selection passes over such an entry. Every other entry acts at once from wherever the palette was opened, because choosing it first gives focus to the region that owns it, so a conversation key needs no Tab first. The choose entries for the mode, the model and the thinking level have no key (`shift+tab` and `ctrl+t` step to the next value, and are on the `Next mode` and `Next thinking level` entries); with the mouse on they show `click the pill`, which opens the same picker. The density has one action, `cycleDensity` (`v`); the three single-density actions (`densityCompact`, `densityVerbose`, `densityFocus`) are gone, and a `keys` entry that names one is reported by `config --check` as an unknown action, like any other.

```jsonc config
{
  "keys": {
    "conversation": {
      // an extra key: both y and c copy the item under the cursor
      "c": "copyItem",
    },
    "global": {
      // move detach from ctrl+d to ctrl+q
      "ctrl+d": null,
      "ctrl+q": "detach",
    },
  },
}
```

### Editing keys in the prompt box

These are `prompt` context actions, so they can be moved like any other key (spec `tui-keymap` "Prompt box selection keys"):

| Keys | Action | What it does |
| --- | --- | --- |
| `shift+left`, `shift+right` | `selectLeft`, `selectRight` | Extend the selection by a character |
| `shift+up`, `shift+down` | `selectUp`, `selectDown` | Extend the selection by a line |
| `shift+home`, `shift+end` | `selectHome`, `selectEnd` | Select to the start or the end of the draft |
| `ctrl+shift+left`, `ctrl+shift+right`, `alt+shift+left`, `alt+shift+right` | `selectWordLeft`, `selectWordRight` | Extend the selection by a word |
| `ctrl+a` | `selectAll` | Select all the draft's text (day-two-feedback: Cmd+A selects the whole terminal in PhpStorm); it replaces OpenTUI's Emacs line start for Ctrl+A, so use `home` for that; only while the prompt box has focus |
| `ctrl+x` | `cut` | Copy the selection, through the same paths and toast as `ctrl+c`, and remove it; nothing happens with no selection |
| `ctrl+z`, `super+z` | `undo` | Undo the last edit step |
| `ctrl+y`, `ctrl+shift+z`, `super+shift+z` | `redo` | Redo it |

The selection is drawn on the `surface.selection` token, or in inverse video under the flat theme. Typing replaces the selection, Backspace and Delete remove it, `ctrl+c` copies it (ahead of the conversation's selection while the prompt box has focus), `esc` clears it and does nothing else, and a drag in the prompt box's text selects but never copies on release (`selection.copy_on_release` is about the conversation). `selectAll`, `cut`, `undo` and `redo` are in the palette (`Select all`, `Cut the selection`, `Undo the last edit`, `Redo the edit`), the selecting keys are keystrokes only. `super` is Cmd on a Mac, which a terminal sends only under the kitty keyboard protocol; and `ctrl+shift+z` is told apart from `ctrl+z` only under it too, so `ctrl+y` is the redo that works everywhere. `ctrl+z` never suspends acp-tui. **In the IDE terminals `ctrl+y` is the redo key**: PhpStorm (both terminals) sends `ctrl+shift+z` as Ctrl+Z's byte, so it undoes instead of redoing, and Zed keeps it for its own redo, so nothing reaches acp-tui; the palette's `Redo the edit` does the same wherever you are (the key probe's results are in the table below). The other keys of this section reach acp-tui in all three terminals. `home` and `end` clear a selection and move in the same press, as in an editor; from an empty prompt box they move the conversation instead.

Undo works in steps, not characters: a word with the space or newline after it, a run of deletions, a paste, a cut, a deleted selection, an inserted file mention or command, or a recalled prompt; a character typed over a selection starts a run, so the selection's deletion and the typing after it are one step; moving the cursor by key or click, or a pause of over a second, ends a run. The history starts afresh when a prompt is sent and when the session changes, so Ctrl+Z never brings back a sent prompt (Up recalls it).

### Validation

An override is rejected, with a problem naming the context, the key and the reason, and the bindings it would have changed stay as they were, when it:

- names an unknown context or action (the closest known one is suggested);
- gives a key that cannot be parsed;
- names the same key twice in one context in different spellings (`"Ctrl+O"` and `"ctrl+o"`);
- binds a printable key without Ctrl or Alt in a text-input context (`prompt`, `find`, `overlay`), because that character would no longer type. The exception is `palette` and `agentCommands` in `prompt`, which act only at the start of an empty prompt box and leave the character as text in a draft (the default `?` and `/`);
- or would leave an essential action without any key: `submit`, `newline`, `detach`, `palette` (counted across the contexts that have it) or the card's `confirm`, which would leave no way to send, exit, reach every action or answer a card.

```jsonc config
{
  "keys": {
    // the palette also opens from an empty prompt box with ';' (a draft types it)
    "prompt": { "?": null, ";": "palette" },
  },
}
```

A project file cannot set keys in the `card` and `elicitation` contexts.

### Keys the IDE terminals keep

PhpStorm, Zed and Windows Terminal keep some keys for themselves, so they never reach acp-tui. The table records what was measured in PhpStorm 2026.2.3 (reworked and classic terminals), Zed 1.18.1, Windows Terminal 1.24 and 1.25 and IntelliJ IDEA 2026.2.3 on Windows (`packages/acp-tui/src/keys/ide-keys.json`, which acp-tui also reads at run time). IntelliJ's terminal keeps what PhpStorm's does (`ctrl+f`, `ctrl+v`, `ctrl+shift+v`), and `ctrl+shift+c` and `ctrl+shift+z` arrive unshifted there too, so the PhpStorm rows apply to it. Every key here has an alternative route, in the last column. If you bind a kept key, acp-tui still binds it (you may have freed it in the IDE) but warns, naming the terminal and the action's other routes; `config --check` gives the warnings for every terminal in the table whatever you run it in. It also warns when your overrides leave an action that a key reached by default reachable in an IDE only through the palette.

| Terminal | Key kept | What happens | Alternatives |
| --- | --- | --- | --- |
| PhpStorm (both) | `ctrl+f` | Opens PhpStorm's own terminal find bar | `f3`; the palette's `Find in the conversation` |
| PhpStorm (both) | `ctrl+v` | PhpStorm pastes the clipboard itself, as one bracketed paste | PhpStorm's own paste; `alt+v`; the palette's paste |
| PhpStorm (both) | `ctrl+shift+v` | Kept by the IDE | `alt+v`; the palette's paste |
| PhpStorm (both) | `ctrl+shift+c` | Arrives as Ctrl+C's byte, so it acts as Ctrl+C | `shift+y` in the conversation; the palette's rich copy |
| PhpStorm (both) | `ctrl+shift+z` | Arrives as Ctrl+Z's byte, so it undoes instead of redoing | `ctrl+y`; the palette's `Redo the edit` |
| PhpStorm (both) | `shift+f3` | Arrives in a form OpenTUI takes for a cursor report | Shift+Enter in the find bar; the palette's previous hit |
| PhpStorm on macOS (both) | `super+z` (Cmd+Z) | Kept by PhpStorm for its own undo; it never reaches the terminal | `ctrl+z`; the palette's `Undo the last edit` |
| PhpStorm on macOS (both) | `shift+super+z` (Cmd+Shift+Z) | Kept by PhpStorm for its own redo | `ctrl+y`; the palette's `Redo the edit` |
| PhpStorm on macOS (both) | `super+x` (Cmd+X) | Kept by PhpStorm for its own cut (acp-tui binds Cut to `ctrl+x` only) | `ctrl+x`; the palette's `Cut the selection` |
| PhpStorm classic | `ctrl+c` | The IDE's Copy wins while JediTerm shows a selection band of its own (a quick click can leave one); it reaches acp-tui otherwise | the palette's copy |
| Zed | `ctrl+p` | Opens Zed's file finder | `?` in an empty prompt box |
| Zed | `ctrl+t` | Opens Zed's project symbols | the effort pill; the palette's `Choose the thinking level` |
| Zed | `f1` | Opens Zed's command palette | the palette's key help |
| Zed | `ctrl+j` | Toggles Zed's bottom dock | Shift+Enter in the prompt box |
| Zed | `ctrl+enter` | Zed's inline assist; it never reaches acp-tui there | Shift+Enter in the prompt box (Zed sends it as a line feed) |
| Zed | `ctrl+shift+v` | Zed's paste | `alt+v`; the palette's paste |
| Zed | `ctrl+shift+c` | Zed's copy | `shift+y` in the conversation; the palette's rich copy |
| Zed | `ctrl+shift+z` | Zed's redo: nothing reaches the terminal | `ctrl+y`; the palette's `Redo the edit` |
| Zed | `shift+f3` | Arrives in a form OpenTUI takes for a cursor report | Shift+Enter in the find bar; the palette's previous hit |
| Windows Terminal | `alt+enter` | Full screen; nothing reaches acp-tui | `ctrl+enter` in the prompt box; Shift+Enter (1.25) or Ctrl+Enter (1.24) in the find bar; the palette's previous hit |
| Windows Terminal | `ctrl+v` | Windows Terminal pastes the clipboard itself, as one bracketed paste | Windows Terminal's own paste; `alt+v`; the palette's paste |
| Windows Terminal | `ctrl+shift+v` | Windows Terminal's paste | `alt+v`; the palette's paste |
| Windows Terminal | `ctrl+shift+z` | Arrives as Ctrl+Z's byte in 1.24 (1.25 sends it distinctly), so it undoes instead of redoing | `ctrl+y`; the palette's `Redo the edit` |
| Windows Terminal | `shift+f3` | Arrives in a form OpenTUI takes for a cursor report | Shift+Enter (1.25) or Ctrl+Enter (1.24) in the find bar; the palette's previous hit |
| Windows Terminal | `ctrl+c` | Windows Terminal's Copy while it holds a selection of its own (Shift+drag); it reaches acp-tui otherwise | the palette's copy |
| Windows Terminal | `ctrl+shift+p`, `ctrl+shift+t`, `ctrl+shift+w`, `ctrl+tab`, `ctrl+,` | Windows Terminal's command palette, new tab, close pane, next tab and settings (bound to nothing in acp-tui) | none needed |

Shift+Enter is the newline key everywhere tested (PhpStorm and IntelliJ send `ESC CR`, Zed `\n`, and a terminal that answers the kitty keyboard query sends `CSI 13;2u`, as Windows Terminal 1.25 does), with Ctrl+J as a fallback where the terminal passes it. Ctrl+Enter is a newline key too (Windows Terminal sends a line feed for it in 1.24 and `CSI 13;5u` in 1.25; IntelliJ and PhpStorm send a plain Enter, which sends). Windows Terminal 1.24 and older cannot tell Shift+Enter from Enter, so there the splash and key help name `ctrl+enter` instead.

For example, moving export from `e` to Ctrl+T is accepted, and `config --check` warns that Zed keeps Ctrl+T, so there `export` is reachable only through the palette (run inside Zed, acp-tui itself reports that warning as a configuration problem at start-up and on reload):

```jsonc config warns
{
  "keys": { "conversation": { "e": null, "ctrl+t": "export" } },
}
```

## Layouts

The screen is composed from a layout, never hard-coded. `layout` follows the design's model: a top and a bottom margin in rows, and an ordered list of regions from top to bottom. Parts you leave out keep the default layout's, so a one-line setting is a complete, valid layout.

| Part | Meaning |
| --- | --- |
| `margins` | `{ "top": n, "bottom": n }`, 1 to 3 rows each. Margins are obligatory, because a screen without them looks crowded. |
| `screen` | The regions from top to bottom. A region is a block name (`conversation`, `activity`, `card`, `prompt`, `find`), a spacer `{ "spacer": n }` (0 to 3 rows), or a bar `{ "left": [...], "center": [...], "right": [...] }` of module names. The conversation takes every row the others leave; `activity`, `card` and `find` take none while empty. |
| `prompt` | The prompt box's bottom border: `pills`, from `mode`, `model` and `thought_level` (named after ACP's category), and `right`, a module list. An agent that sends no `model` option but reports its models in the older model state (Auggie does) still gets the `model` pill and picker, named `Model`, and the `model` module follows it: the pill shows the model the agent reports as current, and choosing another sends `session/set_model`. A `model` option, where an agent sends one, always wins. The older state has no update notification, so a model the agent changes on its own shows when you next open the session. |
| `modules` | Settings per module, applied wherever the module appears (below). |
| `conversation_min_rows` | Rows (4 to 30, default 12) the conversation keeps when the prompt box's resting height is chosen. |
| `scrollbar` | `true` (default) draws the conversation's scroll bar; `false` leaves its column blank to the text. Live. |

The default layout is a one-row top margin; `conversation`, `activity`, `card`, `prompt`; a one-row spacer; `find`; the status row, with `cwd`, `turn-state` and `hints` on the left and `config`, `mouse`, `density`, `position`, `connection`, `usage` and `cost` on the right; a one-row bottom margin. The prompt box's bottom border holds the pills `mode`, `model` and `thought_level` and, on the right, `usage`.

A header bar, no hints:

```jsonc config
{
  "layout": {
    "screen": [
      { "left": ["agent", "model", "cwd"], "right": ["turn-state", "connection"] },
      "conversation", "activity", "card", "prompt", "find",
    ],
  },
}
```

Pills reordered, with no effort pill, and a taller conversation floor:

```jsonc config
{
  "layout": {
    "prompt": { "pills": ["model", "mode"] },
    "conversation_min_rows": 14,
    "scrollbar": false,
  },
}
```

### Modules and their formats

A bar holds modules. A module is a pure function of the session and its settings; one with nothing to show is hidden (`mouse` while the policy is `full`, `density` while it is the density the `density` setting names, `position` while the conversation follows the end, `config` while there is no problem). Narrow bars drop modules lowest priority first, but never `turn-state` while a permission is open or a two-press key is armed, nor `connection` while disconnected.

`layout.modules.<module>` takes `format`, a template naming the module's fields in braces; `priority`, a whole number (higher numbers are kept longer); and `hide_when_empty`. A format naming a field the module lacks is reported with the module's fields and keeps the previous format.

| Module | Shows | Fields | Default format | Default priority |
| --- | --- | --- | --- | --- |
| `agent` | The harness's name and version. | `{agent}` `{version}` | `{agent}` | 80 |
| `model` | The model in use: the `model` option's value, else the agent's older model state's current model. | `{model}` | `{model}` | 60 |
| `mode` | The agent's mode. | `{mode}` | `mode:{mode}` | 50 |
| `cwd` | The session directory: `{cwd}` and `{path}` with `~` for home, `{basename}` its last component. | `{cwd}` `{path}` `{basename}` | `{cwd}` | 30 |
| `connection` | The connection to the harness. | `{state}` | `{state}` | 90 |
| `turn-state` | The turn's state: idle, running with the time, `requires_action`, loading or an armed key; its format must keep `{state}`. | `{state}` `{elapsed}` | `{state}` | 100 |
| `usage` | The context window used and its size. | `{used}` `{size}` `{percent}` | `ctx {used}/{size}` | 22 |
| `cost` | The session's cost, as the agent reports it. | `{cost}` `{amount}` `{currency}` | `{cost}` | 75 |
| `hints` | Key hints for what can be done now. | `{key}` `{label}` | `{key} {label}` | 25 |
| `mouse` | The mouse policy, while it is not full. | `{state}` `{policy}` | `{state}` | 85 |
| `density` | The conversation's density, while it differs from the density setting. | `{name}` | `density: {name}` | 65 |
| `position` | How far the conversation is scrolled, while it does not follow the end. | `{percent}` `{below}` | `scrolled {percent}` | 70 |
| `config` | How many configuration problems there are, while there are any. | `{count}` | `config {count}` | 88 |
| `text` | Fixed text: its format, with no fields. | none | empty | 10 |

```jsonc config
{
  "layout": {
    "modules": {
      "cwd": { "format": "dir {basename}" },
      "cost": { "priority": 99 },
      "hints": { "hide_when_empty": true },
    },
  },
}
```

### What a layout must keep

A layout is rejected, as a whole, with a problem naming every failure, unless `conversation`, `card`, `prompt` and `find` each appear exactly once, the margins are 1 to 3 rows and the spacers 0 to 3, and the `turn-state` and `connection` modules each appear in some bar with a format that includes `{state}`. A rejected `layout` section leaves the layout in use unchanged. These rules protect correctness and security rather than taste (the permission card must be able to dock and `requires_action` and `disconnected` must stay visible); there is no option that hides, restyles or moves the card, the prompt box or the find bar.

```jsonc config fails
{
  // a layout without the card: rejected, and a permission request would have nowhere to dock
  "layout": { "screen": ["conversation", "activity", "prompt", "find"] },
}
```

## The `config` and `glyphs` subcommands

When the first argument is `config` or `glyphs`, acp-tui runs that subcommand as plain text on the normal screen: no harness, no full screen. A directory of that name is written `./config`, a harness of that name is reached with `--harness config`, and a command of that name goes after a `--` (`acp-tui -- config`).

| Command | Does |
| --- | --- |
| `acp-tui config --check` | Checks your file, the project file for the current directory, the themes they name (including the legibility warnings), the key bindings (including the kept-key warnings for all three IDE terminals) and the glyph overrides. One `file:line:column: severity: message` line per problem. Exits 1 if any is an error, 0 with warnings only. A deprecated name that still works (`default_agent`) is a `notice`, which is not counted among the warnings. |
| `acp-tui config --print-default` | Prints a complete file with every setting at its default, after a short guide in sections; each setting has a comment saying what it does and what values it takes, and `agent_servers` has commented examples, each marked `Example, not active`, for the built-in `claude`, `codex-acp`, `opencode acp` and the other agents listed under [Agents](#agents). It loads without problems and gives exactly the defaults. |
| `acp-tui config --print-schema` | Prints the configuration's JSON Schema. |
| `acp-tui config --path` | Prints your file, the themes directory and the project file that applies for the current directory, each present or absent. |
| `acp-tui glyphs --test [set]` | Prints each glyph set (or one) by name, a row per group, so you can see which glyphs your terminal's font draws. |

Run `--check` from the directory you start acp-tui in, since it finds the project file the way acp-tui does.

## Installing the `acp-tui` command

From the repository checkout, once:

```sh
bun run install-cli                  # ~/.local/bin/acp-tui
bun run install-cli --dir ~/bin      # or another directory
bun run install-cli --force          # replace a file that is not its own
bun run install-cli --uninstall      # remove what it wrote (also takes --dir)
```

It writes a small regular file, a short `sh` stub that holds the checkout's absolute path and runs the checkout's launcher, `packages/acp-tui/bin/acp-tui`. Because the stub only points at the checkout, a `git pull` updates the command: run `install-cli` again only if the checkout moves. The launcher finds `bun` on the `PATH` or in `~/.bun/bin` (exit status 127 with a message when there is none) and passes every argument through unchanged, including a `--` of your own, so `acp-tui ./repo -- my-agent` works. Setting `ACP_TUI_ROOT` makes the stub run another checkout.

`install-cli` overwrites a file only if it carries its own marker or is the phase-1a launcher (recognised by its header); any other file is kept unless you pass `--force`. `--uninstall` removes only a stub with its marker. It warns when the directory is not on your `PATH`. A copy of the old launcher that is still on your `PATH` keeps working: its `--spike` argument is ignored with a notice, which `install-cli` stops by replacing it.

It also creates your configuration file when there is none: the commented default (what `acp-tui config --print-default` prints) at `$XDG_CONFIG_HOME/acp-tui/config.jsonc`, or `~/.config/acp-tui/config.jsonc` when `XDG_CONFIG_HOME` is unset or not absolute (`%APPDATA%\acp-tui\config.jsonc` on Windows; a directory it has to make is readable only by you), and prints the path. A configuration that already exists is never replaced, not even with `--force` (which is about the command only): `install-cli` says it kept it. `--uninstall` leaves the configuration alone.

On Windows the command is `acp-tui.cmd` in `%USERPROFILE%\.bun\bin` (Bun's own directory, already on the `PATH`), a batch file that runs `packages\acp-tui\src\cli.ts` with the Bun that ran `install-cli`; `--uninstall` there removes only an `acp-tui.cmd` that `install-cli` wrote. See [Installing acp-tui on Windows](install-windows.md).

## Following the terminal's colours

acp-tui asks the terminal for its foreground and background (OSC 10 and 11) at start-up and derives the surfaces from the answers. Text in indexed and default colours follows the terminal's palette by itself. The derived surfaces and the `light` or `dark` theme section follow only when acp-tui asks again, which it does:

- after a resize settles;
- on **Ctrl+L**, which also repaints the screen;
- on `SIGUSR2`.

No IDE terminal tells applications that its theme changed (neither PhpStorm nor Zed sends the colour-scheme notification), so after switching the IDE's theme, press Ctrl+L. A switch of the Omarchy theme recolours the terminal and indexed text at once; Omarchy sends `SIGUSR2` only to processes named `opencode`, so to have running acp-tui sessions follow it, add a hook. After every theme change Omarchy runs `~/.config/omarchy/hooks/theme-set` and every file in `~/.config/omarchy/hooks/theme-set.d/` except `*.sample`, each as `bash <file> <theme name>`. Save this as `~/.config/omarchy/hooks/theme-set.d/acp-tui` (or add the `pkill` line to `theme-set`):

```sh
#!/bin/bash
# make running acp-tui sessions re-read the terminal's colours
pkill -USR2 -f 'bun .*/packages/acp-tui/src/cli\.ts' || true
```

acp-tui runs as `bun <checkout>/packages/acp-tui/src/cli.ts`, so its process is named `bun` and the pattern above matches its command line; it does not match the agent process or `bun test`. The hook only asks for a re-query: nothing changes on screen unless the terminal's answer did. (An `acp-tui config --check` that happens to be running at that instant has no handler for the signal and ends; nothing is lost.)

## Diagnostic environment variables

These are not settings and are not in `--help` or the schema.

| Variable | Effect |
| --- | --- |
| `ACP_TUI_LOG=<path>` | Appends a JSON-lines debug log (method names, ids, state transitions and timings; never prompt or message text). Records the configuration load (`config_loaded`) and each reload (`config_reload`, with the sections that changed). |
| `ACP_TUI_CAPABILITIES` | Overrides the terminal's capability row for a run, on top of `terminals`: a comma list of names, each alone (on) or `name=true\|false`, such as `osc8` or `osc8=false,sgr9`; it also reaches `emoji` and `detectsUrls`, which `terminals` does not. For tests and IDE checks. |
| `ACP_TUI_OPENER` | The program that opens links instead of `xdg-open`, `open` or, on Windows, the system's URL handler (`rundll32.exe url.dll,FileProtocolHandler`). |
| `ACP_TUI_ROOT` | The checkout the installed stub runs. |
| `ACP_TUI_TEST_HOOKS=crash` | Test only: F12 throws an uncaught error, to exercise the crash exit path. Unreachable from the command line, the configuration or the palette. |

To try a configuration without touching your own, point `XDG_CONFIG_HOME` at a temporary directory: `acp-tui config --check` and acp-tui itself read `$XDG_CONFIG_HOME/acp-tui/`.

## Appendix: theme tokens

The catalogue of `src/theme/tokens.ts` (spec `tui-theme` "Theme tokens, never literal colours"). A theme can set any of them; `acp-tui config --print-schema` and `packages/acp-tui/schema/theme.schema.json` list them with the same descriptions.

| Token | Kind | Styles |
| --- | --- | --- |
| `text` | text | body text of conversation rows and the composer |
| `muted` | text | secondary text: turn-end markers, cwd, metadata |
| `accent` | text | prompt marker, focus and the other accents |
| `hint` | text | key hints bar |
| `warning` | text | warnings, exit-armed hint |
| `danger` | text | errors, disconnected state |
| `user` | text | the user card's bar; under the flat style also the conversation cursor's inverse block on a user message (defaults to accent's colour) |
| `agent` | text | the agent message's gutter glyph, blank unless glyphs.overrides sets gutter.agent; under the flat style, the conversation cursor's inverse gutter on an agent message |
| `thought` | text | thought summary lines |
| `permission` | text | permission prompt frame and marker glyph |
| `status.fg` | text | status bar text |
| `busy` | text | the busy indicator's segment in the prompt box's top border under `busy.style` `colour` (bold bright blue by default, bold magenta on a light background, apart from the focused frame's accent) |
| `tool.ok` | text | tool line: the ok status glyph |
| `tool.fail` | text | tool line: the fail status glyph and word |
| `tool.running` | text | tool line: the running status; in-progress tools in the activity region |
| `tool.kind` | text | tool line: the kind glyph and kind word (each tool.kind.<kind> defaults to it) |
| `tool.title` | text | tool line title, and an expanded tool card's full title |
| `tool.count` | text | tool line: line and match counts |
| `tool.duration` | text | tool line: the duration |
| `tool.index` | text | tool line: the per-session index (#n) |
| `tool.result.label` | text | a command result's labels in an expanded tool card: `Output:` and `Return code:` (defaults to muted) |
| `tool.kind.read` | text | tool line kind of read calls (defaults to tool.kind) |
| `tool.kind.edit` | text | tool line kind of edit calls (defaults to tool.kind) |
| `tool.kind.delete` | text | tool line kind of delete calls (defaults to tool.kind) |
| `tool.kind.move` | text | tool line kind of move calls (defaults to tool.kind) |
| `tool.kind.search` | text | tool line kind of search calls (defaults to tool.kind) |
| `tool.kind.execute` | text | tool line kind of execute calls (defaults to tool.kind) |
| `tool.kind.think` | text | tool line kind of think calls (defaults to tool.kind) |
| `tool.kind.fetch` | text | tool line kind of fetch calls (defaults to tool.kind) |
| `tool.kind.switch_mode` | text | tool line kind of switch_mode calls (defaults to tool.kind) |
| `tool.kind.other` | text | tool line kind of other and unknown calls (defaults to tool.kind) |
| `diff.add` | text | added lines (tool cards, one-liner summaries) |
| `diff.remove` | text | removed lines (tool cards, one-liner summaries) |
| `diff.hunk` | text | diff hunk headers (tool cards) |
| `markdown.heading.1` | text | Markdown level 1 headings (the renderer draws the heavy rule) |
| `markdown.heading.2` | text | Markdown level 2 headings (the renderer draws the light rule) |
| `markdown.heading.3` | text | Markdown level 3 headings |
| `markdown.heading.4` | text | Markdown level 4 headings |
| `markdown.heading.5` | text | Markdown level 5 headings |
| `markdown.heading.6` | text | Markdown level 6 headings |
| `markdown.code` | text | Markdown inline code, and maths shown as its source |
| `markdown.link` | text | Markdown links and footnote references |
| `markdown.quote` | text | Markdown block quotes and thematic breaks |
| `markdown.list` | text | Markdown list bullets and numbers |
| `markdown.task.done` | text | Markdown checked task box [x] |
| `markdown.task.open` | text | Markdown unchecked task box [ ] |
| `markdown.table.border` | text | Markdown table borders and the record layout's rules |
| `markdown.table.header` | text | Markdown table header cells and record headers |
| `markdown.strike` | text | Markdown ~~strikethrough~~ (always; SGR 9 only where the terminal draws it) |
| `markdown.math` | text | Markdown maths converted to Unicode |
| `markdown.alert.note` | text | GitHub alert [!NOTE]: bar and header word |
| `markdown.alert.tip` | text | GitHub alert [!TIP]: bar and header word |
| `markdown.alert.important` | text | GitHub alert [!IMPORTANT]: bar and header word |
| `markdown.alert.warning` | text | GitHub alert [!WARNING]: bar and header word |
| `markdown.alert.caution` | text | GitHub alert [!CAUTION]: bar and header word |
| `code.keyword` | text | highlighted code: keywords |
| `code.string` | text | highlighted code: strings |
| `code.comment` | text | highlighted code: comments |
| `code.number` | text | highlighted code: numbers |
| `code.constant` | text | highlighted code: constants and booleans |
| `code.type` | text | highlighted code: types and classes |
| `code.function` | text | highlighted code: functions and methods |
| `code.variable` | text | highlighted code: variables |
| `code.property` | text | highlighted code: properties and keys |
| `code.operator` | text | highlighted code: operators |
| `code.punctuation` | text | highlighted code: punctuation and brackets |
| `code.tag` | text | highlighted code: markup tags |
| `code.attribute` | text | highlighted code: markup attributes |
| `code.default` | text | highlighted code: every other scope, and code without a grammar |
| `surface.user` | surface | user message card |
| `surface.card` | surface | expanded tool, thought and plan cards |
| `surface.code` | surface | code blocks: a neutral fill, never the permission card's hue |
| `surface.overlay` | surface | overlays: the session list, the link chooser and the @ file picker (the palette, pickers and key help are on the default background); derived at surface.card's step |
| `surface.cursor` | surface | the conversation cursor's gutter bar (its colour), and the highlighted row of an overlay list (a fill) |
| `surface.cursor.faint` | surface | the faint fill across the item under the conversation cursor, beside its bar |
| `surface.selection` | surface | the conversation's text selection (distinct from the cursor's fill) |
| `surface.permission` | surface | permission card fill |
| `surface.permission.selected` | surface | selected option on the permission card (and other cards filled with surface.permission) |
| `status.bg` | surface | status bar background (a surface) |
| `diff.added.bg` | surface | added lines in diffs |
| `diff.removed.bg` | surface | removed lines in diffs |
| `find.current` | surface | the current find hit (text in the default foreground) |
| `find.other` | surface | the other visible find hits (text in the default foreground) |
| `scrollbar.track` | surface | the conversation scroll bar's track; flat: the glyph set's `scrollbar.track` in muted |
| `scrollbar.thumb` | surface | the conversation scroll bar's thumb; flat: the glyph set's `scrollbar.thumb` in muted |
