import { create } from "zustand";
import type { PlotEntry } from "./program";

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
