/**
 * PyIdea's Mojo support (FORK.md), with the `plugins/mojo` language: the project's Mojo SDK as
 * the language server and LLDB debug adapter, Mojo's own keywords, a Mojo Application run
 * configuration with ▶ beside `main`, Build, Reformat and the toolchain's status.
 */
import { activeEditor, onEditorEvent, registerEditorContribution } from "@/editor/api";
import { executeAction, registerActions } from "@/platform/actions";
import { tx } from "@/platform/i18n";
import { call, commands, isTauri, onIdeEvent } from "@/platform/ipc";
import { useProject } from "@/platform/project";
import { registerExternalIcons } from "@/ui";
import { notifications, registerRunConfigType, showStatusInfo } from "@/workbench/contributions";
import { mojoGutter } from "./gutter";
import { mojoKeywords } from "./keywords";
import { buildActiveFile, formatMojo, isMojoFile, runMojoFile } from "./runner";
import { NAMESPACE } from "./settings";
import { activateSettingsPages, MOJO_PAGE } from "./settingsPages";
import { syncMojoSetup } from "./setup";
import { mojoType } from "./types";

const FIRE =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 1C9 4 12 4 11 8C12 7 12 6 12 5C14 7 15 10 13 13C12 15 9 15 8 15C5 15 2 13 2 10C2 8 3 6 5 5C4 8 6 9 7 7C9 5 6 3 8 1Z" fill="#E66D17"/></svg>';

async function showStatus() {
  try {
    const status = await call(commands.pyideaMojoStatus());
    const body = status.error
      ? status.error
      : status.version
        ? [
            `${status.version}`,
            String(status.root),
            status.missing.length ? tx`Missing: ${status.missing.join(", ")}` : "",
          ]
            .filter(Boolean)
            .join("\n")
        : tx(
            "No Mojo SDK found. Install it in the project's environment (pip install mojo) or set it in Settings › Languages & Frameworks › Mojo.",
          );
    notifications().notify({
      group: "mojo",
      level: status.error ? "error" : "info",
      title: tx("Mojo toolchain"),
      body,
    });
  } catch (e) {
    notifications().notify({ group: "mojo", level: "error", title: tx("Mojo toolchain"), body: String(e) });
  }
}

async function restartServer() {
  const configured = await syncMojoSetup().catch(() => false);
  await call(commands.lspRestartNamed("mojo")).catch(() => undefined);
  showStatusInfo(configured ? tx("Mojo language server restarted") : tx("No Mojo SDK found"));
}

function activeMojo() {
  const editor = activeEditor();
  return editor && isMojoFile(editor.ctx.path) ? editor : null;
}

export function activate(): () => void {
  let configured = false;
  const ensureSetup = () => {
    if (configured || !isTauri()) return;
    configured = true;
    void syncMojoSetup().catch((e) => {
      configured = false;
      console.warn("[mojo] setup", e);
    });
  };
  const disposers = [
    registerExternalIcons([["ext:fork/mojo", FIRE]]),
    registerRunConfigType(mojoType),
    activateSettingsPages(),
    registerEditorContribution({
      id: "mojo.editor",
      extensions: (doc) => (isMojoFile(doc.path) && !doc.virtual ? [mojoKeywords, mojoGutter(doc)] : []),
    }),
    // A project's first Mojo file brings in its SDK; settings that pick another one sync again.
    onEditorEvent((e) => {
      if (e.type === "docOpened" && isMojoFile(e.path)) ensureSetup();
    }),
    onIdeEvent("settingsChanged", (e) => {
      if (e.key.startsWith(`plugins.${NAMESPACE}`) || e.key.startsWith("languages.python")) {
        configured = false;
        if (activeMojo()) ensureSetup();
      }
    }),
    useProject.subscribe((s, prev) => {
      if (s.project?.root !== prev.project?.root) configured = false;
    }),
    registerActions([
      {
        id: "mojo.runFile",
        title: "Run Mojo File",
        category: "Mojo",
        when: "projectOpen",
        run: () => {
          const editor = activeMojo();
          if (editor) return runMojoFile(editor.ctx.path);
          showStatusInfo(tx("Open a Mojo file to run it"));
        },
      },
      {
        id: "mojo.debugFile",
        title: "Debug Mojo File",
        category: "Mojo",
        when: "projectOpen",
        run: () => {
          const editor = activeMojo();
          if (editor) return runMojoFile(editor.ctx.path, true);
          showStatusInfo(tx("Open a Mojo file to debug it"));
        },
      },
      {
        id: "mojo.buildFile",
        title: "Build Mojo File",
        category: "Mojo",
        when: "projectOpen",
        run: () => buildActiveFile(),
      },
      {
        id: "mojo.formatFile",
        title: "Reformat Mojo File",
        category: "Mojo",
        when: "projectOpen",
        run: () => {
          const editor = activeMojo();
          if (editor) return formatMojo(editor.view, editor.ctx.path);
          showStatusInfo(tx("Open a Mojo file to format it"));
        },
      },
      {
        id: "mojo.restartServer",
        title: "Restart Mojo Language Server",
        category: "Mojo",
        when: "projectOpen",
        run: () => restartServer(),
      },
      {
        id: "mojo.showStatus",
        title: "Show Mojo Toolchain Status",
        category: "Mojo",
        when: "projectOpen",
        run: () => showStatus(),
      },
      {
        id: "mojo.openSettings",
        title: "Mojo Settings…",
        category: "Mojo",
        run: () => void executeAction("file.settings", MOJO_PAGE),
      },
    ]),
  ];
  if (activeMojo()) ensureSetup();
  return () => disposers.reverse().forEach((d) => d());
}
