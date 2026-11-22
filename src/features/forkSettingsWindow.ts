/**
 * The fork's settings pages (and their runtime) for the native Settings window (see FORK.md),
 * activated once by `../settingsWindowBoot.ts`. Its static imports stay clear of the
 * Workbench, CodeMirror and editor modules (`settingsWindowBoot.test.ts`).
 */
import { activateSettingsWindow as gruvppuccin } from "./gruvppuccin/settingsWindow";
import { activateSettingsWindow as pyidea } from "./pyidea/settingsWindow";

type Activate = () => void | (() => void);

export const forkSettingsWindow: Array<[string, Activate]> = [
  ["gruvppuccin", gruvppuccin],
  ["pyidea", pyidea],
];
