import { describe, expect, it } from "vitest";
import type { Diagnostic } from "@/platform/ipc";
import { lineCodes, opensCodeList, suppressionContext } from "../suppressions";

const diag = (line: number, code: string | null, server: string, message = "m"): Diagnostic => ({
  range: { start: { line, col: 0 }, end: { line, col: 4 } },
  severity: "warning",
  message,
  source: null,
  code,
  server,
});

describe("suppressionContext", () => {
  it("offers directives right after #", () => {
    expect(suppressionContext("x = 1  #")).toEqual({ kind: "directive", from: 8, typed: "" });
    expect(suppressionContext("x = 1  # no")).toEqual({ kind: "directive", from: 9, typed: "no" });
    expect(suppressionContext("x = 1  # pyright: ig")).toMatchObject({ kind: "directive", typed: "pyright: ig" });
    // Ordinary comments are left alone.
    expect(suppressionContext("x = 1  # explain why")).toBeNull();
    expect(suppressionContext("x = 1  # TODO")).toBeNull();
  });

  it("reads noqa code lists, file-level ones and the codes already listed", () => {
    expect(suppressionContext("import os  # noqa: ")).toEqual({
      kind: "codes",
      directive: "noqa",
      from: 19,
      typed: "",
      listed: [],
    });
    expect(suppressionContext("import os  # noqa: F401, E5")).toEqual({
      kind: "codes",
      directive: "noqa",
      from: 25,
      typed: "E5",
      listed: ["F401"],
    });
    expect(suppressionContext("# ruff: noqa: E501,")).toMatchObject({
      directive: "fileNoqa",
      listed: ["E501"],
      typed: "",
    });
  });

  it("reads bracketed ignore lists of the type checkers", () => {
    expect(suppressionContext("x.y  # type: ignore[attr-defined, ar")).toMatchObject({
      directive: "typeIgnore",
      typed: "ar",
      listed: ["attr-defined"],
    });
    expect(suppressionContext("x  # pyright: ignore[")).toMatchObject({ directive: "pyright", typed: "", listed: [] });
    expect(suppressionContext("x  # pyrefly: ignore[bad-")).toMatchObject({ directive: "pyrefly", typed: "bad-" });
    expect(suppressionContext("x  # ty: ignore[unresolved-reference]")).toBeNull();
  });
});

describe("opensCodeList", () => {
  it("opens the list where a code list starts or continues", () => {
    expect(opensCodeList("import os  # noqa: ")).toBe(true);
    expect(opensCodeList("x  # type: ignore[")).toBe(true);
    expect(opensCodeList("import os  # noqa: F401, ")).toBe(true);
    expect(opensCodeList("import os  # noqa: F4")).toBe(false);
    expect(opensCodeList("import os  # noqa")).toBe(false);
    expect(opensCodeList("import os  # see ")).toBe(false);
  });
});

describe("lineCodes", () => {
  it("lists the line's problems a directive can suppress, once each", () => {
    const diagnostics = [
      diag(3, "F401", "ruff"),
      diag(3, "reportUnusedImport", "basedpyright"),
      diag(3, "F401", "ruff"),
      diag(4, "E501", "ruff"),
      diag(3, null, "ruff"),
      diag(3, "E711", "ruff"),
      diag(3, "RUF100", "ruff"),
      diag(3, "invalid-ignore-comment", "ty"),
    ];
    expect(lineCodes(diagnostics, 3, "noqa").map((d) => d.code)).toEqual(["F401", "E711"]);
    expect(lineCodes(diagnostics, 3, "pyright").map((d) => d.code)).toEqual(["reportUnusedImport"]);
    expect(lineCodes(diagnostics, 3, "typeIgnore")).toEqual([]);
    // Problems about the suppression comment itself aren't offered first.
    expect(lineCodes(diagnostics, 3, "ty")).toEqual([]);
  });
});
