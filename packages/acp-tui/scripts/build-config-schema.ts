// Writes the generated JSON Schemas, `schema/config.schema.json` and
// `schema/theme.schema.json` (mvp-configuration task 1.4), from the zod
// schemas in src/config/schema.ts. Run after changing a setting:
//
//   bun packages/acp-tui/scripts/build-config-schema.ts          # write
//   bun packages/acp-tui/scripts/build-config-schema.ts --check  # exit 1 if stale
import { mkdirSync, writeFileSync } from "node:fs";
import { jsonSchemaText, SCHEMA_DIR, SCHEMA_FILES, staleSchemaFiles } from "../src/config/json-schema.ts";

const check = process.argv.includes("--check");
if (check) {
  const stale = staleSchemaFiles();
  for (const path of stale) process.stderr.write(`stale: ${path} (run bun packages/acp-tui/scripts/build-config-schema.ts)\n`);
  process.exit(stale.length === 0 ? 0 : 1);
}
mkdirSync(SCHEMA_DIR, { recursive: true });
for (const file of SCHEMA_FILES) {
  writeFileSync(file.path, jsonSchemaText(file.schema));
  process.stdout.write(`wrote ${file.path}\n`);
}
