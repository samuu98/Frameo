"use client";

import {
  Check,
  ChevronDown,
  ImagePlus,
  LoaderCircle,
  Search,
  UserRound,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface ReferenceImage {
  mediaId: string;
  title: string;
  url: string;
}

interface PersonImageOption {
  id: string;
  title: string;
  width: number | null;
  height: number | null;
  displayUrl: string;
  thumbnailUrl: string | null;
  previewUrl: string | null;
  originalUrl: string | null;
  selected: boolean;
}

interface PersonReferenceModalProps {
  person: {
    id: string;
    name: string;
    images?: ReferenceImage[];
  };
  onClose: () => void;
  onSaved: () => void;
}

function ReliablePersonImage({
  image,
  alt,
  large = false
}: {
  image: Pick<PersonImageOption, "displayUrl" | "thumbnailUrl" | "previewUrl" | "originalUrl">;
  alt: string;
  large?: boolean;
}) {
  const sources = useMemo(
    () => [...new Set((large
      ? [
          `${image.displayUrl}?width=1400`,
          image.previewUrl,
          image.thumbnailUrl,
          image.originalUrl
        ]
      : [
          image.thumbnailUrl,
          `${image.displayUrl}?width=520`,
          image.previewUrl,
          image.originalUrl
        ]
    ).filter((source): source is string => Boolean(source)))],
    [image.displayUrl, image.originalUrl, image.previewUrl, image.thumbnailUrl, large]
  );
  const [sourceIndex, setSourceIndex] = useState(0);

  useEffect(() => setSourceIndex(0), [sources]);

  if (!sources[sourceIndex]) {
    return <span className="person-image-fallback"><ImagePlus size={24} /></span>;
  }

  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={sources[sourceIndex]}
      alt={alt}
      loading={sourceIndex === 0 ? "lazy" : "eager"}
      onError={() => setSourceIndex((current) => current + 1)}
    />
  );
}

export function PersonReferenceModal({
  person,
  onClose,
  onSaved
}: PersonReferenceModalProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PersonImageOption[]>([]);
  const [selected, setSelected] = useState(
    () => new Set(person.images?.map(({ mediaId }) => mediaId) ?? [])
  );
  const [focusedId, setFocusedId] = useState<string | null>(
    person.images?.[0]?.mediaId ?? null
  );
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectionLoaded = useRef(false);

  const load = useCallback(async (skip: number, append: boolean) => {
    append ? setLoadingMore(true) : setLoading(true);
    const params = new URLSearchParams({ take: "80", skip: String(skip) });
    if (query.trim()) params.set("search", query.trim());
    try {
      const response = await fetch(
        `/api/taxonomy/people/${person.id}?${params.toString()}`
      );
      const payload = await response.json().catch(() => null) as {
        items?: PersonImageOption[];
        total?: number;
        selectedIds?: string[];
        error?: string;
      } | null;
      if (!response.ok) throw new Error(payload?.error ?? "Ricerca non riuscita");
      const items = payload?.items ?? [];
      setResults((current) => append
        ? [...current, ...items.filter((item) => !current.some(({ id }) => id === item.id))]
        : items
      );
      setTotal(payload?.total ?? items.length);
      setSelected((current) => {
        const next = selectionLoaded.current
          ? new Set(current)
          : new Set(payload?.selectedIds ?? []);
        for (const image of items) {
          if (image.selected) next.add(image.id);
        }
        selectionLoaded.current = true;
        return next;
      });
      setFocusedId((current) => current ?? items[0]?.id ?? null);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Ricerca non riuscita");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [person.id, query]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(0, false), 220);
    return () => window.clearTimeout(timeout);
  }, [load]);

  const focused = results.find(({ id }) => id === focusedId) ?? results[0] ?? null;

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < 12) next.add(id);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/taxonomy/people/${person.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageIds: [...selected] })
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "Salvataggio non riuscito");
      onSaved();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Salvataggio non riuscito");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="person-reference-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="person-reference-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <span><ImagePlus size={19} /></span>
          <div>
            <small>FOTO PERFORMER</small>
            <h2 id="person-reference-title">{person.name}</h2>
            <p>
              Sono mostrate esclusivamente le foto già associate a questo performer.
              Scegline fino a 12 per la sua scheda.
            </p>
          </div>
          <button onClick={onClose} aria-label="Chiudi"><X size={18} /></button>
        </header>

        <div className="person-reference-workspace">
          <aside className="person-reference-preview">
            {focused ? (
              <>
                <div>
                  <ReliablePersonImage image={focused} alt={focused.title} large />
                </div>
                <p>
                  <strong>{focused.title}</strong>
                  <small>
                    {focused.width && focused.height
                      ? `${focused.width} × ${focused.height}`
                      : "Dimensioni non disponibili"}
                  </small>
                </p>
                <button
                  className={selected.has(focused.id) ? "is-selected" : ""}
                  onClick={() => toggle(focused.id)}
                >
                  {selected.has(focused.id) ? <Check size={16} /> : <ImagePlus size={16} />}
                  {selected.has(focused.id) ? "Selezionata per la scheda" : "Usa nella scheda"}
                </button>
              </>
            ) : (
              <div className="person-reference-no-preview">
                <UserRound size={34} />
                <p>Nessuna foto associata a {person.name}.</p>
              </div>
            )}
          </aside>

          <div className="person-reference-browser">
            <label className="person-image-search">
              <Search size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Cerca tra le foto di ${person.name}…`}
                autoFocus
              />
              {loading ? <LoaderCircle className="spin" size={16} /> : null}
            </label>
            <div className="person-image-browser-meta">
              <span>{total.toLocaleString("it-IT")} foto associate</span>
              <strong>{selected.size} / 12 selezionate</strong>
            </div>
            <div className="person-image-selection">
              {results.map((image) => {
                const isSelected = selected.has(image.id);
                const isFocused = focused?.id === image.id;
                return (
                  <article
                    className={[
                      isSelected ? "is-selected" : "",
                      isFocused ? "is-focused" : ""
                    ].join(" ")}
                    key={image.id}
                  >
                    <button
                      type="button"
                      className="person-image-open"
                      onClick={() => setFocusedId(image.id)}
                      aria-label={`Visualizza ${image.title}`}
                    >
                      <ReliablePersonImage image={image} alt={image.title} />
                      <small>{image.title}</small>
                    </button>
                    <button
                      type="button"
                      className="person-image-toggle"
                      onClick={() => {
                        setFocusedId(image.id);
                        toggle(image.id);
                      }}
                      aria-label={isSelected ? `Deseleziona ${image.title}` : `Seleziona ${image.title}`}
                    >
                      {isSelected ? <Check size={15} /> : <ImagePlus size={14} />}
                    </button>
                  </article>
                );
              })}
              {!loading && !results.length ? (
                <div className="person-image-empty">
                  <ImagePlus size={25} />
                  <p>
                    {query
                      ? "Nessuna foto associata corrisponde alla ricerca."
                      : `Non ci sono ancora foto assegnate a ${person.name}.`}
                  </p>
                </div>
              ) : null}
            </div>
            {results.length < total ? (
              <button
                className="load-more-person-images"
                onClick={() => void load(results.length, true)}
                disabled={loadingMore}
              >
                {loadingMore
                  ? <LoaderCircle className="spin" size={15} />
                  : <ChevronDown size={15} />}
                {loadingMore ? "Caricamento…" : "Carica altre foto"}
              </button>
            ) : null}
          </div>
        </div>

        <footer>
          <p className={error ? "is-error" : ""}>
            {error ?? `${selected.size} immagini selezionate per ${person.name}`}
          </p>
          <div>
            <button onClick={onClose}>Annulla</button>
            <button className="primary" onClick={save} disabled={saving || selected.size > 12}>
              {saving ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}
              {saving ? "Salvataggio…" : "Salva immagini"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
