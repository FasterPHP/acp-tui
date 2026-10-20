// The opener's xdg-activation token (mvp-rendering task 14.5, review C7; src/links/activation.ts),
// against a fake compositor on a Unix socket: no real Wayland display is touched.
//
// The timing tests of this file are in activation.timing.test.ts (parallel-tests: they run in the serial pass).
import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { activationToken, decodeMessages, encodeMessage, openerEnv, readString, readUint, requestToken, waylandSocket } from "../../src/links/activation.ts";
import { fakeCompositor } from "./fake-compositor.ts";
import { socketDir } from "./activation-helpers.ts";

describe("the activation token (C7)", () => {
  test("the wire format round-trips, and a partial message waits", () => {
    const bytes = encodeMessage(5, 1, [7, "acp-tui"]);
    expect(bytes.length).toBe(8 + 4 + 4 + 8);
    const { messages, rest } = decodeMessages(bytes);
    expect(rest.length).toBe(0);
    expect(messages[0]!.object).toBe(5);
    expect(messages[0]!.opcode).toBe(1);
    expect(readUint(messages[0]!.args, 0)).toBe(7);
    expect(readString(messages[0]!.args, 4)).toEqual({ value: "acp-tui", next: 16 });
    expect(decodeMessages(bytes.slice(0, 10)).messages).toHaveLength(0);
  });

  test("the compositor's socket: WAYLAND_DISPLAY under XDG_RUNTIME_DIR, or absolute; none without it", () => {
    expect(waylandSocket({ WAYLAND_DISPLAY: "wayland-1", XDG_RUNTIME_DIR: "/run/user/1000" })).toBe(join("/run/user/1000", "wayland-1"));
    expect(waylandSocket({ WAYLAND_DISPLAY: "/tmp/w" })).toBe("/tmp/w");
    expect(waylandSocket({ WAYLAND_DISPLAY: "wayland-1" })).toBeNull();
    expect(waylandSocket({})).toBeNull();
  });

  test("a token: binds xdg_activation_v1, asks for a token as acp-tui, commits, and returns it", async () => {
    const { dir, path } = socketDir();
    const { server, seen } = fakeCompositor(path);
    try {
      expect(await requestToken(path)).toBe("tok-123");
      // get_registry, sync, bind, get_activation_token, set_app_id, commit
      expect(seen).toEqual([
        { object: 1, opcode: 1 },
        { object: 1, opcode: 0 },
        { object: 2, opcode: 0 },
        { object: 4, opcode: 1 },
        { object: 5, opcode: 1, appId: "acp-tui" },
        { object: 5, opcode: 3 },
      ]);
      expect(await activationToken({ WAYLAND_DISPLAY: path })).toEqual({ token: "tok-123" });
    } finally {
      server.stop(true);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the opener's environment: the token set, or an inherited one removed", () => {
    expect(openerEnv({ PATH: "/bin" }, "tok")).toEqual({ PATH: "/bin", XDG_ACTIVATION_TOKEN: "tok" });
    expect(openerEnv({ PATH: "/bin", XDG_ACTIVATION_TOKEN: "used" }, null)).toEqual({ PATH: "/bin" });
  });
});
