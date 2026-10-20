// mvp-configuration task 1.4: the generated JSON Schemas are kept equal to the
// zod schemas (spec tui-config "Configuration schema", scenarios "Generated
// file current" and, for the schema's content, "Editor completion").
// Regenerate with `bun packages/acp-tui/scripts/build-config-schema.ts`.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { configJsonSchemaText, jsonSchemaText, SCHEMA_FILES, staleSchemaFiles } from "../../src/config/json-schema.ts";
import { ConfigSchema } from "../../src/config/schema.ts";

describe("Generated file current", () => {
  test("schema/config.schema.json and schema/theme.schema.json equal what the schemas generate", () => {
    const stale = staleSchemaFiles();
    if (stale.length > 0) throw new Error(`stale generated JSON Schema: ${stale.join(", ")}; run bun packages/acp-tui/scripts/build-config-schema.ts`);
    expect(stale).toEqual([]);
  });

  test("a setting added without regenerating fails, naming the file; regenerating makes it pass", () => {
    const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "acp-tui-schema-"));
    const config = SCHEMA_FILES[0]!;
    const copy = { ...config, path: join(dir, config.name) };
    writeFileSync(copy.path, jsonSchemaText(config.schema));
    expect(staleSchemaFiles([copy])).toEqual([]);
    // The schema gains a setting; the file is not regenerated.
    const grown = { ...copy, schema: ConfigSchema.extend({ new_setting: z.boolean().default(false).describe("A new setting.") }) };
    expect(staleSchemaFiles([grown])).toEqual([copy.path]);
    expect(staleSchemaFiles([grown])[0]).toEndWith("config.schema.json");
    writeFileSync(copy.path, jsonSchemaText(grown.schema));
    expect(staleSchemaFiles([grown])).toEqual([]);
  });
});

describe("the configuration's JSON Schema", () => {
  test("mouse is an enumeration of full, wheel and off with the default full and a description", () => {
    const schema = JSON.parse(configJsonSchemaText());
    expect(schema.properties.mouse).toMatchObject({ type: "string", enum: ["full", "wheel", "off"], default: "full" });
    expect(schema.properties.mouse.description).toContain("Mouse policy");
    expect(schema.properties.$schema.type).toBe("string");
  });

  test("no dash characters U+2013 or U+2014 in the generated files", () => {
    for (const file of SCHEMA_FILES) expect(jsonSchemaText(file.schema)).not.toMatch(new RegExp("[\\u2013\\u2014]"));
  });
});
