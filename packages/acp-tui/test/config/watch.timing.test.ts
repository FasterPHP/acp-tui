// parallel-tests task 3.4: the watcher test with the real `fs.watch` (task 3.1): the store applies
// a rename save within a second, and a later one too. The time bound depends on the machine's
// load, so it runs in the serial pass; the unit tests of the watcher are in watch.test.ts.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfigStore } from "../../src/config/store.ts";

const temp = (prefix: string) => realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), prefix)));

describe("the configuration watcher (task 3.1)", () => {
  test("with the real fs.watch: the store applies a rename save within a second, and a later one too", async () => {
    const xdg = temp("acp-tui-xdg-");
    mkdirSync(join(xdg, "acp-tui"));
    const file = join(xdg, "acp-tui", "config.jsonc");
    writeFileSync(file, `{ "density": "compact" }`);
    const store = createConfigStore({ env: { XDG_CONFIG_HOME: xdg, HOME: xdg }, sessionDirectory: null });
    store.watch();
    const save = (text: string) => {
      const tmp = join(xdg, "acp-tui", ".config.jsonc.swp");
      writeFileSync(tmp, text);
      renameSync(tmp, file);
    };
    const until = async (check: () => boolean) => {
      const deadline = Date.now() + 1000;
      while (!check() && Date.now() < deadline) await Bun.sleep(10);
      return check();
    };
    try {
      save(`{ "density": "verbose" }`);
      expect(await until(() => store.config().density === "verbose")).toBe(true);
      save(`{ "density": "focus" }`);
      expect(await until(() => store.config().density === "focus")).toBe(true);
    } finally {
      store.dispose();
    }
  });
});
