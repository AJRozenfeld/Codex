"use client";

import { useMemo, useState } from "react";
import type { JournalEntry } from "@/lib/types";

type Tab = "events" | "contacts";

interface CharacterOption {
  id: string;
  name: string;
  slug: string;
  portraitPath: string | null;
}

function TrustDial({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5, 6].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!onChange}
          onClick={() => onChange?.(n)}
          className={`h-5 w-5 rounded-full border text-[10px] flex items-center justify-center transition-colors ${
            n <= value ? "bg-gold border-gold text-ink" : "border-gold/30 text-parchment/30"
          } ${onChange ? "cursor-pointer hover:border-gold" : ""}`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

export function JournalBoard({
  ownerName,
  initialEvents,
  initialContacts,
  otherCharacters,
  createEntryAction,
  updateEntryAction,
  deleteEntryAction,
}: {
  ownerName: string;
  initialEvents: JournalEntry[];
  initialContacts: JournalEntry[];
  otherCharacters: CharacterOption[];
  createEntryAction: (
    category: "event" | "contact",
    subjectCharacterId: string | null,
    title: string,
    body: string,
    trustValue: number | null,
    entryDate: string
  ) => Promise<string>;
  updateEntryAction: (
    entryId: string,
    category: "event" | "contact",
    title: string,
    body: string,
    trustValue: number | null,
    entryDate: string
  ) => Promise<void>;
  deleteEntryAction: (entryId: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<Tab>("events");
  const [events, setEvents] = useState<JournalEntry[]>(initialEvents);
  const [contacts, setContacts] = useState<JournalEntry[]>(initialContacts);
  const [showNewEvent, setShowNewEvent] = useState(false);
  const [newEventTitle, setNewEventTitle] = useState("");
  const [newEventDate, setNewEventDate] = useState("");
  const [newEventBody, setNewEventBody] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editTrust, setEditTrust] = useState(3);

  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);
  const [showAddContact, setShowAddContact] = useState(false);
  const [newContactSubjectId, setNewContactSubjectId] = useState("");
  const [newContactBody, setNewContactBody] = useState("");
  const [newContactDate, setNewContactDate] = useState("");
  const [newContactTrust, setNewContactTrust] = useState(3);

  const subjectGroups = useMemo(() => {
    const map = new Map<string, JournalEntry[]>();
    for (const entry of contacts) {
      if (!entry.subjectCharacterId) continue;
      const list = map.get(entry.subjectCharacterId) ?? [];
      list.push(entry);
      map.set(entry.subjectCharacterId, list);
    }
    return map;
  }, [contacts]);

  const subjectList = useMemo(
    () =>
      Array.from(subjectGroups.entries()).map(([subjectId, entries]) => ({
        subjectId,
        name: entries[0].subjectName ?? "?",
        portraitPath: entries[0].subjectPortraitPath ?? null,
        latestTrust: entries[0].trustValue ?? null,
        count: entries.length,
      })),
    [subjectGroups]
  );

  const availableForNewContact = otherCharacters.filter((c) => !subjectGroups.has(c.id));
  const activeSubjectId = selectedSubjectId ?? subjectList[0]?.subjectId ?? null;
  const activeEntries = activeSubjectId ? subjectGroups.get(activeSubjectId) ?? [] : [];
  const activeSubjectMeta = subjectList.find((s) => s.subjectId === activeSubjectId);

  async function submitNewEvent() {
    if (!newEventBody.trim()) return;
    const id = await createEntryAction("event", null, newEventTitle, newEventBody, null, newEventDate);
    setEvents((prev) => [
      {
        id,
        ownerCharacterId: "",
        category: "event",
        subjectCharacterId: null,
        title: newEventTitle || null,
        body: newEventBody,
        trustValue: null,
        entryDate: newEventDate || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      ...prev,
    ]);
    setNewEventTitle("");
    setNewEventDate("");
    setNewEventBody("");
    setShowNewEvent(false);
  }

  async function submitNewContact() {
    if (!newContactSubjectId || !newContactBody.trim()) return;
    const subject = otherCharacters.find((c) => c.id === newContactSubjectId);
    const id = await createEntryAction("contact", newContactSubjectId, "", newContactBody, newContactTrust, newContactDate);
    setContacts((prev) => [
      {
        id,
        ownerCharacterId: "",
        category: "contact",
        subjectCharacterId: newContactSubjectId,
        subjectName: subject?.name ?? "?",
        subjectSlug: subject?.slug ?? null,
        subjectPortraitPath: subject?.portraitPath ?? null,
        title: null,
        body: newContactBody,
        trustValue: newContactTrust,
        entryDate: newContactDate || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      ...prev,
    ]);
    setSelectedSubjectId(newContactSubjectId);
    setNewContactSubjectId("");
    setNewContactBody("");
    setNewContactDate("");
    setNewContactTrust(3);
    setShowAddContact(false);
  }

  async function submitAddEntryForSubject() {
    if (!activeSubjectId || !newContactBody.trim()) return;
    const meta = activeSubjectMeta;
    const id = await createEntryAction("contact", activeSubjectId, "", newContactBody, newContactTrust, newContactDate);
    setContacts((prev) => [
      {
        id,
        ownerCharacterId: "",
        category: "contact",
        subjectCharacterId: activeSubjectId,
        subjectName: meta?.name ?? "?",
        subjectPortraitPath: meta?.portraitPath ?? null,
        title: null,
        body: newContactBody,
        trustValue: newContactTrust,
        entryDate: newContactDate || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      ...prev,
    ]);
    setNewContactBody("");
    setNewContactDate("");
    setNewContactTrust(3);
  }

  function startEdit(entry: JournalEntry) {
    setEditingId(entry.id);
    setEditTitle(entry.title ?? "");
    setEditDate(entry.entryDate ?? "");
    setEditBody(entry.body);
    setEditTrust(entry.trustValue ?? 3);
  }

  async function saveEdit(category: "event" | "contact") {
    if (!editingId) return;
    await updateEntryAction(editingId, category, editTitle, editBody, category === "contact" ? editTrust : null, editDate);
    if (category === "event") {
      setEvents((prev) =>
        prev.map((e) => (e.id === editingId ? { ...e, title: editTitle || null, body: editBody, entryDate: editDate || null } : e))
      );
    } else {
      setContacts((prev) =>
        prev.map((e) =>
          e.id === editingId ? { ...e, title: editTitle || null, body: editBody, entryDate: editDate || null, trustValue: editTrust } : e
        )
      );
    }
    setEditingId(null);
  }

  async function removeEntry(id: string, category: "event" | "contact") {
    await deleteEntryAction(id);
    if (category === "event") {
      setEvents((prev) => prev.filter((e) => e.id !== id));
    } else {
      setContacts((prev) => prev.filter((e) => e.id !== id));
    }
    if (editingId === id) setEditingId(null);
  }

  return (
    <div>
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setTab("events")}
          className={`rounded-full px-4 py-1.5 text-sm ${tab === "events" ? "bg-gold/90 text-ink" : "border border-gold/30 text-gold hover:bg-gold/10"}`}
        >
          Events
        </button>
        <button
          onClick={() => setTab("contacts")}
          className={`rounded-full px-4 py-1.5 text-sm ${tab === "contacts" ? "bg-gold/90 text-ink" : "border border-gold/30 text-gold hover:bg-gold/10"}`}
        >
          Contacts
        </button>
      </div>

      {tab === "events" && (
        <div className="space-y-4">
          {!showNewEvent ? (
            <button
              onClick={() => setShowNewEvent(true)}
              className="rounded-full border border-gold/40 text-gold px-4 py-1.5 text-xs font-medium hover:bg-gold/10"
            >
              + New Event
            </button>
          ) : (
            <div className="rounded-lg border border-gold/20 bg-void/50 p-4 space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <input
                  className="rounded-lg bg-void border border-gold/30 px-3 py-2 text-sm text-parchment"
                  placeholder="Title (optional)"
                  value={newEventTitle}
                  onChange={(e) => setNewEventTitle(e.target.value)}
                />
                <input
                  className="rounded-lg bg-void border border-gold/30 px-3 py-2 text-sm text-parchment"
                  placeholder="Date / session (optional)"
                  value={newEventDate}
                  onChange={(e) => setNewEventDate(e.target.value)}
                />
              </div>
              <textarea
                rows={4}
                className="w-full rounded-lg bg-void border border-gold/30 px-3 py-2 text-sm text-parchment"
                placeholder="What happened..."
                value={newEventBody}
                onChange={(e) => setNewEventBody(e.target.value)}
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowNewEvent(false)} className="text-xs text-parchment/50 hover:text-parchment">
                  Cancel
                </button>
                <button onClick={submitNewEvent} className="rounded-full bg-gold/90 text-ink px-4 py-1.5 text-xs font-medium hover:bg-gold">
                  Save Entry
                </button>
              </div>
            </div>
          )}

          {events.length === 0 && <p className="text-sm text-parchment/40">No events logged yet.</p>}
          {events.map((entry) => (
            <div key={entry.id} className="rounded-lg border border-gold/15 bg-void/40 p-4">
              {editingId === entry.id ? (
                <div className="space-y-3">
                  <div className="grid sm:grid-cols-2 gap-3">
                    <input
                      className="rounded-lg bg-void border border-gold/30 px-3 py-2 text-sm text-parchment"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                    />
                    <input
                      className="rounded-lg bg-void border border-gold/30 px-3 py-2 text-sm text-parchment"
                      value={editDate}
                      onChange={(e) => setEditDate(e.target.value)}
                    />
                  </div>
                  <textarea
                    rows={4}
                    className="w-full rounded-lg bg-void border border-gold/30 px-3 py-2 text-sm text-parchment"
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                  />
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setEditingId(null)} className="text-xs text-parchment/50 hover:text-parchment">
                      Cancel
                    </button>
                    <button onClick={() => saveEdit("event")} className="rounded-full bg-gold/90 text-ink px-4 py-1.5 text-xs font-medium hover:bg-gold">
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs uppercase tracking-widest text-ember/70">
                      {entry.entryDate || formatDate(entry.createdAt)}
                    </div>
                    <div className="flex gap-3 text-xs">
                      <button onClick={() => startEdit(entry)} className="text-gold hover:underline">
                        Edit
                      </button>
                      <button onClick={() => removeEntry(entry.id, "event")} className="text-blood hover:underline">
                        Delete
                      </button>
                    </div>
                  </div>
                  {entry.title && <h3 className="font-display text-parchment mb-1">{entry.title}</h3>}
                  <p className="text-sm text-parchment/80 whitespace-pre-line">{entry.body}</p>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "contacts" && (
        <div className="grid sm:grid-cols-[220px_1fr] gap-6">
          <div>
            <div className="space-y-1 mb-3">
              {subjectList.map((s) => (
                <button
                  key={s.subjectId}
                  onClick={() => setSelectedSubjectId(s.subjectId)}
                  className={`w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                    activeSubjectId === s.subjectId ? "bg-gold/20 text-gold" : "text-parchment/70 hover:bg-void/60"
                  }`}
                >
                  {s.portraitPath ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.portraitPath} alt={s.name} className="h-7 w-7 rounded-full object-cover border border-gold/20" />
                  ) : (
                    <div className="h-7 w-7 rounded-full bg-void border border-gold/10" />
                  )}
                  <span className="flex-1 truncate">{s.name}</span>
                  <span className="text-[10px] text-parchment/40">{s.count}</span>
                </button>
              ))}
              {subjectList.length === 0 && <p className="text-xs text-parchment/40 px-1">No contacts yet.</p>}
            </div>
            {!showAddContact ? (
              <button
                onClick={() => setShowAddContact(true)}
                className="w-full rounded-full border border-gold/40 text-gold px-3 py-1.5 text-xs font-medium hover:bg-gold/10"
              >
                + Add Contact
              </button>
            ) : (
              <div className="rounded-lg border border-gold/20 bg-void/50 p-3 space-y-2">
                <select
                  className="w-full rounded bg-void border border-gold/30 px-2 py-1.5 text-xs text-parchment"
                  value={newContactSubjectId}
                  onChange={(e) => setNewContactSubjectId(e.target.value)}
                >
                  <option value="">Choose a character...</option>
                  {availableForNewContact.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <div className="text-xs text-parchment/50">Trust</div>
                <TrustDial value={newContactTrust} onChange={setNewContactTrust} />
                <textarea
                  rows={3}
                  className="w-full rounded bg-void border border-gold/30 px-2 py-1.5 text-xs text-parchment"
                  placeholder="First impressions..."
                  value={newContactBody}
                  onChange={(e) => setNewContactBody(e.target.value)}
                />
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowAddContact(false)} className="text-xs text-parchment/50 hover:text-parchment">
                    Cancel
                  </button>
                  <button onClick={submitNewContact} className="rounded-full bg-gold/90 text-ink px-3 py-1 text-xs font-medium hover:bg-gold">
                    Save
                  </button>
                </div>
              </div>
            )}
          </div>

          <div>
            {!activeSubjectId ? (
              <p className="text-sm text-parchment/40">Add a contact to begin writing.</p>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-3 mb-2">
                  {activeSubjectMeta?.portraitPath ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={activeSubjectMeta.portraitPath}
                      alt={activeSubjectMeta.name}
                      className="h-10 w-10 rounded-full object-cover border border-gold/20"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded-full bg-void border border-gold/10" />
                  )}
                  <h3 className="font-display text-lg text-gold">{activeSubjectMeta?.name}</h3>
                </div>

                <div className="rounded-lg border border-gold/20 bg-void/50 p-4 space-y-2">
                  <div className="text-xs text-parchment/50">Add entry &middot; Trust</div>
                  <TrustDial value={newContactTrust} onChange={setNewContactTrust} />
                  <input
                    className="w-full rounded-lg bg-void border border-gold/30 px-3 py-2 text-sm text-parchment"
                    placeholder="Date / session (optional)"
                    value={newContactDate}
                    onChange={(e) => setNewContactDate(e.target.value)}
                  />
                  <textarea
                    rows={3}
                    className="w-full rounded-lg bg-void border border-gold/30 px-3 py-2 text-sm text-parchment"
                    placeholder="What did they conclude, what happened..."
                    value={newContactBody}
                    onChange={(e) => setNewContactBody(e.target.value)}
                  />
                  <div className="flex justify-end">
                    <button
                      onClick={submitAddEntryForSubject}
                      className="rounded-full bg-gold/90 text-ink px-4 py-1.5 text-xs font-medium hover:bg-gold"
                    >
                      Save Entry
                    </button>
                  </div>
                </div>

                {activeEntries.map((entry) => (
                  <div key={entry.id} className="rounded-lg border border-gold/15 bg-void/40 p-4">
                    {editingId === entry.id ? (
                      <div className="space-y-3">
                        <TrustDial value={editTrust} onChange={setEditTrust} />
                        <input
                          className="rounded-lg bg-void border border-gold/30 px-3 py-2 text-sm text-parchment w-full"
                          value={editDate}
                          onChange={(e) => setEditDate(e.target.value)}
                        />
                        <textarea
                          rows={3}
                          className="w-full rounded-lg bg-void border border-gold/30 px-3 py-2 text-sm text-parchment"
                          value={editBody}
                          onChange={(e) => setEditBody(e.target.value)}
                        />
                        <div className="flex justify-end gap-2">
                          <button onClick={() => setEditingId(null)} className="text-xs text-parchment/50 hover:text-parchment">
                            Cancel
                          </button>
                          <button onClick={() => saveEdit("contact")} className="rounded-full bg-gold/90 text-ink px-4 py-1.5 text-xs font-medium hover:bg-gold">
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-3">
                            <span className="text-xs uppercase tracking-widest text-ember/70">
                              {entry.entryDate || formatDate(entry.createdAt)}
                            </span>
                            {entry.trustValue != null && <TrustDial value={entry.trustValue} />}
                          </div>
                          <div className="flex gap-3 text-xs">
                            <button onClick={() => startEdit(entry)} className="text-gold hover:underline">
                              Edit
                            </button>
                            <button onClick={() => removeEntry(entry.id, "contact")} className="text-blood hover:underline">
                              Delete
                            </button>
                          </div>
                        </div>
                        <p className="text-sm text-parchment/80 whitespace-pre-line">{entry.body}</p>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
