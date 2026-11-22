/** Settings › Tools › Actions on Save › Python: PyIdea's Ruff save actions, per project. */
import { useEffect, useState } from "react";
import { tx } from "@/platform/i18n";
import type { RuffInfo } from "@/platform/ipc";
import { Button, Checkbox, T } from "@/ui";
import { useSettingsForm } from "@/workbench/contributions";
import { forgetRuff, ruffInfo } from "./ruff";
import { NAMESPACE, readPyidea, type PyideaSettings } from "./settings";
import styles from "./Pyidea.module.css";

export function PythonSaveActionsPage() {
  const form = useSettingsForm();
  const plugins = form.useValue("plugins") as Record<string, unknown> | undefined;
  const s = readPyidea(plugins?.[NAMESPACE]);
  const [ruff, setRuff] = useState<RuffInfo | null | undefined>(undefined);
  const [probe, setProbe] = useState(0);

  useEffect(() => {
    let live = true;
    void ruffInfo().then((info) => live && setRuff(info));
    return () => {
      live = false;
    };
  }, [probe]);

  // Both keys, so a project's choice doesn't leave the other to the global setting by accident.
  const set = (patch: Partial<PyideaSettings>) => form.setMapEntry("plugins", [NAMESPACE], { ...s, ...patch });

  return (
    <div className={styles.page}>
      <Checkbox
        checked={s.ruffFixOnSave}
        onChange={(ruffFixOnSave) => set({ ruffFixOnSave })}
        label="Fix Python lint on save"
      />
      <p className={styles.hint}>
        <T>Applies Ruff's safe fixes with the project's Ruff configuration and exclusions.</T>
      </p>
      <Checkbox
        checked={s.ruffFormatOnSave}
        onChange={(ruffFormatOnSave) => set({ ruffFormatOnSave })}
        label="Format Python on save"
      />
      <p className={styles.hint}>
        <T>Formats with Ruff after the fixes, unless Format on Save or Ruff's Run on Save already formats the file.</T>
      </p>
      <div className={styles.status}>
        {ruff === undefined ? (
          <T>Looking for Ruff…</T>
        ) : ruff ? (
          <span>{tx`Ruff ${ruff.version}`}</span>
        ) : (
          <T>
            Ruff wasn't found. Saving never installs it: add Ruff to the project's environment or set its path in
            Settings › Languages & Frameworks › Python › Ruff.
          </T>
        )}
        <Button
          size="small"
          variant="ghost"
          onClick={() => {
            forgetRuff();
            setRuff(undefined);
            setProbe((n) => n + 1);
          }}
        >
          Check Again
        </Button>
      </div>
    </div>
  );
}
