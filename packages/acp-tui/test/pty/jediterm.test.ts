// Unit tests for the harness's JediTerm output filter (jediterm.ts).
import { describe, expect, test } from "bun:test";
import { JediTermFilter } from "./jediterm.ts";

describe("JediTermFilter", () => {
  test("drops bare CSI s and CSI u and keeps them with parameters", () => {
    const f = new JediTermFilter();
    expect(f.push("a\x1b[sb\x1b[Hc\x1b[ud\x1b[1;5se")).toBe("ab\x1b[Hcd\x1b[1;5se");
  });

  test("prints an APC string's payload as text", () => {
    const f = new JediTermFilter();
    expect(f.push("x\x1b_Gi=31337,s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\y")).toBe("xGi=31337,s=1,v=1,a=q,t=d,f=24;AAAAy");
  });

  test("holds an incomplete sequence until the next chunk", () => {
    const f = new JediTermFilter();
    expect(f.push("a\x1b")).toBe("a");
    expect(f.push("[sb\x1b[")).toBe("b");
    expect(f.push("31mc\x1b_Gi=1")).toBe("\x1b[31mc");
    expect(f.push(";A\x1b")).toBe("");
    expect(f.push("\\d")).toBe("Gi=1;Ad");
    expect(f.push("e\x1b")).toBe("e");
    expect(f.flush()).toBe("\x1b");
  });

  test("leaves OSC strings terminated by ST alone", () => {
    const f = new JediTermFilter();
    expect(f.push("\x1b]11;?\x1b\\")).toBe("\x1b]11;?\x1b\\");
  });
});
