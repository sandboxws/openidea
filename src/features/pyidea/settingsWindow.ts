/** The native Settings window: the Python save actions page. */
import { activateSettingsPages } from "./settingsPages";

export function activateSettingsWindow(): () => void {
  return activateSettingsPages();
}
