// The prompt box's input rule (opentui-0-6 task 4.1, design D5; spec tui-layout "Prompt box"):
// escape sequences removed, CR LF and a lone CR to LF, every other C0 control but tab and LF,
// DEL and C1 dropped. Over fake-agent's hostile fixtures, which is what a terminal or log copy
// pasted into the prompt box can carry.
import { describe, expect, test } from "bun:test";
import { HOSTILE_CHUNK_TEXT, HOSTILE_FIELD_LABELS, HOSTILE_PAYLOADS, hostileField } from "fake-agent";
import { normalisePaste } from "../../src/app/PromptBox.tsx";
import { promptInput } from "../../src/app/prompt-input.ts";

/** Any character the prompt box must never hold. */
const FORBIDDEN = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;

describe("promptInput", () => {
  test("the spec's paste: escape sequences and control characters go, tab and line breaks stay", () => {
    expect(promptInput("a\x07b\x00c\x1b[31md\x7fe\u0085f\tg\r\nh")).toBe("abcdef\tg\nh");
  });

  test("CR LF and a lone CR become one LF each; LF and tab are kept", () => {
    expect(promptInput("one\r\ntwo\rthree\nfour\tfive")).toBe("one\ntwo\nthree\nfour\tfive");
    expect(promptInput("\r\r\n")).toBe("\n\n");
  });

  test("a lone or cut-off ESC and an 8-bit CSI go with what they introduce", () => {
    expect(promptInput("a\x1bb")).toBe("a");
    expect(promptInput("a\x1b")).toBe("a");
    expect(promptInput("a\x1b[12")).toBe("a");
    expect(promptInput("a\x9b31mb")).toBe("ab");
    expect(promptInput("a\x1b]0;title\x07b")).toBe("ab");
  });

  test("every hostile payload: nothing it left behind, no forbidden character; bidi and zero-width text kept", () => {
    for (const payload of HOSTILE_PAYLOADS) {
      const out = promptInput(`before ${payload.text} after`);
      expect(FORBIDDEN.test(out), payload.name).toBe(false);
      expect(out.startsWith("before "), payload.name).toBe(true);
      expect(out.endsWith(" after"), payload.name).toBe(true);
      // The approval-only payloads are ordinary text in a prompt the user writes.
      if (payload.strippedBy === "default") expect(out.includes(payload.residue), payload.name).toBe(false);
      else expect(out.includes(payload.residue), payload.name).toBe(true);
    }
  });

  test("the hostile fields and chunk: labels and tags survive, nothing forbidden, idempotent", () => {
    for (const label of HOSTILE_FIELD_LABELS) {
      const out = promptInput(hostileField(label));
      expect(FORBIDDEN.test(out), label).toBe(false);
      expect(out.startsWith(label), label).toBe(true);
      for (const payload of HOSTILE_PAYLOADS) expect(out, label).toContain(`<${payload.name}>`);
      expect(promptInput(out)).toBe(out);
    }
    const chunk = promptInput(HOSTILE_CHUNK_TEXT);
    expect(chunk).toBe("Before the escape sequence.After it, unharmed.\nPermission: execute rm -rf /\n");
  });

  test("text without escapes or controls is unchanged, and the paste path uses the same rule", () => {
    const plain = "Explain @src/Db/Connection.php: 日本語 😀 (x → y)";
    expect(promptInput(plain)).toBe(plain);
    expect(normalisePaste).toBe(promptInput);
  });
});
