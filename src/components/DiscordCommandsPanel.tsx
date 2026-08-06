"use client";

import { useState } from "react";
import type { CommandButton, CommandButtonAction, CommandButtonStyle, CustomCommandDetail } from "@/lib/types";

// ---------------------------------------------------------------------------
// Custom-command builder (Discord config suite, 2026-08-06). The DM defines
// slash commands for the linked server; each command opens an ephemeral
// panel of buttons in Discord (like /panel music), and every button posts
// something to the channel: an entity introduction, custom text, a
// template-aware stat roll, or a live status card. Client-side state builds
// the action JSON into a hidden input; the server action sanitizes it
// (sanitizeCommandAction) - editor output is a claim, not a fact. Same
// architecture as BlueprintEditor.
// ---------------------------------------------------------------------------

export interface EntityOption {
  id: string;
  name: string;
}

export interface CommandEditorOptions {
  characters: EntityOption[];
  locations: EntityOption[];
  factions: EntityOption[];
  artifacts: EntityOption[];
  creatures: EntityOption[];
  /** The campaign's sheet-template variables - roll buttons resolve THESE,
   *  so a custom system's stats are first-class here. */
  variables: { key: string; label: string; group: string }[];
}

type ServerAction = (formData: FormData) => void;

export interface CommandPanelActions {
  createCommand: ServerAction;
  saveCommand: ServerAction;
  deleteCommand: ServerAction;
  addButton: ServerAction;
  saveButton: ServerAction;
  deleteButton: ServerAction;
  moveButton: ServerAction;
}

const inputCls =
  "w-full rounded-lg bg-void border border-gold/30 px-3 py-2 text-parchment text-sm focus:outline-none focus:border-gold/70";
const labelCls = "block text-[10px] uppercase tracking-widest text-ember/80 mb-1";
const smallBtn = "text-xs rounded-full border border-gold/40 text-gold px-3 py-1 hover:bg-gold/10";

const STYLES: { value: CommandButtonStyle; label: string }[] = [
  { value: "primary", label: "Blue (primary)" },
  { value: "secondary", label: "Gray (secondary)" },
  { value: "success", label: "Green (success)" },
  { value: "danger", label: "Red (danger)" },
];

const ENTITY_KINDS: { value: "characters" | "locations" | "factions" | "artifacts" | "creatures"; label: string }[] = [
  { value: "characters", label: "Character" },
  { value: "locations", label: "Location" },
  { value: "factions", label: "Faction" },
  { value: "artifacts", label: "Artifact" },
  { value: "creatures", label: "Creature" },
];

function defaultAction(): CommandButtonAction {
  return { kind: "text", text: "" };
}

/** One count/die/modifier slot: a literal number or a template variable. */
function PartInput({
  value,
  onChange,
  options,
  title,
  allowNegative = false,
}: {
  value: number | string;
  onChange: (v: number | string) => void;
  options: CommandEditorOptions["variables"];
  title: string;
  allowNegative?: boolean;
}) {
  const isNumber = typeof value === "number";
  const groups = options.reduce<string[]>((acc, v) => (acc.includes(v.group) ? acc : [...acc, v.group]), []);
  return (
    <span className="inline-flex items-center gap-1" title={title}>
      {isNumber && (
        <input
          type="number"
          min={allowNegative ? undefined : 0}
          className="w-14 rounded bg-void border border-gold/30 px-1.5 py-1 text-parchment text-xs"
          value={value}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
        />
      )}
      <select
        className="rounded bg-void border border-gold/30 px-1 py-1 text-parchment/80 text-xs max-w-28"
        value={isNumber ? "__number" : (value as string)}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "__number") onChange(isNumber ? value : 1);
          else onChange(v);
        }}
      >
        <option value="__number">123 (number)</option>
        {groups.map((group) => (
          <optgroup key={group} label={group}>
            {options.filter((v) => v.group === group).map((v) => (
              <option key={v.key} value={v.key}>
                {v.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </span>
  );
}

function ActionEditor({
  action,
  onChange,
  options,
}: {
  action: CommandButtonAction;
  onChange: (a: CommandButtonAction) => void;
  options: CommandEditorOptions;
}) {
  const entityList = (t: "characters" | "locations" | "factions" | "artifacts" | "creatures") => options[t];
  return (
    <div className="space-y-2">
      <label className="block">
        <span className={labelCls}>When pressed, this button...</span>
        <select
          className={inputCls}
          value={action.kind}
          onChange={(e) => {
            const kind = e.target.value;
            if (kind === "entity") onChange({ kind: "entity", entityType: "characters", entityId: options.characters[0]?.id ?? "" });
            else if (kind === "text") onChange({ kind: "text", text: "" });
            else if (kind === "roll") onChange({ kind: "roll", characterId: options.characters[0]?.id ?? "", label: "Roll", count: 1, die: 20, modifiers: [] });
            else onChange({ kind: "status", targetType: "character", targetId: options.characters[0]?.id ?? "" });
          }}
        >
          <option value="entity">Posts an entity introduction (embed with portrait + summary)</option>
          <option value="text">Posts custom text (and optionally an image)</option>
          <option value="roll">Rolls dice against a character&apos;s sheet (template variables welcome)</option>
          <option value="status">Posts a live status card (HP / AC)</option>
        </select>
      </label>

      {action.kind === "entity" && (
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className={labelCls}>Entity type</span>
            <select
              className={inputCls}
              value={action.entityType}
              onChange={(e) => {
                const entityType = e.target.value as typeof action.entityType;
                onChange({ kind: "entity", entityType, entityId: entityList(entityType)[0]?.id ?? "" });
              }}
            >
              {ENTITY_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelCls}>Which one</span>
            <select className={inputCls} value={action.entityId} onChange={(e) => onChange({ ...action, entityId: e.target.value })}>
              {entityList(action.entityType).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {action.kind === "text" && (
        <>
          <label className="block">
            <span className={labelCls}>Text to post</span>
            <textarea rows={3} className={inputCls} value={action.text} onChange={(e) => onChange({ ...action, text: e.target.value })} placeholder="A storm gathers over Camor..." />
          </label>
          <label className="block">
            <span className={labelCls}>Image URL (optional)</span>
            <input className={inputCls} value={action.imageUrl ?? ""} onChange={(e) => onChange({ ...action, imageUrl: e.target.value || undefined })} placeholder="https://..." />
          </label>
        </>
      )}

      {action.kind === "roll" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={labelCls}>Whose sheet</span>
              <select className={inputCls} value={action.characterId} onChange={(e) => onChange({ ...action, characterId: e.target.value })}>
                {options.characters.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={labelCls}>Roll label</span>
              <input className={inputCls} value={action.label} onChange={(e) => onChange({ ...action, label: e.target.value })} placeholder="Doom Save" />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-parchment/70">
            <PartInput value={action.count} onChange={(v) => onChange({ ...action, count: v })} options={options.variables} title="Number of dice" />
            <span className="text-gold font-medium">d</span>
            <PartInput value={action.die} onChange={(v) => onChange({ ...action, die: v })} options={options.variables} title="Die size" />
            {action.modifiers.map((m, mi) => (
              <span key={mi} className="inline-flex items-center gap-1">
                <span className="text-gold font-medium">+</span>
                <PartInput
                  value={m}
                  onChange={(v) => onChange({ ...action, modifiers: action.modifiers.map((x, xi) => (xi === mi ? v : x)) })}
                  options={options.variables}
                  title="Modifier term"
                  allowNegative
                />
                <button
                  type="button"
                  onClick={() => onChange({ ...action, modifiers: action.modifiers.filter((_, xi) => xi !== mi) })}
                  className="text-blood/70 hover:text-blood"
                  title="Remove this modifier"
                >
                  ×
                </button>
              </span>
            ))}
            <button type="button" onClick={() => onChange({ ...action, modifiers: [...action.modifiers, 0] })} className="text-gold/70 hover:text-gold hover:underline">
              + mod
            </button>
          </div>
        </>
      )}

      {action.kind === "status" && (
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className={labelCls}>Target type</span>
            <select
              className={inputCls}
              value={action.targetType}
              onChange={(e) => {
                const targetType = e.target.value as "character" | "creature";
                const list = targetType === "character" ? options.characters : options.creatures;
                onChange({ kind: "status", targetType, targetId: list[0]?.id ?? "" });
              }}
            >
              <option value="character">Character (live sheet HP/AC)</option>
              <option value="creature">Creature (bestiary HP/AC)</option>
            </select>
          </label>
          <label className="block">
            <span className={labelCls}>Which one</span>
            <select className={inputCls} value={action.targetId} onChange={(e) => onChange({ ...action, targetId: e.target.value })}>
              {(action.targetType === "character" ? options.characters : options.creatures).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}

/** Add-or-edit form for one button: label + style + the action editor, with
 *  the finished action serialized into a hidden input for the server action. */
function ButtonForm({
  commandId,
  button,
  options,
  action,
  onDone,
}: {
  commandId: string;
  button: CommandButton | null;
  options: CommandEditorOptions;
  action: ServerAction;
  onDone?: () => void;
}) {
  const [label, setLabel] = useState(button?.label ?? "");
  const [style, setStyle] = useState<CommandButtonStyle>(button?.style ?? "secondary");
  const [act, setAct] = useState<CommandButtonAction>(button?.action ?? defaultAction());
  return (
    <form action={action} className="rounded-lg border border-gold/30 bg-void/40 p-3 space-y-2">
      <input type="hidden" name="commandId" value={commandId} />
      {button && <input type="hidden" name="buttonId" value={button.id} />}
      <input type="hidden" name="actionJson" value={JSON.stringify(act)} />
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className={labelCls}>Button label</span>
          <input className={inputCls} name="label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Introduce the Kinah" required />
        </label>
        <label className="block">
          <span className={labelCls}>Color</span>
          <select className={inputCls} name="style" value={style} onChange={(e) => setStyle(e.target.value as CommandButtonStyle)}>
            {STYLES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ActionEditor action={act} onChange={setAct} options={options} />
      <div className="flex items-center gap-3">
        <button type="submit" className="rounded-full bg-gold/90 text-ink px-4 py-1.5 text-xs font-medium hover:bg-gold">
          {button ? "Save Button" : "Add Button"}
        </button>
        {onDone && (
          <button type="button" onClick={onDone} className="text-xs text-parchment/50 hover:text-gold">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function describeAction(a: CommandButtonAction | null, options: CommandEditorOptions): string {
  if (!a) return "does nothing (broken action - edit me)";
  if (a.kind === "text") return `posts: “${a.text.slice(0, 60)}${a.text.length > 60 ? "…" : ""}”`;
  if (a.kind === "entity") {
    const name = options[a.entityType].find((o) => o.id === a.entityId)?.name ?? "a deleted entry";
    return `introduces ${name}`;
  }
  if (a.kind === "roll") {
    const name = options.characters.find((o) => o.id === a.characterId)?.name ?? "a deleted character";
    const part = (p: number | string) => (typeof p === "number" ? String(p) : `[${p}]`);
    const mods = a.modifiers.map((m) => `+${part(m)}`).join("");
    return `rolls ${a.label}: ${part(a.count)}d${part(a.die)}${mods} for ${name}`;
  }
  const list = a.targetType === "character" ? options.characters : options.creatures;
  return `posts status of ${list.find((o) => o.id === a.targetId)?.name ?? "a deleted entry"}`;
}

export function DiscordCommandsPanel({
  commands,
  options,
  actions,
}: {
  commands: CustomCommandDetail[];
  options: CommandEditorOptions;
  actions: CommandPanelActions;
}) {
  const [editingButton, setEditingButton] = useState<string | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <form action={actions.createCommand} className="rounded-lg border border-gold/20 bg-void/40 p-3 grid sm:grid-cols-[10rem_1fr_auto] gap-2 items-end">
        <label className="block">
          <span className={labelCls}>/command-name</span>
          <input className={inputCls} name="name" placeholder="e.g. lore" required />
        </label>
        <label className="block">
          <span className={labelCls}>Description (shown in Discord&apos;s command list)</span>
          <input className={inputCls} name="description" placeholder="The DM's lore panel" />
        </label>
        <button type="submit" className="rounded-full bg-gold/90 text-ink px-4 py-2 text-xs font-medium hover:bg-gold">
          + New Command
        </button>
      </form>

      {commands.length === 0 && (
        <p className="text-xs text-parchment/40">
          No custom commands yet. Each one becomes a real slash command in your linked server, opening a DM-only panel of buttons.
        </p>
      )}

      {commands.map((cmd) => (
        <div key={cmd.id} className={`rounded-lg border p-3 space-y-3 ${cmd.enabled ? "border-gold/25" : "border-gold/10 opacity-70"}`}>
          <div className="flex items-center gap-3 flex-wrap">
            <button type="button" onClick={() => toggle(cmd.id)} className="font-display text-gold hover:text-glow">
              /{cmd.name} {expanded.has(cmd.id) ? "▾" : "▸"}
            </button>
            <span className="text-xs text-parchment/45 flex-1">{cmd.description || "no description"}</span>
            <span className="text-[10px] uppercase tracking-widest text-parchment/40">
              {cmd.buttons.length} button{cmd.buttons.length === 1 ? "" : "s"} · {cmd.enabled ? "enabled" : "disabled"}
            </span>
          </div>

          {expanded.has(cmd.id) && (
            <>
              <form action={actions.saveCommand} className="grid sm:grid-cols-[10rem_1fr_auto_auto_auto] gap-2 items-end">
                <input type="hidden" name="commandId" value={cmd.id} />
                <label className="block">
                  <span className={labelCls}>Name</span>
                  <input className={inputCls} name="name" defaultValue={cmd.name} required />
                </label>
                <label className="block">
                  <span className={labelCls}>Description</span>
                  <input className={inputCls} name="description" defaultValue={cmd.description} />
                </label>
                <label className="flex items-center gap-2 text-xs text-parchment/70 pb-2">
                  <input type="checkbox" className="accent-gold" name="enabled" defaultChecked={cmd.enabled} />
                  Enabled
                </label>
                <button type="submit" className={smallBtn}>
                  Save
                </button>
                <button type="submit" formAction={actions.deleteCommand} className="text-xs text-blood hover:underline" title="Delete this command">
                  Delete
                </button>
              </form>

              <div className="space-y-2">
                {cmd.buttons.map((btn) =>
                  editingButton === btn.id ? (
                    <ButtonForm
                      key={btn.id}
                      commandId={cmd.id}
                      button={btn}
                      options={options}
                      action={actions.saveButton}
                      onDone={() => setEditingButton(null)}
                    />
                  ) : (
                    <div key={btn.id} className="flex items-center gap-2 rounded-lg border border-gold/15 bg-void/40 px-3 py-2 text-sm">
                      <span
                        className={`shrink-0 rounded px-2 py-0.5 text-[10px] uppercase tracking-wider border ${
                          btn.style === "primary"
                            ? "border-sky-400/50 text-sky-300"
                            : btn.style === "success"
                              ? "border-green-500/50 text-green-400"
                              : btn.style === "danger"
                                ? "border-blood/60 text-blood"
                                : "border-parchment/30 text-parchment/60"
                        }`}
                      >
                        {btn.label}
                      </span>
                      <span className="flex-1 text-xs text-parchment/55 truncate">{describeAction(btn.action, options)}</span>
                      <form action={actions.moveButton} className="inline-flex gap-1">
                        <input type="hidden" name="commandId" value={cmd.id} />
                        <input type="hidden" name="buttonId" value={btn.id} />
                        <button type="submit" name="direction" value="up" className="text-parchment/40 hover:text-gold text-xs" title="Move up">
                          ↑
                        </button>
                        <button type="submit" name="direction" value="down" className="text-parchment/40 hover:text-gold text-xs" title="Move down">
                          ↓
                        </button>
                      </form>
                      <button type="button" onClick={() => setEditingButton(btn.id)} className="text-xs text-gold/80 hover:text-gold hover:underline">
                        Edit
                      </button>
                      <form action={actions.deleteButton}>
                        <input type="hidden" name="commandId" value={cmd.id} />
                        <input type="hidden" name="buttonId" value={btn.id} />
                        <button type="submit" className="text-xs text-blood hover:underline">
                          Remove
                        </button>
                      </form>
                    </div>
                  )
                )}

                {addingTo === cmd.id ? (
                  <ButtonForm commandId={cmd.id} button={null} options={options} action={actions.addButton} onDone={() => setAddingTo(null)} />
                ) : (
                  <button type="button" onClick={() => setAddingTo(cmd.id)} className={smallBtn}>
                    + Add Button
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
