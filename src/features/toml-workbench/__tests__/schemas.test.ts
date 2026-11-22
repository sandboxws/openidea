import { describe, expect, it } from "vitest";
import type { TomlSchemaAssociation } from "@/platform/ipc";
import { associationsOf, mergeAssociations, withAssociations } from "../schemas";

const PREFIX = "file:///data/pyidea/toml-schemas/";
const ours: TomlSchemaAssociation[] = [
  { pattern: ".*/pyproject\\.toml$", schema: `${PREFIX}v2/pyproject.json`, files: ["pyproject.toml"] },
  { pattern: ".*/\\.?ruff\\.toml$", schema: `${PREFIX}v2/ruff.json`, files: ["ruff.toml", ".ruff.toml"] },
];

describe("mergeAssociations", () => {
  it("adds ours, replaces an older bundle's and keeps the user's", () => {
    const current = {
      ".*/pyproject\\.toml$": `${PREFIX}v1/pyproject.json`,
      ".*/Cargo\\.toml$": "https://example.com/cargo.json",
    };
    expect(mergeAssociations(current, ours, PREFIX, true)).toEqual({
      ".*/Cargo\\.toml$": "https://example.com/cargo.json",
      ".*/pyproject\\.toml$": `${PREFIX}v2/pyproject.json`,
      ".*/\\.?ruff\\.toml$": `${PREFIX}v2/ruff.json`,
    });
  });

  it("lets a user's association for one of our files win", () => {
    const current = { "pyproject\\.toml": "file:///mine.json" };
    expect(mergeAssociations(current, ours, PREFIX, true)).toEqual({
      "pyproject\\.toml": "file:///mine.json",
      ".*/\\.?ruff\\.toml$": `${PREFIX}v2/ruff.json`,
    });
  });

  it("removes ours when turned off and reports no change when up to date", () => {
    const current = { ".*/pyproject\\.toml$": `${PREFIX}v2/pyproject.json`, x: "file:///x.json" };
    expect(mergeAssociations(current, ours, PREFIX, false)).toEqual({ x: "file:///x.json" });
    const merged = mergeAssociations({}, ours, PREFIX, true)!;
    expect(mergeAssociations(merged, ours, PREFIX, true)).toBeNull();
    expect(mergeAssociations({ "[": "file:///bad.json" }, ours, PREFIX, true)).not.toBeNull();
  });
});

describe("taplo settings", () => {
  it("puts associations in place without touching other settings, and drops empty objects", () => {
    const settings = { evenBetterToml: { formatter: { alignEntries: true }, schema: { enabled: true } } };
    const next = withAssociations(settings, { a: "file:///a.json" });
    expect(next).toEqual({
      evenBetterToml: {
        formatter: { alignEntries: true },
        schema: { enabled: true, associations: { a: "file:///a.json" } },
      },
    });
    expect(associationsOf(next)).toEqual({ a: "file:///a.json" });
    expect(withAssociations({ evenBetterToml: { schema: { associations: { a: "x" } } } }, {})).toBeNull();
    expect(associationsOf(undefined)).toEqual({});
  });
});
