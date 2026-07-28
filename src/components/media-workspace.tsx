"use client";

import {
  Archive,
  ArrowDownUp,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Command,
  Download,
  Film,
  Folder,
  Grid2X2,
  HardDrive,
  Heart,
  Image as ImageIcon,
  Inbox,
  Info,
  Layers3,
  LayoutGrid,
  List,
  LoaderCircle,
  Maximize2,
  Menu,
  MoreHorizontal,
  PanelRightClose,
  Pause,
  Play,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Star,
  Tag,
  Trash2,
  Upload,
  UserRound,
  UsersRound,
  WandSparkles,
  X,
  Zap
} from "lucide-react";
import {
  type ChangeEvent,
  type DragEvent,
  type MouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { demoMedia, people, quickTags } from "@/data/media";
import type { MediaItem, MediaType } from "@/types/media";

const navItems = [
  { label: "Libreria", icon: LayoutGrid },
  { label: "Recenti", icon: Clock3 },
  { label: "Preferiti", icon: Heart },
  { label: "Da catalogare", icon: Inbox, count: 12 }
];

const organizeItems = [
  { label: "Persone", icon: UsersRound },
  { label: "Tag", icon: Tag },
  { label: "Gruppi", icon: Layers3 }
];

const formatBytes = (bytes: number) => {
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
};

interface PersistedMedia {
  id: string;
  title: string;
  kind: "IMAGE" | "VIDEO";
  status: "UPLOADING" | "PROCESSING" | "READY" | "ERROR";
  bytes: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  createdAt: string;
  dominantColor: string | null;
  favorite: boolean;
  thumbnailUrl: string | null;
  previewUrl: string | null;
  originalUrl: string;
  tags: Array<{ name: string }>;
  people: Array<{ name: string }>;
  groups: Array<{ name: string }>;
}

const formatDuration = (milliseconds: number | null) => {
  if (!milliseconds) return "—";
  const totalSeconds = Math.round(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const persistedToMedia = (item: PersistedMedia, fallbackSrc?: string): MediaItem => ({
  id: item.id,
  title: item.title,
  type: item.kind === "VIDEO" ? "video" : "image",
  src: item.thumbnailUrl ?? item.previewUrl ?? fallbackSrc ?? item.originalUrl,
  accent: item.dominantColor ?? "#817A70",
  duration: item.kind === "VIDEO" ? formatDuration(item.durationMs) : undefined,
  dimensions:
    item.width && item.height ? `${item.width} × ${item.height}` : "Analisi in corso",
  size: formatBytes(Number(item.bytes)),
  date: new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(item.createdAt)),
  people: item.people.map(({ name }) => name),
  tags: item.tags.map(({ name }) => name),
  group: item.groups[0]?.name ?? "Da catalogare",
  status:
    item.status === "READY"
      ? "ready"
      : item.status === "ERROR"
        ? "error"
        : "processing",
  favorite: item.favorite,
  aspect:
    item.width && item.height && item.height > item.width * 1.12
      ? "portrait"
      : item.width && item.height && item.width > item.height * 1.45
        ? "wide"
        : "landscape"
});

function Logo() {
  return (
    <div className="brand" aria-label="Frameo">
      <span className="brand-mark">
        <span />
        <span />
        <span />
      </span>
      <span>frameo</span>
    </div>
  );
}

function Sidebar({
  active,
  onNavigate,
  onUpload
}: {
  active: string;
  onNavigate: (item: string) => void;
  onUpload: () => void;
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <Logo />
        <button className="sidebar-collapse" aria-label="Riduci navigazione">
          <PanelRightClose size={17} />
        </button>
      </div>

      <button className="upload-primary" onClick={onUpload}>
        <Plus size={18} strokeWidth={2.4} />
        <span>Importa media</span>
        <kbd>U</kbd>
      </button>

      <nav className="sidebar-nav" aria-label="Navigazione principale">
        <p className="nav-caption">Esplora</p>
        {navItems.map(({ label, icon: Icon, count }) => (
          <button
            className={active === label ? "nav-item is-active" : "nav-item"}
            key={label}
            onClick={() => onNavigate(label)}
          >
            <Icon size={18} />
            <span>{label}</span>
            {count ? <em>{count}</em> : null}
          </button>
        ))}

        <p className="nav-caption nav-caption-spaced">Organizza</p>
        {organizeItems.map(({ label, icon: Icon }) => (
          <button
            className={active === label ? "nav-item is-active" : "nav-item"}
            key={label}
            onClick={() => onNavigate(label)}
          >
            <Icon size={18} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-people">
        <div className="sidebar-section-title">
          <span>Volti frequenti</span>
          <button aria-label="Vedi tutte le persone">
            <ChevronRight size={15} />
          </button>
        </div>
        <div className="avatar-stack">
          {people.map((person) => (
            <button key={person.name} title={`${person.name}, ${person.count} media`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={person.src} alt={person.name} />
            </button>
          ))}
          <span>+18</span>
        </div>
      </div>

      <div className="storage-card">
        <div className="storage-head">
          <span>
            <HardDrive size={15} />
            Archivio
          </span>
          <strong>68%</strong>
        </div>
        <div className="storage-track">
          <span />
        </div>
        <p>2.72 TB di 4 TB utilizzati</p>
        <button>Gestisci spazio</button>
      </div>

      <div className="sidebar-footer">
        <button>
          <CircleHelp size={17} />
          Aiuto
        </button>
        <button>
          <Settings size={17} />
          Impostazioni
        </button>
        <button className="profile-button" aria-label="Profilo di Sara Porta">
          <span>SP</span>
          <div>
            <strong>Sara Porta</strong>
            <small>Pro workspace</small>
          </div>
          <MoreHorizontal size={16} />
        </button>
      </div>
    </aside>
  );
}

function Topbar({
  onCommand,
  onUpload,
  onMobileMenu
}: {
  onCommand: () => void;
  onUpload: () => void;
  onMobileMenu: () => void;
}) {
  return (
    <header className="topbar">
      <button className="mobile-menu" onClick={onMobileMenu} aria-label="Apri menu">
        <Menu size={21} />
      </button>
      <div className="breadcrumb">
        <span>Workspace personale</span>
        <ChevronRight size={14} />
        <strong>Libreria</strong>
      </div>
      <button className="global-search" onClick={onCommand}>
        <Search size={17} />
        <span>Cerca file, persone, luoghi o tag…</span>
        <kbd>⌘ K</kbd>
      </button>
      <div className="topbar-actions">
        <button className="icon-button has-dot" aria-label="Notifiche">
          <Bell size={18} />
        </button>
        <button className="compact-upload" onClick={onUpload}>
          <Upload size={17} />
          <span>Importa</span>
        </button>
      </div>
    </header>
  );
}

function StatusRail() {
  return (
    <section className="status-rail" aria-label="Stato elaborazione">
      <div className="status-copy">
        <span className="status-icon">
          <LoaderCircle size={17} />
        </span>
        <div>
          <strong>1 video in elaborazione</strong>
          <p>Generazione anteprima HLS e 12 fotogrammi</p>
        </div>
      </div>
      <div className="status-progress">
        <span style={{ width: "72%" }} />
      </div>
      <small>72%</small>
      <button aria-label="Metti in pausa">
        <Pause size={16} />
      </button>
      <button aria-label="Apri coda">
        <ChevronRight size={17} />
      </button>
    </section>
  );
}

function MediaCard({
  item,
  selected,
  quickMode,
  onOpen,
  onSelect,
  onFavorite,
  onQuickTag
}: {
  item: MediaItem;
  selected: boolean;
  quickMode: boolean;
  onOpen: (item: MediaItem) => void;
  onSelect: (item: MediaItem, event: MouseEvent) => void;
  onFavorite: (item: MediaItem, event: MouseEvent) => void;
  onQuickTag: (item: MediaItem, tag: string, event: MouseEvent) => void;
}) {
  const isProcessing = item.status === "processing";

  return (
    <article
      className={[
        "media-card",
        `is-${item.aspect}`,
        selected ? "is-selected" : "",
        isProcessing ? "is-processing" : ""
      ].join(" ")}
      onClick={() => (quickMode ? undefined : onOpen(item))}
    >
      <div className="media-visual" style={{ backgroundColor: item.accent }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.src} alt="" loading="lazy" />
        <div className="media-shade" />

        <button
          className="select-control"
          onClick={(event) => onSelect(item, event)}
          aria-label={selected ? `Deseleziona ${item.title}` : `Seleziona ${item.title}`}
        >
          {selected ? <Check size={15} strokeWidth={3} /> : null}
        </button>

        <div className="media-topline">
          <span className="media-type">
            {item.type === "video" ? <Film size={13} /> : <ImageIcon size={13} />}
            {item.type === "video" ? "VIDEO" : "FOTO"}
          </span>
          <button
            className={item.favorite ? "favorite is-favorite" : "favorite"}
            onClick={(event) => onFavorite(item, event)}
            aria-label="Aggiungi ai preferiti"
          >
            <Heart size={15} fill={item.favorite ? "currentColor" : "none"} />
          </button>
        </div>

        {item.type === "video" && !isProcessing ? (
          <button className="play-button" aria-label={`Riproduci ${item.title}`}>
            <Play size={18} fill="currentColor" />
          </button>
        ) : null}

        {quickMode ? (
          <div className="quick-tag-overlay">
            <p>Scegli un tag rapido</p>
            <div>
              {quickTags.slice(0, 3).map((tag, index) => (
                <button
                  key={tag.name}
                  onClick={(event) => onQuickTag(item, tag.name, event)}
                  title={tag.name}
                >
                  <kbd>{index + 1}</kbd>
                  <span style={{ background: tag.color }} />
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {isProcessing ? (
          <div className="processing-overlay">
            <WandSparkles size={20} />
            <strong>Preparazione anteprima</strong>
            <span>
              <i style={{ width: "72%" }} />
            </span>
            <small>72%</small>
          </div>
        ) : null}

        <div className="media-bottomline">
          {item.duration ? <span>{item.duration}</span> : <span>{item.dimensions}</span>}
          <button aria-label="Altre azioni">
            <MoreHorizontal size={17} />
          </button>
        </div>
      </div>
      <div className="media-caption">
        <div>
          <h3>{item.title}</h3>
          <p>
            {item.date}
            <span>·</span>
            {item.size}
          </p>
        </div>
        {item.people.length ? (
          <div className="micro-avatars" aria-label={`Persone: ${item.people.join(", ")}`}>
            {item.people.slice(0, 3).map((name) => {
              const person = people.find((entry) => entry.name === name);
              return person ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={name} src={person.src} alt={name} title={name} />
              ) : null;
            })}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function Inspector({
  item,
  onClose,
  onFavorite,
  onAddTag
}: {
  item: MediaItem;
  onClose: () => void;
  onFavorite: () => void;
  onAddTag: (tag: string) => void;
}) {
  const [tab, setTab] = useState<"info" | "organizza" | "attivita">("info");
  const [playing, setPlaying] = useState(false);
  const [tagInput, setTagInput] = useState("");

  return (
    <aside className="inspector" aria-label={`Dettagli di ${item.title}`}>
      <div className="inspector-header">
        <div>
          <span>{item.type === "video" ? "Video" : "Immagine"}</span>
          <h2>{item.title}</h2>
        </div>
        <div>
          <button
            className={item.favorite ? "is-favorite" : ""}
            onClick={onFavorite}
            aria-label="Preferito"
          >
            <Heart size={18} fill={item.favorite ? "currentColor" : "none"} />
          </button>
          <button onClick={onClose} aria-label="Chiudi dettagli">
            <X size={19} />
          </button>
        </div>
      </div>

      <div className="inspector-preview" style={{ backgroundColor: item.accent }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.src} alt={item.title} />
        {item.type === "video" ? (
          <button className="preview-play" onClick={() => setPlaying((value) => !value)}>
            {playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}
          </button>
        ) : null}
        <div className="preview-actions">
          <button aria-label="Vista a schermo intero">
            <Maximize2 size={17} />
          </button>
          <button aria-label="Scarica originale">
            <Download size={17} />
          </button>
          <button aria-label="Altre azioni">
            <MoreHorizontal size={18} />
          </button>
        </div>
      </div>

      {item.type === "video" ? (
        <div className="timeline">
          <span>00:18</span>
          <div>
            {Array.from({ length: 22 }).map((_, index) => (
              <i
                key={index}
                style={{ height: `${8 + ((index * 7) % 16)}px` }}
                className={index < 7 ? "is-passed" : ""}
              />
            ))}
          </div>
          <span>{item.duration}</span>
        </div>
      ) : null}

      <div className="inspector-tabs">
        {[
          ["info", "Info"],
          ["organizza", "Organizza"],
          ["attivita", "Attività"]
        ].map(([value, label]) => (
          <button
            className={tab === value ? "is-active" : ""}
            key={value}
            onClick={() => setTab(value as typeof tab)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="inspector-body">
        {tab === "info" ? (
          <>
            <section className="detail-section">
              <div className="detail-section-title">
                <h3>Dettagli file</h3>
                <button>Modifica</button>
              </div>
              <dl className="detail-list">
                <div>
                  <dt>Formato</dt>
                  <dd>{item.type === "video" ? "H.265 · MP4" : "RAW + JPEG"}</dd>
                </div>
                <div>
                  <dt>Dimensioni</dt>
                  <dd>{item.dimensions}</dd>
                </div>
                <div>
                  <dt>Dimensione</dt>
                  <dd>{item.size}</dd>
                </div>
                <div>
                  <dt>Acquisito</dt>
                  <dd>{item.date}</dd>
                </div>
                <div>
                  <dt>Posizione</dt>
                  <dd>{item.location ?? "Non disponibile"}</dd>
                </div>
              </dl>
            </section>
            <section className="detail-section">
              <div className="detail-section-title">
                <h3>Annotazioni</h3>
              </div>
              <textarea
                defaultValue={
                  item.featured
                    ? "Ripresa drone al tramonto. Usare la sequenza tra 00:18 e 00:34 per il montaggio principale."
                    : ""
                }
                placeholder="Aggiungi una nota a questo media…"
              />
            </section>
          </>
        ) : null}

        {tab === "organizza" ? (
          <>
            <section className="detail-section">
              <div className="detail-section-title">
                <h3>Persone</h3>
                <button>
                  <Plus size={14} /> Aggiungi
                </button>
              </div>
              {item.people.length ? (
                <div className="person-list">
                  {item.people.map((name) => {
                    const person = people.find((entry) => entry.name === name);
                    return (
                      <div key={name}>
                        {person ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={person.src} alt="" />
                        ) : (
                          <span>{name.slice(0, 1)}</span>
                        )}
                        <p>
                          <strong>{name}</strong>
                          <small>Rilevamento confermato</small>
                        </p>
                        <CheckCircle2 size={16} />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <button className="empty-organize">
                  <UserRound size={18} />
                  Assegna una persona
                </button>
              )}
            </section>
            <section className="detail-section">
              <div className="detail-section-title">
                <h3>Tag</h3>
              </div>
              <div className="tag-list">
                {item.tags.map((tag) => (
                  <span key={tag}>
                    {tag}
                    <button onClick={() => undefined} aria-label={`Rimuovi ${tag}`}>
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
              <form
                className="tag-input"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (tagInput.trim()) {
                    onAddTag(tagInput.trim());
                    setTagInput("");
                  }
                }}
              >
                <Tag size={15} />
                <input
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  placeholder="Scrivi e premi Invio"
                />
              </form>
            </section>
            <section className="detail-section">
              <div className="detail-section-title">
                <h3>Gruppo</h3>
                <button>Cambia</button>
              </div>
              <button className="group-row">
                <Folder size={18} />
                <span>
                  <strong>{item.group}</strong>
                  <small>24 elementi</small>
                </span>
                <ChevronRight size={16} />
              </button>
            </section>
          </>
        ) : null}

        {tab === "attivita" ? (
          <div className="activity-list">
            <div>
              <span className="activity-icon green">
                <Check size={15} />
              </span>
              <p>
                <strong>Elaborazione completata</strong>
                <small>Anteprima, HLS e thumbnail generate</small>
                <time>Oggi, 11:46</time>
              </p>
            </div>
            <div>
              <span className="activity-icon purple">
                <Sparkles size={15} />
              </span>
              <p>
                <strong>3 persone riconosciute</strong>
                <small>Conferma suggerimenti nella sezione Persone</small>
                <time>Oggi, 11:45</time>
              </p>
            </div>
            <div>
              <span className="activity-icon neutral">
                <Upload size={15} />
              </span>
              <p>
                <strong>File importato</strong>
                <small>Da Sara Porta · MacBook Pro</small>
                <time>Oggi, 11:42</time>
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function UploadModal({
  onClose,
  onUpload
}: {
  onClose: () => void;
  onUpload: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    setFiles((current) => [...current, ...Array.from(list)]);
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="upload-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <span className="modal-kicker">NUOVO IMPORT</span>
            <h2 id="upload-title">Porta dentro i tuoi ricordi.</h2>
            <p>Foto e video vengono ottimizzati automaticamente senza toccare gli originali.</p>
          </div>
          <button onClick={onClose} aria-label="Chiudi">
            <X size={20} />
          </button>
        </div>

        <div
          className={dragging ? "drop-zone is-dragging" : "drop-zone"}
          onDragEnter={(event: DragEvent) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event: DragEvent) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={(event: DragEvent) => {
            event.preventDefault();
            setDragging(false);
            addFiles(event.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
        >
          <span className="drop-icon">
            <Upload size={24} />
          </span>
          <h3>Trascina qui foto e video</h3>
          <p>oppure scegli dal tuo dispositivo</p>
          <button>Seleziona file</button>
          <small>JPG, PNG, HEIC, RAW, MP4, MOV, MKV · fino a 5 GB per file</small>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*,video/*"
            onChange={(event: ChangeEvent<HTMLInputElement>) => addFiles(event.target.files)}
          />
        </div>

        {files.length ? (
          <div className="upload-files">
            <div className="upload-files-head">
              <strong>{files.length} file pronti</strong>
              <button onClick={() => setFiles([])}>Rimuovi tutti</button>
            </div>
            {files.slice(0, 3).map((file, index) => (
              <div className="upload-file-row" key={`${file.name}-${index}`}>
                <span>{file.type.startsWith("video") ? <Film size={17} /> : <ImageIcon size={17} />}</span>
                <p>
                  <strong>{file.name}</strong>
                  <small>{formatBytes(file.size)}</small>
                </p>
                <CheckCircle2 size={17} />
              </div>
            ))}
            {files.length > 3 ? <small className="more-files">e altri {files.length - 3} file</small> : null}
          </div>
        ) : null}

        <div className="upload-options">
          <label>
            <span>AGGIUNGI AL GRUPPO</span>
            <button>
              <Folder size={16} />
              Da catalogare
              <ChevronDown size={15} />
            </button>
          </label>
          <label>
            <span>TAG AUTOMATICI</span>
            <button className="toggle is-on" aria-label="Tag automatici attivi">
              <i />
            </button>
          </label>
        </div>

        <div className="modal-footer">
          <p>
            <ShieldCheckIcon />
            Gli originali restano privati e intatti.
          </p>
          <div>
            <button onClick={onClose}>Annulla</button>
            <button
              className="confirm-upload"
              disabled={!files.length}
              onClick={() => {
                onUpload(files);
                onClose();
              }}
            >
              Importa {files.length || ""}
              <ArrowRightIcon />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function ShieldCheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3 5 6v5c0 4.65 2.93 8.87 7 10 4.07-1.13 7-5.35 7-10V6l-7-3Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="m9 12 2 2 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CommandPalette({
  onClose,
  onOpenItem
}: {
  onClose: () => void;
  onOpenItem: (item: MediaItem) => void;
}) {
  const [query, setQuery] = useState("");
  const results = demoMedia
    .filter((item) => `${item.title} ${item.tags.join(" ")} ${item.people.join(" ")}`.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 4);

  return (
    <div className="command-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Ricerca globale"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="command-input">
          <Search size={20} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cerca nella tua libreria…"
          />
          <kbd>ESC</kbd>
        </div>
        <div className="command-results">
          <span className="command-label">{query ? "RISULTATI" : "ACCESSO RAPIDO"}</span>
          {!query ? (
            <>
              <button>
                <span className="command-action purple"><Upload size={17} /></span>
                <p><strong>Importa nuovi media</strong><small>Carica foto e video</small></p>
                <kbd>U</kbd>
              </button>
              <button>
                <span className="command-action amber"><Zap size={17} /></span>
                <p><strong>Catalogazione rapida</strong><small>Tagga con la tastiera</small></p>
                <kbd>Q</kbd>
              </button>
              <button>
                <span className="command-action blue"><UsersRound size={17} /></span>
                <p><strong>Riconosci persone</strong><small>12 volti da confermare</small></p>
                <ChevronRight size={16} />
              </button>
            </>
          ) : (
            results.map((item) => (
              <button key={item.id} onClick={() => { onOpenItem(item); onClose(); }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.src} alt="" />
                <p><strong>{item.title}</strong><small>{item.tags.join(" · ") || item.group}</small></p>
                <span className="command-kind">{item.type === "video" ? "VIDEO" : "FOTO"}</span>
              </button>
            ))
          )}
        </div>
        <footer>
          <span><kbd>↑↓</kbd> Naviga</span>
          <span><kbd>↵</kbd> Apri</span>
          <span><Command size={13} /> Ricerca intelligente attiva</span>
        </footer>
      </section>
    </div>
  );
}

function BulkToolbar({
  count,
  onClear,
  onAddTag
}: {
  count: number;
  onClear: () => void;
  onAddTag: (tag: string) => void;
}) {
  return (
    <div className="bulk-toolbar">
      <span className="bulk-count">{count}</span>
      <strong>selezionati</strong>
      <i />
      <button onClick={() => onAddTag("Selezionato")}>
        <Tag size={16} />
        Tagga
      </button>
      <button>
        <Folder size={16} />
        Sposta
      </button>
      <button>
        <Download size={16} />
        Scarica
      </button>
      <button className="danger">
        <Trash2 size={16} />
      </button>
      <button className="bulk-close" onClick={onClear} aria-label="Deseleziona tutto">
        <X size={17} />
      </button>
    </div>
  );
}

function MobileNav({
  active,
  onNavigate,
  onUpload
}: {
  active: string;
  onNavigate: (value: string) => void;
  onUpload: () => void;
}) {
  return (
    <nav className="mobile-nav">
      {[
        { label: "Libreria", icon: LayoutGrid },
        { label: "Persone", icon: UsersRound }
      ].map(({ label, icon: Icon }) => (
        <button className={active === label ? "is-active" : ""} key={label} onClick={() => onNavigate(label)}>
          <Icon size={20} />
          <span>{label}</span>
        </button>
      ))}
      <button className="mobile-add" onClick={onUpload} aria-label="Importa">
        <Plus size={23} />
      </button>
      {[
        { label: "Gruppi", icon: Layers3 },
        { label: "Cerca", icon: Search }
      ].map(({ label, icon: Icon }) => (
        <button className={active === label ? "is-active" : ""} key={label} onClick={() => onNavigate(label)}>
          <Icon size={20} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

export function MediaWorkspace() {
  const [activeNav, setActiveNav] = useState("Libreria");
  const [filter, setFilter] = useState<"all" | MediaType>("all");
  const [sort, setSort] = useState<"recent" | "name">("recent");
  const [view, setView] = useState<"grid" | "compact">("grid");
  const [items, setItems] = useState<MediaItem[]>(demoMedia);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [inspected, setInspected] = useState<MediaItem | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [quickMode, setQuickMode] = useState(false);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const visibleItems = useMemo(() => {
    let result = filter === "all" ? [...items] : items.filter((item) => item.type === filter);
    if (activeNav === "Preferiti") result = result.filter((item) => item.favorite);
    if (activeNav === "Da catalogare") result = result.filter((item) => !item.tags.length || item.status === "processing");
    if (activeNav === "Recenti") result = result.slice(0, 7);
    if (sort === "name") result.sort((a, b) => a.title.localeCompare(b.title));
    return result;
  }, [activeNav, filter, items, sort]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isTyping = target.tagName === "INPUT" || target.tagName === "TEXTAREA";
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
      if (!isTyping && event.key.toLowerCase() === "u") setUploadOpen(true);
      if (!isTyping && event.key.toLowerCase() === "q") setQuickMode((value) => !value);
      if (event.key === "Escape") {
        setUploadOpen(false);
        setCommandOpen(false);
        setQuickMode(false);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/media?take=80")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { items?: PersistedMedia[] } | null) => {
        if (!active || !payload?.items?.length) return;
        const persisted = payload.items.map((item) => persistedToMedia(item));
        setItems((current) => {
          const persistedIds = new Set(persisted.map((item) => item.id));
          return [...persisted, ...current.filter((item) => !persistedIds.has(item.id))];
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const updateItem = (id: string, updater: (item: MediaItem) => MediaItem) => {
    setItems((current) => current.map((item) => (item.id === id ? updater(item) : item)));
    setInspected((current) => (current?.id === id ? updater(current) : current));
  };

  const toggleFavorite = (item: MediaItem, event?: MouseEvent) => {
    event?.stopPropagation();
    updateItem(item.id, (current) => ({ ...current, favorite: !current.favorite }));
  };

  const toggleSelect = (item: MediaItem, event: MouseEvent) => {
    event.stopPropagation();
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  };

  const addTag = (item: MediaItem, tag: string, event?: MouseEvent) => {
    event?.stopPropagation();
    updateItem(item.id, (current) => ({
      ...current,
      tags: current.tags.includes(tag) ? current.tags : [...current.tags, tag]
    }));
    setToast(`“${tag}” aggiunto a ${item.title}`);
  };

  const addTagToSelection = (tag: string) => {
    setItems((current) =>
      current.map((item) =>
        selectedIds.has(item.id) && !item.tags.includes(tag)
          ? { ...item, tags: [...item.tags, tag] }
          : item
      )
    );
    setToast(`“${tag}” aggiunto a ${selectedIds.size} media`);
  };

  const handleUpload = (files: File[]) => {
    const created = files.map((file, index): MediaItem => ({
      id: `local-${Date.now()}-${index}`,
      title: file.name.replace(/\.[^/.]+$/, ""),
      type: file.type.startsWith("video") ? "video" : "image",
      src: URL.createObjectURL(file),
      accent: "#817A70",
      duration: file.type.startsWith("video") ? "—" : undefined,
      dimensions: "Analisi in corso",
      size: formatBytes(file.size),
      date: "adesso",
      people: [],
      tags: [],
      group: "Da catalogare",
      status: "processing",
      aspect: "landscape"
    }));
    setItems((current) => [...created, ...current]);
    setToast(`${files.length} ${files.length === 1 ? "file importato" : "file importati"} · elaborazione avviata`);

    created.forEach((item, index) => {
      window.setTimeout(() => {
        updateItem(item.id, (current) => ({
          ...current,
          status: "ready",
          duration: current.type === "video" ? "00:36" : undefined,
          dimensions: current.type === "video" ? "3840 × 2160" : "6000 × 4000"
        }));
      }, 4600 + index * 700);
    });

    files.forEach((file, index) => {
      const localItem = created[index];
      const body = new FormData();
      body.append("file", file);
      void fetch("/api/media", { method: "POST", body })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: { item?: PersistedMedia } | null) => {
          if (!payload?.item || payload.item.id === localItem.id || !payload.item.createdAt) return;
          const serverItem = persistedToMedia(payload.item, localItem.src);
          setItems((current) =>
            current.map((item) => (item.id === localItem.id ? serverItem : item))
          );

          const poll = (attempt: number) => {
            if (attempt > 12) return;
            window.setTimeout(() => {
              void fetch(`/api/media/${payload.item?.id}`)
                .then((response) => (response.ok ? response.json() : null))
                .then((fresh: { item?: PersistedMedia } | null) => {
                  if (!fresh?.item) return;
                  const updated = persistedToMedia(fresh.item, localItem.src);
                  setItems((current) =>
                    current.map((item) => (item.id === updated.id ? updated : item))
                  );
                  if (fresh.item.status === "PROCESSING" || fresh.item.status === "UPLOADING") {
                    poll(attempt + 1);
                  }
                })
                .catch(() => undefined);
            }, 1500);
          };
          poll(0);
        })
        .catch(() => undefined);
    });
  };

  const navigate = (value: string) => {
    if (value === "Cerca") {
      setCommandOpen(true);
      return;
    }
    setActiveNav(value);
    setMobileSidebar(false);
  };

  return (
    <div className={inspected ? "app-shell has-inspector" : "app-shell"}>
      <div className={mobileSidebar ? "sidebar-drawer is-open" : "sidebar-drawer"}>
        <Sidebar active={activeNav} onNavigate={navigate} onUpload={() => setUploadOpen(true)} />
        <button className="drawer-scrim" onClick={() => setMobileSidebar(false)} aria-label="Chiudi menu" />
      </div>

      <Topbar
        onCommand={() => setCommandOpen(true)}
        onUpload={() => setUploadOpen(true)}
        onMobileMenu={() => setMobileSidebar(true)}
      />

      <main className="main-content">
        <section className="page-intro">
          <div>
            <p className="eyebrow">LUNEDÌ, 28 LUGLIO</p>
            <h1>
              La tua libreria, <em>viva.</em>
            </h1>
            <p className="page-subtitle">
              2.486 ricordi, già ordinati e pronti da rivivere.
            </p>
          </div>
          <div className="library-metrics">
            <div>
              <strong>2.486</strong>
              <span>Media</span>
            </div>
            <i />
            <div>
              <strong>184</strong>
              <span>Video</span>
            </div>
            <i />
            <div>
              <strong>42</strong>
              <span>Persone</span>
            </div>
          </div>
        </section>

        <StatusRail />

        <section className="library-toolbar">
          <div className="filter-tabs">
            {[
              { value: "all", label: "Tutti", count: 2486 },
              { value: "image", label: "Foto", count: 2302 },
              { value: "video", label: "Video", count: 184 }
            ].map((entry) => (
              <button
                className={filter === entry.value ? "is-active" : ""}
                key={entry.value}
                onClick={() => setFilter(entry.value as typeof filter)}
              >
                {entry.label}
                <span>{entry.count.toLocaleString("it-IT")}</span>
              </button>
            ))}
          </div>
          <div className="toolbar-actions">
            <button
              className={quickMode ? "quick-mode is-active" : "quick-mode"}
              onClick={() => setQuickMode((value) => !value)}
            >
              <Zap size={16} fill={quickMode ? "currentColor" : "none"} />
              Catalogazione rapida
              <kbd>Q</kbd>
            </button>
            <button className="tool-button">
              <SlidersHorizontal size={16} />
              Filtra
              <span>2</span>
            </button>
            <button
              className="tool-button sort-button"
              onClick={() => setSort((value) => (value === "recent" ? "name" : "recent"))}
            >
              <ArrowDownUp size={16} />
              {sort === "recent" ? "Più recenti" : "Nome"}
              <ChevronDown size={14} />
            </button>
            <div className="view-switch">
              <button
                className={view === "grid" ? "is-active" : ""}
                onClick={() => setView("grid")}
                aria-label="Vista griglia"
              >
                <Grid2X2 size={16} />
              </button>
              <button
                className={view === "compact" ? "is-active" : ""}
                onClick={() => setView("compact")}
                aria-label="Vista compatta"
              >
                <List size={17} />
              </button>
            </div>
          </div>
        </section>

        {activeNav !== "Libreria" ? (
          <div className="context-banner">
            <div>
              {activeNav === "Persone" ? <UsersRound size={20} /> : null}
              {activeNav === "Tag" ? <Tag size={20} /> : null}
              {activeNav === "Gruppi" ? <Layers3 size={20} /> : null}
              {["Recenti", "Preferiti", "Da catalogare"].includes(activeNav) ? <Sparkles size={20} /> : null}
              <span>
                <strong>{activeNav}</strong>
                <small>{visibleItems.length} elementi nella vista corrente</small>
              </span>
            </div>
            <button onClick={() => setActiveNav("Libreria")}>
              Torna alla libreria
              <X size={15} />
            </button>
          </div>
        ) : null}

        {quickMode ? (
          <div className="quick-mode-banner">
            <span><Zap size={17} fill="currentColor" /></span>
            <p>
              <strong>Catalogazione rapida attiva</strong>
              Passa sui media e usa <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> per assegnare tag senza interrompere il flusso.
            </p>
            <button onClick={() => setQuickMode(false)}>Fine</button>
          </div>
        ) : null}

        <section className={view === "compact" ? "media-grid is-compact" : "media-grid"}>
          {visibleItems.map((item) => (
            <MediaCard
              item={item}
              selected={selectedIds.has(item.id)}
              quickMode={quickMode}
              onOpen={setInspected}
              onSelect={toggleSelect}
              onFavorite={toggleFavorite}
              onQuickTag={addTag}
              key={item.id}
            />
          ))}
        </section>

        {!visibleItems.length ? (
          <section className="empty-state">
            <Archive size={28} />
            <h2>Nessun media qui, per ora.</h2>
            <p>Prova un altro filtro oppure importa qualcosa di nuovo.</p>
            <button onClick={() => setUploadOpen(true)}>
              <Plus size={17} />
              Importa media
            </button>
          </section>
        ) : null}

        <footer className="content-footer">
          <span>Mostrati {visibleItems.length} di 2.486 media</span>
          <button>Carica altri</button>
        </footer>
      </main>

      {inspected ? (
        <Inspector
          item={inspected}
          onClose={() => setInspected(null)}
          onFavorite={() => toggleFavorite(inspected)}
          onAddTag={(tag) => addTag(inspected, tag)}
        />
      ) : null}

      {selectedIds.size ? (
        <BulkToolbar
          count={selectedIds.size}
          onClear={() => setSelectedIds(new Set())}
          onAddTag={addTagToSelection}
        />
      ) : null}

      {uploadOpen ? <UploadModal onClose={() => setUploadOpen(false)} onUpload={handleUpload} /> : null}
      {commandOpen ? (
        <CommandPalette
          onClose={() => setCommandOpen(false)}
          onOpenItem={(item) => setInspected(item)}
        />
      ) : null}
      {toast ? (
        <div className="toast">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      ) : null}
      <MobileNav active={activeNav} onNavigate={navigate} onUpload={() => setUploadOpen(true)} />
    </div>
  );
}
