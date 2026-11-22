// Harness profiles (auggie-1x-support design D2 to D5; spec tui-agent-session "Harness profiles
// recognised from initialize"): what acp-tui knows about a generation of a harness, keyed on the
// `agentInfo` of its `initialize` response and never on the name the entry was launched under, so a
// profile applies to the default `auggie` entry, an entry of any other name and an ad hoc command
// alike. Only what cannot be read from the wire is here (the display name, the version checked, the
// login command, the first quirks). Config options, models, modes, load, resume and list are decided
// from the wire.
//
// The generations of Auggie, corroborated by the title (not matched on it, a version is the more
// stable field): 0.x reports the title `Auggie Agent` and a version such as `0.36.0 (commit
// 7c61e5bb)`; 1.x reports `Auggie Coding Agent` and plain semver (`1.2.2`,
// `1.3.0-prerelease.202611181212`).
import { sanitise } from "acp-model";
import { auggieAuthLoginCommand, auggieLoginCommand } from "./command.ts";

/** The identity of a profile: one per generation. */
export type HarnessProfileId = "auggie-0" | "auggie-1";

/** What `profileFor` reads: the `agentInfo` of an `initialize` response, in any shape (it comes off the wire). */
export interface AgentInfoLike {
  readonly name?: unknown;
  readonly title?: unknown;
  readonly version?: unknown;
}

/** One generation's static facts. */
export interface HarnessProfileDefinition {
  readonly id: HarnessProfileId;
  /** The harness's name on the splash's identity row and in the `agent` module (`Auggie`), whatever its title. */
  readonly displayName: string;
  /** The generation, for comparing two harnesses or an index entry's: equal to `id`. */
  readonly generation: HarnessProfileId;
  /** The versions acp-tui was checked with, as it reads them to the user (`1.2.x`). */
  readonly checkedThrough: string;
  /** The lowest version that is newer than checked, a semver prerelease floor: a version at or above
   *  it gets the "newer than checked" notice (`1.3.0-0` takes `1.3.0-prerelease.…` and `1.3.0`, not `1.2.9`). */
  readonly newerFrom: string;
  /** The command that logs in, as the user types it on `platform` (`auggie login`, `auggie.cmd auth login`). */
  loginCommand(platform?: NodeJS.Platform): string;
  /** Whether the generation tells a logged-out user by a `model` option `unknown/unknown` with no
   *  choices after the session answers (D5), and a prompt error `No API key found`. */
  readonly signalsLoggedOutByModel: boolean;
  /** Whether the generation sends the indexing lines of D16 as agent text (the interception of group 10). */
  readonly indexingPatterns: boolean;
}

/** A profile that matched: its definition and the reported version's leading semver (`0.36.0` from
 *  `0.36.0 (commit 7c61e5bb)`), which only digits, dots, letters and hyphens can make up. */
export interface HarnessProfile extends HarnessProfileDefinition {
  readonly version: string;
}

const AUGGIE_0: HarnessProfileDefinition = {
  id: "auggie-0",
  displayName: "Auggie",
  generation: "auggie-0",
  checkedThrough: "0.37.x",
  newerFrom: "0.38.0-0",
  loginCommand: (platform) => auggieLoginCommand(platform),
  signalsLoggedOutByModel: false,
  indexingPatterns: false,
};

const AUGGIE_1: HarnessProfileDefinition = {
  id: "auggie-1",
  displayName: "Auggie",
  generation: "auggie-1",
  checkedThrough: "1.2.x",
  newerFrom: "1.3.0-0",
  loginCommand: (platform) => auggieAuthLoginCommand(platform),
  signalsLoggedOutByModel: true,
  indexingPatterns: true,
};

/** The profiles, by id. */
export const HARNESS_PROFILES: Readonly<Record<HarnessProfileId, HarnessProfileDefinition>> = { "auggie-0": AUGGIE_0, "auggie-1": AUGGIE_1 };

/** The leading semver of a reported version: `major.minor.patch` with an optional prerelease
 *  (`1.3.0-prerelease.202611181212`), the rest (`(commit 7c61e5bb)`, build metadata) left out; null when it has none. */
export function leadingSemver(version: unknown): string | null {
  if (typeof version !== "string") return null;
  const match = /^\s*v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(version);
  return match?.[1] ?? null;
}

/** The profile for an `initialize` response's `agentInfo`, or null: `name` `auggie` with a leading
 *  version number of 0 is `auggie-0`, of 1 or more `auggie-1`; any other harness, and an `auggie`
 *  without a readable version, has none, and acp-tui then treats it as any harness. */
export function profileFor(agentInfo: AgentInfoLike | null | undefined): HarnessProfile | null {
  if (!agentInfo || agentInfo.name !== "auggie") return null;
  const version = leadingSemver(agentInfo.version);
  if (version === null) return null;
  const major = Number(version.split(".")[0]);
  return { ...(major === 0 ? AUGGIE_0 : AUGGIE_1), version };
}

/** The notice for a harness newer than its profile was checked with, or null: `auggie 1.3.0-prerelease.1 is
 *  newer than acp-tui has been checked with (1.2.x)`. The version is the leading semver, so nothing
 *  hostile reaches it; sanitised again regardless. */
export function newerThanCheckedNotice(profile: HarnessProfile | null): string | null {
  if (profile === null) return null;
  if (Bun.semver.order(profile.version, profile.newerFrom) < 0) return null;
  return `auggie ${sanitise(profile.version, "approval")} is newer than acp-tui has been checked with (${profile.checkedThrough})`;
}

/** The generation as a message names it: `Auggie 0.x`. */
function generationLabel(id: HarnessProfileId): string {
  const definition = HARNESS_PROFILES[id];
  return `${definition.displayName} ${id.slice(id.lastIndexOf("-") + 1)}.x`;
}

/** The profile an index entry's recorded harness maps to, or null (none recorded, or no profile). */
export function recordedProfile(recorded: { readonly name: string; readonly version: string } | null | undefined): HarnessProfile | null {
  return recorded ? profileFor(recorded) : null;
}

/**
 * Why `sessionId`, recorded by `recorded`, cannot be opened by the harness `using`, or null when it
 * can (no profile on either side, or the same generation). Nothing is sent to the harness: the
 * message names the Auggie that recorded the session, the one in use, and the way back. Versions are
 * leading semvers, so nothing hostile reaches the text; it is sanitised again regardless.
 */
export function generationRefusal(sessionId: string, recorded: { readonly name: string; readonly version: string } | null | undefined, using: HarnessProfile | null): string | null {
  const was = recordedProfile(recorded);
  if (was === null || using === null || was.generation === using.generation) return null;
  const clean = (text: string) => sanitise(text, "approval").replace(/\s+/g, " ").trim();
  const head = `session ${clean(sessionId)} was recorded with ${was.displayName} ${clean(was.version)}, and ${using.displayName} ${clean(using.version)} cannot open ${generationLabel(was.generation)} sessions`;
  const way = using.generation === "auggie-1" ? "import them in auggie with /import-legacy-sessions (they get new IDs)" : `to use ${generationLabel(was.generation)} again: npm install -g @augmentcode/auggie@latest`;
  return `${head}; ${way}`;
}

/** What an `auggie-1` harness's `session/load` error adds for an entry with no recorded harness, when
 *  its reason reads `Session … not found` (an older entry may be a 0.x session), else null. */
export function olderEntryAdvice(using: HarnessProfile | null, errorText: string): string | null {
  if (using?.generation !== "auggie-1" || !/Session\b[^\n]*\bnot found/i.test(errorText)) return null;
  return "if it was recorded with Auggie 0.x, import it in auggie with /import-legacy-sessions (it gets a new ID)";
}
