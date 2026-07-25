import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { assetUrl, fetchSheet, patchSheet, requestRoll, ApiError, type SheetResult } from "../lib/api";
import { ABILITY_KEYS, ABILITY_LABELS, SKILL_ABILITY, SKILL_LABELS, abilityModifier, formatModifier } from "../lib/sheet";
import type { AbilityKey, ActionRoll, CharacterSheetData, LiveSheetPatch, SkillKey } from "../lib/types";
import { useDice } from "./DiceOverlay";
import { EmptyState, SectionHeading } from "./ui";

// ---------------------------------------------------------------------------
// The play sheet: read off the server (which merges to the full current
// shape), rolled through the Discord bridge, live-patched for the numbers
// that move mid-combat. Editing stays on the website - during a session you
// read, roll and bleed; you don't fill in forms.
// ---------------------------------------------------------------------------

function d20(size = 14) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="inline-block">
      <polygon points="50,4 89,27 89,73 50,96 11,73 11,27" fill="none" stroke="currentColor" strokeWidth="9" />
      <polygon points="50,20 76,66 24,66" fill="none" stroke="currentColor" strokeWidth="6" />
    </svg>
  );
}

function RollButton({ label, target, small }: { label: string; target: string; small?: boolean }) {
  const { castDie } = useDice();
  return (
    <button
      onClick={() => castDie(label, () => requestRoll(target))}
      title={`Roll ${label} on Discord`}
      className={`no-drag inline-flex items-center gap-1 rounded border border-gold/40 text-gold hover:bg-gold/15 hover:shadow-glow transition-all ${
        small ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-xs"
      }`}
    >
      {d20(small ? 10 : 13)}
    </button>
  );
}

function describeRolls(rolls: ActionRoll[]): string {
  return rolls
    .map((r) => {
      const mods = r.modifiers.map((m) => (typeof m === "number" ? formatModifier(m) : `+[${m}]`)).join("");
      return `${r.label}: ${r.count}d${r.die}${mods}`;
    })
    .join(" · ");
}

export default function SheetView() {
  const { toast } = useDice();
  const [data, setData] = useState<SheetResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState(1);

  const load = useCallback(async () => {
    try {
      setData(await fetchSheet());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load your sheet.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sheet = data?.sheet ?? null;

  const applyPatch = useCallback(
    async (patch: LiveSheetPatch) => {
      if (!data) return;
      try {
        const { live } = await patchSheet(patch);
        setData((d) => (d ? { ...d, sheet: { ...d.sheet, ...live } } : d));
      } catch (e) {
        toast(e instanceof ApiError ? e.message : "The Codex did not record that.", "blood");
        void load();
      }
    },
    [data, toast, load]
  );

  const skillMod = useMemo(() => {
    if (!sheet) return () => 0;
    return (key: SkillKey) => {
      const base = abilityModifier(sheet.abilityScores[SKILL_ABILITY[key]]);
      const p = sheet.skills[key];
      return base + (p?.expertise ? sheet.proficiencyBonus * 2 : p?.proficient ? sheet.proficiencyBonus : 0);
    };
  }, [sheet]);

  if (error) return <EmptyState message={error} />;
  if (!data || !sheet) return <div className="text-parchment/40 text-sm py-10 text-center">Unrolling the parchment…</div>;

  const portrait = assetUrl(data.portraitPath);
  const hpPct = sheet.hitPointMax > 0 ? Math.max(0, Math.min(1, sheet.hitPointCurrent / sheet.hitPointMax)) : 0;
  const dying = sheet.hitPointCurrent <= 0;
  const initiative = abilityModifier(sheet.abilityScores.dex) + sheet.initiativeMisc;
  const slotLevels = Object.entries(sheet.spellSlots).filter(([, s]) => s.total > 0);

  return (
    <div className="max-w-3xl">
      {/* header */}
      <div className="flex gap-6 items-center mb-6">
        {portrait ? (
          <img src={portrait} alt="" className="w-24 h-24 rounded-full object-cover border-2 border-gold/50 shadow-glow flex-none" draggable={false} />
        ) : (
          <div className="w-24 h-24 rounded-full border-2 border-gold/30 grid place-items-center text-gold/40 font-display text-3xl flex-none">
            {data.characterName.slice(0, 1)}
          </div>
        )}
        <div className="min-w-0">
          <SectionHeading eyebrow={[sheet.race, sheet.classLevel].filter(Boolean).join(" · ")} title={data.characterName} />
        </div>
      </div>

      {/* vitals row */}
      <div className="grid grid-cols-4 gap-3 mb-6 text-center">
        {[
          { label: "Armor", value: String(sheet.armorClass) },
          { label: "Speed", value: `${sheet.speed} ft` },
          { label: "Prof", value: formatModifier(sheet.proficiencyBonus) },
        ].map((v) => (
          <div key={v.label} className="card-surface rounded border border-gold/15 py-3">
            <div className="font-display text-xl text-gold">{v.value}</div>
            <div className="text-[10px] uppercase tracking-wider2 text-ember/80 mt-1">{v.label}</div>
          </div>
        ))}
        <div className="card-surface rounded border border-gold/15 py-3 relative">
          <div className="font-display text-xl text-gold">{formatModifier(initiative)}</div>
          <div className="text-[10px] uppercase tracking-wider2 text-ember/80 mt-1 mb-1">Initiative</div>
          <RollButton label="Initiative" target="initiative" small />
        </div>
      </div>

      {/* HP */}
      <div className={`card-surface rounded-lg border p-4 mb-6 ${dying ? "border-blood/70" : "border-gold/20"}`}>
        <div className="flex items-end justify-between mb-2">
          <div>
            <span className={`font-display text-4xl ${dying ? "text-blood" : "text-parchment"}`}>{sheet.hitPointCurrent}</span>
            <span className="text-parchment/40 text-lg"> / {sheet.hitPointMax}</span>
            {sheet.hitPointTemp > 0 && <span className="ml-2 text-sm text-gold/80">+{sheet.hitPointTemp} temp</span>}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
              className="w-16 rounded bg-ink-raised/80 border border-gold/20 px-2 py-1 text-sm text-parchment text-center outline-none focus:border-gold/60"
            />
            <button
              onClick={() => void applyPatch({ kind: "hp", current: sheet.hitPointCurrent - Math.max(0, amount - sheet.hitPointTemp), temp: Math.max(0, sheet.hitPointTemp - amount) })}
              className="rounded border border-blood/50 px-3 py-1 text-sm text-blood hover:bg-blood/15"
            >
              Damage
            </button>
            <button
              onClick={() => void applyPatch({ kind: "hp", current: sheet.hitPointCurrent + amount })}
              className="rounded border border-gold/40 px-3 py-1 text-sm text-gold hover:bg-gold/15"
            >
              Heal
            </button>
            <button
              onClick={() => void applyPatch({ kind: "longRest" })}
              title="Long rest: full HP, slots restored, death saves cleared"
              className="rounded border border-gold/25 px-3 py-1 text-sm text-parchment/70 hover:text-gold hover:border-gold/50"
            >
              🌙 Rest
            </button>
          </div>
        </div>
        <div className="h-2.5 rounded-full bg-ink overflow-hidden border border-gold/10">
          <motion.div
            animate={{ width: `${hpPct * 100}%` }}
            transition={{ type: "spring", stiffness: 120, damping: 20 }}
            className={`h-full ${dying ? "bg-blood" : hpPct < 0.35 ? "bg-ember" : "bg-gold"}`}
          />
        </div>
        {dying && (
          <div className="mt-3 flex items-center gap-6 text-xs">
            {(["successes", "failures"] as const).map((kind) => (
              <div key={kind} className="flex items-center gap-2">
                <span className={kind === "successes" ? "text-gold/80" : "text-blood"}>
                  {kind === "successes" ? "Saves" : "Fails"}
                </span>
                {[1, 2, 3].map((n) => {
                  const count = kind === "successes" ? sheet.deathSaveSuccesses : sheet.deathSaveFailures;
                  return (
                    <button
                      key={n}
                      onClick={() => void applyPatch({ kind: "deathSaves", [kind]: count >= n ? n - 1 : n } as LiveSheetPatch)}
                      className={`w-4 h-4 rotate-45 border ${
                        count >= n
                          ? kind === "successes"
                            ? "bg-gold border-gold"
                            : "bg-blood border-blood"
                          : "border-parchment/30 hover:border-parchment/60"
                      }`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* abilities */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-6">
        {ABILITY_KEYS.map((k: AbilityKey) => {
          const score = sheet.abilityScores[k];
          const mod = abilityModifier(score);
          const saveMod = mod + (sheet.savingThrows[k] ? sheet.proficiencyBonus : 0);
          return (
            <div key={k} className="card-surface rounded-lg border border-gold/15 p-3 text-center">
              <div className="text-[10px] uppercase tracking-wider2 text-ember/80">{ABILITY_LABELS[k].slice(0, 3)}</div>
              <div className="font-display text-2xl text-gold mt-1">{formatModifier(mod)}</div>
              <div className="text-xs text-parchment/40">{score}</div>
              <div className="mt-2 flex justify-center gap-1">
                <RollButton label={ABILITY_LABELS[k]} target={k} small />
              </div>
              <div className="mt-1 text-[10px] text-parchment/50 flex items-center justify-center gap-1">
                save {formatModifier(saveMod)} <RollButton label={`${ABILITY_LABELS[k]} save`} target={`save:${k}`} small />
              </div>
            </div>
          );
        })}
      </div>

      {/* skills */}
      <div className="card-surface rounded-lg border border-gold/15 p-4 mb-6">
        <h2 className="font-display text-lg text-gold mb-3">Skills</h2>
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
          {(Object.keys(SKILL_LABELS) as SkillKey[]).map((k) => (
            <div key={k} className="flex items-center justify-between text-sm">
              <span className="text-parchment/75">
                {SKILL_LABELS[k]}
                <span className="text-parchment/35 text-xs ml-1.5">({SKILL_ABILITY[k]})</span>
                {sheet.skills[k]?.expertise ? <span className="text-gold ml-1">◆◆</span> : sheet.skills[k]?.proficient ? <span className="text-gold ml-1">◆</span> : null}
              </span>
              <span className="flex items-center gap-2">
                <span className="text-parchment tabular-nums">{formatModifier(skillMod(k))}</span>
                <RollButton label={SKILL_LABELS[k]} target={k} small />
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* spell slots */}
      {slotLevels.length > 0 && (
        <div className="card-surface rounded-lg border border-gold/15 p-4 mb-6">
          <h2 className="font-display text-lg text-gold mb-3">Spell Slots</h2>
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            {slotLevels.map(([level, slot]) => (
              <div key={level} className="flex items-center gap-2 text-sm">
                <span className="text-ember/80 uppercase text-[10px] tracking-wider2">Lv {level}</span>
                {Array.from({ length: slot.total }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    onClick={() => void applyPatch({ kind: "slot", level, used: slot.used >= n ? n - 1 : n })}
                    title={slot.used >= n ? "Recover this slot" : "Expend this slot"}
                    className={`w-3.5 h-3.5 rounded-full border transition-colors ${
                      slot.used >= n ? "bg-parchment/15 border-parchment/25" : "bg-gold border-gold shadow-glow"
                    }`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* actions: weapons / spells / custom */}
      {(
        [
          { title: "Arsenal", tone: "ember", entries: sheet.attacks, prefix: "attack" },
          { title: "Spellbook", tone: "gold", entries: sheet.spells, prefix: "spell" },
          { title: "Feats & Powers", tone: "parchment", entries: sheet.customActions, prefix: "custom" },
        ] as const
      ).map(
        (group) =>
          group.entries.length > 0 && (
            <div key={group.title} className="card-surface rounded-lg border border-gold/15 p-4 mb-6">
              <h2 className="font-display text-lg text-gold mb-3">{group.title}</h2>
              <div className="space-y-2">
                {group.entries.map((entry: { id: string; name: string; description?: string; rolls: ActionRoll[]; level?: number; prepared?: boolean }) => (
                  <div key={entry.id} className="flex items-start justify-between gap-3 border-b border-gold/10 last:border-0 pb-2 last:pb-0">
                    <div className="min-w-0">
                      <div className="text-sm text-parchment">
                        {entry.name}
                        {"level" in entry && entry.level !== undefined && (
                          <span className="text-parchment/40 text-xs ml-2">{entry.level === 0 ? "cantrip" : `lv ${entry.level}`}</span>
                        )}
                        {"prepared" in entry && entry.prepared && <span className="text-gold/70 text-xs ml-2">prepared</span>}
                      </div>
                      {entry.rolls.length > 0 && (
                        <div className="text-[11px] text-parchment/45 mt-0.5">{describeRolls(entry.rolls)}</div>
                      )}
                      {entry.description && <div className="text-xs text-parchment/55 mt-1 line-clamp-2">{entry.description}</div>}
                    </div>
                    {entry.rolls.length > 0 && <RollButton label={entry.name} target={`${group.prefix}:${entry.id}`} />}
                  </div>
                ))}
              </div>
            </div>
          )
      )}

      <p className="text-[11px] text-parchment/30 text-center mb-4">
        Rolls land in your table's Discord. To edit the sheet itself, use the Codex website.
      </p>
    </div>
  );
}
