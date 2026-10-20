// mvp-rendering task 9.3: S3's frame budget with `tool-content`'s 5000-line output shown in
// full. Runs the real CLI under the PTY harness (100x30, flat theme), expands the 5000-line
// call, shows all of it (`a`), then sends wheel reports over it at 60/s for 3 s each way and
// PageDown, and prints the time from the key to the full output on screen and the frame work
// (ACP_TUI_LOG `frame` events' `work`, the figure bench/scale.ts reports) of the toggle and of
// the scrolling. Not a test: run it by hand, from the repository root:
// `bun packages/acp-tui/test/conversation/full-output-frames.ts [runs]`.
import { sendPrompt, settle, startCli } from "./cli.ts";

const RUNS = Number(process.argv[2] ?? 3);

function stats(values: number[]): { n: number; p95: number; worst: number } {
  const sorted = [...values].sort((a, b) => a - b);
  return { n: sorted.length, p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? NaN, worst: sorted.at(-1) ?? NaN };
}

const frames = (run: ReturnType<typeof startCli>) => run.events("frame").map((e) => Number(e["work"]));

for (let r = 1; r <= RUNS; r++) {
  const run = startCli({ scenario: "tool-content", cols: 100, rows: 30 });
  const s = run.session;
  try {
    await sendPrompt(s, "go");
    await s.waitFor(/end turn/, 20000);
    await settle(s);
    s.sendKeys("Tab");
    await settle(s, 60);
    for (const _ of [1, 2]) {
      s.sendKeys({ text: "[" });
      await settle(s, 60);
    }
    s.sendKeys("Enter");
    await s.waitFor("4990 rows hidden", 5000);
    await settle(s, 100);
    const before = frames(run).length;
    const sent = performance.now();
    s.sendKeys({ text: "a" });
    await s.waitFor((p) => !p.screenText().join("\n").includes("4990 rows hidden"), 5000);
    const shownMs = performance.now() - sent;
    await settle(s, 100);
    const toggle = frames(run).slice(before);
    const scrollStart = frames(run).length;
    for (const code of [65, 64] as const) {
      const start = performance.now();
      for (let i = 0; i < 180; i++) {
        s.mouseWheel(50, 10, code);
        const wait = start + ((i + 1) * 1000) / 60 - performance.now();
        if (wait > 0) await Bun.sleep(wait);
      }
    }
    for (let i = 0; i < 20; i++) {
      s.sendKeys("PageDown");
      await Bun.sleep(30);
    }
    await settle(s, 100);
    const scroll = frames(run).slice(scrollStart);
    const t = stats(toggle);
    const w = stats(scroll);
    console.log(`run ${r}: toggle to full output: on screen ${shownMs.toFixed(0)} ms after the key (PTY polling included), ${t.n} frames, worst ${t.worst.toFixed(1)} ms; wheel and PgDn over it: ${w.n} frames, p95 ${w.p95.toFixed(1)} ms, worst ${w.worst.toFixed(1)} ms`);
  } finally {
    s.kill("SIGTERM");
    await s.dispose();
  }
}
