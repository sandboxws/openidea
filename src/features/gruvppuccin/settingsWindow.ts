/** The native Settings window: the Gruvppuccin page, and the accent and radii on its own chrome. */
import { startRuntime } from "./runtime";
import { activateSettingsPages } from "./settingsPages";

export function activateSettingsWindow(): () => void {
  const disposers = [startRuntime(), activateSettingsPages()];
  return () => disposers.reverse().forEach((d) => d());
}
