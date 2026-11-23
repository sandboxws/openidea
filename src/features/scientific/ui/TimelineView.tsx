/**
 * The Thread Timeline tool window: when each thread and asyncio task of a Python run was seen
 * and in which function (one cell per sample, colored by its innermost function); a cell shows
 * the sampled stack with links to the source. Sampling can miss short-lived work.
 */
import { revealRange } from "@/editor/api";
import { tx } from "@/platform/i18n";
import { Select, T } from "@/ui";
import { useTimelines } from "../store";
import { functionColor, topFunction, type Lane } from "../timeline";
import styles from "./Timeline.module.css";

function LaneRow({ lane, samples }: { lane: Lane; samples: number }) {
  const selected = useTimelines((s) => s.selected);
  const cells = [];
  for (let i = 0; i < samples; i++) {
    const o = lane.observations.get(i);
    if (!o) {
      cells.push(<span key={i} className={styles.gap} />);
      continue;
    }
    const fn = topFunction(o);
    cells.push(
      <button
        key={i}
        type="button"
        className={styles.cell}
        style={{ background: functionColor(fn || "?") }}
        title={fn}
        aria-label={fn || lane.label}
        aria-selected={selected?.lane === lane.key && selected.sample === i}
        onClick={() => useTimelines.setState({ selected: { lane: lane.key, sample: i } })}
      />,
    );
  }
  return (
    <div className={styles.lane}>
      <span className={styles.label} title={lane.detail || lane.label}>
        <span className={styles.kind}>{lane.kind === "thread" ? tx("thread") : tx("task")}</span>
        {lane.label}
      </span>
      <span className={styles.cells}>{cells}</span>
    </div>
  );
}

export function TimelineView() {
  const captures = useTimelines((s) => s.captures);
  const current = useTimelines((s) => s.current);
  const selected = useTimelines((s) => s.selected);
  const capture = captures[current];
  if (!capture)
    return (
      <div className={styles.empty}>
        <T>Record Thread and Task Timeline runs a Python configuration and shows its threads and asyncio tasks here.</T>
      </div>
    );
  const { timeline } = capture;
  const lane = selected ? timeline.lanes.find((l) => l.key === selected.lane) : undefined;
  const observation = lane && selected ? lane.observations.get(selected.sample) : undefined;
  const at = selected ? timeline.times[selected.sample] : undefined;
  const span = Math.round(timeline.times[timeline.times.length - 1] ?? 0);
  const samples = timeline.times.length;
  const ms = Math.round(at ?? 0);
  const threads = timeline.lanes.filter((l) => l.kind === "thread").length;
  const tasks = timeline.lanes.length - threads;
  return (
    <div className={styles.view}>
      <div className={styles.toolbar}>
        <Select
          value={String(current)}
          options={captures.map((c, i) => ({ value: String(i), label: c.name }))}
          aria-label={tx("Recording")}
          onChange={(v) => useTimelines.setState({ current: Number(v), selected: null })}
        />
        <span>{tx`${samples} samples over ${span} ms · ${threads} threads · ${tasks} tasks`}</span>
      </div>
      <div className={styles.body}>
        <div className={styles.lanes} role="grid" aria-label={tx("Thread and task timeline")}>
          {timeline.lanes.map((l) => (
            <LaneRow key={l.key} lane={l} samples={timeline.times.length} />
          ))}
        </div>
        <div className={styles.details}>
          {lane && observation ? (
            <>
              <div>
                <strong>{lane.label}</strong> <span className={styles.muted}>{tx`at ${ms} ms`}</span>
              </div>
              {lane.detail && <div className={styles.muted}>{lane.detail}</div>}
              <ul className={styles.frames}>
                {observation.frames.map(([file, line, fn], i) => (
                  <li key={`${i}:${file}:${line}`}>
                    {file.startsWith("<") ? (
                      <span>
                        {fn} <span className={styles.muted}>{file}</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className={styles.link}
                        onClick={() =>
                          void revealRange(file, { start: { line: Math.max(line - 1, 0), col: 0 } }, { focus: true })
                        }
                      >
                        {fn} <span className={styles.muted}>{`${file.slice(file.lastIndexOf("/") + 1)}:${line}`}</span>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className={styles.muted}>
              <T>Select a cell to see the stack sampled there.</T>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
