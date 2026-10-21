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

  test("config.dist.jsonc is never watched: an invalid one written and replaced while the store runs causes no reload and no problem (interface-feedback 5.2)", async () => {
    const xdg = temp("acp-tui-xdg-");
    mkdirSync(join(xdg, "acp-tui"));
    const file = join(xdg, "acp-tui", "config.jsonc");
    writeFileSync(file, `{ "density": "compact" }`);
    const store = createConfigStore({ env: { XDG_CONFIG_HOME: xdg, HOME: xdg }, sessionDirectory: null });
    let reloads = 0;
    store.onReload(() => void reloads++);
    store.watch();
    try {
      const dist = join(xdg, "acp-tui", "config.dist.jsonc");
      writeFileSync(dist, `{ "density": "bogus", oops`);
      const tmp = join(xdg, "acp-tui", ".config.dist.jsonc.tmp");
      writeFileSync(tmp, `{ "mouse": 12`);
      renameSync(tmp, dist);
      // Several times the debounce (150 ms): a reload, had one been due, would have happened.
      await Bun.sleep(700);
      expect(reloads).toBe(0);
      expect(store.problems()).toEqual([]);
      expect(store.config().density).toBe("compact");
      // The watcher still works for the real file.
      writeFileSync(file, `{ "density": "verbose" }`);
      const deadline = Date.now() + 1000;
      while (store.config().density !== "verbose" && Date.now() < deadline) await Bun.sleep(10);
      expect(store.config().density).toBe("verbose");
      expect(reloads).toBeGreaterThan(0);
    } finally {
      store.dispose();
    }
  });
});
