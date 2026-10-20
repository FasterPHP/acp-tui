// The terminal IDs of the per-terminal table (mvp-configuration design D12; spec tui-config
// "Per-terminal table"): the rows of `capabilities.ts` and the keys of the `terminals` setting.
// A module of its own, with no imports, so the configuration schema and the renderer share it.

/** `jetbrains` is both PhpStorm terminals (and IntelliJ's on Windows); `default` is any terminal the table does not name. */
export const TERMINAL_IDS = ["jetbrains", "zed", "ghostty", "kitty", "wezterm", "iterm2", "windows-terminal", "default"] as const;
export type TerminalId = (typeof TERMINAL_IDS)[number];
