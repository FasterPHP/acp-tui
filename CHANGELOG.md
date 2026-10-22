# Changelog

## Unreleased

- Tab completes the selected entry of the slash menu into the prompt box as `/<name> `, so arguments can follow it. The key is the new `slash` key context's `complete` action (`keys.slash`), and the menu's border names it.
- Enter on an agent command in the slash menu now always completes it into the prompt box and sends nothing, whether or not the harness sent an argument hint, since a missing hint does not mean the command takes no arguments (`/openspec-apply-change` could not be given a change name before). A second Enter sends it, so a command that takes none, such as `/compact`, takes two presses of Enter from the menu. acp-tui's own commands keep their actions on Enter.
- A prompt that starts with `/` is sent without trailing spaces, so a completed `/compact ` reaches the harness as `/compact`.
- The slash menu lists each group in alphabetical order of name, whatever order the harness sent its commands in. While you type a filter, each group puts the entries where every word starts the name or a word of it first (`ap` lists `/claude-api` and `/openspec-apply-change` before `/heapdump`), then those that hold the words elsewhere in the name, then those matched only through their description, under a muted line `-- matching descriptions --`. The selection starts on the first name match, so `/appl` selects `/openspec-apply-change` before a command that merely mentions an application.
- Undoing a completed command in the prompt box no longer leaves its argument hint behind.
- A harness works only if it has an `agent_servers` entry. The default configuration has one, `auggie`, in effect; `claude`, `opencode` and the others are commented examples: remove the `//` to add one. With no configuration file acp-tui behaves as if it held that default, so a fresh checkout starts Auggie without `install-cli`. A file that exists is taken as written.
- What a harness needs is in its entry: Auggie's `additional_directory_args`, Claude's `startup_timeout_seconds` of 120. Install and login hints follow the program an entry runs, whatever the entry is called.
- A `default_agent_server` (or `default_agent`) naming a harness without an entry is reported by `acp-tui config --check`, and plain `acp-tui` then stops with `default harness '<name>' is not configured` and where to copy the entry from. Nothing changes your file.
- A word that names no configured harness and no directory is an error; acp-tui never looks it up on your `PATH`. A command runs only after `--` (`acp-tui -- opencode acp`).
- The session list offers exactly your configured harnesses.
- Additional directories in your own file belong to a harness: `agent_servers.<name>.additional_directories` adds them to every session of that harness only, through ACP or the entry's `additional_directory_args`. A top-level `additional_directories` in your own file is now reported by `acp-tui config --check` with a message to move it into the entries that should get it, and ignored; a project's `.acp-tui.jsonc` keeps it, for whichever harness runs. So starting a harness that cannot take directories no longer shows a notice every time. The default's commented `auggie` alternative uses `additional_directories` instead of `--add-workspace` in `args`.

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
