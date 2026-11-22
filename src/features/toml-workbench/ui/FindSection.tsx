import { useMemo, useState, type KeyboardEvent } from "react";
import { revealRange } from "@/editor/api";
import { tx } from "@/platform/i18n";
import { fuzzyMatch, HighlightedText, Input, Popup, T } from "@/ui";
import { closeFindSection, useFindSection } from "./store";
import styles from "./FindSection.module.css";

/** Tools › Find TOML Section: the active TOML file's table headings, filtered as you type. */
export function FindSection() {
  const path = useFindSection((s) => s.path);
  const sections = useFindSection((s) => s.sections);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rows = useMemo(
    () =>
      sections
        .map((section) => ({ section, indices: query ? fuzzyMatch(section.name, query) : [] }))
        .filter((r): r is { section: (typeof sections)[number]; indices: number[] } => !!r.indices),
    [sections, query],
  );
  if (!path) return null;
  const close = () => {
    setQuery("");
    setActive(0);
    closeFindSection();
  };
  const go = (index: number) => {
    const row = rows[index];
    if (!row) return;
    close();
    void revealRange(path, { start: { line: row.section.line, col: 0 } }, { focus: true });
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (rows.length ? (i + step + rows.length) % rows.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(active);
    }
  };
  return (
    <Popup open anchor="center" onClose={close} className={styles.popup} aria-label={tx("Find TOML Section")}>
      <div className={styles.header}>
        <T>Find TOML Section</T>
      </div>
      <Input
        className={styles.search}
        value={query}
        placeholder={tx("Table name")}
        aria-label={tx("Table name")}
        data-autofocus
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />
      {rows.length ? (
        <ul className={styles.list} role="listbox" aria-label={tx("TOML sections")}>
          {rows.map(({ section, indices }, i) => (
            <li key={`${section.line}`} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                className={styles.row}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(i)}
              >
                <HighlightedText
                  className={styles.name}
                  text={section.array ? `[[${section.name}]]` : `[${section.name}]`}
                  indices={indices.map((n) => n + (section.array ? 2 : 1))}
                />
                <span className={styles.line}>{section.line + 1}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className={styles.empty}>
          <T>No matching sections</T>
        </div>
      )}
    </Popup>
  );
}
