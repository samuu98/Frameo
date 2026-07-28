"use client";

import {
  AlertTriangle,
  ArrowRight,
  Check,
  Copy,
  FileVideo,
  Folder,
  FolderInput,
  HardDrive,
  LoaderCircle,
  MoveRight,
  ShieldCheck,
  X
} from "lucide-react";
import { useEffect, useState } from "react";
import type { MediaItem } from "@/types/media";

interface PlanItem {
  mediaId: string;
  title: string;
  sourcePath: string;
  targetPath: string;
}

export function OrganizeFilesModal({
  items,
  people,
  onClose,
  onComplete
}: {
  items: MediaItem[];
  people: string[];
  onClose: () => void;
  onComplete: (message: string) => void;
}) {
  const [personName, setPersonName] = useState(people[0] ?? "Sofia");
  const [mode, setMode] = useState<"MOVE" | "COPY">("MOVE");
  const [plan, setPlan] = useState<PlanItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmation, setConfirmation] = useState("");

  useEffect(() => {
    setLoading(true);
    void fetch("/api/files/organize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mediaIds: items.map((item) => item.id), personName, mode, action: "PREVIEW" })
    })
      .then((response) => response.ok ? response.json() : null)
      .then((payload: { plan?: PlanItem[] } | null) => {
        const fallback = items.map((item) => ({
          mediaId: item.id,
          title: item.title,
          sourcePath: `originals/${item.id}/${item.sourceFileName ?? `${item.title}.mp4`}`,
          targetPath: `organized/people/${personName}/${item.sourceFileName ?? `${item.title}.mp4`}`
        }));
        setPlan(payload?.plan?.length ? payload.plan : fallback);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [items, mode, personName]);

  const execute = () => {
    setLoading(true);
    void fetch("/api/files/organize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mediaIds: items.map((item) => item.id),
        personName,
        mode,
        action: "EXECUTE",
        confirmToken: mode === "MOVE" ? confirmation : undefined
      })
    })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json()).error);
        onComplete(mode === "MOVE" ? `${items.length} file spostati nella cartella di ${personName}` : `${items.length} file copiati nella cartella di ${personName}`);
        onClose();
      })
      .catch((error) => onComplete(error instanceof Error ? error.message : "Operazione non riuscita"))
      .finally(() => setLoading(false));
  };

  return (
    <div className="organize-backdrop" onMouseDown={onClose}>
      <section className="organize-modal" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span><FolderInput size={15} /> ORGANIZZA SU FILESYSTEM</span><h2>Una cartella vera, non solo un filtro.</h2><p>Frameo aggiorna database e path insieme, mantenendo i derivati collegati.</p></div><button onClick={onClose}><X size={20} /></button></header>
        <div className="organize-body">
          <aside>
            <label><span>RAGGRUPPA PER PERSONA</span><select value={personName} onChange={(event) => setPersonName(event.target.value)}>{people.map((person) => <option value={person} key={person}>{person}</option>)}</select></label>
            <div className="organize-mode">
              <button className={mode === "MOVE" ? "is-active" : ""} onClick={() => { setMode("MOVE"); setConfirmation(""); }}><MoveRight size={18} /><span><strong>Sposta originali</strong><small>Rimuove i vecchi path</small></span>{mode === "MOVE" ? <Check size={14} /> : null}</button>
              <button className={mode === "COPY" ? "is-active" : ""} onClick={() => { setMode("COPY"); setConfirmation(""); }}><Copy size={18} /><span><strong>Crea una copia</strong><small>Conserva entrambi i path</small></span>{mode === "COPY" ? <Check size={14} /> : null}</button>
            </div>
            <div className="target-folder"><Folder size={19} /><p><span>CARTELLA DESTINAZIONE</span><strong>/organized/people/{personName.toLowerCase().replaceAll(" ", "-")}/</strong></p></div>
            <div className="organize-safety"><ShieldCheck size={17} /><p><strong>Controlli automatici</strong><small>Path confinati nello storage, collisioni rinominate, rollback DB in caso di errore.</small></p></div>
          </aside>
          <main>
            <div className="plan-title"><div><strong>Anteprima operazione</strong><small>{plan.length} file · {mode === "MOVE" ? "i path originali verranno rimossi" : "gli originali restano invariati"}</small></div>{loading ? <LoaderCircle className="is-spinning" size={17} /> : <HardDrive size={17} />}</div>
            <div className="file-plan-list">
              {plan.map((item) => (
                <article key={item.mediaId}><span><FileVideo size={17} /></span><p><strong>{item.title}</strong><small>{item.sourcePath}</small><em><ArrowRight size={12} /> {item.targetPath}</em></p></article>
              ))}
            </div>
            {mode === "MOVE" ? (
              <div className="destructive-confirm"><AlertTriangle size={18} /><div><strong>Questa operazione rimuove i file dal path originale.</strong><p>Scrivi <b>SPOSTA</b> per confermare. I derivati e i metadati resteranno disponibili.</p><input value={confirmation} onChange={(event) => setConfirmation(event.target.value.toUpperCase())} placeholder="SPOSTA" /></div></div>
            ) : null}
          </main>
        </div>
        <footer><span><ShieldCheck size={15} /> L’operazione viene registrata nel log amministrativo.</span><div><button onClick={onClose}>Annulla</button><button className={mode === "MOVE" ? "execute-move" : ""} disabled={loading || (mode === "MOVE" && confirmation !== "SPOSTA")} onClick={execute}>{loading ? <LoaderCircle className="is-spinning" size={15} /> : <FolderInput size={15} />}{mode === "MOVE" ? "Sposta file" : "Copia file"}</button></div></footer>
      </section>
    </div>
  );
}
