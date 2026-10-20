// Where acp-tui keeps its files on each platform (spec tui-config "Configuration locations on
// Windows", scenarios "APPDATA location" and "XDG still wins"; tui-sessions "State location on
// Windows", scenario "LOCALAPPDATA location"), and the path containment test. The platform and
// the environment are injected, so the Windows paths are checked on Linux too.
import { describe, expect, test } from "bun:test";
import { configDirectory, configHome, pathWithin, stateDirectory, stateHome } from "../../src/platform/paths.ts";
import { themesDirectory, userConfigFile } from "../../src/config/sources.ts";
import { sessionIndexPath, stateHomeDir } from "../../src/session/session-index.ts";
import { titleSlotDir } from "../../src/renderer/title-slot.ts";

const WINDOWS = {
  USERPROFILE: "C:\\Users\\u",
  APPDATA: "C:\\Users\\u\\AppData\\Roaming",
  LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local",
};

describe("Configuration locations on Windows", () => {
  test("APPDATA location: config --path's user file and themes directory", () => {
    expect(userConfigFile(WINDOWS, "win32")).toBe("C:\\Users\\u\\AppData\\Roaming\\acp-tui\\config.jsonc");
    expect(themesDirectory(WINDOWS, "win32")).toBe("C:\\Users\\u\\AppData\\Roaming\\acp-tui\\themes");
    expect(configDirectory(WINDOWS, "win32")).toBe("C:\\Users\\u\\AppData\\Roaming\\acp-tui");
  });

  test("XDG still wins: XDG_CONFIG_HOME C:\\cfg gives C:\\cfg\\acp-tui\\config.jsonc", () => {
    expect(userConfigFile({ ...WINDOWS, XDG_CONFIG_HOME: "C:\\cfg" }, "win32")).toBe("C:\\cfg\\acp-tui\\config.jsonc");
    expect(userConfigFile({ ...WINDOWS, XDG_CONFIG_HOME: "C:/cfg" }, "win32")).toBe("C:\\cfg\\acp-tui\\config.jsonc");
  });

  test("an XDG_CONFIG_HOME that is not absolute is ignored, as on Linux", () => {
    expect(configHome({ ...WINDOWS, XDG_CONFIG_HOME: "cfg" }, "win32")).toBe(WINDOWS.APPDATA);
    expect(configHome({ ...WINDOWS, XDG_CONFIG_HOME: "C:cfg" }, "win32")).toBe(WINDOWS.APPDATA);
  });

  test("without APPDATA (or with one that is not absolute), the profile's AppData\\Roaming", () => {
    expect(configHome({ USERPROFILE: "C:\\Users\\u" }, "win32")).toBe("C:\\Users\\u\\AppData\\Roaming");
    expect(configHome({ USERPROFILE: "C:\\Users\\u", APPDATA: "Roaming" }, "win32")).toBe("C:\\Users\\u\\AppData\\Roaming");
  });

  test("Linux and macOS are unchanged: XDG_CONFIG_HOME, else ~/.config; APPDATA means nothing there", () => {
    for (const platform of ["linux", "darwin"] as const) {
      expect(userConfigFile({ HOME: "/home/u", APPDATA: "/x" }, platform)).toBe("/home/u/.config/acp-tui/config.jsonc");
      expect(userConfigFile({ HOME: "/home/u", XDG_CONFIG_HOME: "/cfg" }, platform)).toBe("/cfg/acp-tui/config.jsonc");
      expect(userConfigFile({ HOME: "/home/u", XDG_CONFIG_HOME: "cfg" }, platform)).toBe("/home/u/.config/acp-tui/config.jsonc");
    }
  });
});

describe("State location on Windows", () => {
  test("LOCALAPPDATA location: the session index is C:\\Users\\u\\AppData\\Local\\acp-tui\\sessions.jsonl", () => {
    expect(sessionIndexPath(WINDOWS, "win32")).toBe("C:\\Users\\u\\AppData\\Local\\acp-tui\\sessions.jsonl");
    expect(stateHomeDir(WINDOWS, "win32")).toBe(WINDOWS.LOCALAPPDATA);
    expect(titleSlotDir(WINDOWS, "win32")).toBe("C:\\Users\\u\\AppData\\Local\\acp-tui\\titles");
  });

  test("XDG_STATE_HOME still wins; without LOCALAPPDATA, the profile's AppData\\Local", () => {
    expect(stateDirectory({ ...WINDOWS, XDG_STATE_HOME: "D:\\state" }, "win32")).toBe("D:\\state\\acp-tui");
    expect(stateHome({ USERPROFILE: "C:\\Users\\u" }, "win32")).toBe("C:\\Users\\u\\AppData\\Local");
  });

  test("Linux and macOS are unchanged", () => {
    expect(sessionIndexPath({ HOME: "/home/u", LOCALAPPDATA: "/x" }, "linux")).toBe("/home/u/.local/state/acp-tui/sessions.jsonl");
    expect(titleSlotDir({ XDG_STATE_HOME: "/s" }, "darwin")).toBe("/s/acp-tui/titles");
  });
});

describe("pathWithin", () => {
  test("Linux and macOS: exact, case-sensitive, on whole components", () => {
    expect(pathWithin("/home/u", "/home/u", "linux")).toBe(true);
    expect(pathWithin("/home/u/.config/acp-tui", "/home/u", "linux")).toBe(true);
    expect(pathWithin("/home/u2/x", "/home/u", "linux")).toBe(false);
    expect(pathWithin("/home/U/x", "/home/u", "linux")).toBe(false);
    expect(pathWithin("/anything", "/", "linux")).toBe(true);
    expect(pathWithin("/home/u/x", "/home/u/", "darwin")).toBe(true);
  });

  test("Windows: case ignored, either separator, trailing separators, on whole components", () => {
    expect(pathWithin("c:\\users\\U\\AppData\\Roaming\\acp-tui", "C:\\Users\\u", "win32")).toBe(true);
    expect(pathWithin("C:/Users/u/AppData", "C:\\Users\\u\\", "win32")).toBe(true);
    expect(pathWithin("C:\\Users\\u", "c:\\users\\u", "win32")).toBe(true);
    expect(pathWithin("C:\\Users\\u2\\x", "C:\\Users\\u", "win32")).toBe(false);
    expect(pathWithin("D:\\Users\\u\\x", "C:\\Users\\u", "win32")).toBe(false);
    expect(pathWithin("C:\\x", "C:\\", "win32")).toBe(true);
    expect(pathWithin("\\\\server\\share\\u\\x", "\\\\SERVER\\share", "win32")).toBe(true);
    expect(pathWithin("C:\\Users\\u\\..\\v", "C:\\Users\\u", "win32")).toBe(false);
  });
});
