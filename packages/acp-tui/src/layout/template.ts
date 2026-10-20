// Format templates for bar modules (design 6.10): literal text with `{name}`
// placeholders, `{{` and `}}` for literal braces. Each placeholder can carry
// its own theme token; literal text takes the module's token.
import type { TokenName } from "../theme/index.ts";
import type { Segment } from "./segments.ts";

export type TemplatePart = { kind: "text"; text: string } | { kind: "field"; name: string };

/** Parses a template; throws with a message naming the problem. */
export function parseTemplate(template: string): TemplatePart[] {
  const parts: TemplatePart[] = [];
  let text = "";
  for (let i = 0; i < template.length; i++) {
    const ch = template[i]!;
    if (ch === "{" && template[i + 1] === "{") {
      text += "{";
      i++;
    } else if (ch === "}" && template[i + 1] === "}") {
      text += "}";
      i++;
    } else if (ch === "{") {
      const end = template.indexOf("}", i + 1);
      if (end < 0) throw new Error(`unclosed "{" in format "${template}"`);
      const name = template.slice(i + 1, end);
      if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`invalid placeholder "{${name}}" in format "${template}"`);
      if (text) parts.push({ kind: "text", text });
      text = "";
      parts.push({ kind: "field", name });
      i = end;
    } else if (ch === "}") {
      throw new Error(`unmatched "}" in format "${template}"`);
    } else {
      text += ch;
    }
  }
  if (text) parts.push({ kind: "text", text });
  return parts;
}

/** Placeholder names used by a template. */
export function templateFields(template: string): string[] {
  return parseTemplate(template).flatMap((p) => (p.kind === "field" ? [p.name] : []));
}

export interface FieldValue {
  text: string;
  token?: TokenName;
}

export type Fields = Record<string, FieldValue | string | null | undefined>;

export interface RenderedTemplate {
  segments: Segment[];
  /** True when the template has placeholders and every one of them had no value. */
  empty: boolean;
}

/**
 * Renders a template to segments. Missing values render as `missing` (empty
 * by default). Adjacent parts with the same token are merged.
 */
export function renderTemplate(template: string, fields: Fields, token: TokenName, missing = ""): RenderedTemplate {
  const segments: Segment[] = [];
  let placeholders = 0;
  let filled = 0;
  const push = (text: string, t: TokenName) => {
    if (!text) return;
    const last = segments[segments.length - 1];
    if (last && last.token === t) last.text += text;
    else segments.push({ text, token: t });
  };
  for (const part of parseTemplate(template)) {
    if (part.kind === "text") {
      push(part.text, token);
      continue;
    }
    placeholders++;
    const value = fields[part.name];
    const v = typeof value === "string" ? { text: value } : value;
    if (v && v.text !== "") {
      filled++;
      push(v.text, v.token ?? token);
    } else {
      push(missing, token);
    }
  }
  return { segments, empty: placeholders > 0 ? filled === 0 : segments.length === 0 };
}
