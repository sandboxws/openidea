import { lazyComponent } from "@/ui";
import { registerSettingsPage } from "@/workbench/contributions";

export const SETTINGS_PAGE = "appearance.gruvppuccin";

/** Settings › Appearance › Gruvppuccin (also in the Settings window). */
export function activateSettingsPages(): () => void {
  return registerSettingsPage({
    id: SETTINGS_PAGE,
    title: "Gruvppuccin",
    order: 1,
    keywords: ["theme", "accent", "preset", "corner radius", "arc", "bold keywords", "island", "gruvbox", "catppuccin"],
    component: lazyComponent(() => import("./GruvppuccinSettingsPage").then((m) => m.GruvppuccinSettingsPage)),
  });
}
