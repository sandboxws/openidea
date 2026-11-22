/**
 * Merge guard for this fork (FORK.md): `node scripts/fork/touchpoints.ts [base]`.
 *
 * Diffs the working tree (tracked and staged files) against its merge base with `base`
 * (default `upstream/main`) and checks every changed file against
 * `scripts/fork/touchpoints.json`:
 *   - `owned` globs are the fork's own files and may change freely;
 *   - `generated` files (bindings, lockfiles) are regenerated, never hand-merged;
 *   - `shared` files are upstream's: each may differ by at most its listed number of
 *     changed lines (added + removed);
 *   - anything else is an unlisted edit to an upstream file and fails.
 * It also fails on duplicate keys in the text catalogs (the fork's block and upstream's
 * both adding the same English text) and on hidden action ids the fork calls that
 * upstream no longer registers (`contracts`).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface Config {
  owned: string[];
  generated: string[];
  shared: Record<string, number>;
  catalogs: string[];
  contracts: string[];
}

export interface Change {
  path: string;
  /** Added + removed lines; `null` for binary files. */
  lines: number | null;
}

export type Finding =
  | { kind: "unlisted"; path: string; lines: number | null }
  | { kind: "over-budget"; path: string; lines: number; budget: number }
  | { kind: "duplicate-key"; path: string; key: string }
  | { kind: "missing-contract"; id: string };

/** `**` spans directories, `*` stays within one segment. */
export function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*" && glob[i + 1] === "*") {
      const slash = glob[i + 2] === "/";
      out += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (c === "*") out += "[^/]*";
    else if (c === "?") out += "[^/]";
    else out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

export function matches(globs: string[], path: string): boolean {
  return globs.some((g) => globToRegExp(g).test(path));
}

/** `git diff --numstat -z` output (renames as `added\tremoved\t\0from\0to\0`). */
export function parseNumstat(out: string): Change[] {
  const fields = out.split("\0");
  const changes: Change[] = [];
  for (let i = 0; i < fields.length; i++) {
    const head = fields[i];
    if (!head) continue;
    const [added, removed, path] = head.split("\t");
    const lines = added === "-" || removed === "-" ? null : Number(added) + Number(removed);
    if (path) changes.push({ path, lines });
    else {
      // Rename: the old path is in the next field, the new one after it.
      const to = fields[i + 2];
      i += 2;
      if (to) changes.push({ path: to, lines });
    }
  }
  return changes;
}

export function classify(changes: Change[], config: Config): Finding[] {
  const findings: Finding[] = [];
  for (const change of changes) {
    if (matches(config.owned, change.path) || matches(config.generated, change.path)) continue;
    const budget = config.shared[change.path];
    if (budget === undefined) findings.push({ kind: "unlisted", path: change.path, lines: change.lines });
    else if (change.lines === null || change.lines > budget)
      findings.push({ kind: "over-budget", path: change.path, lines: change.lines ?? Infinity, budget });
  }
  return findings;
}

/** Top-level keys of a flat JSON object that occur more than once (`JSON.parse` keeps the last). */
export function duplicateKeys(json: string): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const m of json.matchAll(/^ {2}("(?:[^"\\]|\\.)*")\s*:/gm)) {
    const key = JSON.parse(m[1]!) as string;
    if (seen.has(key)) dups.add(key);
    seen.add(key);
  }
  return [...dups];
}

/** Hidden action ids the fork executes that no upstream source registers any more. */
export function missingContracts(ids: string[], registered: (id: string) => boolean): string[] {
  return ids.filter((id) => !registered(id));
}

export function explain(f: Finding): string {
  switch (f.kind) {
    case "unlisted":
      return `${f.path}: upstream file edited (${f.lines ?? "binary"} lines) but not listed in touchpoints.json`;
    case "over-budget":
      return `${f.path}: ${f.lines} changed lines, budget ${f.budget}`;
    case "duplicate-key":
      return `${f.path}: duplicate key ${JSON.stringify(f.key)}`;
    case "missing-contract":
      return `action ${f.id} is no longer registered upstream`;
  }
}

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function registeredUpstream(id: string): boolean {
  try {
    git(["grep", "-q", "-F", `id: "${id}"`, "--", "src"]);
    return true;
  } catch {
    return false;
  }
}

function main(): void {
  const base = process.argv[2] ?? "upstream/main";
  const config = JSON.parse(readFileSync(new URL("./touchpoints.json", import.meta.url), "utf8")) as Config;
  const mergeBase = git(["merge-base", base, "HEAD"]).trim();
  const changes = parseNumstat(git(["diff", "--numstat", "-z", "-M", mergeBase]));
  const findings = classify(changes, config);
  for (const path of config.catalogs)
    for (const key of duplicateKeys(readFileSync(path, "utf8"))) findings.push({ kind: "duplicate-key", path, key });
  for (const id of missingContracts(config.contracts, registeredUpstream))
    findings.push({ kind: "missing-contract", id });

  const shared = changes.filter((c) => config.shared[c.path] !== undefined);
  console.log(`${changes.length} files differ from ${base}; ${shared.length} shared upstream files touched`);
  for (const c of shared) console.log(`  ${c.path}: ${c.lines ?? "binary"}/${config.shared[c.path]} lines`);
  if (findings.length === 0) {
    console.log("touch points OK");
    return;
  }
  for (const f of findings) console.error(`✗ ${explain(f)}`);
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
