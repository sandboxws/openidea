import { lazyComponent } from "@/ui";
import { registerSettingsPage } from "@/workbench/contributions";

export const MOJO_PAGE = "languages.mojo";

/** Settings › Languages & Frameworks › Mojo (also in the Settings window). */
export function activateSettingsPages(): () => void {
  return registerSettingsPage({
    id: MOJO_PAGE,
    title: "Mojo",
    group: "Languages & Frameworks",
    order: 60,
    keywords: ["mojo", "sdk", "modular", "import paths", "pixi"],
    projectScope: true,
    defaultScope: "project",
    component: lazyComponent(() => import("./MojoSettingsPage").then((m) => m.MojoSettingsPage)),
  });
}
