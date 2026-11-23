import { create } from "zustand";
import type { DebugValue } from "@/workbench/contributions";

/** The value the Inspect Large Value dialog shows (none: closed). */
export const useInspect = create<{ value: DebugValue | null }>(() => ({ value: null }));

export const openInspect = (value: DebugValue) => useInspect.setState({ value });
export const closeInspect = () => useInspect.setState({ value: null });
