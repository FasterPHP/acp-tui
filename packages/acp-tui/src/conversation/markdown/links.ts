// Link targets (mvp-rendering design decision 4; spec tui-rendering "Links in
// every form", "Link target safety", "OSC 8 only where verified"). Pure: what
// a target written by the agent may become, decided from the text alone and
// the session's working directory, never from the file system (the opener
// checks symlinks when it opens a local path, src/links/open.ts).
//
// - `https` and `http` targets must parse as URLs with a host; the host
//   (`URL.host`, so an internationalised name shows as punycode and a
//   `user@` prefix never hides the real host) is what follows a differing
//   label and what the toast names.
// - `mailto` targets must hold an address; the address follows the label.
// - A target without a scheme is a local path: percent-decoded, resolved
//   against the session's working directory and normalised (so `..` cannot
//   climb out by spelling), and linked only when it stays inside it. The
//   path as written follows the label. `~`, `//host` and fragment-only or
//   query-only targets are refused: none is a path in the working directory.
// - Everything else is refused: other schemes (`javascript`, `data`, `file`
//   and the rest, in any letter case), targets with whitespace or control
//   characters, targets over `MAX_LINK_TARGET` characters, paths outside the
//   working directory. A refused link is drawn as plain text with the target
//   after it, muted; it carries no `link`, so it is never opened and never
//   gets OSC 8.
//
// The working directory is the session's (`setLinkBase`, set by the app from
// the store; `process.cwd()` until then). Only absolute paths depend on it,
// and only for whether they are linked: the drawn text never does, so the
// height cache and the projection are the same in any directory.
import { isAbsolute, posix, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

/** Targets longer than this are never linked (spec "Link target safety"). */
export const MAX_LINK_TARGET = 2048;

/** A refused target is shown in full up to this many characters, else cut in the middle with `…`. */
export const REFUSED_SHOWN_MAX = 120;

export type LinkKind = "web" | "mail" | "file";

/** An allowed target: what the opener gets, what OSC 8 carries, and what is shown. */
export interface AllowedTarget {
  readonly allowed: true;
  readonly kind: LinkKind;
  /** The single argument for the system opener: a URL, or an absolute path for a local file. */
  readonly open: string;
  /** The URL OSC 8 carries, built by acp-tui (a `file://` URL for a local path). */
  readonly url: string;
  /** Shown after a differing label: the host, the mail address, or the path as written. */
  readonly shown: string;
}

export interface RefusedTarget {
  readonly allowed: false;
  /** Why, for tests and the debug log (never shown). */
  readonly reason: "empty" | "length" | "whitespace" | "scheme" | "invalid" | "outside" | "not-a-path";
}

export type TargetVerdict = AllowedTarget | RefusedTarget;

const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;
// C0 and C1 controls, DEL, and every Unicode space or line or paragraph separator.
const WHITESPACE_OR_CONTROL = /[\u0000-\u0020\u007f-\u00a0\u1680\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]/;

const refused = (reason: RefusedTarget["reason"]): RefusedTarget => ({ allowed: false, reason });

/** The verdict on `href` (as the agent wrote it, already sanitised) for a session in `cwd`. */
export function classifyTarget(href: string, cwd: string): TargetVerdict {
  if (href === "") return refused("empty");
  if (href.length > MAX_LINK_TARGET) return refused("length");
  if (WHITESPACE_OR_CONTROL.test(href)) return refused("whitespace");
  const scheme = SCHEME.exec(href)?.[1]?.toLowerCase();
  if (scheme === "https" || scheme === "http") {
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      return refused("invalid");
    }
    if (url.host === "") return refused("invalid");
    return { allowed: true, kind: "web", open: url.href, url: url.href, shown: url.host };
  }
  if (scheme === "mailto") {
    const address = href.slice("mailto:".length).split("?")[0]!;
    if (!/^[^@/\\]+@[^@/\\]+$/.test(address)) return refused("invalid");
    return { allowed: true, kind: "mail", open: href, url: href, shown: address };
  }
  if (scheme !== undefined) return refused("scheme");
  return localPath(href, cwd);
}

/** A target without a scheme: a path inside `cwd`, or refused. */
function localPath(href: string, cwd: string): TargetVerdict {
  if (href.startsWith("~") || href.startsWith("//") || href.startsWith("\\\\")) return refused("not-a-path");
  // The fragment and query are not part of the path.
  const path = href.split(/[?#]/, 1)[0]!;
  if (path === "") return refused("not-a-path");
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return refused("invalid");
  }
  if (WHITESPACE_OR_CONTROL.test(decoded.replace(/ /g, "x"))) return refused("whitespace");
  const target = resolve(cwd, decoded);
  if (!inside(cwd, target)) return refused("outside");
  return { allowed: true, kind: "file", open: target, url: pathToFileURL(target).href, shown: href };
}

/** Whether `target` (absolute, normalised) is `dir` or below it. */
export function inside(dir: string, target: string): boolean {
  const rel = relative(resolve(dir), target);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

/** The refused target as shown after the label: cut in the middle beyond `REFUSED_SHOWN_MAX`. */
export function refusedShown(href: string): string {
  const chars = Array.from(href);
  if (chars.length <= REFUSED_SHOWN_MAX) return href;
  const half = Math.floor((REFUSED_SHOWN_MAX - 1) / 2);
  return chars.slice(0, half).join("") + "…" + chars.slice(chars.length - half).join("");
}

/**
 * Whether a link's label already shows its target, so no host follows it: the label is the
 * target, or the target without its `scheme://` (a `www.` link), its `mailto:` or a trailing
 * slash (compared without letter case). A local path also matches its normalised form.
 */
export function labelShowsTarget(label: string, href: string): boolean {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\/+$/, "");
  const l = norm(label);
  if (l === "") return false;
  const h = norm(href);
  const forms = new Set([h, h.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""), h.replace(/^mailto:/, "")]);
  if (!SCHEME.test(href)) forms.add(norm(posix.normalize(href)));
  return forms.has(l);
}

// -- The session's working directory -----------------------------------------------------------

let base: string | null = null;

/** The directory relative link targets resolve against: the session's. */
export function linkBase(): string {
  return base ?? process.cwd();
}

/** Sets the session's working directory (null: `process.cwd()`). */
export function setLinkBase(dir: string | null): void {
  base = dir;
}
