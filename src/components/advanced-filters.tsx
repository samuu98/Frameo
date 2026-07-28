"use client";

import {
  CalendarRange,
  Check,
  ChevronDown,
  Clock3,
  CopyCheck,
  Heart,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Tag,
  UsersRound,
  X
} from "lucide-react";
import { useState } from "react";
import type { AdvancedFilterState } from "@/types/media";

const toggleValue = (values: string[], value: string) =>
  values.includes(value)
    ? values.filter((entry) => entry !== value)
    : [...values, value];

export function countAdvancedFilters(filters: AdvancedFilterState) {
  return (
    filters.people.length +
    filters.tags.length +
    filters.groups.length +
    Number(Boolean(filters.dateFrom || filters.dateTo)) +
    Number(filters.duration !== "any") +
    Number(filters.resolution !== "any") +
    Number(filters.status !== "any") +
    Number(filters.markerOnly) +
    Number(filters.duplicateOnly) +
    Number(filters.favoriteOnly)
  );
}

export function AdvancedFilters({
  value,
  people,
  tags,
  groups,
  resultCount,
  onApply,
  onClose
}: {
  value: AdvancedFilterState;
  people: string[];
  tags: string[];
  groups: string[];
  resultCount: number;
  onApply: (value: AdvancedFilterState) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(value);

  const reset = () =>
    setDraft({
      people: [],
      tags: [],
      groups: [],
      dateFrom: "",
      dateTo: "",
      duration: "any",
      resolution: "any",
      status: "any",
      markerOnly: false,
      duplicateOnly: false,
      favoriteOnly: false
    });

  return (
    <div className="filter-drawer-backdrop" onMouseDown={onClose}>
      <aside className="filter-drawer" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span><SlidersHorizontal size={15} /> FILTRI AVANZATI</span>
            <h2>Trova esattamente il momento.</h2>
          </div>
          <button onClick={onClose} aria-label="Chiudi filtri"><X size={19} /></button>
        </header>

        <div className="filter-drawer-body">
          <section className="filter-section">
            <div className="filter-section-heading">
              <UsersRound size={16} />
              <div><strong>Persone</strong><small>Una o più persone nel media</small></div>
            </div>
            <div className="filter-choice-grid">
              {people.map((person) => (
                <button
                  className={draft.people.includes(person) ? "is-selected" : ""}
                  key={person}
                  onClick={() => setDraft((current) => ({
                    ...current,
                    people: toggleValue(current.people, person)
                  }))}
                >
                  <span>{person.slice(0, 1)}</span>
                  {person}
                  {draft.people.includes(person) ? <Check size={13} /> : null}
                </button>
              ))}
            </div>
          </section>

          <section className="filter-section">
            <div className="filter-section-heading">
              <Tag size={16} />
              <div><strong>Tag e gruppi</strong><small>Combina tassonomie diverse</small></div>
            </div>
            <label className="filter-select-label">
              <span>TAG</span>
              <div className="filter-chip-field">
                {tags.map((tag) => (
                  <button
                    className={draft.tags.includes(tag) ? "is-selected" : ""}
                    key={tag}
                    onClick={() => setDraft((current) => ({
                      ...current,
                      tags: toggleValue(current.tags, tag)
                    }))}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </label>
            <label className="filter-select-label">
              <span>GRUPPI</span>
              <div className="filter-chip-field">
                {groups.map((group) => (
                  <button
                    className={draft.groups.includes(group) ? "is-selected" : ""}
                    key={group}
                    onClick={() => setDraft((current) => ({
                      ...current,
                      groups: toggleValue(current.groups, group)
                    }))}
                  >
                    {group}
                  </button>
                ))}
              </div>
            </label>
          </section>

          <section className="filter-section two-column-filter">
            <div>
              <div className="filter-section-heading">
                <CalendarRange size={16} />
                <div><strong>Data</strong><small>Intervallo di import</small></div>
              </div>
              <div className="date-filter">
                <input
                  type="date"
                  value={draft.dateFrom}
                  onChange={(event) => setDraft((current) => ({ ...current, dateFrom: event.target.value }))}
                />
                <span>→</span>
                <input
                  type="date"
                  value={draft.dateTo}
                  onChange={(event) => setDraft((current) => ({ ...current, dateTo: event.target.value }))}
                />
              </div>
            </div>
            <div>
              <div className="filter-section-heading">
                <Clock3 size={16} />
                <div><strong>Durata video</strong><small>Lunghezza sorgente</small></div>
              </div>
              <div className="select-shell">
                <select
                  value={draft.duration}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    duration: event.target.value as AdvancedFilterState["duration"]
                  }))}
                >
                  <option value="any">Qualsiasi durata</option>
                  <option value="short">Meno di 1 minuto</option>
                  <option value="medium">1–5 minuti</option>
                  <option value="long">Più di 5 minuti</option>
                </select>
                <ChevronDown size={14} />
              </div>
            </div>
          </section>

          <section className="filter-section two-column-filter">
            <label>
              <span className="mini-label">RISOLUZIONE</span>
              <div className="segment-filter">
                {[
                  ["any", "Tutte"],
                  ["4k", "4K+"],
                  ["hd", "HD"],
                  ["sd", "SD"]
                ].map(([value, label]) => (
                  <button
                    className={draft.resolution === value ? "is-selected" : ""}
                    key={value}
                    onClick={() => setDraft((current) => ({
                      ...current,
                      resolution: value as AdvancedFilterState["resolution"]
                    }))}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </label>
            <label>
              <span className="mini-label">STATO FILE</span>
              <div className="select-shell">
                <select
                  value={draft.status}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    status: event.target.value as AdvancedFilterState["status"]
                  }))}
                >
                  <option value="any">Qualsiasi stato</option>
                  <option value="ready">Pronto</option>
                  <option value="processing">In elaborazione</option>
                  <option value="error">Con errore</option>
                </select>
                <ChevronDown size={14} />
              </div>
            </label>
          </section>

          <section className="filter-section switch-filter-list">
            <button
              className={draft.markerOnly ? "is-active" : ""}
              onClick={() => setDraft((current) => ({ ...current, markerOnly: !current.markerOnly }))}
            >
              <span className="switch-filter-icon purple"><Sparkles size={16} /></span>
              <p><strong>Solo con momenti salienti</strong><small>Video che hanno almeno un marker attivo</small></p>
              <i><b /></i>
            </button>
            <button
              className={draft.duplicateOnly ? "is-active" : ""}
              onClick={() => setDraft((current) => ({ ...current, duplicateOnly: !current.duplicateOnly }))}
            >
              <span className="switch-filter-icon amber"><CopyCheck size={16} /></span>
              <p><strong>Solo possibili duplicati</strong><small>Hash o contenuto visivo simile</small></p>
              <i><b /></i>
            </button>
            <button
              className={draft.favoriteOnly ? "is-active" : ""}
              onClick={() => setDraft((current) => ({ ...current, favoriteOnly: !current.favoriteOnly }))}
            >
              <span className="switch-filter-icon red"><Heart size={16} /></span>
              <p><strong>Solo preferiti</strong><small>Media contrassegnati con il cuore</small></p>
              <i><b /></i>
            </button>
          </section>
        </div>

        <footer>
          <button className="reset-filters" onClick={reset}>
            <RotateCcw size={14} /> Ripristina
          </button>
          <p><strong>{resultCount}</strong><span>risultati nella libreria</span></p>
          <button className="apply-filters" onClick={() => { onApply(draft); onClose(); }}>
            Mostra risultati
            <span>{countAdvancedFilters(draft)}</span>
          </button>
        </footer>
      </aside>
    </div>
  );
}
