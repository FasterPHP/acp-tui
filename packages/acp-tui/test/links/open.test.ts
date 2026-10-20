// Opening a link, without a terminal (mvp-rendering task 6.3; src/links/open.ts and hit.ts).
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Item } from "acp-model";
import { classifyTarget } from "../../src/conversation/markdown/links.ts";
import type { LinkTarget } from "../../src/conversation/markdown/types.ts";
import { itemLinks, linkInRow } from "../../src/links/hit.ts";
import { ProgramNotFoundError } from "../../src/agent/which.ts";
import { openerCommand, planOpen, remoteSession, spawnOpener } from "../../src/links/open.ts";

const target = (href: string, cwd: string): LinkTarget => {
  const v = classifyTarget(href, cwd);
  if (!v.allowed) throw new Error(`refused: ${href}`);
  return { href, open: v.open, url: v.url, kind: v.kind, shown: v.shown };
};

const LOCAL = { SSH_CONNECTION: undefined, SSH_TTY: undefined };

describe("the opener", () => {
  test("xdg-open on Linux, open on macOS, ACP_TUI_OPENER instead of either", () => {
    expect(openerCommand({}, "linux")).toBe("xdg-open");
    expect(openerCommand({}, "freebsd")).toBe("xdg-open");
    expect(openerCommand({}, "darwin")).toBe("open");
    expect(openerCommand({ ACP_TUI_OPENER: "/stub/opener" }, "linux")).toBe("/stub/opener");
  });

  // spec tui-agent-session "Programs resolved from the PATH only".
  test("the opener is started by the path its environment's PATH gives; a name on no PATH entry throws before anything starts", async () => {
    expect(() => spawnOpener(["acp-tui-no-such-opener", "https://example.com/"], { PATH: "." })).toThrow(ProgramNotFoundError);
    if (process.platform === "win32") return;
    const bin = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-opener-")));
    const marker = join(bin, "opened");
    writeFileSync(join(bin, "acp-tui-test-opener"), `#!/bin/sh\necho "$1" > '${marker}'\n`);
    chmodSync(join(bin, "acp-tui-test-opener"), 0o755);
    expect(await spawnOpener(["acp-tui-test-opener", "https://example.com/"], { PATH: `${bin}:/usr/bin:/bin` }).exited).toBe(0);
    expect(existsSync(marker)).toBe(true);
  });

  test("an SSH session is SSH_CONNECTION or SSH_TTY", () => {
    expect(remoteSession({})).toBe(false);
    expect(remoteSession({ SSH_CONNECTION: "a b c d" })).toBe(true);
    expect(remoteSession({ SSH_TTY: "/dev/pts/3" })).toBe(true);
  });

  test("a web link: the opener and the URL, one argument; the toast names the host", () => {
    expect(planOpen(target("https://example.com/inline", "/w"), "/w", LOCAL, "linux")).toEqual({ action: "open", argv: ["xdg-open", "https://example.com/inline"], toast: "opening example.com" });
    expect(planOpen(target("mailto:a@b.example", "/w"), "/w", LOCAL, "darwin")).toEqual({ action: "open", argv: ["open", "mailto:a@b.example"], toast: "opening mail to a@b.example" });
  });

  test("over SSH the target is copied instead", () => {
    expect(planOpen(target("https://example.com/x", "/w"), "/w", { SSH_TTY: "/dev/pts/1" }, "linux")).toEqual({ action: "copy", text: "https://example.com/x", toast: "example.com" });
  });

  test("a local file: its real path; missing, or a symlink out of the working directory, refused", () => {
    const dir = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-open-")));
    mkdirSync(join(dir, "docs"));
    writeFileSync(join(dir, "docs/a.md"), "a");
    const outside = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-out-")));
    writeFileSync(join(outside, "secret"), "s");
    symlinkSync(join(outside, "secret"), join(dir, "escape.md"));
    symlinkSync(join(dir, "docs/a.md"), join(dir, "alias.md"));
    expect(planOpen(target("docs/a.md", dir), dir, LOCAL, "linux")).toEqual({ action: "open", argv: ["xdg-open", join(dir, "docs/a.md")], toast: "opening docs/a.md" });
    expect(planOpen(target("alias.md", dir), dir, LOCAL, "linux")).toMatchObject({ action: "open", argv: ["xdg-open", join(dir, "docs/a.md")] });
    expect(planOpen(target("escape.md", dir), dir, LOCAL, "linux")).toEqual({ action: "refuse", toast: "not opened: escape.md leads outside the working directory" });
    expect(planOpen(target("missing.md", dir), dir, LOCAL, "linux")).toEqual({ action: "refuse", toast: "not opened: missing.md does not exist" });
  });

  test("the rules are applied again against the directory at the time of opening", () => {
    const link = target("/w/project/a.md", "/w/project");
    expect(planOpen(link, "/elsewhere", LOCAL, "linux")).toMatchObject({ action: "refuse" });
  });
});

describe("where links are", () => {
  test("linkInRow: the span's link under a column, none between", () => {
    const link = target("https://example.com/a", "/w");
    const row = { spans: [{ token: "text" as const, text: "see " }, { token: "markdown.link" as const, text: "docs", link }, { token: "text" as const, text: " " }] };
    expect(linkInRow(row, 3)).toBeNull();
    expect(linkInRow(row, 4)).toBe(link);
    expect(linkInRow(row, 7)).toBe(link);
    expect(linkInRow(row, 8)).toBeNull();
  });

  test("itemLinks: an agent message's distinct allowed links in order, with their labels", () => {
    const item = {
      kind: "agent_message",
      id: "m",
      text: "[a **bold** label](https://example.com/1), https://example.com/2, [again](https://example.com/1) and [no](javascript:x)",
    } as unknown as Item;
    expect(itemLinks(item).map((l) => [l.label, l.link.href])).toEqual([
      ["a bold label", "https://example.com/1"],
      ["https://example.com/2", "https://example.com/2"],
    ]);
    expect(itemLinks({ kind: "user_message", id: "u", text: "https://example.com" } as unknown as Item)).toEqual([]);
  });
});
