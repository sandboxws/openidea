import { lazyComponent } from "@/ui";
import { registerSettingsPage } from "@/workbench/contributions";

export const SAVE_ACTIONS_PAGE = "tools.actionsOnSave.python";

/** Settings › Tools › Actions on Save › Python (also in the Settings window). */
export function activateSettingsPages(): () => void {
  return registerSettingsPage({
    id: SAVE_ACTIONS_PAGE,
    title: "Python",
    order: 0,
    keywords: ["ruff", "lint", "fix", "format", "save", "python", "pyidea"],
    projectScope: true,
    defaultScope: "project",
    component: lazyComponent(() => import("./PythonSaveActionsPage").then((m) => m.PythonSaveActionsPage)),
  });
}
