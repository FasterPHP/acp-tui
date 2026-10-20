// The generated JSON Schemas (mvp-configuration design D1, task 1.4; spec
// tui-config "Configuration schema"): `schema/config.schema.json` and
// `schema/theme.schema.json` in this package, made from the zod schemas with
// `z.toJSONSchema` for the input form (what a user writes: every setting
// optional, defaults shown). `scripts/build-config-schema.ts` writes them;
// `test/config/json-schema.test.ts` fails, naming the file, when one is stale.
// `config --print-schema` prints the first.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ConfigSchema, ThemeFileSchema } from "./schema.ts";

/** Where the generated files live: `packages/acp-tui/schema/`. */
export const SCHEMA_DIR = join(import.meta.dir, "../../schema");

export interface SchemaFile {
  readonly name: string;
  readonly path: string;
  readonly schema: z.ZodType;
}

export const SCHEMA_FILES: readonly SchemaFile[] = [
  { name: "config.schema.json", path: join(SCHEMA_DIR, "config.schema.json"), schema: ConfigSchema },
  { name: "theme.schema.json", path: join(SCHEMA_DIR, "theme.schema.json"), schema: ThemeFileSchema },
];

/** A JSON Schema document for a zod schema, as committed (two-space indent, final newline). */
export function jsonSchemaText(schema: z.ZodType): string {
  return `${JSON.stringify(z.toJSONSchema(schema, { io: "input", target: "draft-2020-12" }), null, 2)}\n`;
}

/** The configuration's JSON Schema text (`config --print-schema`). */
export function configJsonSchemaText(): string {
  return jsonSchemaText(ConfigSchema);
}

/** The files that differ from what their schemas generate (missing ones included). */
export function staleSchemaFiles(files: readonly SchemaFile[] = SCHEMA_FILES): string[] {
  return files
    .filter((file) => {
      let committed: string;
      try {
        committed = readFileSync(file.path, "utf8");
      } catch {
        return true;
      }
      return committed !== jsonSchemaText(file.schema);
    })
    .map((file) => file.path);
}
