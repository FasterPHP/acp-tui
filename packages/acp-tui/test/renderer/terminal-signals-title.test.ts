// windows-support D5: the tab's title is set again once a harness has started, on Windows only
// (npm's `.cmd` shims run `title %COMSPEC%`). The title machinery is title.test.ts's; this is the
// platform rule of `createTerminalSignals(...).reassertTitle`, with a fake renderer.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession, type Session } from "acp-model";
import type { CliRenderer } from "@opentui/core";
import { createTerminalSignals } from "../../src/renderer/terminal-signals.ts";
import { createTitleSlots } from "../../src/renderer/title-slot.ts";

let dir: string;
let realWrite: typeof process.stdout.write;
beforeEach(() => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-signals-title-"));
  // The escape output of a renderer without a session goes to stdout; keep it out of the report.
  realWrite = process.stdout.write;
  process.stdout.write = (() => true) as typeof process.stdout.write;
});
afterEach(() => {
  process.stdout.write = realWrite;
  rmSync(dir, { recursive: true, force: true });
});

function fixture(platform: NodeJS.Platform) {
  const session: Session = { ...createSession(), cwd: "/work/acp-tui" };
  const titles: string[] = [];
  const renderer = {
    isDestroyed: false,
    setTerminalTitle: (t: string) => void titles.push(t),
    on() {},
    off() {},
    stdinParser: { push: () => undefined },
  } as unknown as CliRenderer;
  const store = { snapshot: () => session, onChange: () => () => {}, ui: { mouse: "wheel" } } as never;
  const signals = createTerminalSignals({ store, platform, env: {}, titleSlots: createTitleSlots({ dir }) });
  return { signals, renderer, titles };
}

describe("reassertTitle", () => {
  test("on Windows it sets the current title again", () => {
    const f = fixture("win32");
    f.signals.install(f.renderer);
    expect(f.titles).toEqual(["acp-tui"]);
    f.signals.reassertTitle();
    expect(f.titles).toEqual(["acp-tui", "acp-tui"]);
    f.signals.restore();
  });

  test("on Linux and macOS it writes nothing", () => {
    for (const platform of ["linux", "darwin"] as const) {
      const f = fixture(platform);
      f.signals.install(f.renderer);
      f.signals.reassertTitle();
      expect(f.titles).toEqual(["acp-tui"]);
      f.signals.restore();
    }
  });

  test("before the renderer is installed it does nothing", () => {
    const f = fixture("win32");
    f.signals.reassertTitle();
    expect(f.titles).toEqual([]);
  });
});
