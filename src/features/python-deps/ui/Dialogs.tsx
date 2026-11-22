import { useState } from "react";
import { tx } from "@/platform/i18n";
import type { PythonDependencyGroupRef } from "@/platform/ipc";
import { Checkbox, Dialog, Input, Select, T } from "@/ui";
import { setSelection, stage } from "../controller";
import { formatGroups, groupKey, groupLabel, parseGroups } from "../model";
import { useDeps } from "../store";
import styles from "./Deps.module.css";

const NEW_GROUP = "new:group";
const close = () => useDeps.setState({ dialog: null });

/** The groups a requirement can go to, plus a new dependency group. */
function useTargets(except?: PythonDependencyGroupRef) {
  const model = useDeps((s) => s.model);
  const groups = model?.groups ?? [];
  const options = groups
    .map((g) => g.group)
    .filter((g) => !except || groupKey(g) !== groupKey(except))
    .map((g) => ({ value: groupKey(g), label: groupLabel(g) }));
  options.push({ value: NEW_GROUP, label: tx("New dependency group…") });
  const resolve = (key: string, name: string): PythonDependencyGroupRef | null => {
    if (key === NEW_GROUP) return name.trim() ? { kind: "group", name: name.trim() } : null;
    return groups.map((g) => g.group).find((g) => groupKey(g) === key) ?? null;
  };
  return { options, resolve };
}

export function DepsDialogs() {
  const dialog = useDeps((s) => s.dialog);
  if (!dialog) return null;
  switch (dialog.kind) {
    case "add":
      return <AddDialog />;
    case "edit":
      return <EditDialog group={dialog.group} requirement={dialog.requirement} />;
    case "move":
      return <MoveDialog group={dialog.group} requirement={dialog.requirement} />;
    case "groups":
      return <GroupsDialog />;
  }
}

function AddDialog() {
  const { options, resolve } = useTargets();
  const [requirement, setRequirement] = useState("");
  const [target, setTarget] = useState(options[0]?.value ?? NEW_GROUP);
  const [name, setName] = useState("");
  const group = resolve(target, name);
  const submit = () => {
    if (!group || !requirement.trim()) return;
    stage({ op: "add", group, requirement: requirement.trim() });
    close();
  };
  return (
    <Dialog
      open
      title="Add Package"
      onClose={close}
      width={460}
      buttons={[
        { label: "Stage", role: "default", disabled: !group || !requirement.trim(), onClick: submit },
        { label: "Cancel", role: "cancel" },
      ]}
    >
      <div className={styles.form}>
        <T>Requirement</T>
        <Input
          mono
          autoFocus
          value={requirement}
          placeholder={tx("A requirement, such as httpx>=0.27")}
          aria-label={tx("Requirement")}
          onChange={(e) => setRequirement(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <T>Group</T>
        <Select value={target} options={options} onChange={setTarget} aria-label={tx("Group")} />
        {target === NEW_GROUP && (
          <>
            <T>Group name</T>
            <Input mono value={name} aria-label={tx("Group name")} onChange={(e) => setName(e.target.value)} />
          </>
        )}
      </div>
    </Dialog>
  );
}

function EditDialog({ group, requirement }: { group: PythonDependencyGroupRef; requirement: string }) {
  const [text, setText] = useState(requirement);
  const changed = text.trim() && text.trim() !== requirement;
  const submit = () => {
    if (!changed) return;
    stage({ op: "replace", group, requirement, with: text.trim() });
    close();
  };
  return (
    <Dialog
      open
      title="Edit Requirement"
      onClose={close}
      width={460}
      buttons={[
        { label: "Stage", role: "default", disabled: !changed, onClick: submit },
        { label: "Cancel", role: "cancel" },
      ]}
    >
      <div className={styles.form}>
        <T>Requirement</T>
        <Input
          mono
          autoFocus
          autoSelect
          value={text}
          aria-label={tx("Requirement")}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <span className={styles.hint}>
          <T>Edit the version constraints, extras or markers.</T>
        </span>
      </div>
    </Dialog>
  );
}

function MoveDialog({ group, requirement }: { group: PythonDependencyGroupRef; requirement: string }) {
  const { options, resolve } = useTargets(group);
  const [target, setTarget] = useState(options[0]?.value ?? NEW_GROUP);
  const [name, setName] = useState("");
  const to = resolve(target, name);
  const submit = () => {
    if (!to) return;
    stage({ op: "move", group, to, requirement });
    close();
  };
  return (
    <Dialog
      open
      title="Move to Group"
      onClose={close}
      width={460}
      buttons={[
        { label: "Stage", role: "default", disabled: !to, onClick: submit },
        { label: "Cancel", role: "cancel" },
      ]}
    >
      <div className={styles.form}>
        <T>Requirement</T>
        <code>{requirement}</code>
        <T>Move to</T>
        <Select value={target} options={options} onChange={setTarget} aria-label={tx("Move to")} />
        {target === NEW_GROUP && (
          <>
            <T>Group name</T>
            <Input mono value={name} aria-label={tx("Group name")} onChange={(e) => setName(e.target.value)} />
          </>
        )}
      </div>
    </Dialog>
  );
}

function GroupsDialog() {
  const current = useDeps((s) => s.selection);
  const model = useDeps((s) => s.model);
  const extras = model?.groups.filter((g) => g.group.kind === "extra").map((g) => g.group.name) ?? [];
  const [chosen, setChosen] = useState<string[]>(current.extras);
  const [all, setAll] = useState(current.allExtras);
  const [groups, setGroups] = useState(formatGroups(current.groups));
  const [inexact, setInexact] = useState(current.inexact);
  const submit = () => {
    setSelection({ extras: chosen, allExtras: all, groups: parseGroups(groups), inexact });
    close();
  };
  return (
    <Dialog
      open
      title="Select Groups and Extras"
      onClose={close}
      width={480}
      buttons={[
        { label: "OK", role: "default", onClick: submit },
        { label: "Cancel", role: "cancel" },
      ]}
    >
      <div className={styles.form}>
        <T>Extras</T>
        <div className={styles.checks}>
          <Checkbox checked={all} onChange={setAll} label={tx("All extras")} />
          {extras.map((extra) => (
            <Checkbox
              key={extra}
              checked={all || chosen.includes(extra)}
              disabled={all}
              onChange={(on) => setChosen((c) => (on ? [...c, extra] : c.filter((x) => x !== extra)))}
              label={extra}
            />
          ))}
        </div>
        <T>Development groups</T>
        <Input mono value={groups} aria-label={tx("Development groups")} onChange={(e) => setGroups(e.target.value)} />
        <span className={styles.hint}>
          <T>Leave blank for uv's defaults, enter - for none, or list groups separated by commas.</T>
        </span>
        <span />
        <Checkbox checked={inexact} onChange={setInexact} label={tx("Keep packages the lock doesn't list")} />
      </div>
    </Dialog>
  );
}
