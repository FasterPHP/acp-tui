// The glyphs in use (mvp-configuration design D9 and D6): the registry's active set in one Solid
// signal, swapped whole by a reload, and the objects the renderers read it through.
//
// `LIVE_GLYPHS`, `LIVE_CHROME_GLYPHS` and `LIVE_PERMISSION_GLYPHS` are objects whose fields read
// the active set, so a component that uses `LIVE_GLYPHS.gutter.meta` in its JSX, or a memo that
// calls `toolLine(..., LIVE_GLYPHS)`, redraws when a reload changes `glyphs`. `glyphsKey()` is the
// cache key of a glyph object and reads the same signal, so a memo that builds a cache key follows
// reloads too. `applyGlyphs(config)` makes a configuration's glyphs the active ones and returns the
// problems of the overrides left out.
//
// Kept apart from the registry (glyphs.ts), which the configuration loader reads: this module
// imports Solid, and the loader must not (it also runs for `acp-tui config --check`, where no
// renderer ever starts, and loading Solid ahead of the UI's own imports breaks the renderer's
// start-up).
import { createSignal, untrack } from "solid-js";
import type { ChromeGlyphs } from "../layout/glyphs.ts";
import type { PermissionGlyphs } from "../app/permission.ts";
import {
  DEFAULT_CHROME_GLYPHS,
  DEFAULT_GLYPHS,
  DEFAULT_PERMISSION_GLYPHS,
  RESOLVED_SETS,
  resolveGlyphs,
  type ConversationGlyphs,
  type GlyphProblem,
  type GlyphsConfig,
  type ResolvedGlyphs,
} from "./glyphs.ts";

const [active, setActive] = createSignal<ResolvedGlyphs>(RESOLVED_SETS.unicode);

/** The glyphs in use (reactive: a computation that reads it re-runs when a reload changes them). */
export const activeGlyphs = (): ResolvedGlyphs => active();

/**
 * Makes `config`'s glyphs the active ones and returns the problems of the overrides left out. A
 * configuration that resolves to the glyphs already in use changes nothing, so nothing redraws.
 */
export function applyGlyphs(config: GlyphsConfig): readonly GlyphProblem[] {
  const { glyphs, problems } = resolveGlyphs(config);
  if (glyphs.key !== untrack(() => active().key)) setActive(glyphs);
  return problems;
}

/** The unicode set again (tests and shutdown). */
export function resetGlyphs(): void {
  setActive(RESOLVED_SETS.unicode);
}

/** The key of the active set, for caches: "" for plain `unicode`. */
export const glyphsVersion = (): string => active().key;

/**
 * A cache key for a glyph object: the active set's key for the live object, "" for the fixed
 * `unicode` set, and one of its own for any other object (tests build their own).
 */
const OBJECT_KEYS = new WeakMap<object, string>();
let objectCount = 0;
export function glyphsKey(glyphs: ConversationGlyphs): string {
  if (glyphs === LIVE_GLYPHS) return glyphsVersion();
  if (glyphs === DEFAULT_GLYPHS) return "";
  let key = OBJECT_KEYS.get(glyphs);
  if (key === undefined) {
    key = `o${++objectCount}`;
    OBJECT_KEYS.set(glyphs, key);
  }
  return key;
}

/** An object whose fields read `pick(active)`, one getter per key of `shape`. */
function live<T extends object>(shape: T, pick: (set: ResolvedGlyphs) => T): T {
  const out = {} as T;
  for (const key of Object.keys(shape) as (keyof T)[]) {
    Object.defineProperty(out, key, { enumerable: true, get: () => pick(active())[key] });
  }
  return out;
}

/** The conversation's glyphs in use; read in a computation, they follow a reload. */
export const LIVE_GLYPHS: ConversationGlyphs = live(DEFAULT_GLYPHS, (set) => set.conversation);
export const LIVE_CHROME_GLYPHS: ChromeGlyphs = live(DEFAULT_CHROME_GLYPHS, (set) => set.chrome);
export const LIVE_PERMISSION_GLYPHS: PermissionGlyphs = live(DEFAULT_PERMISSION_GLYPHS, (set) => set.permission);
