/**
 * PyIdea's Project Dependencies workspace (FORK.md): a tool window for the project's
 * pyproject.toml groups, lock and environment, with staged edits previewed by uv in a copy of
 * the project and applied with a sync.
 */
import { registerActions } from "@/platform/actions";
import { onIdeEvent } from "@/platform/ipc";
import { useProject } from "@/platform/project";
import { lazyComponent } from "@/ui";
import { registerToolWindow } from "@/workbench/contributions";
import {
  TOOL_WINDOW,
  applyAndSync,
  invalidatePreview,
  openDependencies,
  previewChanges,
  refresh,
  retrySync,
} from "./controller";
import { initialDeps, useDeps } from "./store";

function activateRefresh(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const later = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void refresh(), 300);
  };
  const offFs = onIdeEvent("fsChanged", (e) => {
    const path = useDeps.getState().path;
    if (!path) return;
    const touched = [...e.created, ...e.modified, ...e.removed].map(String);
    if (touched.some((p) => p === path || p.endsWith("/uv.lock") || p.endsWith("/pyproject.toml"))) {
      invalidatePreview();
      later();
    }
  });
  const offSettings = onIdeEvent("settingsChanged", (e) => {
    if (useDeps.getState().path && e.key.startsWith("languages.python")) {
      invalidatePreview();
      later();
    }
  });
  const offRoot = useProject.subscribe((s, prev) => {
    if (s.project?.root !== prev.project?.root) useDeps.setState(initialDeps());
  });
  return () => {
    if (timer) clearTimeout(timer);
    offFs();
    offSettings();
    offRoot();
  };
}

export function activate(): () => void {
  const disposers = [
    registerToolWindow({
      id: TOOL_WINDOW,
      title: "Project Dependencies",
      icon: "package",
      anchor: "bottom",
      order: 60,
      requiresProject: true,
      component: lazyComponent(() => import("./ui/DependenciesView").then((m) => m.DependenciesView)),
    }),
    registerActions([
      {
        id: "pythonDeps.open",
        title: "Open Project Dependencies",
        category: "Tools",
        when: "projectOpen",
        keywords: ["pyproject", "uv", "requirements", "packages", "lock"],
        run: () => openDependencies(),
      },
      {
        id: "pythonDeps.preview",
        title: "Preview Dependency Changes",
        category: "Tools",
        when: "projectOpen",
        run: () => previewChanges(),
      },
      {
        id: "pythonDeps.applyAndSync",
        title: "Apply Dependency Changes and Sync",
        category: "Tools",
        when: "projectOpen",
        run: () => applyAndSync(),
      },
      {
        id: "pythonDeps.retrySync",
        title: "Retry Dependency Sync",
        category: "Tools",
        when: "projectOpen",
        run: () => retrySync(),
      },
    ]),
    activateRefresh(),
  ];
  return () => disposers.reverse().forEach((d) => d());
}
