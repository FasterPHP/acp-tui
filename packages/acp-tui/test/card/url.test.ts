// The elicitation URL's plan (src/card/url.ts) with the platform injected: the opener's argument
// vector on each system, and the refusals that keep the argument from being read as an option.
import { describe, expect, test } from "bun:test";
import { win32 } from "node:path";
import { planUrlOpen } from "../../src/card/url.ts";

const LOCAL = { SSH_CONNECTION: undefined, SSH_TTY: undefined };
const RUNDLL32 = win32.join("C:\\Windows", "System32", "rundll32.exe");

describe("opening an elicitation URL", () => {
  test("xdg-open on Linux, open on macOS, ACP_TUI_OPENER instead of either", () => {
    expect(planUrlOpen("https://example.com/auth?x=1", LOCAL, "linux")).toEqual({ action: "open", argv: ["xdg-open", "https://example.com/auth?x=1"], host: "example.com" });
    expect(planUrlOpen("https://example.com/auth", LOCAL, "darwin")).toMatchObject({ argv: ["open", "https://example.com/auth"] });
    expect(planUrlOpen("https://example.com/auth", { ACP_TUI_OPENER: "/stub" }, "linux")).toMatchObject({ argv: ["/stub", "https://example.com/auth"] });
  });

  test("on Windows the URL handler of url.dll by absolute path, the URL its one last argument, with & kept whole", () => {
    expect(planUrlOpen("https://example.com/a&b=1&c=%26", LOCAL, "win32")).toEqual({ action: "open", argv: [RUNDLL32, "url.dll,FileProtocolHandler", "https://example.com/a&b=1&c=%26"], host: "example.com" });
  });

  test("on Windows the system directory comes from SystemRoot in any letter case, else C:\\Windows", () => {
    expect(planUrlOpen("https://example.com/", { SYSTEMROOT: "D:\\WinNT" }, "win32")).toMatchObject({ argv: [win32.join("D:\\WinNT", "System32", "rundll32.exe"), "url.dll,FileProtocolHandler", "https://example.com/"] });
    expect(planUrlOpen("https://example.com/", { SystemRoot: "D:\\WinNT" }, "win32")).toMatchObject({ argv: [win32.join("D:\\WinNT", "System32", "rundll32.exe"), "url.dll,FileProtocolHandler", "https://example.com/"] });
    // A relative or empty value is no system directory.
    expect(planUrlOpen("https://example.com/", { SystemRoot: "." }, "win32")).toMatchObject({ argv: [RUNDLL32, "url.dll,FileProtocolHandler", "https://example.com/"] });
    expect(planUrlOpen("https://example.com/", { SystemRoot: "" }, "win32")).toMatchObject({ argv: [RUNDLL32, "url.dll,FileProtocolHandler", "https://example.com/"] });
  });

  test("ACP_TUI_OPENER still replaces the handler on Windows, and its name is found in any letter case", () => {
    expect(planUrlOpen("https://example.com/", { ACP_TUI_OPENER: "C:\\stub\\opener.cmd" }, "win32")).toMatchObject({ argv: ["C:\\stub\\opener.cmd", "https://example.com/"] });
    expect(planUrlOpen("https://example.com/", { acp_tui_opener: "C:\\stub\\opener.cmd" }, "win32")).toMatchObject({ argv: ["C:\\stub\\opener.cmd", "https://example.com/"] });
  });

  test("over SSH the URL is copied, and anything but https or http is refused, on every system", () => {
    for (const platform of ["linux", "darwin", "win32"] as const) {
      expect(planUrlOpen("https://example.com/x", { SSH_CONNECTION: "1 2 3 4" }, platform)).toEqual({ action: "copy", host: "example.com" });
      expect(planUrlOpen("file:///C:/Windows/System32/calc.exe", LOCAL, platform)).toMatchObject({ action: "refuse" });
      expect(planUrlOpen("https://example.com/a b", LOCAL, platform)).toMatchObject({ action: "refuse" });
    }
  });
});
