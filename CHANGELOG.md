# Changelog

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
