/** Follows a running plot capture: reads its `plots.jsonl` until the run ends. */
import { call, commands } from "@/platform/ipc";
import { readPlots } from "./program";
import { imagePath, upsertCapture, usePlots } from "./store";

const timers = new Map<string, ReturnType<typeof setInterval>>();

export async function refreshCapture(dir: string): Promise<void> {
  let text = "";
  try {
    text = await call(commands.fsReadText(`${dir}/plots.jsonl`));
  } catch {
    return; // nothing captured yet
  }
  const images = readPlots(text);
  const capture = usePlots.getState().captures.find((c) => c.dir === dir);
  if (!capture || images.length === capture.images.length) return;
  upsertCapture(dir, { images });
  // Follow the newest image while the program draws.
  const latest = images[images.length - 1];
  if (latest) usePlots.setState({ selected: imagePath({ ...capture, images }, latest.file) });
}

export function followCapture(dir: string, name: string) {
  upsertCapture(dir, { name, running: true, started: Date.now() });
  stopFollowing(dir);
  timers.set(
    dir,
    setInterval(() => void refreshCapture(dir), 700),
  );
}

export function stopFollowing(dir: string) {
  const timer = timers.get(dir);
  if (timer) clearInterval(timer);
  timers.delete(dir);
}

export async function finishCapture(dir: string) {
  stopFollowing(dir);
  await refreshCapture(dir);
  upsertCapture(dir, { running: false });
}

export function stopAll() {
  for (const dir of [...timers.keys()]) stopFollowing(dir);
}
