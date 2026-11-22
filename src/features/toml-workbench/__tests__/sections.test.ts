import { describe, expect, it } from "vitest";
import { tomlSections } from "../sections";

describe("tomlSections", () => {
  it("lists tables and arrays of tables with their lines", () => {
    const text = [
      "[project]",
      'name = "x"',
      "",
      "[ tool . ruff . lint ]  # comment",
      "[[tool.uv.index]]",
      '[tool."my.pkg"]',
      "  [indented]",
    ].join("\n");
    expect(tomlSections(text)).toEqual([
      { name: "project", line: 0, array: false },
      { name: "tool.ruff.lint", line: 3, array: false },
      { name: "tool.uv.index", line: 4, array: true },
      { name: 'tool."my.pkg"', line: 5, array: false },
      { name: "indented", line: 6, array: false },
    ]);
  });

  it("ignores headings inside multi-line strings and arrays of values", () => {
    const text = [
      "[a]",
      'doc = """',
      "[not.a.table]",
      '"""',
      "lit = '''",
      "[nor.this]",
      "'''",
      'one = "[x]"',
      "values = [",
      "  1,",
      "]",
      "[b]",
    ].join("\n");
    expect(tomlSections(text).map((s) => s.name)).toEqual(["a", "b"]);
  });
});
