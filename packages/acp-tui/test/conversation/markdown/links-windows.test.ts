// Drive-letter paths are local paths (spec tui-rendering "Drive-letter paths are local paths").
// The platform is injected, so this runs on every system; the paths are built with `path.win32`.
import { describe, expect, test } from "bun:test";
import { win32 } from "node:path";
import { classifyTarget, inside, labelShowsTarget } from "../../../src/conversation/markdown/links.ts";

const WIN = "win32" as const;
const cwd = win32.join("C:\\", "work", "app");
const main = win32.join(cwd, "src", "Main.java");

describe("drive-letter paths", () => {
  test("a backslash path inside the working directory is a file link, not a URL with the scheme c:", () => {
    expect(classifyTarget(main, cwd, WIN)).toEqual({ allowed: true, kind: "file", open: main, url: "file:///C:/work/app/src/Main.java", shown: main });
  });

  test("a forward-slash path is the same file, opened by its Windows path", () => {
    expect(classifyTarget("C:/work/app/src/Main.java", cwd, WIN)).toEqual({ allowed: true, kind: "file", open: main, url: "file:///C:/work/app/src/Main.java", shown: "C:/work/app/src/Main.java" });
  });

  test("the drive letter and the folder names are compared without letter case, as Windows does", () => {
    expect(classifyTarget("c:\\WORK\\app\\x.java", cwd, WIN)).toMatchObject({ allowed: true, kind: "file", open: "c:\\WORK\\app\\x.java" });
  });

  test("a fragment, a query and percent escapes are handled as for any local path", () => {
    expect(classifyTarget("C:\\work\\app\\my%20notes.md#top", cwd, WIN)).toMatchObject({ allowed: true, open: win32.join(cwd, "my notes.md"), url: "file:///C:/work/app/my%20notes.md" });
  });

  test("outside the working directory is refused: another folder, another drive, a climb with ..", () => {
    expect(classifyTarget(win32.join("C:\\", "Windows", "System32", "drivers", "etc", "hosts"), cwd, WIN)).toEqual({ allowed: false, reason: "outside" });
    expect(classifyTarget("D:\\work\\app\\src\\Main.java", cwd, WIN)).toEqual({ allowed: false, reason: "outside" });
    expect(classifyTarget("C:\\work\\app\\..\\secret.txt", cwd, WIN)).toEqual({ allowed: false, reason: "outside" });
    expect(classifyTarget("C:/work/application/x.java", cwd, WIN)).toEqual({ allowed: false, reason: "outside" });
  });

  test("whitespace and control characters are still refused, and a UNC path is no local path", () => {
    expect(classifyTarget("C:\\work\\app\\a\tb", cwd, WIN)).toEqual({ allowed: false, reason: "whitespace" });
    expect(classifyTarget("\\\\server\\share\\x", cwd, WIN)).toEqual({ allowed: false, reason: "not-a-path" });
  });

  test("a drive letter and a colon without a slash are still a scheme; the web schemes are unchanged", () => {
    expect(classifyTarget("C:foo", cwd, WIN)).toEqual({ allowed: false, reason: "scheme" });
    expect(classifyTarget("javascript:alert(1)", cwd, WIN)).toEqual({ allowed: false, reason: "scheme" });
    expect(classifyTarget("https://example.com/a", cwd, WIN)).toMatchObject({ allowed: true, kind: "web" });
    expect(classifyTarget("src\\Main.java", cwd, WIN)).toMatchObject({ allowed: true, kind: "file", open: main });
  });

  test("on another system a drive-letter target is no path: refused as before, never resolved below the directory", () => {
    expect(classifyTarget("C:\\src\\x.java", "/work/app", "linux")).toEqual({ allowed: false, reason: "scheme" });
    expect(classifyTarget("C:/src/x.java", "/work/app", "darwin")).toEqual({ allowed: false, reason: "scheme" });
  });

  test("inside compares by the platform's rules", () => {
    expect(inside(cwd, main, WIN)).toBe(true);
    expect(inside(cwd, cwd, WIN)).toBe(true);
    expect(inside(cwd, "c:\\WORK\\APP\\x", WIN)).toBe(true);
    expect(inside(cwd, "D:\\work\\app\\x", WIN)).toBe(false);
    expect(inside(cwd, "C:\\work\\app2\\x", WIN)).toBe(false);
    expect(inside("/work/app", "/work/app/x", "linux")).toBe(true);
    expect(inside("/work/app", "/work/other", "linux")).toBe(false);
  });

  test("a label that shows the path needs no path after it", () => {
    expect(labelShowsTarget("C:\\work\\app\\src\\Main.java", "C:\\work\\app\\src\\Main.java")).toBe(true);
    expect(labelShowsTarget("C:\\work\\app\\src\\Main.java", "C:/work/app/src/Main.java")).toBe(true);
    expect(labelShowsTarget("Main", "C:\\work\\app\\src\\Main.java")).toBe(false);
  });
});
