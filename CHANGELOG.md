# Changelog

## Unreleased

### Auggie 1.x

- Auggie 1.x (`npm install -g @augmentcode/auggie`, Node 20.6 or later, then `auggie auth login`) is supported next to 0.x, with the one `auggie` entry. acp-tui recognises the generation from Auggie's answer to `initialize`; the login hint, the install hint and the notice for a version newer than checked (1.2.x, 0.37.x) follow it. The commented `auggie` example explains both generations, `--thinking` for 1.x, and `--permission bash:ask-user` (also `write` and `edit`) rules, which 1.x needs to ask before it acts; a commented `auggie-v2` example runs 1.x from `@augmentcode/onison` beside a 0.x `auggie`.
- A model chosen in 1.x is saved as Auggie's global default.
- Auggie 1.x indexes a directory only once it is allowed. acp-tui now turns Auggie's `Indexing disabled` line into a question card, `Auggie is not indexing <dir>.`, opening with nothing selected (digits choose, Esc means not now). Allowing restarts Auggie with `--allow-indexing`, which Auggie keeps as a lasting rule; a stored deny, a file-limit line and the home-directory line are notices.
- Each session records which Auggie made it. A session of the other generation is refused with a message that says how to get back to it (`/import-legacy-sessions` in 1.x).
- The login hint names the command for the generation that is running (`auggie auth login` or `auggie login`).

### Other changes

- When a harness refuses a request, the reason it gives in the error's data is shown instead of `Internal error`.
- Permission cards name their options by what they do when a harness sends two with the same kind, and show a request for a tool call the harness has not announced.
- A turn you interrupt ends as `interrupted`, whatever stop reason the harness answers with.
- Tool calls that carry only a bare tool name as their title are drawn as their command or path; pi's failed-command text shows as a command result; the mode hint is hidden when a harness offers no modes.
- A session is recorded in the index on its first answered prompt, so a session that was never answered does not fill the list.
- `/add-dir` and `--add-dir` work before the first prompt.
- Errors and the messages of the session list can be selected and copied.
- Rows in the session list for a command you ran with `--` show a short harness name (`claude` for the Claude adapter, the script's name for a runner).
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
