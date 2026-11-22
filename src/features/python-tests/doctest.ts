/**
 * Doctests in Python source: which docstring owners hold `>>>` examples (the module, its
 * classes and functions, methods of classes; not functions local to another function, which
 * doctest doesn't find), and the example a line belongs to. A scan of the text, so it works
 * in any Python file without a parse tree.
 */

export interface DoctestOwner {
  /** Dotted symbol within the module, `""` for the module's own docstring. */
  symbol: string;
  /** 0-based line of the `def` / `class` (0 for the module). */
  line: number;
}

const DEF = /^(\s*)(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)/;
const DOC_START = /^\s*[rRuU]?("""|''')/;
const PROMPT = /^\s*>>>(\s|$)/;
const CONTINUATION = /^\s*\.\.\.(\s|$)/;

function indentOf(line: string): number {
  let n = 0;
  for (const c of line) {
    if (c === " ") n++;
    else if (c === "\t") n += 8 - (n % 8);
    else break;
  }
  return n;
}

function blankOrComment(line: string): boolean {
  const t = line.trim();
  return !t || t.startsWith("#");
}

/** The docstring starting at `start` (its first line), as lines, or null when there is none there. */
function docstringAt(lines: readonly string[], start: number): string[] | null {
  const first = lines[start];
  const m = first !== undefined ? DOC_START.exec(first) : null;
  if (!m) return null;
  const quote = m[1]!;
  const rest = first!.slice(first!.indexOf(quote) + 3);
  if (rest.includes(quote)) return [rest.slice(0, rest.indexOf(quote))];
  const out = [rest];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    const end = line.indexOf(quote);
    if (end >= 0) {
      out.push(line.slice(0, end));
      return out;
    }
    out.push(line);
  }
  return out;
}

/** The line after a `def` / `class` header that may span lines (until its closing `:`). */
function afterHeader(lines: readonly string[], start: number): number {
  let depth = 0;
  for (let i = start; i < lines.length; i++) {
    const code = lines[i]!.replace(/#.*$/, "");
    for (const c of code) {
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") depth--;
    }
    if (depth <= 0 && code.trimEnd().endsWith(":")) return i + 1;
  }
  return lines.length;
}

function hasExamples(doc: string[] | null): boolean {
  return !!doc && doc.some((l) => PROMPT.test(l));
}

export function doctestOwners(text: string): DoctestOwner[] {
  const lines = text.split("\n");
  const owners: DoctestOwner[] = [];
  // The module docstring: the first statement.
  const first = lines.findIndex((l) => !blankOrComment(l));
  if (first >= 0 && hasExamples(docstringAt(lines, first))) owners.push({ symbol: "", line: 0 });
  const frames: Array<{ indent: number; name: string; kind: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (blankOrComment(line)) continue;
    const indent = indentOf(line);
    while (frames.length && frames[frames.length - 1]!.indent >= indent) frames.pop();
    const m = DEF.exec(line);
    if (!m) continue;
    const local = frames.some((f) => f.kind === "def");
    frames.push({ indent, name: m[3]!, kind: m[2]! });
    if (local) continue;
    let body = afterHeader(lines, i);
    while (body < lines.length && blankOrComment(lines[body]!)) body++;
    if (hasExamples(docstringAt(lines, body))) owners.push({ symbol: frames.map((f) => f.name).join("."), line: i });
  }
  return owners;
}

/** The 1-based line of the `>>>` prompt of the example on 0-based `line`, or null. */
export function examplePromptLine(text: string, line: number): number | null {
  const lines = text.split("\n");
  for (let i = line; i >= 0; i--) {
    const l = lines[i];
    if (l === undefined) return null;
    if (PROMPT.test(l)) return i + 1;
    if (!CONTINUATION.test(l)) return null;
  }
  return null;
}
