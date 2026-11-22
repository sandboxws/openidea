/**
 * The Plots tool window: the figures captured from Python runs, newest first, followed live
 * while a run draws. Drag to pan, scroll with ⌘ / Ctrl (or the buttons) to zoom.
 */
import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { tx } from "@/platform/i18n";
import { call, commands } from "@/platform/ipc";
import { IconButton, Spinner, T, Toolbar } from "@/ui";
import { imagePath, usePlots, type PlotCapture } from "../store";
import styles from "./Plots.module.css";

const images = new Map<string, Promise<string>>();

function useImage(path: string | null): string | null {
  const [loaded, setLoaded] = useState<{ path: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!path) return;
    let live = true;
    let promise = images.get(path);
    if (!promise) {
      promise = call(commands.fsReadImage(path));
      images.set(path, promise);
    }
    promise.then((url) => live && setLoaded({ path, url })).catch(() => live && setLoaded({ path, url: null }));
    return () => {
      live = false;
    };
  }, [path]);
  return path && loaded?.path === path ? loaded.url : null;
}

function Thumb({ capture, file, title }: { capture: PlotCapture; file: string; title: string }) {
  const path = imagePath(capture, file);
  const url = useImage(path);
  const selected = usePlots((s) => s.selected === path);
  return (
    <button
      type="button"
      className={styles.thumb}
      aria-selected={selected}
      onClick={() => usePlots.setState({ selected: path })}
    >
      {url ? <img src={url} alt={title || file} /> : <Spinner />}
      <span>{title || file}</span>
    </button>
  );
}

export function PlotsView() {
  const captures = usePlots((s) => s.captures);
  const selected = usePlots((s) => s.selected);
  const url = useImage(selected);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);

  const fit = () => {
    const box = stage.current?.getBoundingClientRect();
    const el = img.current;
    if (!box || !el?.naturalWidth) return;
    const scale = Math.min(box.width / el.naturalWidth, box.height / el.naturalHeight, 1);
    setView({ scale, x: (box.width - el.naturalWidth * scale) / 2, y: (box.height - el.naturalHeight * scale) / 2 });
  };
  const zoom = (factor: number, cx?: number, cy?: number) =>
    setView((v) => {
      const box = stage.current?.getBoundingClientRect();
      const px = cx ?? (box ? box.width / 2 : 0);
      const py = cy ?? (box ? box.height / 2 : 0);
      const scale = Math.min(Math.max(v.scale * factor, 0.05), 16);
      const k = scale / v.scale;
      return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
    });
  const onWheel = (e: WheelEvent) => {
    if (!e.metaKey && !e.ctrlKey) return;
    const box = stage.current!.getBoundingClientRect();
    zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - box.left, e.clientY - box.top);
  };
  const onDown = (e: PointerEvent) => {
    drag.current = { x: e.clientX - view.x, y: e.clientY - view.y };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (d) setView((v) => ({ ...v, x: e.clientX - d.x, y: e.clientY - d.y }));
  };

  const reveal = () => {
    if (selected)
      void import("@tauri-apps/plugin-opener").then((o) => o.revealItemInDir(selected)).catch(() => undefined);
  };
  const open = () => {
    if (selected) void import("@tauri-apps/plugin-opener").then((o) => o.openPath(selected)).catch(() => undefined);
  };

  return (
    <div className={styles.view}>
      <Toolbar className={styles.toolbar} aria-label={tx("Plots")}>
        <IconButton icon="zoom-in" title={tx("Zoom In")} disabled={!url} onClick={() => zoom(1.25)} />
        <IconButton icon="zoom-out" title={tx("Zoom Out")} disabled={!url} onClick={() => zoom(0.8)} />
        <IconButton icon="image" title={tx("Fit to Window")} disabled={!url} onClick={fit} />
        <span className={styles.grow} />
        <IconButton icon="external-link" title={tx("Open in Default App")} disabled={!selected} onClick={open} />
        <IconButton icon="folder-open" title={tx("Show the PNG File")} disabled={!selected} onClick={reveal} />
        <IconButton
          icon="trash"
          title={tx("Clear Plots")}
          disabled={!captures.some((c) => !c.running)}
          onClick={() => usePlots.setState((s) => ({ captures: s.captures.filter((c) => c.running), selected: null }))}
        />
      </Toolbar>
      <div className={styles.body}>
        <div className={styles.list} role="listbox" aria-label={tx("Captured plots")}>
          {captures.map((c) => (
            <div key={c.dir}>
              <div className={styles.capture}>
                {c.name} {c.running && <Spinner />}
              </div>
              {c.images.map((image) => (
                <Thumb key={image.file} capture={c} file={image.file} title={image.title} />
              ))}
            </div>
          ))}
        </div>
        <div
          ref={stage}
          className={styles.stage}
          onWheel={onWheel}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={() => (drag.current = null)}
          onDoubleClick={fit}
        >
          {url ? (
            <img
              ref={img}
              src={url}
              alt={tx("Captured plot")}
              onLoad={fit}
              style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
            />
          ) : (
            <div className={styles.empty}>
              <T>Run a Python configuration with Run and Capture Plots to see its Matplotlib figures here.</T>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
