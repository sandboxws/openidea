/** Settings › Languages & Frameworks › Mojo: the SDK and import paths, per project. */
import { useEffect, useState } from "react";
import { tx } from "@/platform/i18n";
import { call, commands, isTauri, type MojoStatus } from "@/platform/ipc";
import { Button, Input, T } from "@/ui";
import { useSettingsForm } from "@/workbench/contributions";
import { NAMESPACE, readMojo, type MojoSettings } from "./settings";
import styles from "./Mojo.module.css";

function version(status: MojoStatus): string {
  const sdk = status.version ?? "";
  const where = String(status.root);
  return tx`Found ${sdk} in ${where}`;
}

function missingText(status: MojoStatus): string {
  const missing = status.missing.join(", ");
  return tx`Missing: ${missing}`;
}

export function MojoSettingsPage() {
  const form = useSettingsForm();
  const plugins = form.useValue("plugins") as Record<string, unknown> | undefined;
  const s = readMojo(plugins?.[NAMESPACE]);
  const set = (patch: Partial<MojoSettings>) => form.setMapEntry("plugins", [NAMESPACE], { ...s, ...patch });
  const [status, setStatus] = useState<MojoStatus | null | undefined>(undefined);
  const [probe, setProbe] = useState(0);

  useEffect(() => {
    let live = true;
    if (!isTauri()) return;
    call(commands.pyideaMojoStatus())
      .then((st) => live && setStatus(st))
      .catch(() => live && setStatus(null));
    return () => {
      live = false;
    };
  }, [probe]);

  return (
    <div className={styles.page}>
      <label className={styles.label} htmlFor="mojo-sdk">
        <T>SDK directory</T>
      </label>
      <Input
        id="mojo-sdk"
        mono
        value={s.sdkDirectory}
        placeholder={tx("Find it: .venv, .pixi/envs/default, the project interpreter's environment")}
        onChange={(e) => set({ sdkDirectory: e.target.value })}
      />
      <p className={styles.hint}>
        <T>
          An environment that contains bin/mojo, relative to the project. Opening a project never installs anything.
        </T>
      </p>
      <label className={styles.label} htmlFor="mojo-imports">
        <T>Import paths</T>
      </label>
      <textarea
        id="mojo-imports"
        className={styles.paths}
        rows={3}
        spellCheck={false}
        value={s.importPaths}
        onChange={(e) => set({ importPaths: e.target.value })}
      />
      <p className={styles.hint}>
        <T>
          One path per line, relative to the project. Source roots are included; the compiler and the language server
          use the same paths.
        </T>
      </p>
      <div className={styles.status}>
        {status === undefined ? (
          <T>Looking for the Mojo SDK…</T>
        ) : status?.error ? (
          <span className={styles.error}>{status.error}</span>
        ) : status?.version ? (
          <span>{version(status)}</span>
        ) : (
          <T>No Mojo SDK found. Install it in the project's environment (pip install mojo) or choose its directory.</T>
        )}
        {status?.missing.length ? <span className={styles.error}>{missingText(status)}</span> : null}
        <Button size="small" variant="ghost" onClick={() => setProbe((n) => n + 1)}>
          Check Again
        </Button>
      </div>
    </div>
  );
}
