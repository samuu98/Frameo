"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Clock3, X } from "lucide-react";

type Project = {
  id: string; name: string; operation: string; state: string; progress: number;
  error: string | null; createdAt: string;
  outputs: { id: string; title: string; status: string }[];
};
const operations: Record<string, string> = { MERGE: "Unione video", TRIM: "Taglio video", SPLIT: "Divisione video" };
const states: Record<string, string> = { PENDING: "In attesa", RUNNING: "In corso", COMPLETED: "Completata", FAILED: "Non riuscita" };

export function EditorActivity({ refreshKey, onOpenResult }: { refreshKey: number; onOpenResult: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [allowed, setAllowed] = useState(true);
  useEffect(() => { if (refreshKey) setOpen(true); }, [refreshKey]);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch("/api/editor", { cache: "no-store", signal: controller.signal });
        if (response.status === 403) { if (!disposed) setAllowed(false); return; }
        if (!response.ok) throw new Error("Stato editing non disponibile. Nuovo tentativo tra pochi secondi.");
        const payload = await response.json();
        if (!disposed) { setProjects(payload.projects ?? []); setError(""); setLoaded(true); }
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : "Connessione non disponibile");
      } finally {
        if (!disposed) timer = setTimeout(refresh, 5000);
      }
    };
    void refresh();
    return () => { disposed = true; controller.abort(); clearTimeout(timer); };
  }, [refreshKey]);
  const active = projects.filter(({ state }) => state === "RUNNING" || state === "PENDING").length;
  if (!allowed) return null;
  return <>
    <button className="compact-upload" onClick={() => setOpen(true)} aria-label={`Attività editing${active ? `: ${active} in corso` : ""}`}><Clock3 size={17} /><span>Editing{active ? ` (${active})` : ""}</span></button>
    {open ? createPortal(<div className="delete-media-backdrop" onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}>
      <section className="editing-activity" role="dialog" aria-modal="true" aria-labelledby="editing-activity-title">
        <header><div><h2 id="editing-activity-title">Attività editing</h2><p>Ultime 50 operazioni · aggiornamento automatico ogni 5 secondi</p></div><button autoFocus onClick={() => setOpen(false)} aria-label="Chiudi attività editing"><X size={20} /></button></header>
        {error ? <p role="alert">{error}</p> : null}
        {!loaded && !error ? <p>Caricamento…</p> : null}
        {loaded && !projects.length ? <p>Nessuna operazione di editing avviata.</p> : null}
        {projects.map((project) => <article key={project.id}>
          <h3>{project.name}</h3>
          <p>{operations[project.operation] ?? project.operation} · {new Date(project.createdAt).toLocaleString("it-IT")}</p>
          <strong>{states[project.state] ?? project.state}{project.state === "RUNNING" ? ` · ${project.progress}%` : ""}</strong>
          {project.state === "RUNNING" || project.state === "PENDING" ? <><progress max={100} value={project.progress} aria-label={`Avanzamento ${project.name}`} /><small>L’avanzamento si aggiorna al termine delle singole fasi. Puoi chiudere questa finestra.</small></> : null}
          {project.error ? <details><summary>Dettagli dell’errore</summary><pre>{project.error}</pre></details> : null}
          {project.outputs?.map((output) => <button key={output.id} onClick={() => { onOpenResult(output.id); setOpen(false); }}>Apri risultato: {output.title}{output.status === "PROCESSING" ? " · anteprima in preparazione" : output.status === "FAILED" ? " · errore anteprima" : ""}</button>)}
          {project.state === "COMPLETED" && !project.outputs?.length ? <small>Il file risultante non è più disponibile nel catalogo.</small> : null}
        </article>)}
      </section>
    </div>, document.body) : null}
  </>;
}
