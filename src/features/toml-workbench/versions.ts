/** PyPI version completion inside a `pyproject.toml` requirement string. */
import type { Completion } from "@codemirror/autocomplete";

const OPERATOR_VERSION = /(?:===|==|!=|~=|>=|<=|<|>)\s*([\w.*+!-]*)$/;

/** The version being typed after a comparison operator in `before` (the string up to the caret). */
export function typedVersion(before: string): string | null {
  return OPERATOR_VERSION.exec(before)?.[1] ?? null;
}

/** Completions for `versions` (newest stable first) starting with `typed`, in that order. */
export function versionOptions(
  versions: readonly string[],
  typed: string,
  detail: (v: string) => string | undefined,
): Completion[] {
  return versions
    .filter((v) => v.startsWith(typed))
    .slice(0, 200)
    .map((label, i) => ({ label, type: "constant", detail: detail(label), boost: -i }));
}
