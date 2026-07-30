"use client";

import { Check, ImagePlus, LoaderCircle, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { PersistedMediaRecord } from "@/types/media";

interface ReferenceImage {
  mediaId: string;
  title: string;
  url: string;
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

export function PersonReferenceModal({
  person,
  onClose,
  onSaved
}: PersonReferenceModalProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PersistedMediaRecord[]>([]);
  const [selected, setSelected] = useState(
    () => new Set(person.images?.map(({ mediaId }) => mediaId) ?? [])
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const timeout = window.setTimeout(() => {
      const params = new URLSearchParams({ kind: "image", take: "80" });
      if (query.trim()) params.set("search", query.trim());
      setLoading(true);
      void fetch(`/api/media?${params.toString()}`)
        .then(async (response) => {
          const payload = await response.json().catch(() => null) as {
            items?: PersistedMediaRecord[];
            error?: string;
          } | null;
          if (!response.ok) throw new Error(payload?.error ?? "Ricerca non riuscita");
          if (active) {
            setResults(payload?.items ?? []);
            setError(null);
          }
        })
        .catch((reason) => {
          if (active) setError(reason instanceof Error ? reason.message : "Ricerca non riuscita");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 220);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [query]);

  const imageOptions = useMemo(() => {
    const options = new Map<string, { id: string; title: string; url: string }>();
    for (const image of person.images ?? []) {
      options.set(image.mediaId, {
        id: image.mediaId,
        title: image.title,
        url: image.url
      });
    }
    for (const image of results) {
      options.set(image.id, {
        id: image.id,
        title: image.title,
        url: image.thumbnailUrl ?? image.previewUrl ?? image.originalUrl
      });
    }
    return [...options.values()];
  }, [person.images, results]);

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
            <small>IMMAGINI PERSONA</small>
            <h2 id="person-reference-title">{person.name}</h2>
            <p>Scegli fino a 12 immagini da mostrare nella scheda.</p>
          </div>
          <button onClick={onClose} aria-label="Chiudi"><X size={18} /></button>
        </header>
        <label className="person-image-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cerca una foto per nome…"
            autoFocus
          />
          {loading ? <LoaderCircle className="spin" size={16} /> : null}
        </label>
        <div className="person-image-selection">
          {imageOptions.map((image) => {
            const isSelected = selected.has(image.id);
            return (
              <button
                type="button"
                className={isSelected ? "is-selected" : ""}
                onClick={() => toggle(image.id)}
                key={image.id}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.url} alt={image.title} loading="lazy" />
                <span>{isSelected ? <Check size={15} /> : null}</span>
                <small>{image.title}</small>
              </button>
            );
          })}
          {!loading && !imageOptions.length ? (
            <div className="person-image-empty">
              <ImagePlus size={25} />
              <p>Nessuna immagine trovata.</p>
            </div>
          ) : null}
        </div>
        <footer>
          <p className={error ? "is-error" : ""}>
            {error ?? `${selected.size} di 12 immagini selezionate`}
          </p>
          <div>
            <button onClick={onClose}>Annulla</button>
            <button className="primary" onClick={save} disabled={saving}>
              {saving ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}
              {saving ? "Salvataggio…" : "Salva immagini"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
