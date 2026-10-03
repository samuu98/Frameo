"use client";

import {
  Check,
  CopyCheck,
  Files,
  RefreshCw,
  SearchCheck,
  ShieldAlert,
  Sparkles,
  Trash2,
  X
} from "lucide-react";
import { useEffect, useState } from "react";

interface DuplicateMedia {
  id: string;
  title: string;
  kind: string;
  bytes?: string;
  thumbnailUrl?: string | null;
  people?: { person: { name: string } }[];
  tags?: { tag: { name: string } }[];
}

function fileSize(bytes?: string) {
  if (bytes === undefined) return "Dimensione non disponibile";
  const value = Number(bytes);
  const unit = value >= 1024 ** 3 ? 3 : value >= 1024 ** 2 ? 2 : value >= 1024 ? 1 : 0;
  return `${(value / 1024 ** unit).toLocaleString("it-IT", { maximumFractionDigits: 2 })} ${["B", "KiB", "MiB", "GiB"][unit]}`;
}

interface DuplicateMatch {
  id: string;
  similarity: number;
  reason: string;
  status: string;
  source: DuplicateMedia;
  candidate: DuplicateMedia;
}

export function DuplicatesPanel() {
  const [matches, setMatches] = useState<DuplicateMatch[]>([]);
  const [scanning, setScanning] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DuplicateMedia | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState("");

  const deleteFile = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setNotice("");
    try {
      const response = await fetch(`/api/media/${deleteTarget.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Eliminazione non riuscita");
      setMatches((current) => current.filter((match) => match.source.id !== deleteTarget.id && match.candidate.id !== deleteTarget.id));
      setNotice(`Eliminato dal disco: ${deleteTarget.title}`);
      setDeleteTarget(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Eliminazione non riuscita");
    } finally {
      setDeleting(false);
    }
  };

  const refresh = () => {
    void fetch("/api/duplicates")
      .then((response) => response.ok ? response.json() : null)
      .then((payload: { matches?: DuplicateMatch[] } | null) => {
        if (Array.isArray(payload?.matches)) setMatches(payload.matches);
      })
      .catch(() => undefined);
  };
  useEffect(refresh, []);

  const resolve = (id: string, status: "KEPT_BOTH" | "MERGED" | "DISMISSED") => {
    setMatches((current) => current.filter((match) => match.id !== id));
    void fetch(`/api/duplicates/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }).catch(() => undefined);
  };

  return (
    <section className="duplicates-panel">
      {notice ? <p role="status">{notice}</p> : null}
      {deleteTarget ? (
        <div className="delete-media-backdrop" onKeyDown={(event) => { if (event.key === "Escape" && !deleting) setDeleteTarget(null); }}>
          <section className="delete-media-dialog" role="dialog" aria-modal="true" aria-labelledby="duplicate-delete-title">
            <span><Trash2 size={22} /></span>
            <h2 id="duplicate-delete-title">Eliminare “{deleteTarget.title}”?</h2>
            <p>{fileSize(deleteTarget.bytes)} · Il file originale e le sue anteprime verranno eliminati definitivamente dal disco. L’azione non è annullabile.</p>
            {notice ? <p role="alert">{notice}</p> : null}
            <footer>
              <button autoFocus disabled={deleting} onClick={() => setDeleteTarget(null)}>Annulla</button>
              <button className="danger" disabled={deleting} onClick={() => void deleteFile()}>{deleting ? "Eliminazione…" : "Elimina definitivamente"}</button>
            </footer>
          </section>
        </div>
      ) : null}
      <div className="management-hero">
        <div><span><CopyCheck size={15} /> QUALITÀ ARCHIVIO</span><h2>Possibili duplicati</h2><p>Confronto SHA-256 e impronta percettiva per immagini e fotogrammi video.</p></div>
        <button onClick={() => {
          setScanning(true);
          void fetch("/api/duplicates", { method: "POST" }).then(() => refresh()).finally(() => window.setTimeout(() => setScanning(false), 700));
        }}><RefreshCw className={scanning ? "is-spinning" : ""} size={17} /> {scanning ? "Scansione…" : "Nuova scansione"}</button>
      </div>
      <div className="duplicate-stats">
        <div><span className="overview-icon purple"><Files size={19} /></span><p><strong>{matches.length}</strong><small>Coppie da verificare</small></p></div>
        <div><span className="overview-icon green"><SearchCheck size={19} /></span><p><strong>{matches.filter((match) => match.similarity === 1).length}</strong><small>Duplicati esatti</small></p></div>
        <div><span className="overview-icon amber"><Sparkles size={19} /></span><p><strong>{matches.filter((match) => match.similarity < 1).length}</strong><small>Somiglianze visive</small></p></div>
      </div>
      <div className="duplicate-list">
        {matches.map((match) => (
          <article className="duplicate-card" key={match.id}>
            <div className="duplicate-confidence"><strong>{Math.round(match.similarity * 100)}%</strong><span>{match.reason}</span></div>
            <div className="duplicate-compare">
              {[match.source, match.candidate].map((media, index) => (
                <div key={media.id}>
                  <span className="duplicate-preview">{media.thumbnailUrl ? <img src={media.thumbnailUrl} alt="" /> : <CopyCheck size={27} />}</span>
                  <p><em>{index === 0 ? "ORIGINALE SUGGERITO" : "POSSIBILE COPIA"}</em><strong>{media.title}</strong><small>{media.kind === "VIDEO" ? "Video" : "Immagine"} · {fileSize(media.bytes)}</small><small>Performer: {media.people?.map(({ person }) => person.name).join(", ") || "Nessuno"}</small><small>Tag: {media.tags?.map(({ tag }) => tag.name).join(", ") || "Nessuno"}</small></p>
                  <button aria-label={`Elimina ${media.title}`} onClick={() => { setNotice(""); setDeleteTarget(media); }}><Trash2 size={14} /> Elimina file</button>
                </div>
              ))}
              <i className="compare-divider">VS</i>
            </div>
            <footer><span><ShieldAlert size={14} /> Nessun file viene eliminato senza conferma.</span><div><button onClick={() => resolve(match.id, "DISMISSED")}><X size={14} /> Non duplicati</button><button onClick={() => resolve(match.id, "KEPT_BOTH")}><Check size={14} /> Tieni entrambi</button><button className="merge-duplicates" onClick={() => resolve(match.id, "MERGED")}><CopyCheck size={14} /> Unifica metadati</button></div></footer>
          </article>
        ))}
        {!matches.length ? (
          <div className="no-rules">
            <SearchCheck size={19} />
            <strong>Nessun duplicato da verificare</strong>
            <p>Avvia una scansione dopo aver importato i tuoi media.</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
