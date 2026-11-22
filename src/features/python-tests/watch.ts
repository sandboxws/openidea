/**
 * Related-test watch: after a save or an external change, waits 400 ms for more, asks which
 * collected test files the changes affect (collecting again first when they can change what's
 * collected), and runs those. An active run finishes before one merged follow-up run starts;
 * Stop drops whatever is pending.
 */

export interface WatchDeps {
  /** The test files `changed` affects, and whether collection must run again first. */
  relate(changed: string[]): Promise<{ files: string[]; refresh: boolean }>;
  collect(): Promise<void>;
  /** Runs these test files; resolves when the run ends. */
  run(files: string[]): Promise<void>;
  /** No related tests for these changes. */
  nothingRelated?(changed: string[]): void;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
}

export const WATCH_DELAY = 400;

export class WatchScheduler {
  private pending = new Set<string>();
  private timer: unknown = null;
  private busy = false;
  private stopped = false;

  constructor(
    private deps: WatchDeps,
    private delay = WATCH_DELAY,
  ) {}

  private set(fn: () => void, ms: number) {
    return (this.deps.setTimer ?? setTimeout)(fn, ms);
  }

  private clear() {
    if (this.timer !== null) (this.deps.clearTimer ?? ((h) => clearTimeout(h as number)))(this.timer);
    this.timer = null;
  }

  /** Files were saved or changed on disk. */
  changed(paths: readonly string[]) {
    if (!paths.length) return;
    this.stopped = false;
    for (const p of paths) this.pending.add(p);
    this.clear();
    this.timer = this.set(() => {
      this.timer = null;
      void this.flush();
    }, this.delay);
  }

  /** Whether a watch run is collecting or running. */
  get active(): boolean {
    return this.busy;
  }

  /** Stop: forget what's pending (the caller stops the run itself). */
  stop() {
    this.stopped = true;
    this.pending.clear();
    this.clear();
  }

  dispose() {
    this.stop();
  }

  private async flush() {
    if (this.busy || !this.pending.size) return;
    this.busy = true;
    try {
      while (this.pending.size && !this.stopped) {
        const changed = [...this.pending];
        this.pending.clear();
        const { files, refresh } = await this.deps.relate(changed);
        if (this.stopped) break;
        if (refresh) await this.deps.collect();
        if (this.stopped) break;
        if (files.length) await this.deps.run(files);
        else this.deps.nothingRelated?.(changed);
      }
    } finally {
      this.busy = false;
    }
  }
}
