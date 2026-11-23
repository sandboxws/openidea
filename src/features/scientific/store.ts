import { create } from "zustand";
import type { PlotEntry } from "./program";
import type { Timeline } from "./timeline";

export interface PlotCapture {
  /** Its output directory. */
  dir: string;
  name: string;
  started: number;
  running: boolean;
  images: PlotEntry[];
}

interface PlotsState {
  captures: PlotCapture[];
  /** `dir/file` of the image shown. */
  selected: string | null;
}

export const usePlots = create<PlotsState>(() => ({ captures: [], selected: null }));

export function upsertCapture(dir: string, patch: Partial<PlotCapture>) {
  usePlots.setState((s) => {
    const at = s.captures.findIndex((c) => c.dir === dir);
    if (at < 0) {
      const capture: PlotCapture = { dir, name: "", started: Date.now(), running: true, images: [], ...patch };
      return { captures: [capture, ...s.captures] };
    }
    const captures = [...s.captures];
    captures[at] = { ...captures[at]!, ...patch };
    return { captures };
  });
}

export const imagePath = (capture: PlotCapture, file: string) => `${capture.dir}/${file}`;

export interface TimelineCapture {
  dir: string;
  name: string;
  timeline: Timeline;
}

interface TimelinesState {
  captures: TimelineCapture[];
  /** Index into `captures`. */
  current: number;
  /** The cell shown: a lane key and a sample. */
  selected: { lane: string; sample: number } | null;
}

export const useTimelines = create<TimelinesState>(() => ({ captures: [], current: 0, selected: null }));

export function addTimeline(capture: TimelineCapture) {
  useTimelines.setState((s) => ({ captures: [capture, ...s.captures].slice(0, 10), current: 0, selected: null }));
}
