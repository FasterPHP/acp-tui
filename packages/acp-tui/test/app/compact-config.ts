// A configuration store whose user file sets `"density": "compact"`, for the in-process tests
// written against `compact` since `focus` became the default density (day-one-feedback task 3.4).
// The file is in a temporary configuration home of its own, never the user's.
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfigStore, type ConfigStore } from "../../src/config/store.ts";

export function compactConfig(): ConfigStore {
  const home = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-cfg-")));
  mkdirSync(join(home, "acp-tui"));
  writeFileSync(join(home, "acp-tui", "config.jsonc"), JSON.stringify({ density: "compact" }));
  return createConfigStore({ env: { XDG_CONFIG_HOME: home, HOME: "/home/u" }, sessionDirectory: null });
}
