// `config --check` (mvp-configuration task 9.1) reports theme problems through src/theme/configured.ts
// before the app is imported, so that module, like the configuration loader
// (test/config/import-graph.test.ts), must load neither Solid nor OpenTUI. Run from a directory
// without this package's bunfig.toml, as an installed `acp-tui` is.
import { expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SRC = join(import.meta.dir, "../../src");

test("the theme's configuration modules load neither solid-js nor @opentui", async () => {
  const script = `
    await import(${JSON.stringify(join(SRC, "theme/configured.ts"))});
    await import(${JSON.stringify(join(SRC, "theme/theme-file.ts"))});
    await import(${JSON.stringify(join(SRC, "theme/legibility.ts"))});
    console.log(JSON.stringify(Object.keys(require.cache).filter((k) => k.includes("solid-js") || k.includes("@opentui"))));
  `;
  const proc = Bun.spawn(["bun", "-e", script], { cwd: process.env.TMPDIR ?? tmpdir(), stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = [await new Response(proc.stdout).text(), await new Response(proc.stderr).text(), await proc.exited];
  expect(err).toBe("");
  expect(code).toBe(0);
  expect(JSON.parse(out.trim())).toEqual([]);
});
