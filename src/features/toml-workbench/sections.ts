/** Table headings of a TOML file, for Find TOML Section. */

export interface TomlSection {
  /** As written, with spaces around dots removed: `tool.ruff.lint`, `tool."my.pkg"`. */
  name: string;
  /** 0-based. */
  line: number;
  /** `[[array.of.tables]]`. */
  array: boolean;
}

const HEADING = /^\s*(\[\[?)\s*((?:[^\]"'#]|"(?:[^"\\]|\\.)*"|'[^']*')+?)\s*\]\]?\s*(?:#.*)?$/;

/** Removes the spaces around the dots of a dotted key, outside its quoted parts. */
function compact(key: string): string {
  return key.replace(/("(?:[^"\\]|\\.)*"|'[^']*')|\s*\.\s*/g, (_match, quoted: string | undefined) => quoted ?? ".");
}

/** Toggles the multi-line string `line` opens or closes (`"""` / `'''`), given the open one. */
function multiline(line: string, open: '"""' | "'''" | null): '"""' | "'''" | null {
  let state = open;
  let i = 0;
  while (i < line.length) {
    if (state) {
      const end = line.indexOf(state, i);
      if (end < 0) return state;
      i = end + 3;
      state = null;
      continue;
    }
    const c = line[i];
    if (c === "#") return null;
    if (line.startsWith('"""', i) || line.startsWith("'''", i)) {
      state = line.slice(i, i + 3) as '"""' | "'''";
      i += 3;
    } else if (c === '"' || c === "'") {
      // A one-line string: skip it.
      const close = c === '"' ? /(?:[^"\\]|\\.)*"/y : /[^']*'/y;
      close.lastIndex = i + 1;
      i = close.exec(line) ? close.lastIndex : line.length;
    } else i++;
  }
  return state;
}

export function tomlSections(text: string): TomlSection[] {
  const out: TomlSection[] = [];
  let open: '"""' | "'''" | null = null;
  text.split("\n").forEach((line, index) => {
    if (!open) {
      const m = HEADING.exec(line);
      if (m) out.push({ name: compact(m[2]!), line: index, array: m[1] === "[[" });
    }
    open = multiline(line, open);
  });
  return out;
}
