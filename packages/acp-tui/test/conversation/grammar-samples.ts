import { getTreeSitterClient } from "@opentui/core";
import { registerGrammars } from "../../src/conversation/grammars.ts";

/** One sample per bundled language (and OpenTUI's own JavaScript, TypeScript and, since 0.6, TSX). */
export const SAMPLES: Record<string, string> = {
  php: "<?php\nclass Foo extends Bar {\n  public function baz(int $x): string { return strlen($x) . 'a'; }\n}\n",
  "php (no tag)": "$x = strlen($y);\n",
  json: '{"name": "acp-tui", "n": 3, "ok": true, "list": [null, "a"]}\n',
  bash: 'for f in *.ts; do echo "$f" | grep -c foo; done # comment\n',
  sql: "SELECT id, name FROM users WHERE age > 30 AND name LIKE 'a%' ORDER BY id;\n",
  python: "def f(x: int) -> str:\n    # comment\n    return 'a' + str(x)\n",
  yaml: "name: acp-tui\nitems:\n  - one # comment\n  - 2\nok: true\n",
  java: "public final class Account {\n  private long id; // comment\n  public String name() { return \"a\"; }\n}\n",
  kotlin: 'dependencies { implementation("org.slf4j:slf4j-api:2.0.16") }\nfun f(x: Int): String = "a" + x // comment\n',
  xml: "<dependency><groupId>junit</groupId></dependency>\n",
  javascript: "const f = (x) => { return `a${x}`; }; // comment\n",
  typescript: "interface A { x: number }\nconst f = (a: A): string => 'a' + a.x;\n",
  tsx: 'const el = <Box title="x" />;\n',
};

/** The OpenTUI filetype each sample is highlighted as, where it differs from the sample's name. */
export const FILETYPE: Record<string, string> = { "php (no tag)": "php", tsx: "typescriptreact" };

export interface Highlighted {
  language: string;
  captures: number;
  groups: string[];
  error?: string;
}

/** Highlights every sample through OpenTUI's TreeSitterClient, the API `<code>` and `<markdown>` use. */
export async function highlightAll(): Promise<Highlighted[]> {
  registerGrammars();
  const client = getTreeSitterClient();
  const out: Highlighted[] = [];
  for (const [language, content] of Object.entries(SAMPLES)) {
    const result = await client.highlightOnce(content, FILETYPE[language] ?? language);
    const found = result.highlights ?? [];
    out.push({
      language,
      captures: found.length,
      groups: [...new Set(found.map((h) => h[2]))].sort(),
      ...(result.error ? { error: result.error } : {}),
    });
  }
  return out;
}

if (import.meta.main) {
  // Run by the offline test under `unshare -rn`: print one JSON line, then exit.
  const results = await highlightAll();
  console.log(JSON.stringify(results));
  await getTreeSitterClient().destroy();
  process.exit(0);
}
