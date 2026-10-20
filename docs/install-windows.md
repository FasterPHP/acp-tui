# Installing acp-tui on Windows

How to run acp-tui on Windows 10 or 11 from PowerShell, in IntelliJ IDEA's terminal or in Windows Terminal, with Auggie or Claude Code as the harness (the coding agent program acp-tui launches). The commands are for Windows PowerShell 5.1 or PowerShell 7; where cmd.exe differs, it says so.

## What you need

| Program | Why | Install |
| --- | --- | --- |
| Bun 1.3.14 or later | runs acp-tui | `winget install Oven-sh.Bun`, or `powershell -c "irm bun.sh/install.ps1 \| iex"` |
| Git for Windows | the checkout, the `@` file picker, and Claude Code's shell tool | `winget install Git.Git` |
| Node.js 20 or later (with npm) | Auggie and most other harnesses are npm packages | `winget install OpenJS.NodeJS.LTS` |
| A harness | the agent you talk to | [Auggie](#3-install-a-harness) or the built-in `claude` |

Open a new terminal after installing, so that the `PATH` is read again, and check:

```powershell
bun --version
git --version
node --version
```

Bun's installer adds `%USERPROFILE%\.bun\bin` to your user `PATH`. The `acp-tui` command goes there too.

## 1. Check out acp-tui and install its dependencies

```powershell
git clone https://github.com/FasterPHP/acp-tui.git
cd acp-tui
bun install
```

The checkout works with `core.autocrlf` set either way (`true` is Git for Windows' default): the repository's `.gitattributes` keeps its text files on LF line endings.

## 2. Install the `acp-tui` command

```powershell
bun run install-cli
```

On Windows this writes `acp-tui.cmd` into `%USERPROFILE%\.bun\bin` (use `--dir <path>` for another directory). It is a small batch file that holds the checkout's path and the path of the Bun that ran the install, and runs the checkout's `packages\acp-tui\src\cli.ts`; a `git pull` updates the command, so run `install-cli` again only if you move the checkout or install another Bun. It prints the file's path, warns if the directory is not on your `PATH`, and creates your configuration file (below) when there is none.

Open a new PowerShell window (the command is not found by windows that were open before the install) and check it from a directory that is not the checkout:

```powershell
cd $HOME
acp-tui --help
```

If the checkout moves, `acp-tui` exits with status 127 and tells you to run `bun run install-cli` in the checkout again. `bun run install-cli --uninstall` removes `acp-tui.cmd` if `install-cli` wrote it, and never anything else. `bun run install-cli --force` replaces a file of that name that `install-cli` did not write.

### Try it without a harness

acp-tui ships with a scripted test agent, so you can see it work before installing any harness. From any directory, with the path to your checkout in place of `C:\src\acp-tui`:

```powershell
acp-tui -- bun C:\src\acp-tui\packages\fake-agent\src\main.ts --scenario basic
```

Everything after `--` is the harness command. Press Ctrl+D to leave.

## 3. Install a harness

### Auggie

```powershell
npm install -g @augmentcode/auggie
auggie login
```

npm 11 prints a warning that the install script of `node-pty` was not run. It did not stop Auggie from running over ACP. Log in with `auggie login` in an ordinary terminal first: Auggie cannot log in over ACP, and without a login acp-tui starts, then exits with "Authentication required: ... Please run 'auggie login'".

Then give acp-tui an entry for it in your configuration file (`acp-tui config --path` prints where that is; open it in any editor):

```jsonc
{
  "agent_servers": {
    "auggie": { "command": "auggie", "args": ["--acp"] },
  },
}
```

The commented default already holds this entry: remove the comment marks from it. `acp-tui config --check` reports mistakes in the file, and then:

```powershell
acp-tui auggie
```

starts Auggie in the current directory. Set `"default_agent_server": "auggie"` to start it with a bare `acp-tui`.

On Windows `auggie` is a `.cmd` file made by npm, which acp-tui starts through `cmd.exe`, as Bun does. Bun refuses to start a `.cmd` or `.bat` file when an argument holds `"`, `%`, `&`, `|`, `<`, `>`, `^` or a line break, so keep them out of an entry's `args`; `acp-tui config --check` warns about them. The same goes for the path of the `.cmd` file itself: a user name such as `R&D` puts one in every npm command. Spaces are fine, in the path (`C:\Users\First Last\...`) and in the arguments.

### Claude Code (built in)

With no configuration, plain `acp-tui` runs the built-in `claude` harness, `claude-agent-acp`, which Bun downloads on first use. It uses your Claude Code login, so sign in to Claude Code first. Other harnesses (Codex, OpenCode and the rest) are listed, with their commands, in [configuration.md](configuration.md#harnesses).

## 4. Terminals

### IntelliJ IDEA

Open the terminal (Alt+F12). It runs PowerShell, and `acp-tui` works there as in any terminal:

- Shift+Enter inserts a newline in the prompt box (and so does Alt+Enter).
- Ctrl+V pastes (the IDE's paste, delivered to acp-tui as one paste).
- Mouse wheel scrolling, selecting by dragging and Ctrl+D to leave behave as on other systems.

Restart the terminal tab after `install-cli` if `acp-tui` is not found.

### Windows Terminal

Update to Windows Terminal 1.25 or later (the Microsoft Store updates it, or `winget upgrade Microsoft.WindowsTerminal`). From 1.25 Windows Terminal speaks the kitty keyboard protocol, so Shift+Enter inserts a newline in acp-tui with nothing to set up.

Before 1.25 Windows Terminal sends Shift+Enter exactly as Enter, which sends your prompt. Use Ctrl+Enter or Ctrl+J for a newline instead; neither needs setup. If you cannot update and want Shift+Enter, add a binding to Windows Terminal's `settings.json` (Settings, Open JSON file), keeping the `actions` and `keybindings` arrays you already have:

```json
{
  "actions": [
    { "command": { "action": "sendInput", "input": "\u001b[13;2u" }, "id": "User.acpShiftEnter" }
  ],
  "keybindings": [
    { "id": "User.acpShiftEnter", "keys": "shift+enter" }
  ]
}
```

Caveat: Windows Terminal has no per-profile bindings, so this applies to every tab, and it replaces PowerShell's own Shift+Enter (which starts a new line of a multi-line command) as well. Updating to 1.25 avoids that.

## 5. Where acp-tui keeps its files

| What | Where |
| --- | --- |
| Configuration | `%APPDATA%\acp-tui\config.jsonc` (usually `C:\Users\<you>\AppData\Roaming\acp-tui`); `acp-tui config --path` prints it |
| Themes | `%APPDATA%\acp-tui\themes\` |
| Session index and state | `%LOCALAPPDATA%\acp-tui\` (usually `C:\Users\<you>\AppData\Local\acp-tui`) |

`install-cli` creates the configuration file with every setting commented at its default, and never replaces one that exists. An `XDG_CONFIG_HOME` or `XDG_STATE_HOME` environment variable that holds an absolute path overrides these places. [configuration.md](configuration.md) describes every setting.

## When something goes wrong

Write a debug log (method names, IDs, states and timings; never your prompts or the agent's text) and reproduce the problem:

```powershell
$env:ACP_TUI_LOG = "$env:TEMP\acp-tui.log"
acp-tui auggie
```

(cmd.exe: `set ACP_TUI_LOG=%TEMP%\acp-tui.log`.) Then report:

- what you typed and what you expected, with a screenshot if the screen looks wrong;
- the log, `acp-tui.log` in your temporary directory;
- the output of `bun --version`, `node --version`, `git --version`, and `auggie --version` if you use Auggie;
- the commit you run (`git rev-parse --short HEAD` in the checkout), your Windows version (`winver`), and the terminal with its version: Windows Terminal (Settings, About), or IntelliJ's build (Help, About);
- whether PowerShell was Windows PowerShell 5.1 or PowerShell 7 (`$PSVersionTable.PSVersion`).
