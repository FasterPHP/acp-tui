# Contributing to acp-tui

Thank you for your interest. acp-tui is at an early, preview stage.

## Issues first

Open an issue before you start on a change, so we can agree it is wanted and how it should work. Bugs and feedback have forms: https://github.com/FasterPHP/acp-tui/issues/new/choose. Include the output of `acp-tui --version`.

## Pull requests

Pull requests are made against this repository, which is the code's only home. They are reviewed and merged by Marcus Don here.

- Keep a change focused, with tests for the behaviour it changes.
- Write commit messages that describe the change in plain terms.
- Use British English, and no em or en dashes, in code comments, messages and docs.
- Pin dependencies exactly (no ranges).

## Working on the code

```sh
bun install
bun run test        # a parallel pass, then the timing tests serially
bun run typecheck
```

Do not run the suite on macOS: some tests reach the real pasteboard there. Run it on Linux or Windows, or run only the tests that cover your change with `bun test <path>` (not the clipboard ones) and let the continuous check on the pull request run the rest. `bun run test:windows` runs the suite on GitHub's Windows runner for the pushed branch.

A test whose assertion has an upper bound or a band on wall-clock time goes in a `*.timing.test.ts` file. A wait in a test ends on the outcome (text, a cell, a log event), never on a quiet screen.

The workspace layout and conventions are in [AGENTS.md](AGENTS.md). By contributing you agree that your contribution is licensed under the Apache License 2.0, as the project is.
