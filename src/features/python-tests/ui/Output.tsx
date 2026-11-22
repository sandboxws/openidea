/** Runner output with its ANSI colours, and `file.py:line` references that open the source. */
import { Fragment, useMemo, type ReactNode } from "react";
import { revealRange } from "@/editor/api";
import { AnsiStream, spanStyle } from "@/ui/ansi";
import styles from "./PythonTests.module.css";

/** `path/to/file.py:12` (pytest, tracebacks print `File "…", line 12` too). */
const LINK = /(?:File "([^"]+\.pyi?)", line (\d+))|((?:\/|\.{1,2}\/)?[\w./-]*\.pyi?):(\d+)/g;

export interface OutputLink {
  text: string;
  path: string;
  /** 1-based. */
  line: number;
}

/** Splits `text` into plain parts and source links (paths resolved against `root`). */
export function outputLinks(text: string, root: string | null): Array<string | OutputLink> {
  const out: Array<string | OutputLink> = [];
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    const file = m[1] ?? m[3]!;
    const line = Number(m[2] ?? m[4]);
    if (!file || !line) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    const path = file.startsWith("/") || !root ? file : `${root}/${file.replace(/^\.\//, "")}`;
    out.push({ text: m[0], path, line });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Output({ text, root }: { text: string; root: string | null }) {
  const rendered = useMemo(() => {
    const spans = new AnsiStream().parse(text);
    const nodes: ReactNode[] = [];
    spans.forEach((span, i) => {
      const parts = outputLinks(span.text, root);
      nodes.push(
        <span key={i} style={spanStyle(span)}>
          {parts.map((part, j) =>
            typeof part === "string" ? (
              <Fragment key={j}>{part}</Fragment>
            ) : (
              <button
                key={j}
                type="button"
                className={styles.link}
                onClick={() => void revealRange(part.path, { start: { line: part.line - 1, col: 0 } }, { focus: true })}
              >
                {part.text}
              </button>
            ),
          )}
        </span>,
      );
    });
    return nodes;
  }, [text, root]);
  return <pre className={styles.output}>{rendered}</pre>;
}
