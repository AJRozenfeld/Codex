"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RollButton } from "./RollButton";
import { formatModifier, describeActionRoll } from "@/lib/character-sheet-shared";
import {
  SHEET_TEMPLATE_5E,
  computeSheetDerived,
  makeSheetResolver,
  type SheetLike,
  type SheetTemplateDef,
} from "@/lib/sheet-engine";
import type { CharacterSheetData } from "@/lib/types";
import type { LiveSheetPatch, LiveSheetState } from "@/lib/character-sheet";

// ---------------------------------------------------------------------------
// The character page (2026-07-21, Aviv's brief: "beautiful, epic... something
// that makes the player smile"). A read-only presentation of the sheet -
// portrait in an ornate frame, carved ability stones, a living HP bar, the
// arsenal and the spellbook as cards - with every roll button and live
// combat control still active. Editing lives behind the Edit toggle
// (CharacterSheetForm, unchanged).
//
// SHEET ENGINE PHASE A (2026-08-06): the page renders whatever
// SheetTemplateDef it is handed - abilities, skills, derived-stat math and
// section visibility all come from the template. The default is the seeded
// 5e template, under which this renders EXACTLY what the hardcoded version
// rendered (parity contract).
// ---------------------------------------------------------------------------

/** 5e coin styling by key; unknown coins of a custom system get the plain
 *  gold-ish look. */
const COIN_CLS: Record<string, string> = {
  pp: "border-slate-300/50 text-slate-200",
  gp: "border-gold/60 text-gold",
  ep: "border-teal-300/40 text-teal-200",
  sp: "border-slate-400/40 text-slate-300",
  cp: "border-ember/50 text-ember",
};
const COIN_CLS_DEFAULT = "border-gold/40 text-gold/80";

function Stagger({ i, children }: { i: number; children: React.ReactNode }) {
  return (
    <div className="animate-fade-in" style={{ animationDelay: `${Math.min(i * 90, 540)}ms`, animationFillMode: "both" }}>
      {children}
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 mb-5">
      <h2 className="font-display text-xl text-gold tracking-wide whitespace-nowrap">{children}</h2>
      <div className="ornate-divider flex-1">
        <span className="glyph" />
      </div>
    </div>
  );
}

export function CharacterSheetView({
  characterName,
  portraitPath,
  data,
  template = SHEET_TEMPLATE_5E,
  editHref,
  rollAction,
  livePatchAction,
  saved = false,
}: {
  characterName: string;
  portraitPath: string | null;
  data: CharacterSheetData;
  /** The system this sheet renders through (Sheet Engine Phase A). */
  template?: SheetTemplateDef;
  /** Where the Edit button leads (the classic form). */
  editHref: string;
  rollAction?: (target: string) => Promise<{ ok: boolean; error?: string }>;
  livePatchAction?: (patch: LiveSheetPatch) => Promise<LiveSheetState>;
  saved?: boolean;
}) {
  // Live combat subset - mirrors the form's fire-and-reconcile pattern.
  const [live, setLive] = useState({
    hitPointCurrent: data.hitPointCurrent,
    hitPointTemp: data.hitPointTemp,
    deathSaveSuccesses: data.deathSaveSuccesses,
    deathSaveFailures: data.deathSaveFailures,
    spellSlots: data.spellSlots,
  });
  const [showSaved, setShowSaved] = useState(saved);
  useEffect(() => {
    if (!showSaved) return;
    const url = new URL(window.location.href);
    if (url.searchParams.has("saved")) {
      url.searchParams.delete("saved");
      window.history.replaceState(null, "", url.toString());
    }
    const t = setTimeout(() => setShowSaved(false), 3500);
    return () => clearTimeout(t);
  }, [showSaved]);

  async function patch(p: LiveSheetPatch) {
    if (!livePatchAction) return;
    try {
      const next = await livePatchAction(p);
      setLive(next);
    } catch {
      // transient - next click retries
    }
  }

  // Every derived number flows through the engine against this template.
  const sheetLike = data as unknown as SheetLike;
  const resolver = makeSheetResolver(template, sheetLike);
  const derived = computeSheetDerived(template, sheetLike);
  const prof = Number(data.proficiencyBonus) || 0;
  const scores = data.abilityScores as unknown as Record<string, number>;
  const saves = data.savingThrows as unknown as Record<string, boolean>;
  const skillEntries = data.skills as unknown as Record<string, { proficient: boolean; expertise: boolean }>;
  const currency = data.currency as unknown as Record<string, number>;
  const initiative = derived.initiative;
  const spellDc = derived.spellSaveDc;
  const spellAtk = derived.spellAttack;
  const hpPct = data.hitPointMax > 0 ? Math.max(0, Math.min(100, (live.hitPointCurrent / data.hitPointMax) * 100)) : 0;
  const dying = template.features.deathSaves && data.hitPointMax > 0 && live.hitPointCurrent === 0;
  const hasSpellcasting =
    template.features.spellcasting && Boolean(data.spellcastingClass || data.spellcastingAbility || data.spells.length > 0);
  const slotLevels = Array.from({ length: template.spellSlotLevels }, (_, i) => String(i + 1)).filter(
    (lvl) => (live.spellSlots[lvl]?.total ?? 0) > 0
  );
  const spellsByLevel = new Map<number, typeof data.spells>();
  for (const sp of data.spells) {
    const arr = spellsByLevel.get(sp.level) ?? [];
    arr.push(sp);
    spellsByLevel.set(sp.level, arr);
  }
  const persona = template.features.personality
    ? [
        { label: "Personality", text: data.personalityTraits },
        { label: "Ideals", text: data.ideals },
        { label: "Bonds", text: data.bonds },
        { label: "Flaws", text: data.flaws },
      ].filter((p) => p.text.trim())
    : [];
  // 5e renders its coins in the historical pp->cp display order; custom
  // templates show theirs in template order.
  const coinOrder = template === SHEET_TEMPLATE_5E ? ["pp", "gp", "ep", "sp", "cp"] : template.coins.map((c) => c.key);
  const coins = coinOrder
    .map((key) => template.coins.find((c) => c.key === key))
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .map((c) => ({ key: c.key, label: c.label, cls: COIN_CLS[c.key] ?? COIN_CLS_DEFAULT }));

  return (
    <div className="space-y-10">
      {/* ---------- Hero ---------- */}
      <Stagger i={0}>
        <section className="relative overflow-hidden rounded-xl border border-gold/25 card-static shadow-card px-6 py-8 sm:px-10">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10"
            style={{ background: "radial-gradient(ellipse 70% 60% at 50% 0%, rgba(218,185,98,0.12), transparent 70%)" }}
          />
          <div className="flex flex-col sm:flex-row items-center gap-7">
            {portraitPath ? (
              <div className="relative shrink-0">
                <div className="absolute -inset-1.5 rounded-full border border-gold/40" aria-hidden />
                <div className="absolute -inset-3 rounded-full border border-gold/15" aria-hidden />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={portraitPath}
                  alt={characterName}
                  className="h-36 w-36 sm:h-44 sm:w-44 rounded-full object-cover border-2 border-gold/60 shadow-glow"
                />
              </div>
            ) : (
              <div className="relative shrink-0 h-36 w-36 sm:h-44 sm:w-44 rounded-full border-2 border-gold/40 bg-void flex items-center justify-center">
                <span className="font-display text-5xl text-gold/50">{characterName.charAt(0) || "?"}</span>
              </div>
            )}
            <div className="text-center sm:text-left flex-1 min-w-0">
              <div className="text-[11px] uppercase tracking-[0.35em] text-ember mb-2">
                {data.playerName ? `Played by ${data.playerName}` : "Adventurer of the realm"}
              </div>
              <h1 className="font-display text-4xl sm:text-5xl text-gold text-glow break-words">{characterName}</h1>
              <p className="mt-2 text-parchment/75 font-body italic">
                {[data.race, data.classLevel, data.background].filter(Boolean).join(" · ") || "A story yet unwritten"}
              </p>
              <div className="mt-3 flex items-center justify-center sm:justify-start gap-4 text-xs text-parchment/55 flex-wrap">
                {template.features.alignment && data.alignment && <span>{data.alignment}</span>}
                {template.features.experiencePoints && data.experiencePoints > 0 && (
                  <span>{data.experiencePoints.toLocaleString()} XP</span>
                )}
                {template.features.inspiration && data.inspiration && (
                  <span className="text-gold" title="Inspiration!">
                    ✦ Inspired
                  </span>
                )}
              </div>
            </div>
            <Link
              href={editHref}
              className="shrink-0 rounded-full border border-gold/40 text-gold px-5 py-2 text-sm hover:bg-gold/10 hover:border-gold/70 transition-colors"
            >
              Edit Sheet
            </Link>
          </div>
        </section>
      </Stagger>

      {/* ---------- Vitals ---------- */}
      <Stagger i={1}>
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="card-static rounded-xl border border-gold/20 shadow-card p-5 text-center">
            <div className="text-[10px] uppercase tracking-[0.25em] text-ember/80 mb-2">Armor Class</div>
            <div className="mx-auto h-16 w-14 relative flex items-center justify-center">
              <svg viewBox="0 0 40 48" className="absolute inset-0 h-full w-full text-gold/50" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M20 2 L38 8 V22 C38 34 30 42 20 46 C10 42 2 34 2 22 V8 Z" />
              </svg>
              <span className="font-display text-3xl text-parchment relative">{data.armorClass}</span>
            </div>
          </div>
          <div className="card-static rounded-xl border border-gold/20 shadow-card p-5 text-center">
            <div className="text-[10px] uppercase tracking-[0.25em] text-ember/80 mb-2">Initiative</div>
            <div className="flex items-center justify-center gap-2">
              <span className="font-display text-3xl text-parchment">{formatModifier(initiative)}</span>
              {rollAction && <RollButton target="initiative" label="Initiative" rollAction={rollAction} />}
            </div>
            <div className="text-[10px] text-parchment/40 mt-2">Speed {data.speed} ft.</div>
          </div>
          <div className="card-static rounded-xl border border-gold/20 shadow-card p-5 text-center">
            <div className="text-[10px] uppercase tracking-[0.25em] text-ember/80 mb-2">Proficiency</div>
            <div className="font-display text-3xl text-parchment">{formatModifier(prof)}</div>
            {derived.passives.map((p) => (
              <div key={p.label} className="text-[10px] text-parchment/40 mt-2">
                {p.label} {p.value}
              </div>
            ))}
          </div>
          <div className="card-static rounded-xl border border-gold/20 shadow-card p-5 text-center">
            <div className="text-[10px] uppercase tracking-[0.25em] text-ember/80 mb-2">Hit Dice</div>
            <div className="font-display text-2xl text-parchment">
              {template.features.hitDice ? data.hitDiceCurrent || data.hitDiceTotal || "—" : "—"}
            </div>
            {template.features.hitDice && data.hitDiceCurrent && data.hitDiceTotal && (
              <div className="text-[10px] text-parchment/40 mt-2">of {data.hitDiceTotal}</div>
            )}
          </div>
        </section>
      </Stagger>

      {/* ---------- The life bar ---------- */}
      <Stagger i={2}>
        <section className={`card-static rounded-xl border shadow-card p-6 ${dying ? "border-blood/60" : "border-gold/20"}`}>
          <div className="flex items-end justify-between flex-wrap gap-3 mb-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.25em] text-ember/80 mb-1">Hit Points</div>
              <div className="font-display text-4xl text-parchment">
                {live.hitPointCurrent}
                <span className="text-parchment/40 text-2xl"> / {data.hitPointMax}</span>
                {live.hitPointTemp > 0 && <span className="text-sky-300 text-xl ml-3">+{live.hitPointTemp} temp</span>}
              </div>
            </div>
            {livePatchAction && (
              <div className="flex items-center gap-2 flex-wrap">
                <QuickAdjust label="Damage" tone="blood" onApply={(n) => patch({ kind: "hp", current: live.hitPointCurrent - n })} />
                <QuickAdjust label="Heal" tone="green" onApply={(n) => patch({ kind: "hp", current: live.hitPointCurrent + n })} />
                <button
                  type="button"
                  onClick={() => patch({ kind: "longRest" })}
                  title="Full HP, all spell slots recovered, death saves cleared"
                  className="rounded-full border border-gold/40 text-gold px-3 py-1.5 text-xs hover:bg-gold/10 transition-colors"
                >
                  🌙 Long Rest
                </button>
              </div>
            )}
          </div>
          <div className="h-3 rounded-full bg-void border border-gold/20 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${dying ? "bg-blood" : "bg-gradient-to-r from-ember to-gold"}`}
              style={{ width: `${hpPct}%` }}
            />
          </div>
          {dying && (
            <div className="mt-4 flex items-center gap-6 flex-wrap text-sm">
              <span className="text-blood font-display tracking-wide">Death&apos;s Door</span>
              <DeathPips
                label="Successes"
                count={live.deathSaveSuccesses}
                tone="gold"
                onSet={livePatchAction ? (v) => patch({ kind: "deathSaves", successes: v }) : undefined}
              />
              <DeathPips
                label="Failures"
                count={live.deathSaveFailures}
                tone="blood"
                onSet={livePatchAction ? (v) => patch({ kind: "deathSaves", failures: v }) : undefined}
              />
            </div>
          )}
        </section>
      </Stagger>

      {/* ---------- Abilities ---------- */}
      <Stagger i={3}>
        <SectionHeading>Abilities</SectionHeading>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {template.abilities.map(({ key, label, short }) => {
            const score = scores[key] ?? 10;
            const mod = resolver.abilityMod(key);
            const saveProf = Boolean(saves[key]);
            const saveBonus = resolver.saveBonus(key);
            return (
              <div key={key} className="card-static rounded-xl border border-gold/20 shadow-card p-4 text-center relative">
                <div className="text-[10px] uppercase tracking-[0.25em] text-ember/80">{short}</div>
                <div className="font-display text-4xl text-parchment mt-1">{formatModifier(mod)}</div>
                <div className="text-xs text-parchment/45 mt-0.5">{score}</div>
                {rollAction && (
                  <div className="mt-2 flex justify-center">
                    <RollButton target={key} label={label} rollAction={rollAction} />
                  </div>
                )}
                <div className="mt-3 pt-2 border-t border-gold/10 flex items-center justify-center gap-1.5 text-[11px] text-parchment/60">
                  <span className={saveProf ? "text-gold" : ""} title={saveProf ? "Proficient in this save" : "Saving throw"}>
                    {saveProf ? "◆" : "◇"} Save {formatModifier(saveBonus)}
                  </span>
                  {rollAction && <RollButton target={`save:${key}`} label={`${label} Save`} rollAction={rollAction} />}
                </div>
              </div>
            );
          })}
        </div>
      </Stagger>

      {/* ---------- Skills ---------- */}
      {template.skills.length > 0 && (
        <Stagger i={4}>
          <SectionHeading>Skills</SectionHeading>
          <div className="card-static rounded-xl border border-gold/20 shadow-card p-5">
            <div className="grid sm:grid-cols-2 gap-x-10 gap-y-1.5">
              {template.skills.map((skill) => {
                const entry = skillEntries[skill.key] ?? { proficient: false, expertise: false };
                const bonus = resolver.skillBonus(skill.key);
                return (
                  <div key={skill.key} className="flex items-center gap-2.5 text-sm py-0.5">
                    <span
                      className={`w-6 text-center text-[10px] ${entry.expertise ? "text-gold" : entry.proficient ? "text-gold/70" : "text-parchment/25"}`}
                      title={entry.expertise ? "Expertise" : entry.proficient ? "Proficient" : "Untrained"}
                    >
                      {entry.expertise ? "◆◆" : entry.proficient ? "◆" : "◇"}
                    </span>
                    <span className="w-9 text-gold">{formatModifier(bonus)}</span>
                    <span className="flex-1 text-parchment/85">{skill.label}</span>
                    <span className="text-[10px] uppercase text-parchment/35">{skill.ability}</span>
                    {rollAction && <RollButton target={skill.key} label={skill.label} rollAction={rollAction} />}
                  </div>
                );
              })}
            </div>
          </div>
        </Stagger>
      )}

      {/* ---------- Arsenal ---------- */}
      {((template.features.attacks && data.attacks.length > 0) ||
        (template.features.customActions && data.customActions.length > 0)) && (
        <Stagger i={5}>
          <SectionHeading>Arsenal &amp; Deeds</SectionHeading>
          <div className="grid sm:grid-cols-2 gap-4">
            {template.features.attacks &&
              data.attacks.map((atk) => (
                <div key={atk.id} className="card-static rounded-xl border border-ember/25 shadow-card p-5">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-display text-lg text-parchment">⚔️ {atk.name || "Unnamed weapon"}</h3>
                    {rollAction && atk.rolls.length > 0 && (
                      <RollButton target={`attack:${atk.id}`} label={atk.name || "this weapon"} rollAction={rollAction} />
                    )}
                  </div>
                  {atk.description && <p className="text-xs text-parchment/55 italic mt-1.5">{atk.description}</p>}
                  {atk.rolls.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      {atk.rolls.map((r) => (
                        <span key={r.id} className="text-[11px] rounded-full border border-ember/30 text-ember px-2.5 py-0.5">
                          {r.label} {describeActionRoll(r)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            {template.features.customActions &&
              data.customActions.map((act) => (
                <div key={act.id} className="card-static rounded-xl border border-green-700/30 shadow-card p-5">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-display text-lg text-parchment">✦ {act.name || "Unnamed action"}</h3>
                    {rollAction && act.rolls.length > 0 && (
                      <RollButton target={`custom:${act.id}`} label={act.name || "this action"} rollAction={rollAction} />
                    )}
                  </div>
                  {act.description && <p className="text-xs text-parchment/55 italic mt-1.5">{act.description}</p>}
                  {act.rolls.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      {act.rolls.map((r) => (
                        <span key={r.id} className="text-[11px] rounded-full border border-green-600/30 text-green-400/90 px-2.5 py-0.5">
                          {r.label} {describeActionRoll(r)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
          </div>
        </Stagger>
      )}

      {/* ---------- Spellbook ---------- */}
      {hasSpellcasting && (
        <Stagger i={6}>
          <SectionHeading>Spellbook</SectionHeading>
          <div className="card-static rounded-xl border border-gold/20 shadow-card p-6 space-y-5">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm text-parchment/70">
              {data.spellcastingClass && (
                <span>
                  <span className="text-ember/80 text-[10px] uppercase tracking-widest mr-2">Class</span>
                  {data.spellcastingClass}
                </span>
              )}
              {data.spellcastingAbility && (
                <>
                  <span>
                    <span className="text-ember/80 text-[10px] uppercase tracking-widest mr-2">Save DC</span>
                    <span className="text-gold font-display text-lg">{spellDc}</span>
                  </span>
                  <span>
                    <span className="text-ember/80 text-[10px] uppercase tracking-widest mr-2">Spell Attack</span>
                    <span className="text-gold font-display text-lg">{formatModifier(spellAtk)}</span>
                  </span>
                </>
              )}
            </div>

            {slotLevels.length > 0 && (
              <div className="flex flex-wrap gap-x-7 gap-y-3">
                {slotLevels.map((lvl) => {
                  const slot = live.spellSlots[lvl];
                  return (
                    <div key={lvl} className="flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-widest text-ember/80">Lv {lvl}</span>
                      <div className="flex gap-1">
                        {Array.from({ length: slot.total }, (_, pi) => {
                          const used = pi < slot.used;
                          return (
                            <button
                              key={pi}
                              type="button"
                              disabled={!livePatchAction}
                              title={livePatchAction ? (used ? "Recover this slot" : "Spend a slot") : undefined}
                              onClick={() => patch({ kind: "slot", level: lvl, used: used ? pi : pi + 1 })}
                              className={`h-3.5 w-3.5 rounded-full border transition-colors ${used ? "bg-void border-gold/30" : "bg-gold border-gold shadow-glow"} ${livePatchAction ? "hover:border-gold" : "cursor-default"}`}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {Array.from(spellsByLevel.keys())
              .sort((a, b) => a - b)
              .map((lvl) => (
                <div key={lvl}>
                  <div className="text-[10px] uppercase tracking-[0.25em] text-ember/80 mb-2">
                    {lvl === 0 ? "Cantrips" : `Level ${lvl}`}
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {(spellsByLevel.get(lvl) ?? []).map((sp) => (
                      <div key={sp.id} className="rounded-lg border border-gold/15 bg-void/50 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <h4 className="font-display text-parchment">
                            ✨ {sp.name || "Unnamed spell"}
                            {sp.prepared && (
                              <span className="ml-2 text-[9px] uppercase tracking-widest text-gold/70 border border-gold/30 rounded-full px-1.5 py-0.5">
                                prepared
                              </span>
                            )}
                          </h4>
                          {rollAction && sp.rolls.length > 0 && (
                            <RollButton target={`spell:${sp.id}`} label={sp.name || "this spell"} rollAction={rollAction} />
                          )}
                        </div>
                        {sp.rolls.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {sp.rolls.map((r) => (
                              <span key={r.id} className="text-[11px] rounded-full border border-gold/25 text-gold/80 px-2.5 py-0.5">
                                {r.label} {describeActionRoll(r)}
                              </span>
                            ))}
                          </div>
                        )}
                        {sp.description && (
                          <details className="mt-2">
                            <summary className="text-[11px] text-parchment/45 cursor-pointer hover:text-gold">description</summary>
                            <p className="text-xs text-parchment/60 italic mt-1.5 whitespace-pre-wrap">{sp.description}</p>
                          </details>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        </Stagger>
      )}

      {/* ---------- Persona & Possessions ---------- */}
      <Stagger i={7}>
        <SectionHeading>The Person Behind the Blade</SectionHeading>
        <div className="grid lg:grid-cols-2 gap-4">
          {persona.length > 0 && (
            <div className="card-static rounded-xl border border-gold/20 shadow-card p-5 space-y-3">
              {persona.map((p) => (
                <div key={p.label}>
                  <div className="text-[10px] uppercase tracking-[0.25em] text-ember/80 mb-1">{p.label}</div>
                  <p className="text-sm text-parchment/75 font-body italic whitespace-pre-wrap">{p.text}</p>
                </div>
              ))}
            </div>
          )}
          <div className="space-y-4">
            {template.features.equipment && (data.equipment.trim() || coins.some((c) => (currency[c.key] ?? 0) > 0)) && (
              <div className="card-static rounded-xl border border-gold/20 shadow-card p-5">
                <div className="text-[10px] uppercase tracking-[0.25em] text-ember/80 mb-2">Possessions</div>
                {data.equipment.trim() && (
                  <p className="text-sm text-parchment/70 whitespace-pre-wrap mb-3">{data.equipment}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  {coins
                    .filter((c) => (currency[c.key] ?? 0) > 0)
                    .map((c) => (
                      <span key={c.key} className={`text-xs rounded-full border px-3 py-1 ${c.cls}`} title={c.label}>
                        {(currency[c.key] ?? 0).toLocaleString()} {c.key}
                      </span>
                    ))}
                </div>
              </div>
            )}
            {template.features.proficienciesLanguages && data.proficienciesLanguages.trim() && (
              <div className="card-static rounded-xl border border-gold/20 shadow-card p-5">
                <div className="text-[10px] uppercase tracking-[0.25em] text-ember/80 mb-2">Proficiencies &amp; Languages</div>
                <p className="text-sm text-parchment/70 whitespace-pre-wrap">{data.proficienciesLanguages}</p>
              </div>
            )}
            {data.featuresTraits.trim() && (
              <div className="card-static rounded-xl border border-gold/20 shadow-card p-5">
                <div className="text-[10px] uppercase tracking-[0.25em] text-ember/80 mb-2">Features &amp; Traits</div>
                <p className="text-sm text-parchment/70 whitespace-pre-wrap">{data.featuresTraits}</p>
              </div>
            )}
          </div>
        </div>
      </Stagger>

      <div className="ornate-divider max-w-xs mx-auto pt-2">
        <span className="glyph" />
      </div>

      {showSaved && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg border border-gold/60 bg-void px-5 py-3 shadow-card text-sm text-gold">
          <span aria-hidden>✓</span> Character sheet saved
        </div>
      )}
    </div>
  );
}

function QuickAdjust({ label, tone, onApply }: { label: string; tone: "blood" | "green"; onApply: (n: number) => void }) {
  const [val, setVal] = useState("");
  const color = tone === "blood" ? "border-blood/50 text-blood" : "border-[#5c7a5e]/60 text-[#4e6b50]";
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number"
        min={0}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder="0"
        className="w-14 rounded bg-void border border-gold/30 px-1.5 py-1 text-parchment text-xs text-center"
      />
      <button
        type="button"
        onClick={() => {
          const n = Number(val) || 0;
          if (n > 0) onApply(n);
          setVal("");
        }}
        className={`rounded-full border px-2.5 py-1 text-xs hover:bg-gold/5 transition-colors ${color}`}
      >
        {label}
      </button>
    </span>
  );
}

function DeathPips({
  label,
  count,
  tone,
  onSet,
}: {
  label: string;
  count: number;
  tone: "gold" | "blood";
  onSet?: (v: number) => void;
}) {
  const on = tone === "gold" ? "bg-gold border-gold" : "bg-blood border-blood";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-parchment/60">
      {label}
      {[1, 2, 3].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!onSet}
          onClick={() => onSet?.(count >= n ? n - 1 : n)}
          className={`h-3.5 w-3.5 rounded-full border transition-colors ${count >= n ? on : "bg-void border-parchment/30"} ${onSet ? "hover:border-parchment" : "cursor-default"}`}
        />
      ))}
    </span>
  );
}
