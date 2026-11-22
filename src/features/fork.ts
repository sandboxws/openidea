/**
 * Features of this fork (see FORK.md). Upstream's lists in `./index.ts` and
 * `../settingsWindowBoot.ts` each pull these in once, so adding a fork feature
 * only ever edits this file.
 *
 * Activation runs after every upstream feature. Like those, a fork `activate()`
 * registers contributions and returns a disposer; it must not reach for the
 * editor service eagerly.
 */
type Activate = () => void | (() => void);

/** Workbench window features. */
export const forkFeatures: Array<[string, Activate]> = [];

/** Settings pages (and their runtime) for the native Settings window. */
export const forkSettingsWindow: Array<[string, Activate]> = [];
