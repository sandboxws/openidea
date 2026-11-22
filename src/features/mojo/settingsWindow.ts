/** The native Settings window: the Mojo page. */
import { activateSettingsPages } from "./settingsPages";

export function activateSettingsWindow(): () => void {
  return activateSettingsPages();
}
