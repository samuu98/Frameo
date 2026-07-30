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
  GalleryVerticalEnd,
  Grid2X2,
  HardDrive,
  Heart,
  Image as ImageIcon,
  ImagePlus,
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
import { LibraryManagement } from "@/components/library-management";
import { PersonReferenceModal } from "@/components/person-reference-modal";

const navItems = [
  { label: "Libreria", icon: LayoutGrid },
  { label: "Recenti", icon: Clock3 },
  { label: "Preferiti", icon: Heart },
  { label: "Da catalogare", icon: Inbox }
];

const organizeItems = [
  { label: "Performer", value: "Persone", icon: UsersRound },
  { label: "Tag", value: "Tag", icon: Tag },
  { label: "Collezioni", value: "Gruppi", icon: Layers3 }
];

const adminItems = [
  { label: "Gestione libreria", icon: HardDrive },
  { label: "Duplicati", icon: CopyCheck },
  { label: "Utenti & accessi", icon: Shield }
];

interface TaxonomyEntry {
  id: string;
  name: string;
  color?: string | null;
  count: number;
  images?: Array<{
    mediaId: string;
    title: string;
    url: string;
  }>;
}

interface TaxonomyGroup {
  id: string;
  name: string;
  color: string;
  count: number;
}

interface FolderOption {
  key: string;
  label: string;
  count: number;
}

interface PersonFacets {
  total: number;
  tags: Array<{ id: string; name: string; color: string; count: number }>;
  groups: Array<{ id: string; name: string; color: string; count: number }>;
}

interface SkippedImportFile {
  file: File;
  reason: string;
}

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

const processingLabels: Record<string, string> = {
  queued: "In coda",
  "image:analyze": "Analisi immagine",
  "image:thumbnail": "Creazione miniatura",
  "image:preview": "Creazione anteprima",
  "video:analyze": "Analisi video e metadati",
  "video:thumbnail": "Estrazione miniatura",
  "video:preview": "Montaggio anteprima rappresentativa",
  "video:stream": "Preparazione streaming HLS",
  finalizing: "Indicizzazione finale",
  "video-hls-and-preview": "Conversione video",
  "image-preview": "Elaborazione immagine"
};

const processingLabel = (operation?: string) =>
  operation ? processingLabels[operation] ?? operation : "Caricamento sul server";

const uploadMedia = (
  file: File,
  importId: string,
  onProgress: (progress: number) => void
) =>
  new Promise<{ item?: PersistedMediaRecord }>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const body = new FormData();
    body.append("file", file);
    request.open("POST", "/api/media");
    request.responseType = "json";
    request.setRequestHeader("x-frameo-import-id", importId);
    request.setRequestHeader("x-frameo-file-name", encodeURIComponent(file.name));
    request.setRequestHeader("x-frameo-file-size", String(file.size));
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
      }
    };
    request.onerror = () => reject(new Error("Connessione interrotta durante l’importazione"));
    request.onabort = () => reject(new Error("Importazione annullata"));
    request.onload = () => {
      const payload = request.response as {
        item?: PersistedMediaRecord;
        error?: string;
      } | null;
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(payload?.error ?? "Importazione non riuscita"));
        return;
      }
      onProgress(100);
      resolve(payload ?? {});
    };
    request.send(body);
  });

const readVideoDuration = (file: File) =>
  new Promise<number | null>((resolve) => {
    if (!file.type.startsWith("video/")) {
      resolve(null);
      return;
    }
    const source = URL.createObjectURL(file);
    const video = document.createElement("video");
    const finish = (value: number | null) => {
      window.clearTimeout(timeout);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(source);
      resolve(value);
    };
    const timeout = window.setTimeout(() => finish(null), 10_000);
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const durationMs = Math.round(video.duration * 1000);
      finish(Number.isFinite(durationMs) && durationMs > 0 ? durationMs : null);
    };
    video.onerror = () => finish(null);
    video.src = source;
  });

const originalAspectRatio = (dimensions: string) => {
  const match = dimensions.match(/^(\d+)\s*[×x]\s*(\d+)$/);
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? `${width} / ${height}` : undefined;
};

const persistedToMedia = (item: PersistedMediaRecord, fallbackSrc?: string): MediaItem => {
  const latestJob = [...(item.jobs ?? [])].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  )[0];

  return {
    id: item.id,
    title: item.title,
    type: item.kind === "VIDEO" ? "video" : "image",
    src: item.thumbnailUrl ?? item.previewUrl ?? fallbackSrc ?? item.originalUrl,
    mimeType: item.mimeType,
    thumbnailUrl: item.thumbnailUrl,
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
    processingStage: latestJob
      ? processingLabel(latestJob.operation)
      : item.status === "READY"
        ? "Completato"
        : "In attesa dell’elaborazione",
    processingProgress: latestJob?.progress ?? (item.status === "READY" ? 100 : 0),
    processingState: latestJob?.state,
    processingError: latestJob?.error,
    aspect:
      item.width && item.height && item.height > item.width * 1.12
        ? "portrait"
        : item.width && item.height && item.width > item.height * 1.45
          ? "wide"
          : "landscape"
  };
};

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
        {organizeItems.map(({ label, value, icon: Icon }) => (
          <button
            className={active === value ? "nav-item is-active" : "nav-item"}
            key={value}
            onClick={() => onNavigate(value)}
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
          <span>Performer frequenti</span>
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
          <p>
            {processing[0]?.processingStage ?? "Caricamento sul server"}
            {typeof processing[0]?.processingProgress === "number"
              ? ` · ${processing[0].processingProgress}%`
              : ""}
          </p>
        </div>
      </div>
      <button aria-label="Apri coda">
        <ChevronRight size={17} />
      </button>
    </section>
  );
}

interface ExternalScanState {
  configured: boolean;
  running: boolean;
  discovered: number;
  supported: number;
  added: number;
  skipped: number;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

function ExternalLibraryRail({
  scan,
  onScan
}: {
  scan: ExternalScanState | null;
  onScan: () => void;
}) {
  if (!scan?.configured) return null;

  return (
    <section className="external-library-rail" aria-label="Libreria esterna">
      <span className={scan.running ? "status-icon is-running" : "status-icon"}>
        {scan.running ? <LoaderCircle size={17} /> : <FolderInput size={17} />}
      </span>
      <div>
        <strong>
          {scan.running
            ? "Indicizzazione disco esterno"
            : scan.error
              ? "Scansione interrotta"
              : "Disco esterno collegato"}
        </strong>
        <p>
          {scan.running
            ? `${scan.supported.toLocaleString("it-IT")} media trovati · ${scan.added.toLocaleString("it-IT")} nuovi`
            : scan.error
              ? scan.error
              : `${scan.added.toLocaleString("it-IT")} nuovi · ${scan.skipped.toLocaleString("it-IT")} già presenti`}
        </p>
      </div>
      <button onClick={onScan} disabled={scan.running}>
        {scan.running ? "Scansione…" : "Scansiona"}
      </button>
    </section>
  );
}

function TaxonomyManager({
  kind,
  entries,
  onCreate,
  onOpen,
  onManageImages
}: {
  kind: "people" | "tags";
  entries: TaxonomyEntry[];
  onCreate: (name: string) => void;
  onOpen: (name: string) => void;
  onManageImages?: (entry: TaxonomyEntry) => void;
}) {
  const [name, setName] = useState("");
  const isPeople = kind === "people";

  return (
    <section className="taxonomy-manager">
      <header>
        <div>
          <span>{isPeople ? <UsersRound size={17} /> : <Tag size={17} />}</span>
          <div>
          <strong>{isPeople ? "Performer" : "Tag"}</strong>
            <small>
              {entries.length
                ? `${entries.length} ${isPeople ? "performer" : "tag"} nel catalogo`
                : `Crea il primo ${isPeople ? "performer" : "tag"}`}
            </small>
          </div>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            onCreate(name.trim());
            setName("");
          }}
        >
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={isPeople ? "Nome performer" : "Nome tag"}
          />
          <button type="submit">
            <Plus size={14} />
            Aggiungi
          </button>
        </form>
      </header>
      {entries.length ? (
        <div className={isPeople ? "taxonomy-grid is-people-grid" : "taxonomy-grid"}>
          {entries.map((entry) => (
            <article className={isPeople ? "person-taxonomy-card" : ""} key={entry.id}>
              {isPeople ? (
                <div className="person-card-images">
                  {(entry.images ?? []).slice(0, 1).map((image) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={image.url} alt="" loading="lazy" key={image.mediaId} />
                  ))}
                  {!entry.images?.length ? (
                    <span>
                      {entry.name
                        .split(" ")
                        .map((part) => part[0])
                        .join("")
                      .slice(0, 2)}
                    </span>
                  ) : null}
                  {(entry.images?.length ?? 0) > 1 ? (
                    <small>+{(entry.images?.length ?? 1) - 1} foto</small>
                  ) : null}
                </div>
              ) : (
                <span style={{ background: entry.color ?? "#8B5CF6" }}>
                  <Tag size={15} />
                </span>
              )}
              <button className="taxonomy-card-open" onClick={() => onOpen(entry.name)}>
                <p>
                  <strong>{entry.name}</strong>
                  <small>{entry.count.toLocaleString("it-IT")} media</small>
                </p>
                <ChevronRight size={15} />
              </button>
              {isPeople ? (
                <button
                  className="manage-person-images"
                  onClick={() => onManageImages?.(entry)}
                >
                  <ImagePlus size={14} />
                  <span>{entry.images?.length ? "Gestisci foto" : "Aggiungi foto"}</span>
                </button>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <div className="taxonomy-empty">
          {isPeople ? <UsersRound size={22} /> : <Tag size={22} />}
          <p>Nessun elemento creato.</p>
        </div>
      )}
    </section>
  );
}

function PersonFacetTabs({
  person,
  facets,
  activeTag,
  activeGroup,
  onAll,
  onTag,
  onGroup
}: {
  person: string;
  facets: PersonFacets | null;
  activeTag?: string;
  activeGroup?: string;
  onAll: () => void;
  onTag: (name: string) => void;
  onGroup: (name: string) => void;
}) {
  return (
    <section className="person-facet-tabs" aria-label={`Sottogruppi di ${person}`}>
      <div>
        <UsersRound size={16} />
        <span><strong>{person}</strong><small>Tag e gruppi collegati</small></span>
      </div>
      <nav>
        <button
          className={!activeTag && !activeGroup ? "is-active" : ""}
          onClick={onAll}
        >
          Tutti <span>{facets?.total ?? "…"}</span>
        </button>
        {facets?.tags.map((tag) => (
          <button
            className={activeTag === tag.name ? "is-active" : ""}
            onClick={() => onTag(tag.name)}
            key={`tag-${tag.id}`}
          >
            <i style={{ background: tag.color }} />
            {tag.name} <span>{tag.count}</span>
          </button>
        ))}
        {facets?.groups.map((group) => (
          <button
            className={activeGroup === group.name ? "is-active" : ""}
            onClick={() => onGroup(group.name)}
            key={`group-${group.id}`}
          >
            <Layers3 size={13} />
            {group.name} <span>{group.count}</span>
          </button>
        ))}
      </nav>
    </section>
  );
}

function TaxonomyAssignmentPicker({
  kind,
  options,
  assignedNames,
  query,
  onQuery,
  onSelect,
  onCreate
}: {
  kind: "people" | "tags" | "groups";
  options: Array<{ id: string; name: string; color?: string | null; count: number }>;
  assignedNames: string[];
  query: string;
  onQuery: (value: string) => void;
  onSelect: (option: { id: string; name: string }) => void;
  onCreate?: (name: string) => void;
}) {
  const normalizedQuery = query.trim().toLocaleLowerCase("it");
  const filtered = options.filter(({ name }) =>
    !normalizedQuery || name.toLocaleLowerCase("it").includes(normalizedQuery)
  );
  const exactMatch = options.some(
    ({ name }) => name.toLocaleLowerCase("it") === normalizedQuery
  );
  const label = kind === "people"
    ? "performer"
    : kind === "tags"
      ? "tag"
      : "gruppi e collezioni";

  return (
    <div className={`taxonomy-assignment-picker is-${kind}`}>
      <label>
        <Search size={15} />
        <input
          autoFocus
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder={`Cerca tra ${options.length} ${label}…`}
        />
        <span>{filtered.length}</span>
      </label>
      <div>
        {filtered.map((option) => {
          const assigned = assignedNames.includes(option.name);
          return (
            <button
              type="button"
              className={assigned ? "is-assigned" : ""}
              onClick={() => {
                if (!assigned) onSelect(option);
              }}
              disabled={assigned}
              key={option.id}
            >
              <i style={{ background: option.color ?? "#6D5DFB" }}>
                {kind === "people"
                  ? option.name.split(" ").map((part) => part[0]).join("").slice(0, 2)
                  : kind === "tags"
                    ? <Tag size={12} />
                    : <Layers3 size={12} />}
              </i>
              <span>
                <strong>{option.name}</strong>
                <small>{option.count.toLocaleString("it-IT")} media</small>
              </span>
              {assigned ? <Check size={15} /> : <Plus size={15} />}
            </button>
          );
        })}
        {!filtered.length ? (
          <p>Nessun risultato per “{query.trim()}”.</p>
        ) : null}
      </div>
      {onCreate && query.trim() && !exactMatch ? (
        <button
          className="create-taxonomy-from-picker"
          type="button"
          onClick={() => onCreate(query.trim())}
        >
          <Plus size={14} /> Crea e assegna “{query.trim()}”
        </button>
      ) : null}
    </div>
  );
}

function MediaCard({
  item,
  selected,
  quickMode,
  quickTags,
  onOpen,
  onOpenLarge,
  onSelect,
  onFavorite,
  onQuickTag
}: {
  item: MediaItem;
  selected: boolean;
  quickMode: boolean;
  quickTags: Array<{ name: string; color: string }>;
  onOpen: (item: MediaItem) => void;
  onOpenLarge: (item: MediaItem) => void;
  onSelect: (item: MediaItem, event: MouseEvent) => void;
  onFavorite: (item: MediaItem, event: MouseEvent) => void;
  onQuickTag: (item: MediaItem, tag: string, event: MouseEvent) => void;
}) {
  const isProcessing = item.status === "processing";
  const hoverVideoRef = useRef<HTMLVideoElement>(null);
  const inlineVideoRef = useRef<HTMLVideoElement>(null);
  const [previewing, setPreviewing] = useState(false);
  const [inlinePlaying, setInlinePlaying] = useState(false);
  const [inlineFallback, setInlineFallback] = useState(false);
  const [visualFailed, setVisualFailed] = useState(false);
  const needsVisualPlaceholder =
    visualFailed || (item.type === "video" && !item.thumbnailUrl);

  useEffect(() => {
    const video = hoverVideoRef.current;
    if (!video || !previewing) return;
    video.currentTime = 0;
    void video.play().catch(() => undefined);
    return () => {
      video.pause();
      video.currentTime = 0;
    };
  }, [previewing]);

  useEffect(() => {
    const video = inlineVideoRef.current;
    if (!video || !inlinePlaying) return;
    void video.play().catch(() => undefined);
    return () => video.pause();
  }, [inlineFallback, inlinePlaying]);

  useEffect(() => {
    setInlinePlaying(false);
    setInlineFallback(false);
  }, [item.id]);

  const inlineSource = inlineFallback
    ? item.previewUrl ?? item.originalUrl ?? item.src
    : item.originalUrl ?? item.previewUrl ?? item.src;

  return (
    <article
      className={[
        "media-card",
        `is-${item.aspect}`,
        selected ? "is-selected" : "",
        isProcessing ? "is-processing" : "",
        inlinePlaying ? "is-inline-playing" : ""
      ].join(" ")}
      onClick={() => (quickMode ? undefined : onOpen(item))}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse" || event.pointerType === "pen") {
          setPreviewing(true);
        }
      }}
      onPointerLeave={() => setPreviewing(false)}
    >
      <div
        className="media-visual"
        style={{
          backgroundColor: item.accent,
          aspectRatio: originalAspectRatio(item.dimensions)
        }}
      >
        {inlinePlaying && item.type === "video" ? (
          <video
            ref={inlineVideoRef}
            className="inline-card-player"
            src={inlineSource}
            poster={item.thumbnailUrl ?? item.src}
            controls
            autoPlay
            playsInline
            preload="metadata"
            onClick={(event) => event.stopPropagation()}
            onError={() => {
              if (!inlineFallback && item.previewUrl) setInlineFallback(true);
            }}
          />
        ) : needsVisualPlaceholder ? (
          <div className="video-card-placeholder">
            {item.type === "video" ? <Film size={28} /> : <ImageIcon size={28} />}
            <span>
              {item.type === "video" ? "Video originale" : "Immagine non disponibile"}
            </span>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.src}
            alt=""
            loading="lazy"
            onError={(event) => {
              if (
                item.type === "image" &&
                item.originalUrl &&
                event.currentTarget.src !== new URL(item.originalUrl, window.location.href).href
              ) {
                event.currentTarget.src = item.originalUrl;
                return;
              }
              setVisualFailed(true);
            }}
          />
        )}
        {item.type === "video" && item.previewUrl && previewing && !inlinePlaying ? (
          <video
            ref={hoverVideoRef}
            className="hover-video-preview"
            src={item.previewUrl}
            poster={item.src}
            muted
            loop
            playsInline
            preload="none"
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

        {item.type === "video" && !isProcessing && !quickMode ? (
          <div className="card-play-actions">
            <button
              className="inline-play-button"
              onClick={(event) => {
                event.stopPropagation();
                setPreviewing(false);
                setInlinePlaying((value) => !value);
              }}
              aria-label={inlinePlaying ? `Ferma ${item.title}` : `Riproduci ${item.title} nella card`}
              title={inlinePlaying ? "Ferma riproduzione" : "Riproduci qui"}
            >
              {inlinePlaying
                ? <Pause size={17} fill="currentColor" />
                : <Play size={17} fill="currentColor" />}
              <span>{inlinePlaying ? "Ferma" : "Riproduci qui"}</span>
            </button>
            <button
              className="large-play-button"
              onClick={(event) => {
                event.stopPropagation();
                inlineVideoRef.current?.pause();
                onOpenLarge(item);
              }}
              aria-label={`Riproduci ${item.title} in grande`}
              title="Apri player grande"
            >
              <Maximize2 size={17} />
              <span>In grande</span>
            </button>
          </div>
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
            <strong>{item.processingStage ?? "Caricamento sul server"}</strong>
            <span>
              <i style={{ width: `${item.processingProgress ?? 8}%` }} />
            </span>
            <small>
              {typeof item.processingProgress === "number"
                ? `${item.processingProgress}%`
                : "Upload in corso"}
            </small>
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
          <p className="catalog-credits">
            <UsersRound size={12} />
            {item.people.length
              ? item.people.slice(0, 3).join(" · ")
              : item.group}
          </p>
          <small className="catalog-meta">
            {item.tags.length
              ? item.tags.slice(0, 3).join(" · ")
              : `${item.date} · ${item.size}`}
          </small>
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

function FullMediaPlayer({
  item,
  onClose
}: {
  item: MediaItem;
  onClose: () => void;
}) {
  const playerRef = useRef<HTMLVideoElement>(null);
  const [fallback, setFallback] = useState(false);
  const originalAvailable = Boolean(item.originalUrl);
  const source = fallback
    ? item.previewUrl ?? item.originalUrl ?? item.src
    : item.originalUrl ?? item.previewUrl ?? item.src;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  return (
    <div className="full-player-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="full-media-player"
        role="dialog"
        aria-modal="true"
        aria-label={`Riproduzione di ${item.title}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span><Film size={15} /> PLAYER GRANDE</span>
            <h2>{item.title}</h2>
          </div>
          <div>
            <em>
              {fallback ? "ANTEPRIMA OTTIMIZZATA" : originalAvailable ? "QUALITÀ ORIGINALE" : "MIGLIORE QUALITÀ DISPONIBILE"}
              {item.dimensions !== "Analisi in corso" ? ` · ${item.dimensions}` : ""}
            </em>
            <button onClick={onClose} aria-label="Chiudi player"><X size={20} /></button>
          </div>
        </header>
        <div className="full-player-stage" style={{ backgroundColor: item.accent }}>
          <video
            ref={playerRef}
            key={source}
            src={source}
            poster={item.thumbnailUrl ?? item.src}
            controls
            autoPlay
            playsInline
            preload="metadata"
            onDoubleClick={() => void playerRef.current?.requestFullscreen?.()}
            onError={() => {
              if (!fallback && item.previewUrl && source !== item.previewUrl) {
                setFallback(true);
              }
            }}
          />
        </div>
        <footer>
          <p>
            {fallback
              ? "Il codec originale non è riproducibile dal browser: sto usando la versione compatibile."
              : "Riproduzione diretta del file originale, senza usare la clip ridotta dell’anteprima."}
          </p>
          <button onClick={() => void playerRef.current?.requestFullscreen?.()}>
            <Maximize2 size={16} /> Schermo intero
          </button>
        </footer>
      </section>
    </div>
  );
}

function Inspector({
  item,
  availablePeople,
  availableTags,
  availableGroups,
  onClose,
  onFavorite,
  onAddTag,
  onRemoveTag,
  onAddPerson,
  onRemovePerson,
  onSetGroup,
  onAddMarker,
  onEdit,
  onRename,
  onCapture
}: {
  item: MediaItem;
  availablePeople: TaxonomyEntry[];
  availableTags: TaxonomyEntry[];
  availableGroups: TaxonomyGroup[];
  onClose: () => void;
  onFavorite: () => void;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onAddPerson: (name: string) => void;
  onRemovePerson: (name: string) => void;
  onSetGroup: (group: TaxonomyGroup) => void;
  onAddMarker: (marker: HighlightMarker) => void;
  onEdit: () => void;
  onRename: (name: string) => void;
  onCapture: (positionMs: number) => void;
}) {
  const [tab, setTab] = useState<"info" | "organizza" | "attivita">("info");
  const [openPicker, setOpenPicker] = useState<"people" | "tags" | "groups" | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");
  const [markerOpen, setMarkerOpen] = useState(false);
  const [markerLabel, setMarkerLabel] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(item.title);
  const playerRef = useRef<HTMLVideoElement>(null);
  const [currentPosition, setCurrentPosition] = useState(
    Math.min(18_000, item.durationMs ?? 18_000)
  );
  const playableSource = item.originalUrl ?? item.previewUrl ?? item.src;

  useEffect(() => {
    setRenameValue(item.title);
    setRenameOpen(false);
    setPickerQuery("");
    setOpenPicker(null);
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
        {item.type === "video" ? (
          <video
            ref={playerRef}
            src={playableSource}
            poster={item.thumbnailUrl ?? undefined}
            controls
            playsInline
            preload="metadata"
            onTimeUpdate={(event) => setCurrentPosition(event.currentTarget.currentTime * 1000)}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.src} alt={item.title} />
        )}
        <div className="preview-actions">
          {item.type === "video" ? (
            <button type="button" onClick={() => onCapture(currentPosition)} aria-label="Cattura fotogramma" title="Cattura fotogramma">
              <Camera size={17} />
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Vista a schermo intero"
            title="Schermo intero"
            onClick={() => {
              const target = playerRef.current ??
                document.querySelector<HTMLElement>(".inspector-preview > img");
              void target?.requestFullscreen?.();
            }}
          >
            <Maximize2 size={17} />
          </button>
          <a
            href={item.originalUrl ?? item.src}
            download={item.sourceFileName ?? item.title}
            aria-label="Scarica originale"
            title="Scarica originale"
          >
            <Download size={17} />
          </a>
          {item.type === "video" ? (
            <button type="button" onClick={onEdit} aria-label="Apri editor" title="Apri editor">
              <Scissors size={17} />
            </button>
          ) : null}
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
        {item.status !== "ready" ? (
          <section className={`processing-detail is-${item.status}`}>
            <div>
              {item.status === "error" ? (
                <Info size={17} />
              ) : (
                <LoaderCircle size={17} />
              )}
              <span>
                <strong>
                  {item.status === "error"
                    ? "Elaborazione non riuscita"
                    : item.processingStage ?? "Caricamento sul server"}
                </strong>
                <small>
                  {item.processingState === "PENDING"
                    ? "In attesa del proprio turno"
                    : item.processingState === "RUNNING"
                      ? "Operazione in esecuzione"
                      : "Preparazione del file"}
                </small>
              </span>
              <b>{item.processingProgress ?? 0}%</b>
            </div>
            <span>
              <i style={{ width: `${item.processingProgress ?? 5}%` }} />
            </span>
            {item.processingError ? <p>{item.processingError}</p> : null}
          </section>
        ) : null}
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
                <button onClick={() => {
                  setOpenPicker((value) => value === "people" ? null : "people");
                  setPickerQuery("");
                }}>
                  <Plus size={14} /> Aggiungi
                </button>
              </div>
              {openPicker === "people" ? (
                <TaxonomyAssignmentPicker
                  kind="people"
                  options={availablePeople}
                  assignedNames={item.people}
                  query={pickerQuery}
                  onQuery={setPickerQuery}
                  onSelect={(option) => {
                    onAddPerson(option.name);
                    setPickerQuery("");
                  }}
                  onCreate={(name) => {
                    onAddPerson(name);
                    setPickerQuery("");
                  }}
                />
              ) : null}
              {item.people.length ? (
                <div className="person-list">
                  {item.people.map((name) => (
                      <div key={name}>
                        <span>{name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span>
                        <p>
                          <strong>{name}</strong>
                          <small>Rilevamento confermato</small>
                        </p>
                        <button
                          onClick={() => onRemovePerson(name)}
                          aria-label={`Rimuovi ${name}`}
                        >
                          <X size={14} />
                        </button>
                      </div>
                  ))}
                </div>
              ) : (
                <button
                  className="empty-organize"
                  onClick={() => {
                    setOpenPicker("people");
                    setPickerQuery("");
                  }}
                >
                  <UserRound size={18} />
                  Assegna una persona
                </button>
              )}
            </section>
            <section className="detail-section">
              <div className="detail-section-title">
                <h3>Tag</h3>
                <button onClick={() => {
                  setOpenPicker((value) => value === "tags" ? null : "tags");
                  setPickerQuery("");
                }}>
                  <Plus size={14} /> Aggiungi
                </button>
              </div>
              {openPicker === "tags" ? (
                <TaxonomyAssignmentPicker
                  kind="tags"
                  options={availableTags}
                  assignedNames={item.tags}
                  query={pickerQuery}
                  onQuery={setPickerQuery}
                  onSelect={(option) => {
                    onAddTag(option.name);
                    setPickerQuery("");
                  }}
                  onCreate={(name) => {
                    onAddTag(name);
                    setPickerQuery("");
                  }}
                />
              ) : null}
              <div className="tag-list">
                {item.tags.map((tag) => (
                  <span key={tag}>
                    {tag}
                    <button onClick={() => onRemoveTag(tag)} aria-label={`Rimuovi ${tag}`}>
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            </section>
            <section className="detail-section">
              <div className="detail-section-title">
                <h3>Gruppo</h3>
                <button onClick={() => {
                  setOpenPicker((value) => value === "groups" ? null : "groups");
                  setPickerQuery("");
                }}>
                  <Layers3 size={14} /> Cambia
                </button>
              </div>
              {openPicker === "groups" ? (
                <TaxonomyAssignmentPicker
                  kind="groups"
                  options={availableGroups}
                  assignedNames={item.group === "Da catalogare" ? [] : [item.group]}
                  query={pickerQuery}
                  onQuery={setPickerQuery}
                  onSelect={(option) => {
                    const group = availableGroups.find(({ id }) => id === option.id);
                    if (group) onSetGroup(group);
                    setOpenPicker(null);
                    setPickerQuery("");
                  }}
                />
              ) : null}
              <button
                className="group-row"
                onClick={() => {
                  setOpenPicker("groups");
                  setPickerQuery("");
                }}
              >
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
                <small>
                  {item.processingStage ?? item.sourceFileName ?? item.title}
                  {typeof item.processingProgress === "number"
                    ? ` · ${item.processingProgress}%`
                    : ""}
                </small>
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
  onUpload: (files: File[], skipped: SkippedImportFile[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [checking, setChecking] = useState(false);
  const [durations, setDurations] = useState<Array<number | null>>([]);
  const [duplicateChecks, setDuplicateChecks] = useState<Array<{
    duplicate: boolean;
    confidence?: "EXACT" | "PROBABLE";
    reason?: string;
    match?: {
      title: string;
      durationMs: number | null;
      importedAt: string;
    } | null;
  }>>([]);
  const [forcedDuplicates, setForcedDuplicates] = useState<Set<number>>(new Set());
  const [checkError, setCheckError] = useState<string | null>(null);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    setFiles((current) => [...current, ...Array.from(list)]);
  };

  useEffect(() => {
    if (!files.length) {
      setDurations([]);
      setDuplicateChecks([]);
      setForcedDuplicates(new Set());
      setCheckError(null);
      return;
    }
    let active = true;
    setChecking(true);
    setCheckError(null);
    setForcedDuplicates(new Set());
    void Promise.all(files.map(readVideoDuration))
      .then(async (measuredDurations) => {
        if (!active) return;
        setDurations(measuredDurations);
        const response = await fetch("/api/media/import-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            files: files.map((file, index) => ({
              name: file.name,
              bytes: file.size,
              durationMs: measuredDurations[index]
            }))
          })
        });
        const payload = (await response.json().catch(() => null)) as {
          results?: typeof duplicateChecks;
          error?: string;
        } | null;
        if (!response.ok || !Array.isArray(payload?.results)) {
          throw new Error(payload?.error ?? "Controllo duplicati non riuscito");
        }
        if (active) setDuplicateChecks(payload.results);
      })
      .catch((error) => {
        if (active) {
          setCheckError(
            error instanceof Error
              ? error.message
              : "Controllo duplicati non riuscito"
          );
        }
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [files]);

  const filesToImport = files.filter(
    (_, index) => !duplicateChecks[index]?.duplicate || forcedDuplicates.has(index)
  );
  const duplicateCount = duplicateChecks.filter(({ duplicate }) => duplicate).length;
  const skippedFiles = files.flatMap((file, index) => {
    const check = duplicateChecks[index];
    return check?.duplicate && !forcedDuplicates.has(index)
      ? [{ file, reason: check.reason ?? "File già presente in libreria" }]
      : [];
  });

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
              <strong>
                {checking
                  ? `Verifica di ${files.length} file…`
                  : `${filesToImport.length} pronti · ${duplicateCount} già presenti`}
              </strong>
              <button onClick={() => setFiles([])}>Rimuovi tutti</button>
            </div>
            {files.slice(0, 8).map((file, index) => {
              const check = duplicateChecks[index];
              const forced = forcedDuplicates.has(index);
              return (
              <div
                className={check?.duplicate && !forced ? "upload-file-row is-duplicate" : "upload-file-row"}
                key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
              >
                <span>{file.type.startsWith("video") ? <Film size={17} /> : <ImageIcon size={17} />}</span>
                <p>
                  <strong>{file.name}</strong>
                  <small>
                    {formatBytes(file.size)}
                    {durations[index] ? ` · ${formatDuration(durations[index])}` : ""}
                    {check?.duplicate
                      ? ` · ${check.confidence === "EXACT" ? "già importato" : "possibile duplicato"}`
                      : ""}
                  </small>
                  {check?.duplicate ? <em>{check.reason}</em> : null}
                </p>
                {checking ? (
                  <LoaderCircle className="is-spinning" size={17} />
                ) : check?.duplicate ? (
                  <button
                    type="button"
                    onClick={() =>
                      setForcedDuplicates((current) => {
                        const next = new Set(current);
                        if (next.has(index)) next.delete(index);
                        else next.add(index);
                        return next;
                      })
                    }
                  >
                    {forced ? "Escludi" : "Importa comunque"}
                  </button>
                ) : (
                  <CheckCircle2 size={17} />
                )}
              </div>
            )})}
            {files.length > 8 ? <small className="more-files">e altri {files.length - 8} file</small> : null}
            {checkError ? <p className="upload-check-error">{checkError}</p> : null}
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
              disabled={!files.length || checking}
              onClick={() => {
                onUpload(filesToImport, skippedFiles);
                onClose();
              }}
            >
              {checking
                ? "Verifica…"
                : filesToImport.length
                  ? `Importa ${filesToImport.length}`
                  : "Conferma verifica"}
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
  tags,
  people,
  groups,
  onClear,
  onAddTag,
  onAddPerson,
  onAddGroup,
  onEdit,
  onOrganize
}: {
  count: number;
  tags: TaxonomyEntry[];
  people: TaxonomyEntry[];
  groups: TaxonomyGroup[];
  onClear: () => void;
  onAddTag: (tag: string) => void;
  onAddPerson: (name: string) => void;
  onAddGroup: (group: TaxonomyGroup) => void;
  onEdit: () => void;
  onOrganize: () => void;
}) {
  const [openPicker, setOpenPicker] = useState<"tags" | "people" | "groups" | null>(null);
  const [query, setQuery] = useState("");

  const togglePicker = (picker: "tags" | "people" | "groups") => {
    setOpenPicker((current) => current === picker ? null : picker);
    setQuery("");
  };

  return (
    <div className="bulk-toolbar">
      <span className="bulk-count">{count}</span>
      <strong>selezionati</strong>
      <i />
      <div className="bulk-taxonomy-action">
        <button onClick={() => togglePicker("tags")} className={openPicker === "tags" ? "is-active" : ""}>
          <Tag size={16} /> Tag <ChevronDown size={13} />
        </button>
        {openPicker === "tags" ? (
          <TaxonomyAssignmentPicker
            kind="tags"
            options={tags}
            assignedNames={[]}
            query={query}
            onQuery={setQuery}
            onSelect={(option) => {
              onAddTag(option.name);
              setOpenPicker(null);
            }}
          />
        ) : null}
      </div>
      <div className="bulk-taxonomy-action">
        <button onClick={() => togglePicker("people")} className={openPicker === "people" ? "is-active" : ""}>
          <UsersRound size={16} /> Performer <ChevronDown size={13} />
        </button>
        {openPicker === "people" ? (
          <TaxonomyAssignmentPicker
            kind="people"
            options={people}
            assignedNames={[]}
            query={query}
            onQuery={setQuery}
            onSelect={(option) => {
              onAddPerson(option.name);
              setOpenPicker(null);
            }}
          />
        ) : null}
      </div>
      <div className="bulk-taxonomy-action">
        <button onClick={() => togglePicker("groups")} className={openPicker === "groups" ? "is-active" : ""}>
          <Layers3 size={16} /> Gruppo <ChevronDown size={13} />
        </button>
        {openPicker === "groups" ? (
          <TaxonomyAssignmentPicker
            kind="groups"
            options={groups}
            assignedNames={[]}
            query={query}
            onQuery={setQuery}
            onSelect={(option) => {
              const group = groups.find(({ id }) => id === option.id);
              if (group) onAddGroup(group);
              setOpenPicker(null);
            }}
          />
        ) : null}
      </div>
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
        { label: "Libreria", value: "Libreria", icon: LayoutGrid },
        { label: "Performer", value: "Persone", icon: UsersRound }
      ].map(({ label, value, icon: Icon }) => (
        <button className={active === value ? "is-active" : ""} key={value} onClick={() => onNavigate(value)}>
          <Icon size={20} />
          <span>{label}</span>
        </button>
      ))}
      <button className="mobile-add" onClick={onUpload} aria-label="Importa">
        <Plus size={23} />
      </button>
      {[
        { label: "Collezioni", value: "Gruppi", icon: Layers3 },
        { label: "Cerca", value: "Cerca", icon: Search }
      ].map(({ label, value, icon: Icon }) => (
        <button className={active === value ? "is-active" : ""} key={value} onClick={() => onNavigate(value)}>
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
  const [view, setView] = useState<"grid" | "compact" | "stories">("grid");
  const [items, setItems] = useState<MediaItem[]>([]);
  const [libraryTotal, setLibraryTotal] = useState(0);
  const [libraryCounts, setLibraryCounts] = useState({
    all: 0,
    image: 0,
    video: 0,
    uncatalogued: 0
  });
  const [mediaRefreshNonce, setMediaRefreshNonce] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [externalScan, setExternalScan] = useState<ExternalScanState | null>(null);
  const [taxonomyPeople, setTaxonomyPeople] = useState<TaxonomyEntry[]>([]);
  const [taxonomyTags, setTaxonomyTags] = useState<TaxonomyEntry[]>([]);
  const [taxonomyGroups, setTaxonomyGroups] = useState<TaxonomyGroup[]>([]);
  const [folderOptions, setFolderOptions] = useState<FolderOption[]>([]);
  const [folderFilter, setFolderFilter] = useState("");
  const [personFacets, setPersonFacets] = useState<PersonFacets | null>(null);
  const [referencePerson, setReferencePerson] = useState<TaxonomyEntry | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [inspected, setInspected] = useState<MediaItem | null>(null);
  const [expandedItem, setExpandedItem] = useState<MediaItem | null>(null);
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
  const scanCompletionRef = useRef<string | null>(null);

  const mediaQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (filter !== "all") params.set("kind", filter);
    if (sort === "name") params.set("sort", "name");
    if (activeNav === "Preferiti" || advancedFilters.favoriteOnly) {
      params.set("favorite", "true");
    }
    if (activeNav === "Da catalogare") params.set("uncatalogued", "true");
    if (advancedFilters.people.length) {
      params.set("people", advancedFilters.people.join(","));
    }
    if (advancedFilters.tags.length) {
      params.set("tags", advancedFilters.tags.join(","));
    }
    if (advancedFilters.groups.length) {
      params.set("groups", advancedFilters.groups.join(","));
    }
    if (folderFilter) params.set("folders", folderFilter);
    if (advancedFilters.duration === "short") params.set("durationMax", "60");
    if (advancedFilters.duration === "medium") {
      params.set("durationMin", "60");
      params.set("durationMax", "300");
    }
    if (advancedFilters.duration === "long") params.set("durationMin", "300");
    if (advancedFilters.resolution !== "any") {
      params.set("resolution", advancedFilters.resolution);
    }
    if (advancedFilters.status !== "any") {
      params.set("status", advancedFilters.status.toUpperCase());
    }
    if (advancedFilters.markerOnly) params.set("markerOnly", "true");
    if (advancedFilters.duplicateOnly) params.set("duplicateOnly", "true");
    if (advancedFilters.dateFrom) params.set("dateFrom", advancedFilters.dateFrom);
    if (advancedFilters.dateTo) params.set("dateTo", advancedFilters.dateTo);
    return params.toString();
  }, [activeNav, advancedFilters, filter, folderFilter, sort]);

  const visibleItems = useMemo(() => {
    let result = filter === "all" ? [...items] : items.filter((item) => item.type === filter);
    if (activeNav === "Preferiti") result = result.filter((item) => item.favorite);
    if (activeNav === "Da catalogare") {
      result = result.filter(
        (item) => !item.people.length || item.group === "Da catalogare"
      );
    }
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
  const selectedPerson =
    advancedFilters.people.length === 1
      ? taxonomyPeople.find(({ name }) => name === advancedFilters.people[0]) ?? null
      : null;
  const imageCount = libraryCounts.image;
  const videoCount = libraryCounts.video;
  const uncataloguedCount = libraryCounts.uncatalogued;
  const duplicateCount = items.reduce((total, item) => total + (item.duplicateCount ?? 0), 0);
  const processingKey = items
    .filter((item) => item.status === "processing" && !item.id.startsWith("local-"))
    .map((item) => item.id)
    .sort()
    .join("|");

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
    const params = new URLSearchParams(mediaQuery);
    params.set("take", "200");
    void fetch(`/api/media?${params.toString()}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: {
        items?: PersistedMediaRecord[];
        mode?: string;
        total?: number;
        counts?: { all: number; image: number; video: number; uncatalogued: number };
      } | null) => {
        if (!active || !Array.isArray(payload?.items)) return;
        setItems(
          payload.mode === "demo"
            ? demoMedia
            : payload.items.map((item) => persistedToMedia(item))
        );
        setLibraryTotal(
          payload.mode === "demo"
            ? demoMedia.length
            : payload.total ?? payload.items.length
        );
        if (payload.counts) setLibraryCounts(payload.counts);
        else if (payload.mode === "demo") {
          setLibraryCounts({
            all: demoMedia.length,
            image: demoMedia.filter(({ type }) => type === "image").length,
            video: demoMedia.filter(({ type }) => type === "video").length,
            uncatalogued: demoMedia.filter(
              (item) => !item.people.length || item.group === "Da catalogare"
            ).length
          });
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [mediaQuery, mediaRefreshNonce]);

  useEffect(() => {
    let active = true;
    void fetch("/api/taxonomy")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: {
        people?: Array<string | {
          id: string;
          name: string;
          count?: number;
          images?: TaxonomyEntry["images"];
        }>;
        tags?: Array<string | {
          id: string;
          name: string;
          color?: string | null;
          count?: number;
        }>;
        groups?: Array<string | {
          id: string;
          name: string;
          accent?: string | null;
          count?: number;
        }>;
      } | null) => {
        if (!active || !payload) return;
        setTaxonomyPeople((payload.people ?? []).map((entry) =>
          typeof entry === "string"
            ? { id: `demo-person-${entry}`, name: entry, count: 0 }
            : {
                id: entry.id,
                name: entry.name,
                count: entry.count ?? 0,
                images: entry.images
              }
        ));
        setTaxonomyTags((payload.tags ?? []).map((entry) => typeof entry === "string"
          ? { id: `demo-tag-${entry}`, name: entry, color: "#6D5DFB", count: 0 }
          : {
              id: entry.id,
              name: entry.name,
              color: entry.color ?? "#6D5DFB",
              count: entry.count ?? 0
            }));
        setTaxonomyGroups((payload.groups ?? []).map((entry) =>
          typeof entry === "string"
            ? {
                id: `demo-group-${entry}`,
                name: entry,
                color: "#F97316",
                count: 0
              }
            : {
                id: entry.id,
                name: entry.name,
                color: entry.accent ?? "#F97316",
                count: entry.count ?? 0
              }
        ));
      })
      .catch(() => undefined);
    void fetch("/api/library/folders")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { folders?: FolderOption[] } | null) => {
        if (active) setFolderOptions(payload?.folders ?? []);
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
    if (!selectedPerson || selectedPerson.id.startsWith("demo-")) {
      setPersonFacets(null);
      return;
    }
    let active = true;
    setPersonFacets(null);
    void fetch(`/api/taxonomy/people/${selectedPerson.id}/facets`)
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: PersonFacets | null) => {
        if (active && payload) setPersonFacets(payload);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [selectedPerson]);

  useEffect(() => {
    let active = true;
    const checkScan = () => {
      void fetch("/api/library/scan")
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: { scan?: ExternalScanState } | null) => {
          if (!active || !payload?.scan) return;
          setExternalScan(payload.scan);
          if (
            payload.scan.completedAt &&
            payload.scan.completedAt !== scanCompletionRef.current
          ) {
            scanCompletionRef.current = payload.scan.completedAt;
            setMediaRefreshNonce((current) => current + 1);
          }
        })
        .catch(() => undefined);
    };
    checkScan();
    const interval = window.setInterval(checkScan, 3000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/library/folders")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { folders?: FolderOption[] } | null) => {
        if (active) setFolderOptions(payload?.folders ?? []);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [mediaRefreshNonce]);

  useEffect(() => {
    const processingIds = items
      .filter((item) => item.status === "processing" && !item.id.startsWith("local-"))
      .map((item) => item.id);
    if (!processingIds.length) return;

    const refresh = () => {
      void Promise.all(
        processingIds.map(async (id) => {
          const response = await fetch(`/api/media/${id}`);
          if (!response.ok) return null;
          const payload = (await response.json()) as { item?: PersistedMediaRecord };
          return payload.item ?? null;
        })
      )
        .then((records) => {
          const freshById = new Map(
            records
              .filter((record): record is PersistedMediaRecord => Boolean(record))
              .map((record) => [record.id, record])
          );
          setItems((current) =>
            current.map((item) => {
              const record = freshById.get(item.id);
              return record ? persistedToMedia(record, item.src) : item;
            })
          );
          setInspected((current) => {
            if (!current) return current;
            const record = freshById.get(current.id);
            return record ? persistedToMedia(record, current.src) : current;
          });
        })
        .catch(() => undefined);
    };

    refresh();
    const interval = window.setInterval(refresh, 3000);
    return () => window.clearInterval(interval);
  }, [processingKey]);

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

  const replacePersistedItem = (record: PersistedMediaRecord) => {
    setItems((current) =>
      current.map((item) =>
        item.id === record.id ? persistedToMedia(record, item.src) : item
      )
    );
    setInspected((current) =>
      current?.id === record.id
        ? persistedToMedia(record, current.src)
        : current
    );
  };

  const patchMediaTaxonomy = async (
    item: MediaItem,
    body: { tagNames?: string[]; personNames?: string[]; groupIds?: string[] }
  ) => {
    const response = await fetch(`/api/media/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = (await response.json().catch(() => null)) as {
      item?: PersistedMediaRecord;
      error?: string;
    } | null;
    if (!response.ok || !payload?.item) {
      throw new Error(payload?.error ?? "Salvataggio non riuscito");
    }
    replacePersistedItem(payload.item);
    return payload.item;
  };

  const reloadTaxonomy = () => {
    void fetch("/api/taxonomy")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: {
        people?: Array<{
          id: string;
          name: string;
          count?: number;
          images?: TaxonomyEntry["images"];
        }>;
        tags?: Array<{
          id: string;
          name: string;
          color?: string | null;
          count?: number;
        }>;
        groups?: Array<{
          id: string;
          name: string;
          accent?: string | null;
          count?: number;
        }>;
      } | null) => {
        if (!payload) return;
        setTaxonomyPeople((payload.people ?? []).map((entry) => ({
          id: entry.id,
          name: entry.name,
          count: entry.count ?? 0,
          images: entry.images
        })));
        setTaxonomyTags((payload.tags ?? []).map((entry) => ({
          id: entry.id,
          name: entry.name,
          color: entry.color ?? "#6D5DFB",
          count: entry.count ?? 0
        })));
        setTaxonomyGroups((payload.groups ?? []).map((entry) => ({
          id: entry.id,
          name: entry.name,
          color: entry.accent ?? "#F97316",
          count: entry.count ?? 0
        })));
      })
      .catch(() => undefined);
  };

  const addTag = (item: MediaItem, tag: string, event?: MouseEvent) => {
    event?.stopPropagation();
    const previousTags = item.tags;
    const nextTags = previousTags.includes(tag)
      ? previousTags
      : [...previousTags, tag];
    updateItem(item.id, (current) => ({
      ...current,
      tags: nextTags
    }));
    void patchMediaTaxonomy(item, { tagNames: nextTags })
      .then(() => {
        setToast(`“${tag}” aggiunto a ${item.title}`);
        reloadTaxonomy();
      })
      .catch((error) => {
        updateItem(item.id, (current) => ({ ...current, tags: previousTags }));
        setToast(error instanceof Error ? error.message : "Tag non salvato");
      });
  };

  const removeTag = (item: MediaItem, tag: string) => {
    const previousTags = item.tags;
    const nextTags = previousTags.filter((entry) => entry !== tag);
    updateItem(item.id, (current) => ({ ...current, tags: nextTags }));
    void patchMediaTaxonomy(item, { tagNames: nextTags })
      .then(() => {
        setToast(`“${tag}” rimosso da ${item.title}`);
        reloadTaxonomy();
      })
      .catch((error) => {
        updateItem(item.id, (current) => ({ ...current, tags: previousTags }));
        setToast(error instanceof Error ? error.message : "Tag non rimosso");
      });
  };

  const addPerson = (item: MediaItem, name: string) => {
    const previousPeople = item.people;
    const nextPeople = previousPeople.includes(name)
      ? previousPeople
      : [...previousPeople, name];
    updateItem(item.id, (current) => ({ ...current, people: nextPeople }));
    void patchMediaTaxonomy(item, { personNames: nextPeople })
      .then(() => {
        setToast(`${name} assegnato a ${item.title}`);
        reloadTaxonomy();
      })
      .catch((error) => {
        updateItem(item.id, (current) => ({ ...current, people: previousPeople }));
        setToast(error instanceof Error ? error.message : "Persona non assegnata");
      });
  };

  const removePerson = (item: MediaItem, name: string) => {
    const previousPeople = item.people;
    const nextPeople = previousPeople.filter((entry) => entry !== name);
    updateItem(item.id, (current) => ({ ...current, people: nextPeople }));
    void patchMediaTaxonomy(item, { personNames: nextPeople })
      .then(() => {
        setToast(`${name} rimosso da ${item.title}`);
        reloadTaxonomy();
      })
      .catch((error) => {
        updateItem(item.id, (current) => ({ ...current, people: previousPeople }));
        setToast(error instanceof Error ? error.message : "Persona non rimossa");
      });
  };

  const setGroup = (item: MediaItem, group: TaxonomyGroup) => {
    const previousGroup = item.group;
    updateItem(item.id, (current) => ({ ...current, group: group.name }));
    void patchMediaTaxonomy(item, { groupIds: [group.id] })
      .then(() => {
        setToast(`“${group.name}” assegnato a ${item.title}`);
        reloadTaxonomy();
      })
      .catch((error) => {
        updateItem(item.id, (current) => ({ ...current, group: previousGroup }));
        setToast(error instanceof Error ? error.message : "Gruppo non assegnato");
      });
  };

  const addTagToSelection = (tag: string) => {
    const targets = selectedItems;
    setItems((current) =>
      current.map((item) =>
        selectedIds.has(item.id) && !item.tags.includes(tag)
          ? { ...item, tags: [...item.tags, tag] }
          : item
      )
    );
    void fetch("/api/media/bulk-taxonomy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mediaIds: targets.map(({ id }) => id),
        addTagNames: [tag]
      })
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as {
          updated?: number;
          error?: string;
        } | null;
        if (!response.ok) throw new Error(payload?.error ?? "Tag non salvato");
        setToast(`“${tag}” aggiunto a ${payload?.updated ?? targets.length} media`);
        reloadTaxonomy();
      })
      .catch((error) => {
        setToast(error instanceof Error ? error.message : "Tag non salvato");
      });
  };

  const addPersonToSelection = (name: string) => {
    const targets = selectedItems;
    setItems((current) =>
      current.map((item) =>
        selectedIds.has(item.id) && !item.people.includes(name)
          ? { ...item, people: [...item.people, name] }
          : item
      )
    );
    void fetch("/api/media/bulk-taxonomy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mediaIds: targets.map(({ id }) => id),
        addPersonNames: [name]
      })
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as {
          updated?: number;
          error?: string;
        } | null;
        if (!response.ok) throw new Error(payload?.error ?? "Persona non assegnata");
        setToast(`${name} assegnato a ${payload?.updated ?? targets.length} media`);
        reloadTaxonomy();
      })
      .catch((error) => {
        setToast(error instanceof Error ? error.message : "Persona non assegnata");
      });
  };

  const addGroupToSelection = (group: TaxonomyGroup) => {
    const targets = selectedItems;
    setItems((current) =>
      current.map((item) =>
        selectedIds.has(item.id) ? { ...item, group: group.name } : item
      )
    );
    void fetch("/api/media/bulk-taxonomy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mediaIds: targets.map(({ id }) => id),
        addGroupIds: [group.id]
      })
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as {
          updated?: number;
          error?: string;
        } | null;
        if (!response.ok) throw new Error(payload?.error ?? "Gruppo non assegnato");
        setToast(`“${group.name}” assegnato a ${payload?.updated ?? targets.length} media`);
        reloadTaxonomy();
      })
      .catch((error) => {
        setToast(error instanceof Error ? error.message : "Gruppo non assegnato");
        setMediaRefreshNonce((current) => current + 1);
      });
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

  const handleUpload = (files: File[], skipped: SkippedImportFile[] = []) => {
    if (skipped.length) {
      void fetch("/api/media/imports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: skipped.map(({ file, reason }) => ({
            name: file.name,
            mimeType: file.type,
            bytes: file.size,
            reason
          }))
        })
      })
        .then((response) => {
          if (!response.ok) throw new Error("Registrazione dei duplicati non riuscita");
        })
        .catch((error) =>
          setToast(
            error instanceof Error
              ? error.message
              : "Registrazione dei duplicati non riuscita"
          )
        );
    }
    const importIds = files.map(() => crypto.randomUUID());
    const created = files.map((file, index): MediaItem => {
      const localUrl = URL.createObjectURL(file);
      const isVideo = file.type.startsWith("video");
      return {
        id: `local-${importIds[index]}`,
        title: file.name.replace(/\.[^/.]+$/, ""),
        type: isVideo ? "video" : "image",
        src: localUrl,
        originalUrl: isVideo ? localUrl : undefined,
        accent: "#817A70",
        duration: isVideo ? "—" : undefined,
        dimensions: "Analisi in corso",
        size: formatBytes(file.size),
        date: "adesso",
        people: [],
        tags: [],
        group: "Da catalogare",
        status: "processing",
        processingStage: "Caricamento sul server",
        processingProgress: 0,
        processingState: "RUNNING",
        aspect: "landscape"
      };
    });
    setItems((current) => [...created, ...current]);
    setToast(
      files.length
        ? `${files.length} ${files.length === 1 ? "import avviato" : "import avviati"}${skipped.length ? ` · ${skipped.length} già presenti` : ""}`
        : `${skipped.length} ${skipped.length === 1 ? "file già presente" : "file già presenti"} · nessun duplicato importato`
    );

    let nextUpload = 0;
    const uploadNext = async () => {
      while (nextUpload < files.length) {
        const index = nextUpload;
        nextUpload += 1;
        const file = files[index];
        const localItem = created[index];
        try {
          const payload = await uploadMedia(file, importIds[index], (progress) => {
            updateItem(localItem.id, (current) => ({
              ...current,
              processingProgress: progress,
              processingStage:
                progress === 100
                  ? "In attesa dell’elaborazione"
                  : "Caricamento sul server"
            }));
          });
          if (!payload.item || payload.item.id === localItem.id || !payload.item.createdAt) {
            continue;
          }
          const serverItem = persistedToMedia(payload.item, localItem.src);
          setItems((current) =>
            current.map((item) => (item.id === localItem.id ? serverItem : item))
          );
          setInspected((current) =>
            current?.id === localItem.id ? serverItem : current
          );
        } catch (error) {
          setItems((current) => current.filter((item) => item.id !== localItem.id));
          setInspected((current) => (current?.id === localItem.id ? null : current));
          URL.revokeObjectURL(localItem.src);
          setToast(error instanceof Error ? error.message : "Importazione non riuscita");
        }
      }
    };

    void Promise.all(
      Array.from({ length: Math.min(2, files.length) }, () => uploadNext())
    );
  };

  const startExternalScan = () => {
    void fetch("/api/library/scan", { method: "POST" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { scan?: ExternalScanState } | null) => {
        if (payload?.scan) setExternalScan(payload.scan);
      })
      .catch(() => undefined);
  };

  const createTaxonomyEntry = (kind: "PERSON" | "TAG", name: string) => {
    void fetch("/api/taxonomy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, name })
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as {
          entry?: TaxonomyEntry;
          error?: string;
        } | null;
        if (!response.ok || !payload?.entry) {
          throw new Error(payload?.error ?? "Creazione non riuscita");
        }
        const entry = {
          ...payload.entry,
          color: payload.entry.color ?? (kind === "TAG" ? "#8B5CF6" : undefined)
        };
        if (kind === "PERSON") {
          setTaxonomyPeople((current) => [
            ...current.filter(({ id }) => id !== entry.id),
            entry
          ].sort((left, right) => left.name.localeCompare(right.name)));
        } else {
          setTaxonomyTags((current) => [
            ...current.filter(({ id }) => id !== entry.id),
            entry
          ].sort((left, right) => left.name.localeCompare(right.name)));
        }
        setToast(`${kind === "PERSON" ? "Persona" : "Tag"} “${name}” creato`);
      })
      .catch((error) => {
        setToast(error instanceof Error ? error.message : "Creazione non riuscita");
      });
  };

  const loadMoreMedia = () => {
    if (loadingMore || items.length >= libraryTotal) return;
    setLoadingMore(true);
    const params = new URLSearchParams(mediaQuery);
    params.set("take", "200");
    params.set("skip", String(items.length));
    void fetch(`/api/media?${params.toString()}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: {
        items?: PersistedMediaRecord[];
        total?: number;
        counts?: { all: number; image: number; video: number; uncatalogued: number };
      } | null) => {
        if (!Array.isArray(payload?.items)) return;
        const nextItems = payload.items.map((item) => persistedToMedia(item));
        setItems((current) => {
          const existing = new Set(current.map(({ id }) => id));
          return [
            ...current,
            ...nextItems.filter(({ id }) => !existing.has(id))
          ];
        });
        setLibraryTotal(payload.total ?? libraryTotal);
        if (payload.counts) setLibraryCounts(payload.counts);
      })
      .catch(() => undefined)
      .finally(() => setLoadingMore(false));
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
          people={taxonomyPeople.map(({ name }) => name)}
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

      <main
        className={[
          "main-content",
          ["Persone", "Tag"].includes(activeNav) ? "is-taxonomy-view" : "",
          view === "stories" && activeNav === "Libreria" ? "is-story-view" : ""
        ].join(" ")}
      >
        {activeNav === "Utenti & accessi" ? (
          <UserManagement
            onReady={() => {
              setActiveNav("Libreria");
              setMediaRefreshNonce((current) => current + 1);
            }}
          />
        ) : activeNav === "Gestione libreria" ? (
          <LibraryManagement
            onChanged={() => setMediaRefreshNonce((current) => current + 1)}
          />
        ) : activeNav === "Duplicati" ? (
          <DuplicatesPanel />
        ) : (
          <>
        <section className="page-intro">
          <div>
            <p className="eyebrow">
              {activeNav === "Persone" ? "CAST & PERFORMER" : "CATALOGO PRIVATO"}
            </p>
            <h1>
              {activeNav === "Persone" ? (
                <>I tuoi <em>performer.</em></>
              ) : (
                <>La tua collezione, <em>organizzata.</em></>
              )}
            </h1>
            <p className="page-subtitle">
              {activeNav === "Persone"
                ? `${taxonomyPeople.length.toLocaleString("it-IT")} profili con scene, immagini, tag e collezioni.`
                : libraryCounts.all
                ? `${libraryCounts.all.toLocaleString("it-IT")} media nel tuo archivio.`
                : "Il tuo archivio è pronto per il primo contenuto."}
            </p>
          </div>
          <div className="library-metrics">
            <div>
              <strong>
                {(activeNav === "Persone" ? taxonomyPeople.length : libraryCounts.all).toLocaleString("it-IT")}
              </strong>
              <span>{activeNav === "Persone" ? "Performer" : "Media"}</span>
            </div>
            <i />
            <div>
              <strong>
                {(activeNav === "Persone" ? taxonomyTags.length : videoCount).toLocaleString("it-IT")}
              </strong>
              <span>{activeNav === "Persone" ? "Tag" : "Video"}</span>
            </div>
            <i />
            <div>
              <strong>
                {(activeNav === "Persone" ? taxonomyGroups.length : taxonomyPeople.length).toLocaleString("it-IT")}
              </strong>
              <span>{activeNav === "Persone" ? "Collezioni" : "Performer"}</span>
            </div>
          </div>
        </section>

        <ExternalLibraryRail scan={externalScan} onScan={startExternalScan} />
        <StatusRail items={items} />

        <section className="library-toolbar">
          <div className="filter-tabs">
            {[
              { value: "all", label: "Tutti", count: libraryCounts.all },
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
            <label className={folderFilter ? "folder-filter is-active" : "folder-filter"}>
              <Folder size={16} />
              <select
                value={folderFilter}
                onChange={(event) => {
                  setFolderFilter(event.target.value);
                  setSelectedIds(new Set());
                }}
                aria-label="Filtra per cartella"
              >
                <option value="">Tutte le cartelle</option>
                {folderOptions.map((folder) => (
                  <option value={folder.key} key={folder.key}>
                    {folder.label} ({folder.count.toLocaleString("it-IT")})
                  </option>
                ))}
              </select>
              <ChevronDown size={13} />
            </label>
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
              <button
                className={view === "stories" ? "is-active" : ""}
                onClick={() => setView("stories")}
                aria-label="Vista storie"
                title="Scorrimento Storie"
              >
                <GalleryVerticalEnd size={17} />
              </button>
            </div>
          </div>
        </section>

        {advancedFilterCount || folderFilter ? (
          <div className="active-filter-bar">
            <span><SlidersHorizontal size={14} /> Filtri attivi</span>
            {folderFilter ? (
              <button onClick={() => setFolderFilter("")}>
                <Folder size={12} />
                {folderOptions.find(({ key }) => key === folderFilter)?.label ?? folderFilter}
                <X size={12} />
              </button>
            ) : null}
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
            {folderFilter && visibleItems.length ? (
              <button
                className="select-visible-media"
                onClick={() => setSelectedIds(new Set(visibleItems.map(({ id }) => id)))}
              >
                <Check size={12} />
                Seleziona i {visibleItems.length} caricati
              </button>
            ) : null}
            <button
              className="clear-active-filters"
              onClick={() => {
                setAdvancedFilters(emptyAdvancedFilters);
                setFolderFilter("");
              }}
            >
              Azzera tutto
            </button>
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
                <strong>{activeNav === "Persone" ? "Performer" : activeNav === "Gruppi" ? "Collezioni" : activeNav}</strong>
                <small>{visibleItems.length} elementi nella vista corrente</small>
              </span>
            </div>
            <button onClick={() => setActiveNav("Libreria")}>
              Torna alla libreria
              <X size={15} />
            </button>
          </div>
        ) : null}

        {selectedPerson && activeNav === "Libreria" ? (
          <PersonFacetTabs
            person={selectedPerson.name}
            facets={personFacets}
            activeTag={advancedFilters.tags[0]}
            activeGroup={advancedFilters.groups[0]}
            onAll={() => setAdvancedFilters((current) => ({
              ...current,
              tags: [],
              groups: []
            }))}
            onTag={(name) => setAdvancedFilters((current) => ({
              ...current,
              tags: [name],
              groups: []
            }))}
            onGroup={(name) => setAdvancedFilters((current) => ({
              ...current,
              tags: [],
              groups: [name]
            }))}
          />
        ) : null}

        {activeNav === "Persone" ? (
          <TaxonomyManager
            kind="people"
            entries={taxonomyPeople}
            onCreate={(name) => createTaxonomyEntry("PERSON", name)}
            onOpen={(name) => {
              setAdvancedFilters((current) => ({ ...current, people: [name] }));
              setActiveNav("Libreria");
            }}
            onManageImages={setReferencePerson}
          />
        ) : activeNav === "Tag" ? (
          <TaxonomyManager
            kind="tags"
            entries={taxonomyTags}
            onCreate={(name) => createTaxonomyEntry("TAG", name)}
            onOpen={(name) => {
              setAdvancedFilters((current) => ({ ...current, tags: [name] }));
              setActiveNav("Libreria");
            }}
          />
        ) : (
          <>
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

            <section
              className={[
                "media-grid",
                view === "compact" ? "is-compact" : "",
                view === "stories" ? "is-stories" : ""
              ].join(" ")}
            >
              {visibleItems.map((item) => (
                <MediaCard
                  item={item}
                  selected={selectedIds.has(item.id)}
                  quickMode={quickMode}
                  quickTags={taxonomyTags.map(({ name, color }) => ({
                    name,
                    color: color ?? "#6D5DFB"
                  }))}
                  onOpen={setInspected}
                  onOpenLarge={setExpandedItem}
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
              <span>
                Mostrati {visibleItems.length} di {libraryTotal.toLocaleString("it-IT")} media
              </span>
              {items.length < libraryTotal ? (
                <button onClick={loadMoreMedia} disabled={loadingMore}>
                  {loadingMore ? "Caricamento…" : "Carica altri 200"}
                </button>
              ) : null}
            </footer>
          </>
        )}
          </>
        )}
      </main>

      {inspected ? (
        <Inspector
          item={inspected}
          availablePeople={taxonomyPeople}
          availableTags={taxonomyTags}
          availableGroups={taxonomyGroups}
          onClose={() => setInspected(null)}
          onFavorite={() => toggleFavorite(inspected)}
          onAddTag={(tag) => addTag(inspected, tag)}
          onRemoveTag={(tag) => removeTag(inspected, tag)}
          onAddPerson={(name) => addPerson(inspected, name)}
          onRemovePerson={(name) => removePerson(inspected, name)}
          onSetGroup={(group) => setGroup(inspected, group)}
          onAddMarker={(marker) => addMarker(inspected, marker)}
          onEdit={() => setEditorOpen(true)}
          onRename={(name) => renameFile(inspected, name)}
          onCapture={(initialTimeMs) => setCaptureRequest({
            item: inspected,
            initialTimeMs
          })}
        />
      ) : null}

      {expandedItem ? (
        <FullMediaPlayer
          item={expandedItem}
          onClose={() => setExpandedItem(null)}
        />
      ) : null}

      {selectedIds.size ? (
        <BulkToolbar
          count={selectedIds.size}
          tags={taxonomyTags}
          people={taxonomyPeople}
          groups={taxonomyGroups}
          onClear={() => setSelectedIds(new Set())}
          onAddTag={addTagToSelection}
          onAddPerson={addPersonToSelection}
          onAddGroup={addGroupToSelection}
          onEdit={() => setEditorOpen(true)}
          onOrganize={() => setOrganizerOpen(true)}
        />
      ) : null}

      {uploadOpen ? <UploadModal onClose={() => setUploadOpen(false)} onUpload={handleUpload} /> : null}
      {referencePerson ? (
        <PersonReferenceModal
          person={referencePerson}
          onClose={() => setReferencePerson(null)}
          onSaved={() => {
            reloadTaxonomy();
            setToast(`Immagini di ${referencePerson.name} aggiornate`);
          }}
        />
      ) : null}
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
          people={taxonomyPeople.map(({ name }) => name)}
          tags={taxonomyTags.map(({ name }) => name)}
          groups={taxonomyGroups.map(({ name }) => name)}
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
          people={taxonomyPeople.map(({ name }) => name)}
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
