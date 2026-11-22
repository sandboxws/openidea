/**
 * PyIdea's Python editing features (FORK.md): Ruff lint fixes and formatting on save,
 * rule codes and documentation links in problem hovers, and completion in suppression
 * comments.
 */
import { registerEditorContribution } from "@/editor/api";
import { registerActions } from "@/platform/actions";
import { call, commands, isTauri } from "@/platform/ipc";
import { useProject } from "@/platform/project";
import { showStatusInfo } from "@/workbench/contributions";
import { tx } from "@/platform/i18n";
import { diagnosticRuleTheme, registerDiagnosticLinks, rememberRuffRules } from "./diagnosticLinks";
import { forgetRuff, ruffInfo, ruffRules, watchRuffSettings } from "./ruff";
import { registerRuffOnSave } from "./saveActions";
import { NAMESPACE, pyideaSettings, type PyideaSettings } from "./settings";
import { activateSettingsPages } from "./settingsPages";
import { suppressionCompletion } from "./suppressions";

async function setForProject(patch: Partial<PyideaSettings>) {
  if (!isTauri() || !useProject.getState().project) return;
  const next = { ...pyideaSettings(), ...patch };
  useProject.setState({
    settings: await call(commands.settingsSet("project", `plugins.${NAMESPACE}`, JSON.stringify(next))),
  });
}

function activateActions(): () => void {
  return registerActions([
    {
      id: "pyidea.toggleRuffFixOnSave",
      title: "Fix Python Lint on Save",
      category: "Code",
      when: "projectOpen",
      keywords: ["ruff", "lint", "fix", "save"],
      toggled: () => pyideaSettings().ruffFixOnSave,
      run: () => setForProject({ ruffFixOnSave: !pyideaSettings().ruffFixOnSave }),
    },
    {
      id: "pyidea.toggleRuffFormatOnSave",
      title: "Format Python on Save",
      category: "Code",
      when: "projectOpen",
      keywords: ["ruff", "format", "save"],
      toggled: () => pyideaSettings().ruffFormatOnSave,
      run: () => setForProject({ ruffFormatOnSave: !pyideaSettings().ruffFormatOnSave }),
    },
    {
      id: "pyidea.refreshRuff",
      title: "Refresh Ruff Rules",
      category: "Code",
      when: "projectOpen",
      keywords: ["ruff", "rules", "noqa"],
      run: async () => {
        forgetRuff();
        const info = await ruffInfo();
        if (info) rememberRuffRules(await ruffRules());
        showStatusInfo(info ? tx`Ruff ${info.version}` : tx("Ruff wasn't found"));
      },
    },
  ]);
}

export function activate(): () => void {
  const disposers = [
    registerRuffOnSave(),
    registerDiagnosticLinks(),
    watchRuffSettings(),
    registerEditorContribution({
      id: "pyidea.python",
      extensions: (doc) => {
        if (doc.language !== "python" || doc.readOnly || doc.virtual) return [];
        // Rule names, for the documentation links of Ruff's problems.
        void ruffRules().then(rememberRuffRules);
        return [diagnosticRuleTheme, suppressionCompletion(() => doc.path)];
      },
    }),
    activateActions(),
    activateSettingsPages(),
  ];
  return () => disposers.reverse().forEach((d) => d());
}
