"use client";

import {
  Check,
  Database,
  Film,
  FolderCheck,
  FolderInput,
  HardDrive,
  Image as ImageIcon,
  LoaderCircle,
  Play,
  RefreshCw,
  Save,
  Square,
  StopCircle,
  Upload
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

interface LibraryPayload {
  settings: {
    scanFolders: string[];
    uploadFolder: string;
  };
  paths: {
    scanRoot: string | null;
    uploadRoot: string;
    storageRoot: string;
  };
  availableFolders: string[];
  stats: {
    total: number;
    videos: number;
    images: number;
    videosWithoutThumbnail: number;
    videosWithoutPreview: number;
    imagesWithoutThumbnail: number;
  };
  scan: {
    configured: boolean;
    running: boolean;
    discovered: number;
    supported: number;
    added: number;
    skipped: number;
    error: string | null;
    completedAt: string | null;
  };
  previews: {
    running: boolean;
    cancelling: boolean;
    requested: number;
    completed: number;
    failed: number;
    currentTitle: string | null;
    error: string | null;
  };
  imports: Array<{
    id: string;
    fileName: string;
    mimeType: string | null;
    totalBytes: string;
    uploadedBytes: string;
    state: "UPLOADING" | "PROCESSING" | "READY" | "SKIPPED" | "FAILED";
    progress: number;
    stage: string | null;
    error: string | null;
    createdAt: string;
    updatedAt: string;
    completedAt: string | null;
    media: {
      id: string;
      title: string;
      kind: "IMAGE" | "VIDEO";
      status: "UPLOADING" | "PROCESSING" | "READY" | "ERROR";
    } | null;
  }>;
}

interface StashSyncPayload {
  configured: boolean;
  running: boolean;
  scenes: number;
  images: number;
  processed: number;
  matched: number;
  unmatched: number;
  assignments: number;
  people: number;
  tags: number;
  groups: number;
  error: string | null;
  completedAt: string | null;
}

const number = (value: number) => value.toLocaleString("it-IT");
const bytes = (value: string) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "dimensione non disponibile";
  if (amount < 1024 ** 2) return `${Math.max(1, Math.round(amount / 1024))} KB`;
  if (amount < 1024 ** 3) return `${(amount / 1024 ** 2).toFixed(1)} MB`;
  return `${(amount / 1024 ** 3).toFixed(1)} GB`;
};
const importStateLabel: Record<LibraryPayload["imports"][number]["state"], string> = {
  UPLOADING: "Caricamento",
  PROCESSING: "Elaborazione",
  READY: "Completato",
  SKIPPED: "Già presente",
  FAILED: "Errore"
};
const importStageLabel: Record<string, string> = {
  queued: "In coda",
  "image:analyze": "Analisi immagine",
  "image:thumbnail": "Miniatura immagine",
  "image:preview": "Anteprima immagine",
  "video:analyze": "Analisi video",
  "video:thumbnail": "Miniatura video",
  "video:preview": "Anteprima video",
  "video:stream": "Preparazione streaming",
  finalizing: "Finalizzazione"
};

export function LibraryManagement({ onChanged }: { onChanged?: () => void }) {
  const [data, setData] = useState<LibraryPayload | null>(null);
  const [scanFolders, setScanFolders] = useState<string[]>([""]);
  const [uploadFolder, setUploadFolder] = useState("originals");
  const [folderQuery, setFolderQuery] = useState("");
  const [previewLimit, setPreviewLimit] = useState(100);
  const [stashSync, setStashSync] = useState<StashSyncPayload | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/library");
    const payload = (await response.json().catch(() => null)) as
      | (LibraryPayload & { error?: string })
      | null;
    if (!response.ok || !payload) {
      throw new Error(payload?.error ?? "Impossibile leggere la libreria");
    }
    setData(payload);
    setScanFolders(payload.settings.scanFolders);
    setUploadFolder(payload.settings.uploadFolder);
  }, []);

  const loadStash = useCallback(async () => {
    const response = await fetch("/api/library/stash");
    const payload = await response.json().catch(() => null) as {
      sync?: StashSyncPayload;
    } | null;
    if (response.ok && payload?.sync) setStashSync(payload.sync);
  }, []);

  useEffect(() => {
    void load().catch((error) =>
      setMessage(error instanceof Error ? error.message : "Errore libreria")
    );
    void loadStash();
  }, [load, loadStash]);

  useEffect(() => {
    const activeImport = data?.imports.some(
      ({ state }) => state === "UPLOADING" || state === "PROCESSING"
    );
    const interval = window.setInterval(() => {
      void load().then(onChanged).catch(() => undefined);
      void loadStash();
    }, activeImport || data?.scan.running || data?.previews.running || stashSync?.running
      ? 2500
      : 5000);
    return () => window.clearInterval(interval);
  }, [data, load, loadStash, onChanged, stashSync?.running]);

  const visibleFolders = useMemo(() => {
    const query = folderQuery.trim().toLocaleLowerCase("it");
    return (data?.availableFolders ?? [])
      .filter((folder) =>
        (folder || "Tutta la libreria").toLocaleLowerCase("it").includes(query)
      )
      .slice(0, 120);
  }, [data?.availableFolders, folderQuery]);

  const toggleFolder = (folder: string) => {
    setScanFolders((current) => {
      if (folder === "") return [""];
      const withoutRoot = current.filter((entry) => entry !== "");
      if (withoutRoot.includes(folder)) {
        const next = withoutRoot.filter((entry) => entry !== folder);
        return next.length ? next : [""];
      }
      return [...withoutRoot, folder].sort((left, right) =>
        left.localeCompare(right)
      );
    });
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/library", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanFolders, uploadFolder })
      });
      const payload = (await response.json().catch(() => null)) as
        | (LibraryPayload & { error?: string })
        | null;
      if (!response.ok || !payload) {
        throw new Error(payload?.error ?? "Salvataggio non riuscito");
      }
      setData(payload);
      setMessage("Cartelle salvate. La prossima scansione userà questa selezione.");
      onChanged?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Salvataggio non riuscito");
    } finally {
      setSaving(false);
    }
  };

  const startScan = async () => {
    setMessage(null);
    const response = await fetch("/api/library/scan", { method: "POST" });
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    if (!response.ok) {
      setMessage(payload?.error ?? "Scansione non avviata");
      return;
    }
    setMessage("Scansione avviata in background.");
    await load();
  };

  const startPreviews = async (mode: "MISSING_ANY" | "REGENERATE") => {
    setMessage(null);
    const response = await fetch("/api/library/previews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode,
        kind: "VIDEO",
        limit: previewLimit
      })
    });
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    if (!response.ok) {
      setMessage(payload?.error ?? "Coda anteprime non avviata");
      return;
    }
    setMessage(
      mode === "REGENERATE"
        ? "Rigenerazione anteprime avviata."
        : "Generazione delle anteprime mancanti avviata."
    );
    await load();
  };

  const cancelPreviews = async () => {
    await fetch("/api/library/previews", { method: "DELETE" });
    setMessage("La coda si fermerà al termine del file corrente.");
    await load();
  };

  const startStashSync = async () => {
    setMessage(null);
    const response = await fetch("/api/library/stash", { method: "POST" });
    const payload = await response.json().catch(() => null) as {
      sync?: StashSyncPayload;
      error?: string;
    } | null;
    if (!response.ok) {
      setMessage(payload?.error ?? "Sincronizzazione Stash non avviata");
      return;
    }
    if (payload?.sync) setStashSync(payload.sync);
    setMessage("Sincronizzazione del catalogo Stash avviata.");
  };

  if (!data) {
    return (
      <section className="library-management loading-management">
        <LoaderCircle className="is-spinning" size={24} />
        <p>{message ?? "Lettura configurazione libreria…"}</p>
      </section>
    );
  }

  const previewProgress = data.previews.requested
    ? Math.round(
        ((data.previews.completed + data.previews.failed) /
          data.previews.requested) *
          100
      )
    : 0;

  return (
    <section className="library-management">
      <div className="management-hero library-management-hero">
        <div>
          <span><HardDrive size={15} /> ARCHIVIO & DERIVATI</span>
          <h2>Gestione libreria</h2>
          <p>Decidi quali cartelle indicizzare, dove salvare gli upload e quando generare le anteprime.</p>
        </div>
        <button onClick={() => void load()}>
          <RefreshCw size={17} /> Aggiorna stato
        </button>
      </div>

      <div className="library-stat-grid">
        <div><Database size={20} /><p><strong>{number(data.stats.total)}</strong><span>Media indicizzati</span></p></div>
        <div><Film size={20} /><p><strong>{number(data.stats.videos)}</strong><span>Video</span></p></div>
        <div><ImageIcon size={20} /><p><strong>{number(data.stats.images)}</strong><span>Immagini</span></p></div>
        <div className={data.stats.videosWithoutThumbnail ? "has-warning" : ""}>
          <Square size={20} />
          <p><strong>{number(data.stats.videosWithoutThumbnail)}</strong><span>Miniature video mancanti</span></p>
        </div>
      </div>

      <article className="import-activity-card">
        <header>
          <span><Upload size={20} /></span>
          <div>
            <h3>Stato importazioni</h3>
            <p>
              Caricamenti, elaborazioni e file esclusi dal controllo duplicati.
              Lo storico resta visibile anche dopo aver cambiato schermata.
            </p>
          </div>
          <em>
            {data.imports.filter(({ state }) =>
              state === "UPLOADING" || state === "PROCESSING"
            ).length} attivi
          </em>
        </header>
        {data.imports.length ? (
          <div className="import-activity-list">
            {data.imports.slice(0, 30).map((entry) => {
              const active = entry.state === "UPLOADING" || entry.state === "PROCESSING";
              const stage = entry.stage
                ? importStageLabel[entry.stage] ?? entry.stage
                : entry.state === "UPLOADING"
                  ? "Trasferimento al server"
                  : null;
              return (
                <div className={`import-activity-row is-${entry.state.toLowerCase()}`} key={entry.id}>
                  <span className="import-kind">
                    {entry.mimeType?.startsWith("video/") || entry.media?.kind === "VIDEO"
                      ? <Film size={18} />
                      : <ImageIcon size={18} />}
                  </span>
                  <div className="import-copy">
                    <strong title={entry.fileName}>{entry.fileName}</strong>
                    <small>
                      {bytes(entry.totalBytes)} · {new Intl.DateTimeFormat("it-IT", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit"
                      }).format(new Date(entry.createdAt))}
                      {stage ? ` · ${stage}` : ""}
                    </small>
                    {active ? (
                      <span className="import-progress">
                        <i style={{ width: `${entry.progress}%` }} />
                      </span>
                    ) : null}
                    {entry.error ? (
                      <small className={entry.state === "SKIPPED" ? "import-note" : "import-error"}>
                        {entry.error}
                      </small>
                    ) : null}
                  </div>
                  <div className="import-state">
                    {active ? <LoaderCircle className="is-spinning" size={14} /> : null}
                    <span>{importStateLabel[entry.state]}</span>
                    {active ? <strong>{entry.progress}%</strong> : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty-import-activity">
            <Upload size={22} />
            <p>Nessuna importazione registrata. I prossimi tentativi appariranno qui.</p>
          </div>
        )}
      </article>

      <div className="library-management-grid">
        <article className="library-settings-card">
          <header>
            <span><FolderInput size={19} /></span>
            <div><h3>Cartelle da scansionare</h3><p>Radice montata: <code>{data.paths.scanRoot ?? "non configurata"}</code></p></div>
          </header>
          <label className="folder-search">
            Cerca tra le cartelle disponibili
            <input
              value={folderQuery}
              onChange={(event) => setFolderQuery(event.target.value)}
              placeholder="es. xxx/video"
            />
          </label>
          <div className="folder-choice-list">
            {visibleFolders.map((folder) => {
              const checked = scanFolders.includes(folder);
              return (
                <button
                  className={checked ? "is-selected" : ""}
                  key={folder || "__root__"}
                  onClick={() => toggleFolder(folder)}
                >
                  <i>{checked ? <Check size={13} /> : null}</i>
                  <span>{folder || "Tutta la libreria montata"}</span>
                  {folder === "" ? <em>radice</em> : null}
                </button>
              );
            })}
          </div>
          <p className="folder-selection-summary">
            <FolderCheck size={15} />
            {scanFolders[0] === ""
              ? "Verranno scansionate tutte le sottocartelle."
              : `${scanFolders.length} cartelle selezionate.`}
          </p>
        </article>

        <article className="library-settings-card">
          <header>
            <span><HardDrive size={19} /></span>
            <div><h3>Destinazione upload</h3><p>Storage scrivibile: <code>{data.paths.storageRoot}</code></p></div>
          </header>
          <label className="upload-folder-field">
            CARTELLA RELATIVA
            <input
              value={uploadFolder}
              onChange={(event) => setUploadFolder(event.target.value)}
              placeholder="originals"
            />
          </label>
          <div className="resolved-folder">
            <span>Percorso risultante</span>
            <code>{data.paths.storageRoot}/{uploadFolder.replace(/^\/+/, "")}</code>
          </div>
          <p>Ogni upload viene salvato in una sottocartella univoca; gli originali non vengono sovrascritti.</p>
          <button className="save-library-settings" onClick={save} disabled={saving}>
            {saving ? <LoaderCircle className="is-spinning" size={16} /> : <Save size={16} />}
            {saving ? "Salvataggio…" : "Salva configurazione"}
          </button>
        </article>
      </div>

      <div className="library-jobs-grid">
        <article className="library-job-card">
          <header><FolderInput size={19} /><div><h3>Scansione libreria</h3><p>Ricerca ricorsiva dei media supportati.</p></div></header>
          <div className="job-numbers">
            <p><strong>{number(data.scan.discovered)}</strong><span>file letti</span></p>
            <p><strong>{number(data.scan.supported)}</strong><span>supportati</span></p>
            <p><strong>{number(data.scan.added)}</strong><span>nuovi</span></p>
            <p><strong>{number(data.scan.skipped)}</strong><span>già presenti</span></p>
          </div>
          {data.scan.error ? <p className="job-error">{data.scan.error}</p> : null}
          <button onClick={startScan} disabled={data.scan.running}>
            {data.scan.running ? <LoaderCircle className="is-spinning" size={16} /> : <Play size={16} />}
            {data.scan.running ? "Scansione in corso…" : "Avvia scansione completa"}
          </button>
        </article>

        <article className="library-job-card">
          <header><Film size={19} /><div><h3>Anteprime video</h3><p>Miniatura statica e clip riprodotta soltanto al passaggio del cursore.</p></div></header>
          <div className="preview-missing-summary">
            <p><strong>{number(data.stats.videosWithoutThumbnail)}</strong><span>senza miniatura</span></p>
            <p><strong>{number(data.stats.videosWithoutPreview)}</strong><span>senza clip hover</span></p>
          </div>
          {data.previews.running ? (
            <div className="preview-queue-progress">
              <div><span style={{ width: `${previewProgress}%` }} /></div>
              <p>
                <strong>{previewProgress}% · {data.previews.completed}/{data.previews.requested}</strong>
                <span>{data.previews.currentTitle ?? "Preparazione file…"}</span>
              </p>
            </div>
          ) : null}
          {data.previews.error ? <p className="job-error">{data.previews.error}</p> : null}
          <label className="preview-limit">
            FILE PER QUESTA CODA
            <select value={previewLimit} onChange={(event) => setPreviewLimit(Number(event.target.value))}>
              <option value={25}>25</option>
              <option value={100}>100</option>
              <option value={500}>500</option>
              <option value={2000}>2.000</option>
              <option value={10000}>Tutti (max 10.000)</option>
            </select>
          </label>
          <div className="preview-job-actions">
            {data.previews.running ? (
              <button className="stop-preview-job" onClick={cancelPreviews}>
                <StopCircle size={16} /> Ferma dopo il file corrente
              </button>
            ) : (
              <>
                <button onClick={() => void startPreviews("MISSING_ANY")}>
                  <Play size={16} /> Genera mancanti
                </button>
                <button onClick={() => void startPreviews("REGENERATE")}>
                  <RefreshCw size={16} /> Rigenera
                </button>
              </>
            )}
          </div>
        </article>

        <article className="library-job-card stash-sync-card">
          <header>
            <Database size={19} />
            <div>
              <h3>Catalogo Stash</h3>
              <p>Importa persone, tag, gruppi e titoli associandoli agli stessi file.</p>
            </div>
          </header>
          {stashSync?.configured ? (
            <>
              <div className="job-numbers">
                <p><strong>{number(stashSync.matched)}</strong><span>corrispondenze</span></p>
                <p><strong>{number(stashSync.people)}</strong><span>persone</span></p>
                <p><strong>{number(stashSync.tags)}</strong><span>tag</span></p>
                <p><strong>{number(stashSync.groups)}</strong><span>gruppi</span></p>
              </div>
              {stashSync.running ? (
                <div className="stash-sync-progress">
                  <LoaderCircle className="is-spinning" size={16} />
                  <span>
                    {number(stashSync.processed)} di {number(stashSync.scenes + stashSync.images)} elementi letti
                  </span>
                </div>
              ) : null}
              {stashSync.error ? <p className="job-error">{stashSync.error}</p> : null}
              <button onClick={startStashSync} disabled={stashSync.running || data.scan.running}>
                {stashSync.running ? <LoaderCircle className="is-spinning" size={16} /> : <RefreshCw size={16} />}
                {stashSync.running ? "Sincronizzazione in corso…" : "Sincronizza da Stash"}
              </button>
              <small className="stash-sync-note">
                I file originali non vengono copiati né modificati. Le immagini generate da Stash sono escluse dalla libreria.
              </small>
            </>
          ) : (
            <div className="stash-not-configured">
              <Database size={22} />
              <p>Collegamento Stash non configurato sul server.</p>
            </div>
          )}
        </article>
      </div>

      {message ? <div className="library-management-message">{message}</div> : null}
    </section>
  );
}
