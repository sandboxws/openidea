/**
 * Add or edit a Spark connection. The name, kind, master / endpoint, interpreter and monitoring
 * URLs go to the project's settings; the Connect token, the monitoring Authorization header and
 * the Spark configuration (which can hold keys) go to the OS credential store.
 */
import { useEffect, useState } from "react";
import { tx } from "@/platform/i18n";
import { Dialog, Input, Select, T } from "@/ui";
import { readSecret, removeConnection, saveConnection, type SecretChanges } from "../connections";
import { connectionProblems, parseConf, type SparkConnection } from "../model";
import { message } from "../session";
import { useSpark } from "../store";
import styles from "./Spark.module.css";

const close = () => useSpark.setState({ editing: null });

export function ConnectionDialogHost() {
  const editing = useSpark((s) => s.editing);
  return editing ? <ConnectionDialog key={editing.id} initial={editing} /> : null;
}

/** A credential field: blank keeps a saved value; Forget clears it. */
function SecretField(props: {
  label: string;
  saved: boolean;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const forgotten = props.value === null;
  return (
    <div className={styles.secretRow}>
      <Input
        type="password"
        autoComplete="off"
        value={props.value ?? ""}
        aria-label={props.label}
        placeholder={props.saved && !forgotten ? tx("Saved; type to replace") : ""}
        onChange={(e) => props.onChange(e.target.value)}
      />
      {props.saved && !forgotten && (
        <button type="button" className={styles.linkButton} onClick={() => props.onChange(null)}>
          <T>Forget</T>
        </button>
      )}
    </div>
  );
}

function ConnectionDialog({ initial }: { initial: SparkConnection }) {
  const connections = useSpark((s) => s.connections);
  const existing = connections.some((c) => c.id === initial.id);
  const [draft, setDraft] = useState(initial);
  const [conf, setConf] = useState("");
  const [saved, setSaved] = useState({ token: false, authorization: false });
  const [token, setToken] = useState<string | null>("");
  const [authorization, setAuthorization] = useState<string | null>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!existing) return;
    let live = true;
    void Promise.all([
      readSecret(initial.id, "conf"),
      readSecret(initial.id, "token"),
      readSecret(initial.id, "authorization"),
    ]).then(([c, t, a]) => {
      if (!live) return;
      setConf(c ?? "");
      setSaved({ token: Boolean(t), authorization: Boolean(a) });
    });
    return () => {
      live = false;
    };
  }, [existing, initial.id]);

  const set = (patch: Partial<SparkConnection>) => setDraft((d) => ({ ...d, ...patch }));
  const problems = connectionProblems(draft, connections);
  const confProblems = parseConf(conf).problems;
  const insecure =
    (authorization || (saved.authorization && authorization !== null)) &&
    [draft.uiUrl, draft.historyUrl].some((u) => u.trim().toLowerCase().startsWith("http://"));
  const invalid = problems.length > 0 || confProblems.length > 0 || Boolean(insecure);

  const submit = async () => {
    if (invalid || busy) return;
    setBusy(true);
    const secrets: SecretChanges = { conf };
    if (draft.kind === "connect" && (token || token === null)) secrets.token = token;
    if (draft.kind === "local") secrets.token = null;
    if (authorization || authorization === null) secrets.authorization = authorization;
    try {
      await saveConnection({ ...draft, name: draft.name.trim() }, secrets);
      close();
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  };
  const problem = (field: Parameters<typeof problems.includes>[0], text: string) =>
    problems.includes(field) && <span className={styles.invalid}>{text}</span>;

  return (
    <Dialog
      open
      title={existing ? "Edit Spark Connection" : "Add Spark Connection"}
      onClose={close}
      width={560}
      buttons={[
        { label: "Save", role: "default", disabled: invalid || busy, onClick: () => void submit() },
        ...(existing
          ? [
              {
                label: "Remove",
                onClick: () => {
                  void removeConnection(initial.id).then(close, (e: unknown) => setError(message(e)));
                },
              },
            ]
          : []),
        { label: "Cancel", role: "cancel" as const },
      ]}
    >
      <div className={styles.form}>
        <T>Name</T>
        <Input autoFocus value={draft.name} aria-label={tx("Name")} onChange={(e) => set({ name: e.target.value })} />
        {problem("name", tx("Give the connection a name no other connection has"))}
        <T>Type</T>
        <Select
          value={draft.kind}
          aria-label={tx("Type")}
          options={[
            { value: "local", label: tx("Local") },
            { value: "connect", label: tx("Spark Connect") },
          ]}
          onChange={(v) => set({ kind: v === "connect" ? "connect" : "local" })}
        />
        {draft.kind === "local" ? (
          <>
            <T>Master</T>
            <Input
              mono
              value={draft.master}
              aria-label={tx("Master")}
              onChange={(e) => set({ master: e.target.value })}
            />
            {problem("master", tx("A master such as local[*] or local[2]"))}
            <span className={styles.hint}>
              <T>Needs pyspark in the interpreter and Java 17 or later.</T>
            </span>
          </>
        ) : (
          <>
            <T>Endpoint</T>
            <Input
              mono
              value={draft.remote}
              aria-label={tx("Endpoint")}
              placeholder="sc://host:15002"
              onChange={(e) => set({ remote: e.target.value })}
            />
            {problem("remote", tx("A Spark Connect endpoint: sc://host:port"))}
            <T>Token</T>
            <SecretField label={tx("Token")} saved={saved.token} value={token} onChange={setToken} />
            <span className={styles.hint}>
              <T>
                Needs pyspark-client or pyspark[connect] in the interpreter. With a token the client uses TLS, unless
                the host is localhost.
              </T>
            </span>
          </>
        )}
        <T>Interpreter</T>
        <Input
          mono
          value={draft.python}
          aria-label={tx("Interpreter")}
          placeholder={tx("The project's interpreter")}
          onChange={(e) => set({ python: e.target.value })}
        />
        <span className={styles.hint}>
          <T>
            A path to python, absolute or relative to the project. A separate environment keeps Spark's dependencies
            apart.
          </T>
        </span>
        <T>Spark UI</T>
        <Input
          mono
          value={draft.uiUrl}
          aria-label={tx("Spark UI")}
          placeholder={draft.kind === "local" ? tx("The session's own") : "https://…"}
          onChange={(e) => set({ uiUrl: e.target.value })}
        />
        {problem("uiUrl", tx("An http or https URL"))}
        <T>History Server</T>
        <Input
          mono
          value={draft.historyUrl}
          aria-label={tx("History Server")}
          placeholder="https://…"
          onChange={(e) => set({ historyUrl: e.target.value })}
        />
        {problem("historyUrl", tx("An http or https URL"))}
        <T>Authorization</T>
        <SecretField
          label={tx("Authorization header")}
          saved={saved.authorization}
          value={authorization}
          onChange={setAuthorization}
        />
        {insecure ? (
          <span className={styles.invalid}>
            <T>Use https monitoring URLs with an Authorization header.</T>
          </span>
        ) : (
          <span className={styles.hint}>
            <T>Sent to the Spark UI and History Server only.</T>
          </span>
        )}
        <span className={styles.wide}>
          <T>Spark configuration</T>
        </span>
        <textarea
          className={`${styles.conf} ${styles.wide}`}
          value={conf}
          spellCheck={false}
          aria-label={tx("Spark configuration")}
          placeholder={"spark.sql.shuffle.partitions=8\nspark.driver.memory=2g"}
          onChange={(e) => setConf(e.target.value)}
        />
        {confProblems.length > 0 && (
          <span className={styles.invalid}>{tx`Line ${confProblems[0]!.line} isn't key=value`}</span>
        )}
        {error && <span className={`${styles.invalid} ${styles.wide}`}>{error}</span>}
      </div>
    </Dialog>
  );
}
