# Changelog

## Unreleased

### Breaking changes

- Ctrl+D always leaves, whatever the prompt box holds. It no longer deletes forward when there is a draft: use Delete, or bind another key to `detach` and remove Ctrl+D under `keys`.

### Prompt box

- The cursor's colour comes from the terminal: acp-tui asks for its cursor, foreground and background colours at start and uses the cursor colour when it can be seen against the background, else the foreground (a dark cursor on a light theme was invisible in foot). The prompt box shows no cursor for the first moments (at most 0.3 seconds) until the terminal has answered, and `OSC 112` gives the terminal its own colour back at exit and on every fallback reset.
- Unsent drafts are kept per session: leaving a session that can be reopened with text in the prompt box (Ctrl+D, `/exit`, a closed window, a signal or a switch) saves the text, its `@` mentions and the cursor in a private file in acp-tui's state directory, and `-c`, `-r` or the session list puts it back. It is removed when you send a prompt or leave with an empty prompt box. At most 200 drafts of 256 KiB are kept.
- A draft that is not kept (too large, a session that cannot be reopened, or `prompt.keep_drafts` set to `false`) is printed below the command line at exit after `draft (not sent):`, unwrapped so that it can be copied back.
- New setting `prompt.keep_drafts` (default `true`), read from your own file only. Drafts are plain files that may hold anything you typed, a secret included.

### Other changes

- Muted text on a light background is drawn as a mix of the terminal's foreground and background colours, so it stays legible.
- A tool card's output note counts lines, not rows (`3 lines hidden`), and a harness that streams only the tail of an output shows `last N lines`.
- `focus` density shows one line per gap of hidden tool calls, thoughts and plans, in the place of the gap, instead of one line per turn, so a turn with several answers keeps its answers apart from its calls. A line sits between the answers with a blank row on each side, like any tool line; opening one line shows only its members.
- The turn-end line shows the turn's totals when it has more than one such gap, in every density: `end turn · 6 tool calls (1 failed) · 1 thought · 42.0s`, or `interrupted · 2 tool calls (1 stopped) · 1 thought` after an interrupt.
- Once a running turn has more than one such gap, the activity line shows its count at the right (`2 tool calls (1 running) · 1 thought`), and keeps it during `activity.linger_seconds`; with one gap the gap's own line shows it.

## 0.3.0

Auggie 1.x (`@augmentcode/auggie` 1.2, now its default install) works with the same `auggie` entry as 0.x. If you upgraded Auggie, log in again with `auggie auth login`; sessions made with 0.x cannot be opened by 1.x (import them in Auggie with `/import-legacy-sessions`).

### Auggie 1.x

- Auggie 1.x (`npm install -g @augmentcode/auggie`, Node 20.6 or later, then `auggie auth login`) is supported next to 0.x, with the one `auggie` entry. acp-tui recognises the generation from Auggie's answer to `initialize`; the login hint, the install hint and the notice for a version newer than checked (1.2.x, 0.37.x) follow it. The commented `auggie` example explains both generations, `--thinking` for 1.x, and `--permission bash:ask-user` (also `write` and `edit`) rules, which 1.x needs to ask before it acts; a commented `auggie-v2` example runs 1.x from `@augmentcode/onison` beside a 0.x `auggie`.
- A model chosen in 1.x is saved as Auggie's global default.
- Auggie 1.x indexes a directory only once it is allowed. acp-tui now turns Auggie's `Indexing disabled` line into a question card, `Auggie is not indexing <dir>.`, opening with nothing selected (digits choose, Esc means not now). Allowing restarts Auggie with `--allow-indexing`, which Auggie keeps as a lasting rule; a stored deny, a file-limit line and the home-directory line are notices.
- Each session records which Auggie made it. A session of the other generation is refused with a message that says how to get back to it (`/import-legacy-sessions` in 1.x).
- The login hint names the command for the generation that is running (`auggie auth login` or `auggie login`). With Auggie 1.x logged out, acp-tui stops at start-up with that command instead of failing every prompt with `Internal error`.
- The indexing question takes focus and mouse like the permission card: a click selects an option, Tab returns to the card from the prompt box.
- Auggie 1.x does not list your custom commands and skills in the `/` menu (it sends none); they still work when typed (`/`, Esc, then the name).
- The splash's arrow is `→` alone (the box-drawing line drew as a block in some terminals).
- Model pickers draw descriptions in a column after the names and cut them only at the row's end; when the harness names no current model, a line says that `default` is the harness's own choice (Auggie does not say which model that is).
- The advice for a 1.x session refused under 0.x reads `npm install -g @augmentcode/auggie@latest`.

### Other changes

- When a harness refuses a request, the reason it gives in the error's data is shown instead of `Internal error`.
- Permission cards name their options by what they do when a harness sends two with the same kind, and show a request for a tool call the harness has not announced.
- A turn you interrupt ends as `interrupted`, whatever stop reason the harness answers with.
- Tool calls that carry only a bare tool name as their title are drawn as their command or path; pi's failed-command text shows as a command result; the mode hint is hidden when a harness offers no modes.
- A session is recorded in the index on its first answered prompt, so a session that was never answered does not fill the list.
- `/add-dir` and `--add-dir` work before the first prompt.
- Errors and the messages of the session list can be selected and copied.
- Rows in the session list for a command you ran with `--` show a short harness name (`claude` for the Claude adapter, the script's name for a runner).
- Tool output keeps its line breaks: plain text output (from any harness, when it is not a recognised command result or a code block) was drawn with its lines joined.
- A permission question keeps its line breaks, in the card's scrollable preview, so a command quoted on its own line stays on its own line; so does an answered permission's record when expanded.
- Emoji that a terminal measures differently from how it draws them (`⚠️` in Zed) are drawn as their names in permission cards too, so the card's frame lines up.
- The tester guide says to install Auggie 1.x; an older `config.jsonc` without `agent_servers` needs an `auggie` entry (`acp-tui config --diff-default` shows it).

## 0.2.0

### Breaking changes

Harnesses now come only from your configuration file. If you set up 0.1.0 with the built-in `claude` or a bare command name, add an `agent_servers` entry for it: `acp-tui config --print-default` shows commented entries for `claude`, `opencode` and others to copy.

- A harness works only if it has an `agent_servers` entry. The default configuration has one, `auggie`, in effect; `claude`, `opencode` and the others are commented examples: remove the `//` to add one. With no configuration file acp-tui behaves as if it held that default, so a fresh checkout starts Auggie without `install-cli`. A file that exists is taken as written.
- A word that names no configured harness and no directory is an error; acp-tui never looks it up on your `PATH`. A command runs only after `--` (`acp-tui -- opencode acp`).
- A `default_agent_server` (or `default_agent`) naming a harness without an entry is reported by `acp-tui config --check`, and plain `acp-tui` then stops with `default harness '<name>' is not configured` and where to copy the entry from. Nothing changes your file.
- The session list offers exactly your configured harnesses.
- Additional directories in your own file belong to a harness: `agent_servers.<name>.additional_directories` adds them to every session of that harness only, through ACP or the entry's `additional_directory_args`. A top-level `additional_directories` in your own file is now reported by `acp-tui config --check` with a message to move it into the entries that should get it, and ignored; a project's `.acp-tui.jsonc` keeps it, for whichever harness runs. So starting a harness that cannot take directories no longer shows a notice every time. The default's commented `auggie` alternative uses `additional_directories` instead of `--add-workspace` in `args`.

### Slash menu

- Tab completes the selected entry of the slash menu into the prompt box as `/<name> `, so arguments can follow it. The key is the new `slash` key context's `complete` action (`keys.slash`), and the menu's border names it.
- Enter on an agent command in the slash menu now always completes it into the prompt box and sends nothing, whether or not the harness sent an argument hint, since a missing hint does not mean the command takes no arguments (`/openspec-apply-change` could not be given a change name before). A second Enter sends it, so a command that takes none, such as `/compact`, takes two presses of Enter from the menu. acp-tui's own commands keep their actions on Enter.
- A prompt that starts with `/` is sent without trailing spaces, so a completed `/compact ` reaches the harness as `/compact`.
- The slash menu lists each group in alphabetical order of name, whatever order the harness sent its commands in. While you type a filter, each group puts the entries where every word starts the name or a word of it first (`ap` lists `/claude-api` and `/openspec-apply-change` before `/heapdump`), then those that hold the words elsewhere in the name, then those matched only through their description, under a muted line `-- matching descriptions --`. The selection starts on the first name match, so `/appl` selects `/openspec-apply-change` before a command that merely mentions an application.
- Undoing a completed command in the prompt box no longer leaves its argument hint behind.

### Other changes

- What a harness needs is in its entry: Auggie's `additional_directory_args`, Claude's `startup_timeout_seconds` of 120. Install and login hints follow the program an entry runs, whatever the entry is called.
- A harness that lists models but names no current one (Auggie right after a login) shows `default` in the model pill, the status row and the splash, and the model picker opens as usual.
- A setting change the harness is slow to answer shows a notice after 3 s, and after 30 s a warning that names the value still in force; a later answer still applies.
- Model lists whose names are `<provider name>/<model>` (OpenCode 1.x) are grouped under each provider's name.
- The `@` file picker lists files in one case-insensitive alphabetical order, tracked and untracked together, with a directory's files kept together.
- Windows: Ctrl+C works while `--resume <id>` or `--continue` is finding a session, even when acp-tui was started with Ctrl+C ignored; the login and install hints name `auggie.cmd` and `npm.cmd`, which run under PowerShell's default execution policy; messages show the home directory as `~` instead of `undefined`.
- The commented Auggie examples no longer set a reasoning effort, since Auggie keeps a start-up effort across model changes.

## 0.1.0 (preview for testers)

First version shared with testers.

- Full-screen terminal client for ACP agents, for IDE terminals (PhpStorm, IntelliJ IDEA, Zed) and ordinary terminals, on Linux, macOS and Windows.
- Two built-in harnesses: `auggie` (`auggie --acp` from your `PATH`, the default for now) and `claude` (Claude Code through `claude-agent-acp`). Plain `acp-tui` starts Auggie, `acp-tui claude` starts Claude. Others are added in the configuration file.
- If Auggie is not installed, acp-tui prints the install command; if you are not logged in, it says to run `auggie login`. A notice appears when Auggie 1.x is the one running, since it has not been checked.
- The session list offers a built-in harness only when it is installed.
- `acp-tui --version` (and `-v`) prints the version, commit, Bun, platform and terminal, for bug reports.
- A crash writes a report under acp-tui's state directory and names it in the exit text; attach it to your report.
- Java, Kotlin and XML code blocks are highlighted, alongside PHP, JSON, YAML, Python, SQL and shell.
- `bun run update` brings a checkout up to date (`git pull --ff-only`, then `bun install` if the lock file changed).
- Issue forms for bugs and feedback, a README, a tester guide and a NOTICE file.
