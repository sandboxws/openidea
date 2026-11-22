/**
 * Workbench features of this fork (see FORK.md). Upstream's list in `./index.ts` pulls
 * these in once, so adding a fork feature only ever edits this file; the native Settings
 * window's fork pages are in `./forkSettingsWindow.ts`.
 *
 * Activation runs after every upstream feature. Like those, a fork `activate()`
 * registers contributions and returns a disposer; it must not reach for the
 * editor service eagerly.
 */
import { activate as gruvppuccin } from "./gruvppuccin";
import { activate as mojo } from "./mojo";
import { activate as pyidea } from "./pyidea";
import { activate as pythonDeps } from "./python-deps";
import { activate as pythonTests } from "./python-tests";
import { activate as pythonWeb } from "./python-web";
import { activate as scientific } from "./scientific";
import { activate as tomlWorkbench } from "./toml-workbench";

type Activate = () => void | (() => void);

export const forkFeatures: Array<[string, Activate]> = [
  ["gruvppuccin", gruvppuccin],
  ["pyidea", pyidea],
  ["python-tests", pythonTests],
  ["python-web", pythonWeb],
  ["toml-workbench", tomlWorkbench],
  ["python-deps", pythonDeps],
  ["mojo", mojo],
  ["scientific", scientific],
];
