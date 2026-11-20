// Harness profiles keyed on `agentInfo` (spec tui-agent-session "Harness profiles recognised from
// initialize" and "Harness newer than checked"), as pure rules.
import { describe, expect, test } from "bun:test";
import { generationRefusal, HARNESS_PROFILES, leadingSemver, newerThanCheckedNotice, olderEntryAdvice, profileFor } from "../../src/agent/harness-profiles.ts";

describe("profileFor", () => {
  test("auggie 0.x with a commit in the version", () => {
    const profile = profileFor({ name: "auggie", title: "Auggie Agent", version: "0.36.0 (commit 7c61e5bb)" });
    expect(profile).toMatchObject({ id: "auggie-0", generation: "auggie-0", displayName: "Auggie", version: "0.36.0", checkedThrough: "0.37.x" });
  });

  test("auggie 0.37.1 and 1.2.2", () => {
    expect(profileFor({ name: "auggie", version: "0.37.1" })?.id).toBe("auggie-0");
    expect(profileFor({ name: "auggie", title: "Auggie Coding Agent", version: "1.2.2" })).toMatchObject({ id: "auggie-1", version: "1.2.2", checkedThrough: "1.2.x" });
  });

  test("a prerelease keeps its tag in the version", () => {
    expect(profileFor({ name: "auggie", version: "1.3.0-prerelease.202611181212" })).toMatchObject({ id: "auggie-1", version: "1.3.0-prerelease.202611181212" });
  });

  test("the title does not decide, the version does", () => {
    expect(profileFor({ name: "auggie", title: "Auggie Coding Agent", version: "0.36.0" })?.id).toBe("auggie-0");
  });

  test("no version, an unparsable one, another name or no agentInfo: no profile", () => {
    expect(profileFor({ name: "auggie" })).toBeNull();
    expect(profileFor({ name: "auggie", version: "beta" })).toBeNull();
    expect(profileFor({ name: "auggie", version: 2 })).toBeNull();
    expect(profileFor({ name: "claude-agent-acp", version: "0.94.0" })).toBeNull();
    expect(profileFor(null)).toBeNull();
    expect(profileFor(undefined)).toBeNull();
  });

  test("the profile follows the reported name, never the entry's", () => {
    // profileFor takes only `agentInfo`: an entry called `work` running Auggie 1.2.2 gets the same profile.
    expect(profileFor({ name: "auggie", version: "1.2.2" })).toEqual(profileFor({ name: "auggie", version: "1.2.2" }));
    expect(HARNESS_PROFILES["auggie-1"].indexingPatterns).toBe(true);
    expect(HARNESS_PROFILES["auggie-0"].indexingPatterns).toBe(false);
  });

  test("a hostile version reads only its leading semver", () => {
    const profile = profileFor({ name: "auggie", version: "1.2.3\x1b]52;c;ZXZpbA==\x07" });
    expect(profile?.version).toBe("1.2.3");
    expect(leadingSemver("v1.2.3+build.5")).toBe("1.2.3");
    expect(leadingSemver("1.2")).toBeNull();
  });
});

describe("newerThanCheckedNotice", () => {
  test("within the checked minor: none", () => {
    for (const version of ["1.2.2", "1.2.9", "1.0.0", "1.3.0-prerelease.1".replace("1.3", "1.2")]) expect(newerThanCheckedNotice(profileFor({ name: "auggie", version }))).toBeNull();
    for (const version of ["0.36.0 (commit 7c61e5bb)", "0.37.1"]) expect(newerThanCheckedNotice(profileFor({ name: "auggie", version }))).toBeNull();
  });

  test("a prerelease of the next minor and later versions get the notice", () => {
    expect(newerThanCheckedNotice(profileFor({ name: "auggie", version: "1.3.0-prerelease.202611181212" }))).toBe("auggie 1.3.0-prerelease.202611181212 is newer than acp-tui has been checked with (1.2.x)");
    expect(newerThanCheckedNotice(profileFor({ name: "auggie", version: "1.3.0" }))).toContain("(1.2.x)");
    expect(newerThanCheckedNotice(profileFor({ name: "auggie", version: "2.0.0" }))).toContain("auggie 2.0.0 is newer");
    expect(newerThanCheckedNotice(profileFor({ name: "auggie", version: "0.38.0 (commit abc)" }))).toBe("auggie 0.38.0 is newer than acp-tui has been checked with (0.37.x)");
  });

  test("no profile: none", () => {
    expect(newerThanCheckedNotice(null)).toBeNull();
  });
});

describe("generationRefusal and olderEntryAdvice (auggie-1x-support task 9.2 and 9.4)", () => {
  const one = profileFor({ name: "auggie", version: "1.2.2" });
  const zero = profileFor({ name: "auggie", version: "0.37.1 (commit 1a2b3c4d)" });

  test("0.x recorded, 1.x in use: the import advice, with the version without its commit", () => {
    expect(generationRefusal("s-0", { name: "auggie", version: "0.36.0 (commit 7c61e5bb)" }, one)).toBe(
      "session s-0 was recorded with Auggie 0.36.0, and Auggie 1.2.2 cannot open Auggie 0.x sessions; import them in auggie with /import-legacy-sessions (they get new IDs)",
    );
  });

  test("1.x recorded, 0.x in use: the way back", () => {
    expect(generationRefusal("s-1", { name: "auggie", version: "1.2.2" }, zero)).toBe(
      "session s-1 was recorded with Auggie 1.2.2, and Auggie 0.37.1 cannot open Auggie 1.x sessions; to use Auggie 1.x again: npm install -g @augmentcode/auggie",
    );
  });

  test("the same generation, no recorded harness, a harness without a profile, or an unreadable version: no refusal", () => {
    expect(generationRefusal("s", { name: "auggie", version: "1.2.0" }, one)).toBeNull();
    expect(generationRefusal("s", undefined, one)).toBeNull();
    expect(generationRefusal("s", { name: "auggie", version: "0.36.0" }, null)).toBeNull();
    expect(generationRefusal("s", { name: "other", version: "0.36.0" }, one)).toBeNull();
    expect(generationRefusal("s", { name: "auggie", version: "beta" }, one)).toBeNull();
  });

  test("a hostile session ID reaches the message printable", () => {
    expect(generationRefusal("s\x1b[2J\n0", { name: "auggie", version: "0.36.0" }, one)).not.toMatch(/[\x00-\x1f\x7f]/);
  });

  test("older entries: only an auggie-1 harness and a `Session … not found` reason add the advice", () => {
    const text = "Internal error: Session s-2 not found (-32603)";
    expect(olderEntryAdvice(one, text)).toContain("/import-legacy-sessions");
    expect(olderEntryAdvice(zero, text)).toBeNull();
    expect(olderEntryAdvice(null, text)).toBeNull();
    expect(olderEntryAdvice(one, "Internal error: No API key found")).toBeNull();
    expect(olderEntryAdvice(one, "Resource not found")).toBeNull();
  });
});
