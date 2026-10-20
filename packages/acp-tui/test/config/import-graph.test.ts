// The CLI reads the configuration (the agent catalogue, and later the `config`
// subcommand) before the app is imported, so the configuration modules must not
// load Solid or OpenTUI: Bun would resolve `solid-js` to its server build before
// cli.ts registers the JSX preload, and the app would then fail with "Orphan
// text error" (and OpenTUI's native library would load for `--help`). Run from a
// directory without this package's bunfig.toml, as an installed `acp-tui` is.
import { expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SRC = join(import.meta.dir, "../../src");

test("cli.ts, the configuration loader and the subcommands load neither solid-js nor @opentui when imported", async () => {
  const script = `
    await import(${JSON.stringify(join(SRC, "cli.ts"))});
    await import(${JSON.stringify(join(SRC, "config/load.ts"))});
    await import(${JSON.stringify(join(SRC, "config/json-schema.ts"))});
    await import(${JSON.stringify(join(SRC, "config/effective.ts"))});
    await import(${JSON.stringify(join(SRC, "config/sources.ts"))});
    await import(${JSON.stringify(join(SRC, "config/read.ts"))});
    await import(${JSON.stringify(join(SRC, "config/default-file.ts"))});
    await import(${JSON.stringify(join(SRC, "config-command.ts"))});
    await import(${JSON.stringify(join(SRC, "glyphs-command.ts"))});
    console.log(JSON.stringify(Object.keys(require.cache).filter((k) => k.includes("solid-js") || k.includes("@opentui"))));
  `;
  const proc = Bun.spawn(["bun", "-e", script], { cwd: process.env.TMPDIR ?? tmpdir(), stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = [await new Response(proc.stdout).text(), await new Response(proc.stderr).text(), await proc.exited];
  expect(err).toBe("");
  expect(code).toBe(0);
  expect(JSON.parse(out.trim())).toEqual([]);
});

test("outside Windows, reading the user's file never loads the Win32 owner lookup (bun:ffi)", async () => {
  if (process.platform === "win32") return;
  const file = join(process.env.TMPDIR ?? tmpdir(), `acp-tui-import-graph-${process.pid}.jsonc`);
  const script = `
    const { writeFileSync } = await import("node:fs");
    writeFileSync(${JSON.stringify(file)}, "{}");
    const sources = await import(${JSON.stringify(join(SRC, "config/sources.ts"))});
    sources.readConfigFile(${JSON.stringify(file)}, { checkWriters: true });
    await import(${JSON.stringify(join(SRC, "cli.ts"))});
    await import(${JSON.stringify(join(SRC, "config/read.ts"))});
    console.log(JSON.stringify(Object.keys(require.cache).filter((k) => k.includes("windows-owner"))));
  `;
  const proc = Bun.spawn(["bun", "-e", script], { cwd: process.env.TMPDIR ?? tmpdir(), stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = [await new Response(proc.stdout).text(), await new Response(proc.stderr).text(), await proc.exited];
  expect(err).toBe("");
  expect(code).toBe(0);
  expect(JSON.parse(out.trim())).toEqual([]);
});
