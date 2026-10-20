// Idempotence property test (task 2.2): a fixed corpus plus a few thousand deterministically
// generated strings mixing printable text and escape fragments, in both sanitiser modes.
//
// The generator uses a small seeded PRNG (mulberry32) rather than Math.random so a failure is
// reproducible: the printed seed and index pin down the exact failing string.

import { describe, expect, test } from "bun:test";
import { reduce } from "../src/reducer.ts";
import { sanitise, type SanitiseMode } from "../src/sanitiser.ts";
import { createSession } from "../src/types.ts";

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FRAGMENTS = [
  "plain text ",
  "with spaces",
  "Größe",
  "✓",
  "😀", // emoji (surrogate pair)
  "\x1b",
  "[",
  "]",
  "P",
  "_",
  "^",
  "X",
  ";",
  "0",
  "1",
  "2",
  "3",
  "?",
  "m",
  "J",
  "r",
  "h",
  "\x07",
  "\\",
  "\x1b\\",
  "\u009b",
  "\u009c",
  "\u009d",
  "\u0090",
  "\u009e",
  "\u009f",
  "\u0098",
  "\r",
  "\r\n",
  "\n",
  "\t",
  "‮",
  "‪",
  "​",
  "‍",
  "⁦",
  "﻿",
  "؜",
  "᠎",
];

function randomString(rand: () => number, fragmentCount: number): string {
  let out = "";
  for (let i = 0; i < fragmentCount; i++) {
    const fragment = FRAGMENTS[Math.floor(rand() * FRAGMENTS.length)] as string;
    out += fragment;
  }
  return out;
}

const FIXED_CORPUS = [
  "",
  "plain ASCII text",
  "Größe: 12 ✓",
  "Hello 😀 world",
  "before\x1b]52;c;ZXZpbA==\x07after",
  "\x1b]8;;https://evil.example\x1b\\click\x1b]8;;\x1b\\",
  "\x1b[31mred\x1b[0m",
  "kept\x1b]52;c;not-terminated",
  "kept\x1b[31",
  "a\r\nb\rc\td",
  "a\u009b31mred\u009b0m",
  "rm ‮exe.dangerous‬ file.txt",
  "safe​‌‍word",
  "\x1b",
  "\u009c",
  "\x1b[",
  "\x1b]",
  "\x1b\x1b\x1b",
];

function checkIdempotent(input: string, mode: SanitiseMode): void {
  const once = sanitise(input, mode);
  const twice = sanitise(once, mode);
  expect(twice).toBe(once);
}

describe("sanitiser idempotence: fixed corpus", () => {
  for (const input of FIXED_CORPUS) {
    for (const mode of ["default", "approval"] as const) {
      test(`mode=${mode} input=${JSON.stringify(input)}`, () => {
        checkIdempotent(input, mode);
      });
    }
  }
});

describe("sanitiser idempotence: generated strings", () => {
  const SEED = 0x5eed_1234;
  const CASE_COUNT = 3000;
  const rand = mulberry32(SEED);

  for (let index = 0; index < CASE_COUNT; index++) {
    const fragmentCount = 1 + Math.floor(rand() * 12);
    const input = randomString(rand, fragmentCount);
    const mode: SanitiseMode = index % 2 === 0 ? "default" : "approval";

    test(`seed=${SEED} case=${index} mode=${mode}`, () => {
      checkIdempotent(input, mode);
    });
  }
});

describe("sanitiser idempotence: legacy model state", () => {
  // The reducer sanitises every string of a `models` field, so feeding a stored state back in
  // as a response changes nothing (spec model-session, "Legacy model state is recorded").
  const SEED = 0x5eed_4321;
  const rand = mulberry32(SEED);

  test("a generated legacy model state is stable under a second pass", () => {
    for (let index = 0; index < 300; index++) {
      const models = {
        currentModelId: randomString(rand, 1 + Math.floor(rand() * 6)),
        availableModels: Array.from({ length: 1 + Math.floor(rand() * 3) }, () => ({
          modelId: randomString(rand, 1 + Math.floor(rand() * 6)),
          name: randomString(rand, 1 + Math.floor(rand() * 6)),
          description: rand() < 0.5 ? null : randomString(rand, 1 + Math.floor(rand() * 6)),
        })),
      };
      const once = reduce(createSession(), { type: "session_created", at: 0, cwd: "/x", response: { sessionId: "s", models } as never }).models;
      expect(once).not.toBeNull();
      const twice = reduce(createSession(), { type: "session_created", at: 0, cwd: "/x", response: { sessionId: "s", models: once } as never }).models;
      expect(twice).toEqual(once);
      expect(JSON.stringify(once)).not.toMatch(/[\x1b\x07\x80-\x9f]/);
    }
  });
});

describe("sanitiser idempotence: raw tool output", () => {
  // `rawOutputText` is sanitised on entry, so feeding a recorded text back in as `rawOutput`
  // changes nothing (spec model-session, "Raw tool output is recorded").
  const SEED = 0x5eed_7a11;
  const rand = mulberry32(SEED);

  function recorded(rawOutput: unknown): string | null {
    const session = reduce(createSession(), {
      type: "session_update",
      at: 0,
      update: { sessionUpdate: "tool_call", toolCallId: "t", title: "Run", rawOutput } as never,
    });
    const item = session.items.get("tool:t");
    return item?.kind === "tool_call" ? item.rawOutputText : null;
  }

  test("a generated raw output is stable under a second pass, as a string and as an output field", () => {
    for (let index = 0; index < 300; index++) {
      const text = randomString(rand, 1 + Math.floor(rand() * 12));
      for (const wrap of [(value: string) => value, (value: string) => ({ output: value })]) {
        const once = recorded(wrap(text));
        expect(once).not.toBeNull();
        expect(recorded(wrap(once as string))).toBe(once);
        expect(once).not.toMatch(/[\x1b\x07\x80-\x9f]/);
      }
    }
  });
});
