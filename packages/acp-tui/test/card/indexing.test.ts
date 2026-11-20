// auggie-1x-support tasks 10.2, 10.4 and 10.5 (design D16; spec tui-layout "Indexing question card",
// tui-agent-session "Declining Auggie's indexing" and "Other indexing lines from Auggie"): the run's
// indexing host and the card's rows.
import { describe, expect, test } from "bun:test";
import { createRoot } from "solid-js";
import { elicitationRows } from "../../src/card/elicitation-form.ts";
import { createIndexingHost, deniedNotice, FROM_ACP_TUI, INDEXING_OPTIONS, indexingParagraphs, shownDirectory } from "../../src/card/indexing.tsx";

function host(allowResult: string | null = null) {
  const notices: string[] = [];
  let allowed = 0;
  let resolveAllow!: (failure: string | null) => void;
  const h = createRoot(() =>
    createIndexingHost({
      notify: (text) => notices.push(text),
      allow: () => {
        allowed += 1;
        return new Promise((resolve) => (resolveAllow = resolve));
      },
      fresh: () => false,
      home: "/home/user",
    }),
  );
  return { h, notices, allowed: () => allowed, finish: (failure: string | null = allowResult) => resolveAllow(failure) };
}
const disabled = (directory: string) => ({ kind: "disabled" as const, directory });

describe("the indexing host", () => {
  test("collects directories in order, once each; a line while the card is open joins it", () => {
    const { h } = host();
    expect(h.current()).toBeNull();
    expect(h.take(disabled("/work/app"))).toBe(true);
    expect(h.take(disabled("/work/app"))).toBe(true);
    expect(h.current()).toEqual({ directories: ["/work/app"] });
    h.take(disabled("/work/lib"));
    expect(h.current()).toEqual({ directories: ["/work/app", "/work/lib"] });
  });

  test("not now: the directories are dropped silently for the rest of the run", () => {
    const { h, notices } = host();
    h.take(disabled("/work/app"));
    h.decline();
    expect(h.current()).toBeNull();
    h.take(disabled("/work/app"));
    expect(h.current()).toBeNull();
    expect(notices).toEqual([]);
    // Another directory is still asked about.
    h.take(disabled("/work/lib"));
    expect(h.current()).toEqual({ directories: ["/work/lib"] });
  });

  test("allow, then the line again: a stored deny rule, one notice naming indexingDenyDirs, never asked again", async () => {
    const { h, notices, allowed, finish } = host();
    h.take(disabled("/home/user/Projects/app"));
    h.allow();
    expect(allowed()).toBe(1);
    expect(h.current()).toBeNull();
    finish(null);
    await Bun.sleep(0);
    h.take(disabled("/home/user/Projects/app"));
    h.take(disabled("/home/user/Projects/app"));
    expect(h.current()).toBeNull();
    expect(notices).toEqual(["Auggie has a rule never to index ~/Projects/app; remove it in auggie or from indexingDenyDirs in ~/.augment/settings.json"]);
  });

  test("an allow that failed is no deny rule: the line is then dropped as for not now", async () => {
    const { h, notices, finish } = host();
    h.take(disabled("/work/app"));
    h.allow();
    finish("cannot start harness 'auggie': gone");
    await Bun.sleep(0);
    h.take(disabled("/work/app"));
    expect(h.current()).toBeNull();
    expect(notices).toEqual([]);
  });

  test("the file-limit and home-directory texts are warning notices, once each, sanitised, and never a question", () => {
    const { h, notices } = host();
    const limited = { kind: "limited" as const, directory: "/work/app", text: 'Indexing limited for "/work/app": file limit reached. Use a smaller workspace or exclude files with .augmentignore.' };
    const home = { kind: "home" as const, directory: "/home/user", text: 'Indexing disabled for "/home/user": home directory or parent directory.‮ Start in a project.' };
    expect(h.take(limited)).toBe(true);
    expect(h.take(home)).toBe(true);
    h.take(limited);
    expect(h.current()).toBeNull();
    expect(notices).toEqual([limited.text, 'Indexing disabled for "/home/user": home directory or parent directory. Start in a project.']);
  });

  test("the deny notice and the shown directory: the home directory as ~, sanitised", () => {
    expect(shownDirectory("/home/user/Projects/app", "/home/user")).toBe("~/Projects/app");
    expect(shownDirectory("/work/a\u001b[31mb", "/home/user")).not.toContain("\u001b");
    expect(deniedNotice("/work/app")).toContain("indexingDenyDirs");
  });
});

describe("the indexing card's rows", () => {
  const rows = (directories: string[], fresh: boolean, width: number) =>
    elicitationRows(
      { kind: "client", subtitle: FROM_ACP_TUI, paragraphs: indexingParagraphs(directories.map((d) => shownDirectory(d, "/home/user")), fresh), options: INDEXING_OPTIONS, cursor: 1 },
      width,
      { focused: true, maxRows: 100, hints: [{ text: "enter choose · esc not now", token: "muted" }] },
    ).map((row) => row.map((s) => s.text).join(""));
  const body = (r: string[]) => r.slice(1, -1).map((row) => row.slice(1, -1).trim()).join(" ");

  test("One directory: Question from acp-tui, the directory with ~, what allowing does, the lasting rule, how to refuse for good, the two options", () => {
    const r = rows(["/home/user/Projects/app"], false, 63);
    expect(r[0]).toStartWith("╭─ ◊ Question  from acp-tui ─");
    expect(r.every((row) => row.length === 63)).toBe(true);
    const text = body(r);
    for (const part of ["~/Projects/app", "--allow-indexing", "reopens this session", "indexingAllowDirs in ~/.augment/settings.json", "To never index a directory, answer Auggie's own question in auggie, started in that directory.", "1 allow indexing   2 not now"]) {
      expect(text).toContain(part);
    }
    expect(r.at(-1)).toContain("esc not now");
  });

  test("Before the first prompt: allowing starts a new session", () => {
    const text = body(rows(["/work/app"], true, 63));
    expect(text).toContain("starts a new session");
    expect(text).not.toContain("reopens this session");
  });

  test("A directory joins: each directory on its own row, a long one wrapped, never cut", () => {
    const long = `/work/${"x".repeat(90)}`;
    const r = rows(["/work/app", long], false, 63);
    expect(r.some((row) => /^│ +\/work\/app +│$/.test(row))).toBe(true);
    expect(body(r).replace(/ /g, "")).toContain(long);
    expect(body(r)).toContain("these directories");
  });

  test("at 80 columns, every row is the card's width", () => {
    const r = rows(["/home/user/Projects/app"], false, 80);
    expect(r).toHaveLength(10);
    expect(r.every((row) => row.length === 80)).toBe(true);
  });
});
