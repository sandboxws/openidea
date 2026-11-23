/**
 * PyIdea's Spark workspace (FORK.md): connections to a local Spark or a Spark Connect server
 * per project, each with one session process shared by the Spark SQL editor and the Spark
 * console; the catalog; bounded previews with filter, sort, count and CSV export.
 */
import { registerEditorContribution, activeEditor } from "@/editor/api";
import { registerActions } from "@/platform/actions";
import { tx } from "@/platform/i18n";
import { call, commands, IpcError } from "@/platform/ipc";
import { appDataDir } from "@/platform/platformInfo";
import { useProject } from "@/platform/project";
import { lazyComponent, registerExternalIcons } from "@/ui";
import {
  editorService,
  registerMenuGroup,
  registerOverlay,
  registerToolWindow,
  showStatusInfo,
  toolWindowService,
} from "@/workbench/contributions";
import { sparkSqlCompletion } from "./completion";
import { resetSpark, syncConnections } from "./connections";
import { blankConnection, statementAt } from "./model";
import { cancelSession, connect, disconnect, disconnectAll, installSessions, runPython, runSql } from "./session";
import { CONSOLE_TAB, useSpark } from "./store";

const WORKSPACE = "spark";
const RESULTS = "sparkResults";

const SPARKLE =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 1.5 9.5 6.5 14.5 8 9.5 9.5 8 14.5 6.5 9.5 1.5 8 6.5 6.5Z" stroke="currentColor" stroke-linejoin="round"/></svg>';

const isSparkSqlPath = (path: string) => path.toLowerCase().endsWith(".sparksql");

/** The active editor when it holds Spark SQL (a `.sparksql` file, or SQL). */
function sqlEditor() {
  const editor = activeEditor();
  if (!editor) return null;
  const { language, path } = editor.ctx;
  return language === "sparksql" || language === "sql" || isSparkSqlPath(path) ? editor : null;
}

/** The selection, else the statement at the caret. */
function statementToRun(): string | null {
  const editor = sqlEditor();
  if (!editor) return null;
  const { state } = editor.view;
  const { from, to, head } = state.selection.main;
  if (from !== to) return state.sliceDoc(from, to).trim() || null;
  return statementAt(state.doc.toString(), head)?.text ?? null;
}

function selectedConnection(): string | null {
  const { selected, connections } = useSpark.getState();
  if (selected) return selected;
  if (!connections.length) {
    toolWindowService().show(WORKSPACE, true);
    useSpark.setState({ editing: blankConnection(crypto.randomUUID()) });
  }
  return null;
}

async function runStatement(explain: boolean) {
  const sql = statementToRun();
  if (!sql) {
    showStatusInfo(tx("Put the caret in a Spark SQL statement, or select one"));
    return;
  }
  const id = selectedConnection();
  if (!id) return;
  toolWindowService().show(RESULTS, false);
  await runSql(id, sql, explain);
}

async function runSelectionInConsole() {
  const editor = activeEditor();
  const range = editor?.view.state.selection.main;
  const code = editor && range && range.from !== range.to ? editor.view.state.sliceDoc(range.from, range.to) : "";
  if (!code.trim()) {
    showStatusInfo(tx("Select Python code to run in the Spark console"));
    return;
  }
  const id = selectedConnection();
  if (!id) return;
  useSpark.setState({ tab: CONSOLE_TAB });
  toolWindowService().show(RESULTS, false);
  await runPython(id, code);
}

/** A new `spark[_n].sparksql` among the scratch files. */
async function newSqlFile() {
  const dir = `${(await appDataDir()).replace(/\/+$/, "")}/scratches`;
  try {
    await call(commands.fsCreateDir(dir));
  } catch (e) {
    if (!(e instanceof IpcError && e.kind === "alreadyExists")) throw e;
  }
  const names = new Set((await call(commands.fsReadDir(dir))).map((e) => e.name));
  let name = "spark.sparksql";
  for (let n = 2; names.has(name); n++) name = `spark_${n}.sparksql`;
  const path = `${dir}/${name}`;
  await call(commands.fsCreateFile(path));
  await editorService().openFile(path, { focus: true });
}

export function activate(): () => void {
  syncConnections();
  const offProject = useProject.subscribe((s, prev) => {
    if (s.project?.root !== prev.project?.root) {
      disconnectAll();
      resetSpark();
      syncConnections();
    } else if (s.settings !== prev.settings) syncConnections();
  });
  const disposers = [
    offProject,
    installSessions(),
    registerExternalIcons([["ext:fork/spark", SPARKLE]]),
    registerToolWindow({
      id: WORKSPACE,
      title: "Spark",
      icon: "ext:fork/spark",
      anchor: "right",
      stripe: "onUse",
      order: 45,
      requiresProject: true,
      component: lazyComponent(() => import("./ui/SparkView").then((m) => m.SparkView)),
    }),
    registerToolWindow({
      id: RESULTS,
      title: "Spark Results",
      icon: "db-in-editor-results",
      anchor: "bottom",
      stripe: "onUse",
      order: 62,
      requiresProject: true,
      component: lazyComponent(() => import("./ui/ResultsView").then((m) => m.ResultsView)),
    }),
    registerOverlay({
      id: "spark.connection",
      component: lazyComponent(() => import("./ui/ConnectionDialog").then((m) => m.ConnectionDialogHost)),
    }),
    registerEditorContribution({
      id: "spark.sqlCompletion",
      extensions: (ctx) => (ctx.language === "sparksql" || isSparkSqlPath(ctx.path) ? sparkSqlCompletion() : []),
    }),
    registerMenuGroup({
      id: "spark.editor",
      menus: ["editor"],
      order: 40,
      items: (_menu, { paths }) => {
        const path = paths[0] ?? "";
        if (isSparkSqlPath(path))
          return [
            { kind: "action", action: "spark.runStatement" },
            { kind: "action", action: "spark.explainStatement" },
          ];
        const range = activeEditor()?.view.state.selection.main;
        if (path.endsWith(".py") && range && range.from !== range.to && useSpark.getState().connections.length)
          return [{ kind: "action", action: "spark.runSelectionInConsole" }];
        return [];
      },
    }),
    registerActions([
      {
        id: "spark.openWorkspace",
        title: "Open Spark Workspace",
        category: "Tools",
        when: "projectOpen",
        keywords: ["spark", "pyspark", "catalog", "connect"],
        run: () => toolWindowService().show(WORKSPACE, true),
      },
      {
        id: "spark.addConnection",
        title: "Add Spark Connection…",
        category: "Tools",
        when: "projectOpen",
        run: () => {
          toolWindowService().show(WORKSPACE, false);
          useSpark.setState({ editing: blankConnection(crypto.randomUUID()) });
        },
      },
      {
        id: "spark.connect",
        title: "Connect to Spark",
        category: "Tools",
        when: "projectOpen",
        run: () => {
          const id = selectedConnection();
          if (id) void connect(id);
        },
      },
      {
        id: "spark.disconnect",
        title: "Disconnect from Spark",
        category: "Tools",
        when: "projectOpen",
        run: () => {
          const id = useSpark.getState().selected;
          if (id) disconnect(id);
        },
      },
      {
        id: "spark.runStatement",
        title: "Run in Spark",
        category: "Run",
        icon: "run",
        when: "projectOpen",
        keywords: ["spark", "sql", "query", "execute"],
        run: () => runStatement(false),
      },
      {
        id: "spark.explainStatement",
        title: "Explain in Spark",
        category: "Run",
        icon: "db-plan",
        when: "projectOpen",
        keywords: ["spark", "sql", "plan"],
        run: () => runStatement(true),
      },
      {
        id: "spark.cancel",
        title: "Cancel Spark Query",
        category: "Run",
        when: "projectOpen",
        run: () => {
          const id = useSpark.getState().selected;
          if (id) cancelSession(id);
        },
      },
      {
        id: "spark.newSqlFile",
        title: "New Spark SQL File",
        category: "File",
        when: "projectOpen",
        run: () => newSqlFile(),
      },
      {
        id: "spark.openConsole",
        title: "Open Spark Console",
        category: "Tools",
        when: "projectOpen",
        run: () => {
          useSpark.setState({ tab: CONSOLE_TAB });
          toolWindowService().show(RESULTS, true);
        },
      },
      {
        id: "spark.runSelectionInConsole",
        title: "Run Selection in Spark Console",
        category: "Run",
        when: "projectOpen",
        run: () => runSelectionInConsole(),
      },
    ]),
  ];
  return () => disposers.reverse().forEach((d) => d());
}
