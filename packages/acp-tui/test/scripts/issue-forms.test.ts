// The GitHub issue forms parse as YAML and carry what a report needs.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const dir = join(import.meta.dir, "../../../../.github/ISSUE_TEMPLATE");

async function load(name: string): Promise<any> {
  return Bun.YAML.parse(await Bun.file(join(dir, name)).text());
}

describe("issue forms", () => {
  test("blank issues are off", async () => {
    expect((await load("config.yml")).blank_issues_enabled).toBe(false);
  });

  test("the bug form asks for the version, the setup and the crash report", async () => {
    const form = await load("bug.yml");
    expect(form.name).toBe("Bug report");
    const ids = form.body.filter((item: any) => item.id).map((item: any) => item.id);
    expect(ids).toEqual(["version", "ide", "engine", "os", "shell", "harness", "steps", "expected", "actual", "crash"]);
    for (const item of form.body) expect(item.type).toBeOneOf(["markdown", "textarea", "input", "dropdown"]);
  });

  test("the feedback form has one required field", async () => {
    const form = await load("feedback.yml");
    const required = form.body.filter((item: any) => item.validations?.required).map((item: any) => item.id);
    expect(required).toEqual(["feedback"]);
  });
});
