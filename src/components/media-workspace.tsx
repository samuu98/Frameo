"use client";

import {
  Archive,
  ArrowDownUp,
  Bell,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Command,
  CopyCheck,
  Download,
  Film,
  Folder,
  FolderInput,
  Grid2X2,
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
  PencilLine,
  Play,
  Plus,
  Search,
  Scissors,
  Settings,
  Shield,
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
import { demoMedia } from "@/data/media";
import {
  emptyAdvancedFilters,
  type AdvancedFilterState,
  type HighlightMarker,
  type MediaItem,
  type MediaType,
  type PersistedMediaRecord
} from "@/types/media";
import {
  AdvancedFilters,
  countAdvancedFilters
} from "@/components/advanced-filters";
import { DuplicatesPanel } from "@/components/duplicates-panel";
import { FrameCaptureModal } from "@/components/frame-capture-modal";
import { HighlightsPlayer } from "@/components/highlights-player";
import { OrganizeFilesModal } from "@/components/organize-files-modal";
import { UserManagement } from "@/components/user-management";
import { VideoEditorModal } from "@/components/video-editor-modal";

const navItems = [
  { label: "Libreria", icon: LayoutGrid },
  { label: "Recenti", icon: Clock3 },
  { label: "Preferiti", icon: Heart },
  { label: "Da catalogare", icon: Inbox }
];

const organizeItems = [
  { label: "Persone", icon: UsersRound },
  { label: "Tag", icon: Tag },
  { label: "Gruppi", icon: Layers3 }
];

const adminItems = [
  { label: "Duplicati", icon: CopyCheck },
  { label: "Utenti & accessi", icon: Shield }
];

const formatBytes = (bytes: number) => {
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
};

const formatDuration = (milliseconds: number | null) => {
  if (!milliseconds) return "—";
  const totalSeconds = Math.round(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const persistedToMedia = (item: PersistedMediaRecord, fallbackSrc?: string): MediaItem => ({
  id: item.id,
  title: item.title,
  type: item.kind === "VIDEO" ? "video" : "image",
  src: item.thumbnailUrl ?? item.previewUrl ?? fallbackSrc ?? item.originalUrl,
  previewUrl: item.previewUrl,
  originalUrl: item.originalUrl,
  streamUrl: item.streamUrl,
  accent: item.dominantColor ?? "#817A70",
  duration: item.kind === "VIDEO" ? formatDuration(item.durationMs) : undefined,
  durationMs: item.durationMs,
  frameRate: item.frameRate,
  dimensions:
    item.width && item.height ? `${item.width} × ${item.height}` : "Analisi in corso",
  size: formatBytes(Number(item.bytes)),
  date: new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(item.createdAt)),
  createdAt: item.createdAt,
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
  markers: item.markers ?? [],
  duplicateCount: item.duplicateCount ?? 0,
  sourceFileName: item.sourceFileName ?? undefined,
  sourceMediaId: item.sourceMediaId,
  sourceTimeMs: item.sourceTimeMs,
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
  onUpload,
  people,
  uncataloguedCount,
  duplicateCount
}: {
  active: string;
  onNavigate: (item: string) => void;
  onUpload: () => void;
  people: string[];
  uncataloguedCount: number;
  duplicateCount: number;
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
        {navItems.map(({ label, icon: Icon }) => (
          <button
            className={active === label ? "nav-item is-active" : "nav-item"}
            key={label}
            onClick={() => onNavigate(label)}
          >
            <Icon size={18} />
            <span>{label}</span>
            {label === "Da catalogare" && uncataloguedCount ? <em>{uncataloguedCount}</em> : null}
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

        <p className="nav-caption nav-caption-spaced">Amministra</p>
        {adminItems.map(({ label, icon: Icon }) => (
          <button
            className={active === label ? "nav-item is-active" : "nav-item"}
            key={label}
            onClick={() => onNavigate(label)}
          >
            <Icon size={18} />
            <span>{label}</span>
            {label === "Duplicati" && duplicateCount ? <em>{duplicateCount}</em> : null}
          </button>
        ))}
      </nav>

      {people.length ? <div className="sidebar-people">
        <div className="sidebar-section-title">
          <span>Volti frequenti</span>
          <button aria-label="Vedi tutte le persone">
            <ChevronRight size={15} />
          </button>
        </div>
        <div className="avatar-stack">
          {people.slice(0, 4).map((person) => (
            <button key={person} title={person} aria-label={person}>
              <span className="avatar-initials">{person.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span>
            </button>
          ))}
          {people.length > 4 ? <span>+{people.length - 4}</span> : null}
        </div>
      </div> : null}

      <div className="sidebar-footer">
        <button>
          <CircleHelp size={17} />
          Aiuto
        </button>
        <button>
          <Settings size={17} />
          Impostazioni
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

function StatusRail({ items }: { items: MediaItem[] }) {
  const processing = items.filter((item) => item.status === "processing");
  if (!processing.length) return null;

  return (
    <section className="status-rail" aria-label="Stato elaborazione">
      <div className="status-copy">
        <span className="status-icon">
          <LoaderCircle size={17} />
        </span>
        <div>
          <strong>{processing.length} media in elaborazione</strong>
          <p>{processing[0]?.title}</p>
        </div>
      </div>
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
  quickTags,
  onOpen,
  onSelect,
  onFavorite,
  onQuickTag
}: {
  item: MediaItem;
  selected: boolean;
  quickMode: boolean;
  quickTags: Array<{ name: string; color: string }>;
  onOpen: (item: MediaItem) => void;
  onSelect: (item: MediaItem, event: MouseEvent) => void;
  onFavorite: (item: MediaItem, event: MouseEvent) => void;
  onQuickTag: (item: MediaItem, tag: string, event: MouseEvent) => void;
}) {
  const isProcessing = item.status === "processing";
  const hoverVideoRef = useRef<HTMLVideoElement>(null);

  return (
    <article
      className={[
        "media-card",
        `is-${item.aspect}`,
        selected ? "is-selected" : "",
        isProcessing ? "is-processing" : ""
      ].join(" ")}
      onClick={() => (quickMode ? undefined : onOpen(item))}
      onMouseEnter={() => {
        if (hoverVideoRef.current) {
          hoverVideoRef.current.currentTime = 0;
          void hoverVideoRef.current.play().catch(() => undefined);
        }
      }}
      onMouseLeave={() => {
        if (hoverVideoRef.current) {
          hoverVideoRef.current.pause();
          hoverVideoRef.current.currentTime = 0;
        }
      }}
    >
      <div className="media-visual" style={{ backgroundColor: item.accent }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.src} alt="" loading="lazy" />
        {item.type === "video" && item.previewUrl ? (
          <video
            ref={hoverVideoRef}
            className="hover-video-preview"
            src={item.previewUrl}
            poster={item.src}
            muted
            loop
            playsInline
            preload="metadata"
          />
        ) : null}
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
          </div>
        ) : null}

        <div className="media-bottomline">
          {item.duration ? <span>{item.duration}</span> : <span>{item.dimensions}</span>}
          {item.type === "video" && item.markers?.length ? (
            <span className="marker-count"><Sparkles size={11} /> {item.markers.length}</span>
          ) : null}
          {item.duplicateCount ? (
            <span className="duplicate-count"><CopyCheck size={11} /> {item.duplicateCount}</span>
          ) : null}
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
            {item.people.slice(0, 3).map((name) => (
              <span key={name} title={name}>
                {name.split(" ").map((part) => part[0]).join("").slice(0, 2)}
              </span>
            ))}
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
  onAddTag,
  onAddMarker,
  onEdit,
  onRename,
  onCapture
}: {
  item: MediaItem;
  onClose: () => void;
  onFavorite: () => void;
  onAddTag: (tag: string) => void;
  onAddMarker: (marker: HighlightMarker) => void;
  onEdit: () => void;
  onRename: (name: string) => void;
  onCapture: (positionMs: number) => void;
}) {
  const [tab, setTab] = useState<"info" | "organizza" | "attivita">("info");
  const [playing, setPlaying] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [markerOpen, setMarkerOpen] = useState(false);
  const [markerLabel, setMarkerLabel] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(item.title);
  const [currentPosition, setCurrentPosition] = useState(
    Math.min(18_000, item.durationMs ?? 18_000)
  );

  useEffect(() => {
    setRenameValue(item.title);
    setRenameOpen(false);
  }, [item.id, item.title]);

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
        {playing && item.type === "video" && (item.originalUrl || item.previewUrl) ? (
          <video
            src={item.originalUrl ?? item.previewUrl ?? undefined}
            poster={item.src}
            autoPlay
            muted
            playsInline
            onTimeUpdate={(event) => setCurrentPosition(event.currentTarget.currentTime * 1000)}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.src} alt={item.title} />
        )}
        {item.type === "video" ? (
          <button className="preview-play" onClick={() => setPlaying((value) => !value)}>
            {playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}
          </button>
        ) : null}
        <div className="preview-actions">
          {item.type === "video" ? (
            <button onClick={() => onCapture(currentPosition)} aria-label="Cattura fotogramma">
              <Camera size={17} />
            </button>
          ) : null}
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
        <div className="inspector-timeline-shell">
          <div className="timeline">
            <span>{formatDuration(currentPosition)}</span>
            <div>
              {Array.from({ length: 22 }).map((_, index) => (
                <i
                  key={index}
                  style={{ height: `${8 + ((index * 7) % 16)}px` }}
                  className={index / 22 < currentPosition / (item.durationMs ?? 60_000) ? "is-passed" : ""}
                />
              ))}
              {(item.markers ?? []).map((marker) => (
                <button
                  className="timeline-marker"
                  key={marker.id}
                  style={{
                    left: `${Math.min(100, (marker.startMs / (item.durationMs ?? 60_000)) * 100)}%`,
                    background: marker.color
                  }}
                  title={`${marker.label} · ${formatDuration(marker.startMs)}`}
                  onClick={() => setCurrentPosition(marker.startMs)}
                />
              ))}
            </div>
            <span>{item.duration}</span>
          </div>
          <div className="marker-toolbar">
            <div>
              {(item.markers ?? []).slice(0, 3).map((marker) => (
                <button key={marker.id} onClick={() => setCurrentPosition(marker.startMs)}>
                  <i style={{ background: marker.color }} />
                  {marker.label}
                  <span>{formatDuration(marker.startMs)}</span>
                </button>
              ))}
            </div>
            <button className="add-marker-button" onClick={() => setMarkerOpen((value) => !value)}>
              <Plus size={14} /> Marker
            </button>
          </div>
          {markerOpen ? (
            <form
              className="marker-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!markerLabel.trim()) return;
                onAddMarker({
                  id: `local-marker-${Date.now()}`,
                  label: markerLabel.trim(),
                  startMs: Math.round(currentPosition),
                  endMs: Math.min(
                    Math.round(currentPosition + 6500),
                    item.durationMs ?? currentPosition + 6500
                  ),
                  color: "#6D5DFB",
                  featured: true
                });
                setMarkerLabel("");
                setMarkerOpen(false);
              }}
            >
              <Sparkles size={15} />
              <input
                autoFocus
                value={markerLabel}
                onChange={(event) => setMarkerLabel(event.target.value)}
                placeholder={`Titolo marker a ${formatDuration(currentPosition)}`}
              />
              <button type="submit">Aggiungi</button>
            </form>
          ) : null}
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
        {item.type === "video" ? (
          <div className="inspector-video-tools">
            <button className="capture-frame-from-inspector" onClick={() => onCapture(currentPosition)}>
              <Camera size={15} />
              Cattura fotogramma
              <span>FRAME LAB</span>
            </button>
            <button className="open-editor-from-inspector" onClick={onEdit}>
              <Scissors size={15} />
              Apri nell’editor leggero
              <ChevronRight size={15} />
            </button>
          </div>
        ) : null}
        {tab === "info" ? (
          <>
            <section className="detail-section">
              <div className="detail-section-title">
                <h3>Dettagli file</h3>
                <button onClick={() => setRenameOpen((value) => !value)}>
                  <PencilLine size={13} /> Rinomina file
                </button>
              </div>
              {renameOpen ? (
                <form
                  className="rename-file-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!renameValue.trim() || renameValue.trim() === item.title) {
                      setRenameOpen(false);
                      return;
                    }
                    onRename(renameValue.trim());
                    setRenameOpen(false);
                  }}
                >
                  <PencilLine size={14} />
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    aria-label="Nuovo nome del file"
                  />
                  <span>{item.sourceFileName?.match(/\.[^.]+$/)?.[0] ?? (item.type === "video" ? ".mp4" : "")}</span>
                  <button type="submit">Salva</button>
                </form>
              ) : null}
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
                  {item.people.map((name) => (
                      <div key={name}>
                        <span>{name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span>
                        <p>
                          <strong>{name}</strong>
                          <small>Rilevamento confermato</small>
                        </p>
                        <CheckCircle2 size={16} />
                      </div>
                  ))}
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
                  <small>Gruppo assegnato</small>
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
                <strong>{item.status === "ready" ? "Media disponibile" : "Elaborazione in corso"}</strong>
                <small>{item.sourceFileName ?? item.title}</small>
                <time>{item.date}</time>
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
  onOpenItem,
  items
}: {
  onClose: () => void;
  onOpenItem: (item: MediaItem) => void;
  items: MediaItem[];
}) {
  const [query, setQuery] = useState("");
  const results = items
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
                <p><strong>Gestisci persone</strong><small>Organizza i volti della libreria</small></p>
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
  onAddTag,
  onEdit,
  onOrganize
}: {
  count: number;
  onClear: () => void;
  onAddTag: (tag: string) => void;
  onEdit: () => void;
  onOrganize: () => void;
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
      <button onClick={onOrganize}>
        <FolderInput size={16} />
        Filesystem
      </button>
      <button onClick={onEdit}>
        <Scissors size={16} />
        Editor
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
  const [items, setItems] = useState<MediaItem[]>([]);
  const [taxonomyPeople, setTaxonomyPeople] = useState<string[]>([]);
  const [taxonomyTags, setTaxonomyTags] = useState<Array<{ name: string; color: string }>>([]);
  const [taxonomyGroups, setTaxonomyGroups] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [inspected, setInspected] = useState<MediaItem | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [quickMode, setQuickMode] = useState(false);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilterState>(
    emptyAdvancedFilters
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [highlightsOpen, setHighlightsOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [organizerOpen, setOrganizerOpen] = useState(false);
  const [captureRequest, setCaptureRequest] = useState<{
    item: MediaItem;
    initialTimeMs: number;
  } | null>(null);

  const visibleItems = useMemo(() => {
    let result = filter === "all" ? [...items] : items.filter((item) => item.type === filter);
    if (activeNav === "Preferiti") result = result.filter((item) => item.favorite);
    if (activeNav === "Da catalogare") result = result.filter((item) => !item.tags.length || item.status === "processing");
    if (activeNav === "Recenti") result = result.slice(0, 7);
    if (advancedFilters.people.length) {
      result = result.filter((item) =>
        advancedFilters.people.some((person) => item.people.includes(person))
      );
    }
    if (advancedFilters.tags.length) {
      result = result.filter((item) =>
        advancedFilters.tags.some((tag) => item.tags.includes(tag))
      );
    }
    if (advancedFilters.groups.length) {
      result = result.filter((item) => advancedFilters.groups.includes(item.group));
    }
    if (advancedFilters.duration !== "any") {
      result = result.filter((item) => {
        if (item.type !== "video") return false;
        const duration = item.durationMs ?? 0;
        if (advancedFilters.duration === "short") return duration < 60_000;
        if (advancedFilters.duration === "medium") return duration >= 60_000 && duration <= 300_000;
        return duration > 300_000;
      });
    }
    if (advancedFilters.resolution !== "any") {
      result = result.filter((item) => {
        const width = Number.parseInt(item.dimensions.split("×")[0]?.trim() ?? "0", 10);
        if (advancedFilters.resolution === "4k") return width >= 3840;
        if (advancedFilters.resolution === "hd") return width >= 1280 && width < 3840;
        return width > 0 && width < 1280;
      });
    }
    if (advancedFilters.status !== "any") {
      result = result.filter((item) => item.status === advancedFilters.status);
    }
    if (advancedFilters.markerOnly) {
      result = result.filter((item) => Boolean(item.markers?.length));
    }
    if (advancedFilters.duplicateOnly) {
      result = result.filter((item) => Boolean(item.duplicateCount));
    }
    if (advancedFilters.favoriteOnly) {
      result = result.filter((item) => item.favorite);
    }
    if (advancedFilters.dateFrom) {
      result = result.filter((item) => !item.createdAt || item.createdAt >= `${advancedFilters.dateFrom}T00:00:00`);
    }
    if (advancedFilters.dateTo) {
      result = result.filter((item) => !item.createdAt || item.createdAt <= `${advancedFilters.dateTo}T23:59:59`);
    }
    if (sort === "name") result.sort((a, b) => a.title.localeCompare(b.title));
    return result;
  }, [activeNav, advancedFilters, filter, items, sort]);

  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(item.id)),
    [items, selectedIds]
  );
  const advancedFilterCount = countAdvancedFilters(advancedFilters);
  const imageCount = items.filter((item) => item.type === "image").length;
  const videoCount = items.filter((item) => item.type === "video").length;
  const uncataloguedCount = items.filter((item) => !item.tags.length || item.status === "processing").length;
  const duplicateCount = items.reduce((total, item) => total + (item.duplicateCount ?? 0), 0);

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
      if (!isTyping && event.key.toLowerCase() === "h") setHighlightsOpen(true);
      if (event.key === "Escape") {
        setUploadOpen(false);
        setCommandOpen(false);
        setQuickMode(false);
        setFiltersOpen(false);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/media?take=80")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { items?: PersistedMediaRecord[]; mode?: string } | null) => {
        if (!active || !Array.isArray(payload?.items)) return;
        setItems(payload.mode === "demo"
          ? demoMedia
          : payload.items.map((item) => persistedToMedia(item)));
      })
      .catch(() => undefined);
    void fetch("/api/taxonomy")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: {
        people?: Array<string | { name: string }>;
        tags?: Array<string | { name: string; color?: string | null }>;
        groups?: Array<string | { name: string }>;
      } | null) => {
        if (!active || !payload) return;
        setTaxonomyPeople((payload.people ?? []).map((entry) => typeof entry === "string" ? entry : entry.name));
        setTaxonomyTags((payload.tags ?? []).map((entry) => typeof entry === "string"
          ? { name: entry, color: "#6D5DFB" }
          : { name: entry.name, color: entry.color ?? "#6D5DFB" }));
        setTaxonomyGroups((payload.groups ?? []).map((entry) => typeof entry === "string" ? entry : entry.name));
      })
      .catch(() => undefined);
    void fetch("/api/users")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { onboarding?: boolean } | null) => {
        if (active && payload?.onboarding) setActiveNav("Utenti & accessi");
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

  const addMarker = (item: MediaItem, marker: HighlightMarker) => {
    updateItem(item.id, (current) => ({
      ...current,
      markers: [...(current.markers ?? []), marker]
    }));
    setToast(`Momento “${marker.label}” aggiunto a ${item.title}`);
    void fetch(`/api/media/${item.id}/markers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(marker)
    }).catch(() => undefined);
  };

  const renameFile = (item: MediaItem, name: string) => {
    const previousTitle = item.title;
    updateItem(item.id, (current) => ({ ...current, title: name }));
    setToast(`Rinomina di “${previousTitle}” in corso…`);
    void fetch("/api/files/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mediaId: item.id, name, confirm: true })
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as {
          error?: string;
          media?: { sourceFileName?: string };
        } | null;
        if (!response.ok) throw new Error(payload?.error ?? "Rinomina non riuscita");
        updateItem(item.id, (current) => ({
          ...current,
          title: name,
          sourceFileName: payload?.media?.sourceFileName ?? current.sourceFileName
        }));
        setToast(`File rinominato in “${name}”`);
      })
      .catch((error) => {
        updateItem(item.id, (current) => ({ ...current, title: previousTitle }));
        setToast(error instanceof Error ? error.message : "Rinomina non riuscita");
      });
  };

  const addCapturedFrame = (record: PersistedMediaRecord) => {
    const captured = persistedToMedia(record);
    setItems((current) => [
      captured,
      ...current.filter((item) => item.id !== captured.id)
    ]);
    setToast(`“${captured.title}” salvato nella libreria`);
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

    files.forEach((file, index) => {
      const localItem = created[index];
      const body = new FormData();
      body.append("file", file);
      void fetch("/api/media", { method: "POST", body })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: { item?: PersistedMediaRecord } | null) => {
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
                .then((fresh: { item?: PersistedMediaRecord } | null) => {
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
        <Sidebar
          active={activeNav}
          people={taxonomyPeople}
          uncataloguedCount={uncataloguedCount}
          duplicateCount={duplicateCount}
          onNavigate={navigate}
          onUpload={() => setUploadOpen(true)}
        />
        <button className="drawer-scrim" onClick={() => setMobileSidebar(false)} aria-label="Chiudi menu" />
      </div>

      <Topbar
        onCommand={() => setCommandOpen(true)}
        onUpload={() => setUploadOpen(true)}
        onMobileMenu={() => setMobileSidebar(true)}
      />

      <main className="main-content">
        {activeNav === "Utenti & accessi" ? (
          <UserManagement />
        ) : activeNav === "Duplicati" ? (
          <DuplicatesPanel />
        ) : (
          <>
        <section className="page-intro">
          <div>
            <p className="eyebrow">ARCHIVIO PERSONALE</p>
            <h1>
              La tua libreria, <em>viva.</em>
            </h1>
            <p className="page-subtitle">
              {items.length ? `${items.length} media nel tuo archivio.` : "Il tuo archivio è pronto per il primo contenuto."}
            </p>
          </div>
          <div className="library-metrics">
            <div>
              <strong>{items.length.toLocaleString("it-IT")}</strong>
              <span>Media</span>
            </div>
            <i />
            <div>
              <strong>{videoCount.toLocaleString("it-IT")}</strong>
              <span>Video</span>
            </div>
            <i />
            <div>
              <strong>{taxonomyPeople.length.toLocaleString("it-IT")}</strong>
              <span>Persone</span>
            </div>
          </div>
        </section>

        <StatusRail items={items} />

        <section className="library-toolbar">
          <div className="filter-tabs">
            {[
              { value: "all", label: "Tutti", count: items.length },
              { value: "image", label: "Foto", count: imageCount },
              { value: "video", label: "Video", count: videoCount }
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
              className="highlights-launch"
              onClick={() => setHighlightsOpen(true)}
              disabled={!visibleItems.some((item) => item.type === "video" && item.markers?.length)}
            >
              <Sparkles size={16} fill="currentColor" />
              Momenti salienti
              <kbd>H</kbd>
            </button>
            <button
              className={quickMode ? "quick-mode is-active" : "quick-mode"}
              onClick={() => setQuickMode((value) => !value)}
            >
              <Zap size={16} fill={quickMode ? "currentColor" : "none"} />
              Catalogazione rapida
              <kbd>Q</kbd>
            </button>
            <button
              className={advancedFilterCount ? "tool-button has-filters" : "tool-button"}
              onClick={() => setFiltersOpen(true)}
            >
              <SlidersHorizontal size={16} />
              Filtra
              {advancedFilterCount ? <span>{advancedFilterCount}</span> : null}
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

        {advancedFilterCount ? (
          <div className="active-filter-bar">
            <span><SlidersHorizontal size={14} /> Filtri attivi</span>
            {[...advancedFilters.people, ...advancedFilters.tags, ...advancedFilters.groups].map((entry) => (
              <button key={entry} onClick={() => setAdvancedFilters((current) => ({
                ...current,
                people: current.people.filter((value) => value !== entry),
                tags: current.tags.filter((value) => value !== entry),
                groups: current.groups.filter((value) => value !== entry)
              }))}>{entry}<X size={12} /></button>
            ))}
            {advancedFilters.markerOnly ? <button onClick={() => setAdvancedFilters((current) => ({ ...current, markerOnly: false }))}>con marker<X size={12} /></button> : null}
            {advancedFilters.duplicateOnly ? <button onClick={() => setAdvancedFilters((current) => ({ ...current, duplicateOnly: false }))}>duplicati<X size={12} /></button> : null}
            {advancedFilters.favoriteOnly ? <button onClick={() => setAdvancedFilters((current) => ({ ...current, favoriteOnly: false }))}>preferiti<X size={12} /></button> : null}
            <button className="clear-active-filters" onClick={() => setAdvancedFilters(emptyAdvancedFilters)}>Azzera tutto</button>
          </div>
        ) : null}

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
              quickTags={taxonomyTags}
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
          <span>Mostrati {visibleItems.length} di {items.length} media</span>
        </footer>
          </>
        )}
      </main>

      {inspected ? (
        <Inspector
          item={inspected}
          onClose={() => setInspected(null)}
          onFavorite={() => toggleFavorite(inspected)}
          onAddTag={(tag) => addTag(inspected, tag)}
          onAddMarker={(marker) => addMarker(inspected, marker)}
          onEdit={() => setEditorOpen(true)}
          onRename={(name) => renameFile(inspected, name)}
          onCapture={(initialTimeMs) => setCaptureRequest({
            item: inspected,
            initialTimeMs
          })}
        />
      ) : null}

      {selectedIds.size ? (
        <BulkToolbar
          count={selectedIds.size}
          onClear={() => setSelectedIds(new Set())}
          onAddTag={addTagToSelection}
          onEdit={() => setEditorOpen(true)}
          onOrganize={() => setOrganizerOpen(true)}
        />
      ) : null}

      {uploadOpen ? <UploadModal onClose={() => setUploadOpen(false)} onUpload={handleUpload} /> : null}
      {commandOpen ? (
        <CommandPalette
          items={items}
          onClose={() => setCommandOpen(false)}
          onOpenItem={(item) => setInspected(item)}
        />
      ) : null}
      {filtersOpen ? (
        <AdvancedFilters
          value={advancedFilters}
          people={taxonomyPeople}
          tags={taxonomyTags.map(({ name }) => name)}
          groups={taxonomyGroups}
          resultCount={visibleItems.length}
          onApply={setAdvancedFilters}
          onClose={() => setFiltersOpen(false)}
        />
      ) : null}
      {highlightsOpen ? (
        <HighlightsPlayer
          items={visibleItems}
          filters={advancedFilters}
          onClose={() => setHighlightsOpen(false)}
          onOpenSource={(item) => {
            setHighlightsOpen(false);
            setInspected(item);
          }}
        />
      ) : null}
      {editorOpen ? (
        <VideoEditorModal
          items={
            selectedItems.some((item) => item.type === "video")
              ? selectedItems
              : inspected?.type === "video"
                ? [inspected]
                : visibleItems.filter((item) => item.type === "video").slice(0, 3)
          }
          onClose={() => setEditorOpen(false)}
          onCreated={setToast}
        />
      ) : null}
      {organizerOpen ? (
        <OrganizeFilesModal
          items={selectedItems.length ? selectedItems : inspected ? [inspected] : []}
          people={taxonomyPeople}
          onClose={() => setOrganizerOpen(false)}
          onComplete={setToast}
        />
      ) : null}
      {captureRequest ? (
        <FrameCaptureModal
          item={captureRequest.item}
          initialTimeMs={captureRequest.initialTimeMs}
          onClose={() => setCaptureRequest(null)}
          onCaptured={addCapturedFrame}
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
