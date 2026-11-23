/** The thread and task timeline: samples read from `timeline.jsonl`, arranged in lanes. */

/** `[file, line, function]`, innermost first. */
export type Frame = [string, number, string];

export interface Observation {
  /** Sample index. */
  sample: number;
  frames: Frame[];
}

export interface Lane {
  key: string;
  kind: "thread" | "task";
  label: string;
  /** For a task: its coroutine and the thread its loop runs on. */
  detail: string;
  observations: Map<number, Observation>;
  first: number;
  last: number;
}

export interface Timeline {
  /** Milliseconds since the start, per sample. */
  times: number[];
  lanes: Lane[];
}

interface RawSample {
  t: number;
  threads?: Array<{ id: number; name: string; frames: Frame[] }>;
  tasks?: Array<{ id: number; name: string; coro: string; thread: string; frames: Frame[] }>;
}

export function readTimeline(jsonl: string): Timeline {
  const times: number[] = [];
  const lanes = new Map<string, Lane>();
  const observe = (
    key: string,
    make: () => Omit<Lane, "observations" | "first" | "last">,
    sample: number,
    frames: Frame[],
  ) => {
    let lane = lanes.get(key);
    if (!lane) {
      lane = { ...make(), observations: new Map(), first: sample, last: sample };
      lanes.set(key, lane);
    }
    lane.observations.set(sample, { sample, frames });
    lane.last = sample;
  };
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let raw: RawSample;
    try {
      raw = JSON.parse(line) as RawSample;
    } catch {
      continue;
    }
    const sample = times.length;
    times.push(raw.t);
    for (const t of raw.threads ?? [])
      observe(
        `thread:${t.id}`,
        () => ({ key: `thread:${t.id}`, kind: "thread", label: t.name, detail: "" }),
        sample,
        t.frames,
      );
    for (const t of raw.tasks ?? [])
      observe(
        `task:${t.id}`,
        () => ({ key: `task:${t.id}`, kind: "task", label: t.name, detail: `${t.coro} · ${t.thread}` }),
        sample,
        t.frames,
      );
  }
  // Threads first, then tasks, each by when they were first seen.
  const ordered = [...lanes.values()].sort((a, b) =>
    a.kind === b.kind ? a.first - b.first : a.kind === "thread" ? -1 : 1,
  );
  return { times, lanes: ordered };
}

/** The function an observation shows (its innermost frame), or "". */
export const topFunction = (o: Observation | undefined) => o?.frames[0]?.[2] ?? "";

const PALETTE = ["--ansi-blue", "--ansi-green", "--ansi-magenta", "--ansi-cyan", "--ansi-yellow", "--ansi-red"];

/** A stable color per function name, from the theme's ANSI palette. */
export function functionColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return `color-mix(in srgb, var(${PALETTE[Math.abs(hash) % PALETTE.length]}) 55%, transparent)`;
}
