// parallel-tests task 3.4: the cursor shape reload test whose assertion is a time bound (the shape follows a saved file within one second), which runs in the serial pass.
// What the file covers is in the header of prompt-cursor.pty.test.ts; its helpers are in prompt-cursor-helpers.ts.
import { afterEach, describe, test } from "bun:test";
import { configHome } from "../pty/config-home.ts";
import { LEFT, start, shapeIs, typed, disposeSession } from "./prompt-cursor-helpers.ts";

afterEach(disposeSession);

describe("Prompt box cursor (task 7.1)", () => {
  test("Reload: the shape follows a saved file within a second", async () => {
    const config = configHome({ density: "compact" });
    const s = start({ config });
    await typed(s, "hello");
    s.sendKeys({ text: LEFT });
    await s.waitFor(shapeIs("5"), 5000);
    config.write({ density: "compact", prompt: { cursor: "block" } });
    await s.waitFor(shapeIs("1"), 1000);
    config.write({ density: "compact", prompt: { cursor: "bar" } });
    await s.waitFor(shapeIs("5"), 1000);
  }, 30000);
});
