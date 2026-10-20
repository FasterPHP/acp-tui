// day-one-feedback task 9.1 and 9.3 (spec tui-config "Terminal title setting"): the title format.
import { describe, expect, test } from "bun:test";
import { DEFAULT_TITLE_FORMAT, expandTitleFormat, titleFormatIssue, titlePlaceholderList } from "../../src/renderer/title-format.ts";

const values = { dir: "acp-tui", counter: "", agent: "Auggie", title: "" };

describe("expandTitleFormat", () => {
  test("the default is the directory's name, with the instance number from the second instance on", () => {
    expect(DEFAULT_TITLE_FORMAT).toBe("{dir}{counter}");
    expect(expandTitleFormat(DEFAULT_TITLE_FORMAT, values)).toBe("acp-tui");
    expect(expandTitleFormat(DEFAULT_TITLE_FORMAT, { ...values, counter: " 2" })).toBe("acp-tui 2");
  });

  test("Agent title kept: literal text before an empty placeholder goes with it", () => {
    const format = "{dir}{counter} · {title}";
    expect(expandTitleFormat(format, values)).toBe("acp-tui");
    expect(expandTitleFormat(format, { ...values, title: "Pool reuse" })).toBe("acp-tui · Pool reuse");
    expect(expandTitleFormat(format, { ...values, counter: " 3", title: "Pool reuse" })).toBe("acp-tui 3 · Pool reuse");
  });

  test("the old title as a format: nothing is left when the only placeholder is empty", () => {
    expect(expandTitleFormat("acp-tui | {title}", values)).toBe("");
    expect(expandTitleFormat("acp-tui | {title}", { ...values, title: "Pool reuse" })).toBe("acp-tui | Pool reuse");
    expect(expandTitleFormat("acp-tui | {agent} | {dir}", values)).toBe("acp-tui | Auggie | acp-tui");
  });

  test("white space collapses and the ends are trimmed", () => {
    expect(expandTitleFormat("  {dir}   {agent}  ", values)).toBe("acp-tui Auggie");
    expect(expandTitleFormat("{agent}", { ...values, agent: "a\tb" })).toBe("a b");
  });

  test("braces written twice are literal, and a placeholder the title lacks is empty", () => {
    expect(expandTitleFormat("{{{dir}}}", values)).toBe("{acp-tui}");
    expect(expandTitleFormat("{dir}{repo}", values)).toBe("acp-tui");
    expect(expandTitleFormat("{dir", values)).toBe("");
  });
});

describe("titleFormatIssue", () => {
  test("valid formats have none", () => {
    for (const format of [DEFAULT_TITLE_FORMAT, "{dir}{counter} · {title}", "{agent}", "plain text", ""]) expect(titleFormatIssue(format)).toBeNull();
  });

  test("Unknown placeholder: names it and the allowed ones", () => {
    const issue = titleFormatIssue("{repo}")!;
    expect(issue).toContain("{repo}");
    expect(issue).toContain(titlePlaceholderList());
    expect(titlePlaceholderList()).toBe("{dir}, {counter}, {agent}, {title}");
  });

  test("an unparsable template is a problem too", () => {
    expect(titleFormatIssue("{dir")).toContain("is not a valid format");
    expect(titleFormatIssue("dir}")).toContain("is not a valid format");
  });
});
