// Phase 1a probe (task 2.1): an alternate-screen OpenTUI app that logs what
// reaches it, as the self-test target of the PTY harness extensions (D12) and a
// reusable input probe for the IDE spikes.
//
//   bun packages/acp-tui/test/pty/screen-probe.tsx [--log <file>] [--colours]
//        [--leave-modes <n,n,...>] [--no-mouse] [--hover]
//
// The renderer options are design D2's, with the mouse on. The log file comes
// from `--log` or `SCREEN_PROBE_LOG`; every line is JSON with a `t` (epoch ms):
//
//   ready    { cols, rows, mouse, hover, kitty }
//   stdin    { data }       every chunk read from stdin, byte for byte (a second
//                           `data` listener; this is where raw mouse reports and
//                           the cursor keys that follow them can be seen, and it
//                           is the source for recording fixtures)
//   raw      { sequence }   every sequence OpenTUI's parser hands to input handlers;
//                           mouse reports and keys do not appear here (the parser
//                           consumes them first), terminal replies do
//   key      { name, ctrl, meta, shift, sequence, eventType }
//   paste    { text }
//   mouse    { type, button, x, y, shift, alt, ctrl, dir?, delta? }
//                           OpenTUI's decoded event; x and y are 0-based cells
//   colours  { path: "osc" | "palette", foreground, background }
//                           `--colours` only. `osc` is the probe's own OSC 10 and
//                           11 query (300 ms timeout; both colours `null` when the
//                           terminal did not answer). `palette` is OpenTUI's
//                           `getPalette()`, whose `defaultForeground` and
//                           `defaultBackground` are `null` when OSC 4 is unanswered
//                           (it probes OSC 4 support first). Hex strings, `#rrggbb`.
//   exit     { reason }     just before `destroy()`
//
// Ctrl+Q exits with status 0. `--leave-modes 1000,1006` writes `CSI ? 1000;1006 h`
// once the renderer has closed, so the harness's mode tracker has something to
// report. (OpenTUI 0.6 restores the terminal when its native session closes, or
// at process exit if it has not closed yet, so the modes are written after
// `renderer.closed`, when neither can turn them off again; opentui-0-6 task 6.4.)
import { appendFileSync } from "node:fs";
import { createCliRenderer, decodePasteBytes, type KeyEvent, type MouseEvent } from "@opentui/core";
import { render, useTerminalDimensions } from "@opentui/solid";
import { createSignal } from "solid-js";

function option(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string): boolean => process.argv.includes(name);

const logPath = option("--log") ?? process.env.SCREEN_PROBE_LOG;
const log = (entry: Record<string, unknown>): void => {
  if (logPath) appendFileSync(logPath, JSON.stringify({ t: Date.now(), ...entry }) + "\n");
};

const mouse = !flag("--no-mouse");
const hover = flag("--hover");
const leaveModes = (option("--leave-modes") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const renderer = await createCliRenderer({
  screenMode: "alternate-screen",
  externalOutputMode: "passthrough",
  useMouse: mouse,
  enableMouseMovement: hover,
  exitOnCtrlC: false,
  consoleMode: "disabled",
  targetFps: 30,
  maxFps: 60,
  exitSignals: [],
});

process.stdin.on("data", (chunk: Buffer) => log({ kind: "stdin", data: chunk.toString("latin1") }));
renderer.prependInputHandler((sequence) => {
  log({ kind: "raw", sequence });
  return false;
});
renderer.keyInput.on("keypress", (k: KeyEvent) => {
  log({ kind: "key", name: k.name, ctrl: k.ctrl, meta: k.meta, shift: k.shift, sequence: k.sequence, eventType: k.eventType });
  setLast(`key ${k.ctrl ? "ctrl+" : ""}${k.meta ? "meta+" : ""}${k.shift ? "shift+" : ""}${k.name}`);
  if (k.ctrl && k.name === "q") quit("ctrl+q");
});
renderer.keyInput.on("paste", (p) => log({ kind: "paste", text: decodePasteBytes(p.bytes) }));

const [last, setLast] = createSignal("none");
const onMouse = (e: MouseEvent): void => {
  log({
    kind: "mouse",
    type: e.type,
    button: e.button,
    x: e.x,
    y: e.y,
    shift: e.modifiers.shift,
    alt: e.modifiers.alt,
    ctrl: e.modifiers.ctrl,
    ...(e.scroll ? { dir: e.scroll.direction, delta: e.scroll.delta } : {}),
  });
  setLast(`mouse ${e.type} ${e.x},${e.y}`);
};

function Probe() {
  const size = useTerminalDimensions();
  return (
    <box width="100%" height="100%" flexDirection="column" onMouse={onMouse}>
      <text>{`SCREEN-PROBE ready ${size().width}x${size().height} mouse=${mouse} hover=${hover}`}</text>
      <text>{`last ${last()}`}</text>
    </box>
  );
}

await render(() => <Probe />, renderer);
// OpenTUI 0.6 hit-tests mouse reports against the native scene, which is empty until the first
// frame has been laid out and painted; `ready` is logged only after it (opentui-0-6 task 6.4).
await renderer.idle();

function quit(reason: string): void {
  log({ kind: "exit", reason });
  renderer.destroy();
  if (leaveModes.length === 0) process.exit(0);
  void renderer.closed.finally(() => {
    process.stdout.write(`\x1b[?${leaveModes.join(";")}h`);
    process.exit(0);
  });
}

log({ kind: "ready", cols: renderer.width, rows: renderer.height, mouse, hover, kitty: renderer.useKittyKeyboard });

if (flag("--colours")) {
  const hex = (r: string, g: string, b: string): string => {
    const c = (s: string): string => {
      const v = parseInt(s, 16);
      const max = 16 ** s.length - 1;
      return Math.round((v / max) * 255).toString(16).padStart(2, "0");
    };
    return `#${c(r)}${c(g)}${c(b)}`;
  };
  const found: { 10: string | null; 11: string | null } = { 10: null, 11: null };
  const unsubscribe = renderer.subscribeOsc((sequence) => {
    const m = /^\x1b\](10|11);rgb:([0-9a-fA-F]+)\/([0-9a-fA-F]+)\/([0-9a-fA-F]+)/.exec(sequence);
    if (m) found[m[1] === "10" ? 10 : 11] = hex(m[2]!, m[3]!, m[4]!);
  });
  process.stdout.write("\x1b]10;?\x07\x1b]11;?\x07");
  setTimeout(() => {
    unsubscribe();
    log({ kind: "colours", path: "osc", foreground: found[10], background: found[11] });
  }, 300);

  void renderer.getPalette({ timeout: 1000 }).then(
    (p) => log({ kind: "colours", path: "palette", foreground: p.defaultForeground, background: p.defaultBackground }),
    (error) => log({ kind: "colours", path: "palette", error: String(error) }),
  );
}
