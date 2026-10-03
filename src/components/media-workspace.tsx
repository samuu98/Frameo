"use client";

import {
  Archive,
  ArrowDownUp,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
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
  Pause,
  PencilLine,
  Play,
  Plus,
  Search,
  ScanLine,
  Scissors,
  Settings,
  Shield,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  Star,
  Tag,
  Trash2,
  Tv,
  Upload,
  UserRound,
  UsersRound,
  WandSparkles,
  X,
  Zap
} from "lucide-react";
import {
  type CSSProperties,
  type ChangeEvent,
  type DragEvent,
  type MouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { mediaSortGroups, type MediaSort } from "@/lib/media-sort";
import { createPortal } from "react-dom";
import { demoMedia } from "@/data/media";
import { readDemoTvSelection, saveDemoTvSelection } from "@/lib/demo-tv-selection";
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
import { EditorActivity } from "@/components/editor-activity";
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
  { label: "Gallerie", value: "Gruppi", icon: Layers3 }
];

const MEDIA_PAGE_SIZE = 48;

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
  images?: TaxonomyEntry["images"];
  ownerPersonId?: string | null;
  previews?: Array<{
    mediaId: string;
    title: string;
    type: "video" | "image";
    imageUrl: string;
    videoUrl?: string | null;
    originalUrl?: string | null;
    streamUrl?: string | null;
    durationMs?: number | null;
    width?: number | null;
    height?: number | null;
  }>;
}

interface DuplicateDetailRecord extends PersistedMediaRecord {
  matchId: string;
  similarity: number;
  reason: string;
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

const createClientId = () => {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.getRandomValues === "function"
  ) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
};

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

const isVideoUploadFile = (file: Pick<File, "name" | "type">) =>
  file.type.startsWith("video/") ||
  /\.(mp4|m4v|mov|mkv|webm|avi|wmv|mpeg|mpg)$/i.test(file.name);

const readVideoDuration = (file: File) =>
  new Promise<number | null>((resolve) => {
    if (!isVideoUploadFile(file)) {
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
    galleries: item.groups.map(({ name, ownerPersonId }) => ({ name, ownerPersonId })),
    group:
      item.groups.find(({ ownerPersonId }) => !ownerPersonId)?.name ??
      item.groups[0]?.name ??
      "Da catalogare",
    status:
      item.status === "READY"
        ? "ready"
        : item.status === "ERROR"
          ? "error"
          : "processing",
    favorite: item.favorite,
    showOnTv: item.showOnTv,
    hideFromRandomHome: item.hideFromRandomHome,
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
  uncataloguedCount,
  duplicateCount,
  galleries,
  activeGallery,
  onOpenGallery,
  onCreateGallery
}: {
  active: string;
  onNavigate: (item: string) => void;
  uncataloguedCount: number;
  duplicateCount: number;
  galleries: TaxonomyGroup[];
  activeGallery?: string;
  onOpenGallery: (name: string) => void;
  onCreateGallery: (name: string) => Promise<boolean>;
}) {
  const [creating, setCreating] = useState(false);
  const [galleryName, setGalleryName] = useState("");
  const [saving, setSaving] = useState(false);
  const adminActive = adminItems.some(({ label }) => label === active);

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <Logo />
      </div>

      <nav className="sidebar-nav" aria-label="Navigazione principale">
        <p className="nav-caption">Libreria</p>
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
        <a className="nav-item" href="/downloads">
          <Download size={18} />
          <span>Download center</span>
        </a>
        <a className="nav-item" href="/tv">
          <Tv size={18} />
          <span>Galleria TV</span>
        </a>

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

        <section className="sidebar-galleries" aria-label="Gallerie">
          <div className="sidebar-section-title">
            <span>Gallerie</span>
            <button type="button" aria-label="Nuova galleria" title="Nuova galleria" aria-expanded={creating} onClick={() => setCreating((value) => !value)} disabled={saving}>
              {creating ? <X size={15} /> : <Plus size={15} />}
            </button>
          </div>
          {creating ? (
            <form className="sidebar-gallery-form" onSubmit={async (event) => {
              event.preventDefault();
              const name = galleryName.trim();
              if (!name || saving) return;
              setSaving(true);
              try {
                if (await onCreateGallery(name)) {
                  setGalleryName("");
                  setCreating(false);
                }
              } finally {
                setSaving(false);
              }
            }}>
              <input autoFocus aria-label="Nome galleria" placeholder="Nome galleria" maxLength={64} value={galleryName} onChange={(event) => setGalleryName(event.target.value)} disabled={saving} />
              <button type="submit" disabled={saving || !galleryName.trim()}>{saving ? "Creazione…" : "Crea galleria"}</button>
            </form>
          ) : null}
          {galleries.map((gallery) => (
            <button key={gallery.id} className={activeGallery === gallery.name ? "nav-item is-active" : "nav-item"} aria-current={activeGallery === gallery.name ? "page" : undefined} title={gallery.name} onClick={() => onOpenGallery(gallery.name)}>
              <Layers3 size={17} style={{ color: gallery.color }} />
              <span>{gallery.name}</span>
              <em>{gallery.count.toLocaleString("it-IT")}</em>
            </button>
          ))}
          {!galleries.length ? <p className="sidebar-gallery-empty">Crea una galleria per raccogliere foto e video.</p> : null}
        </section>

        <details className="sidebar-admin" open={adminActive || undefined}>
          <summary>
            <Settings size={17} />
            <span>Amministrazione</span>
            <ChevronDown size={15} />
          </summary>
          <div>
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
          </div>
        </details>
      </nav>
    </aside>
  );
}

function Topbar({
  editRefresh,
  onOpenResult,
  active,
  onCommand,
  onUpload,
  onMobileMenu
}: {
  editRefresh: number;
  onOpenResult: (id: string) => void;
  active: string;
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
        <strong>{active}</strong>
      </div>
      <button className="global-search" onClick={onCommand}>
        <Search size={17} />
        <span>Cerca file, persone, luoghi o tag…</span>
        <kbd>⌘ K</kbd>
      </button>
      <div className="topbar-actions">
        <EditorActivity refreshKey={editRefresh} onOpenResult={onOpenResult} />
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
  kind: "people" | "tags" | "groups";
  entries: TaxonomyEntry[];
  onCreate: (name: string) => void;
  onOpen: (name: string) => void;
  onManageImages?: (entry: TaxonomyEntry) => void;
}) {
  const [name, setName] = useState("");
  const isPeople = kind === "people";
  const isGroups = kind === "groups";

  return (
    <section className="taxonomy-manager">
      <header>
        <div>
          <span>{isPeople ? <UsersRound size={17} /> : isGroups ? <Layers3 size={17} /> : <Tag size={17} />}</span>
          <div>
          <strong>{isPeople ? "Performer" : isGroups ? "Gallerie" : "Tag"}</strong>
            <small>
              {entries.length
                ? `${entries.length} ${isPeople ? "performer" : isGroups ? "gallerie" : "tag"} nel catalogo`
                : (isGroups ? "Crea la prima galleria" : `Crea il primo ${isPeople ? "performer" : "tag"}`)}
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
            placeholder={isPeople ? "Nome performer" : isGroups ? "Nome galleria" : "Nome tag"}
          />
          <button type="submit">
            <Plus size={14} />
            Aggiungi
          </button>
        </form>
      </header>
      {entries.length ? (
        <div className={isPeople ? "taxonomy-grid is-people-grid" : "taxonomy-grid is-preview-grid"}>
          {entries.map((entry) => (
            <article className={isPeople ? "person-taxonomy-card" : ""} key={entry.id}>
              {isPeople || isGroups || entry.images?.length ? (
                <div className="person-card-images">
                  {(entry.images ?? []).map((image) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={image.url} alt="" loading="lazy" key={image.mediaId} />
                  ))}
                  {!entry.images?.length ? (
                    <span>
                      {isGroups ? <Layers3 size={24} /> : entry.name
                        .split(" ")
                        .map((part) => part[0])
                        .join("")
                      .slice(0, 2)}
                    </span>
                  ) : null}
                  {(entry.images?.length ?? 0) > 1 ? (
                    <small>{entry.images?.length} preview</small>
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
          {isPeople ? <UsersRound size={22} /> : isGroups ? <Layers3 size={22} /> : <Tag size={22} />}
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

function Pagination({
  currentPage,
  pageCount,
  pages,
  loading,
  onPage
}: {
  currentPage: number;
  pageCount: number;
  pages: number[];
  loading: boolean;
  onPage: (page: number) => void;
}) {
  return (
    <nav className="media-pagination" aria-label="Pagine della libreria">
      <button onClick={() => onPage(currentPage - 1)} disabled={currentPage === 1 || loading} aria-label="Pagina precedente"><ChevronLeft size={16} /></button>
      {pages.map((page, index) => (
        <span key={page}>
          {index > 0 && page - pages[index - 1] > 1 ? <i>…</i> : null}
          <button className={page === currentPage ? "is-active" : ""} onClick={() => onPage(page)} disabled={loading} aria-label={`Pagina ${page}`} aria-current={page === currentPage ? "page" : undefined}>{page}</button>
        </span>
      ))}
      <button onClick={() => onPage(currentPage + 1)} disabled={currentPage === pageCount || loading} aria-label="Pagina successiva"><ChevronRight size={16} /></button>
    </nav>
  );
}

function DiscoveryStrip({
  people,
  tags,
  groups,
  onPerson,
  onTag,
  onGroup
}: {
  people: TaxonomyEntry[];
  tags: TaxonomyEntry[];
  groups: TaxonomyGroup[];
  onPerson: (name: string) => void;
  onTag: (name: string) => void;
  onGroup: (name: string) => void;
}) {
  return (
    <section className="discovery-hub">
      <header>
        <div><span><Sparkles size={14} /> DISCOVERY MIX</span><h2>Esplora performer, scene e fantasie.</h2></div>
        <p>La selezione alterna il catalogo per darti più varietà, non soltanto gli ultimi file aggiunti.</p>
      </header>
      <div className="discovery-performers">
        {people.filter(({ images }) => images?.length).slice(0, 10).map((person) => (
          <button onClick={() => onPerson(person.name)} key={person.id}>
            <span>
              {(person.images ?? []).map((image) => <img src={image.url} alt="" loading="lazy" key={image.mediaId} />)}
            </span>
            <strong>{person.name}</strong><small>{person.count} contenuti</small>
          </button>
        ))}
      </div>
      <div className="discovery-chips">
        <span>Trending</span>
        {tags.slice().sort((a, b) => b.count - a.count).slice(0, 12).map((tag) => (
          <button style={{ "--chip": tag.color ?? "#6D5DFB" } as CSSProperties} onClick={() => onTag(tag.name)} key={tag.id}>#{tag.name}<small>{tag.count}</small></button>
        ))}
        {groups.slice(0, 5).map((group) => (
          <button className="is-group" onClick={() => onGroup(group.name)} key={group.id}><Layers3 size={12} /> {group.name}<small>{group.count}</small></button>
        ))}
      </div>
    </section>
  );
}

type CompatibleVideoState = { state: "idle" | "pending" | "running" | "ready" | "failed"; progress: number; url?: string; error?: string | null };

function useCompatibleVideo(item: { id: string; originalUrl?: string | null; streamUrl?: string | null; previewUrl?: string | null; src?: string }) {
  const initialSource = item.streamUrl?.endsWith(".mp4") ? item.streamUrl : item.originalUrl ?? item.previewUrl ?? item.src ?? "";
  const [source, setSource] = useState(initialSource);
  const [failed, setFailed] = useState(false);
  const [job, setJob] = useState<CompatibleVideoState | null>(null);
  useEffect(() => { setSource(initialSource); setFailed(false); setJob(null); }, [item.id, initialSource]);
  useEffect(() => {
    if (job?.state !== "pending" && job?.state !== "running") return;
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch(`/api/media/${item.id}/compatible`, { cache: "no-store" });
        if (!response.ok) return;
        const next = await response.json() as CompatibleVideoState;
        if (!active) return;
        setJob(next);
        if (next.state === "ready" && next.url) { setSource(next.url); setFailed(false); }
      } catch { /* Keep the previous progress until the next poll. */ }
    };
    const timer = window.setInterval(() => void poll(), 2500);
    void poll();
    return () => { active = false; window.clearInterval(timer); };
  }, [item.id, job?.state]);
  const prepare = async () => {
    setJob({ state: "pending", progress: 0 });
    try {
      const response = await fetch(`/api/media/${item.id}/compatible`, { method: "POST" });
      const result = await response.json() as CompatibleVideoState & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Conversione non avviata");
      setJob(result);
      if (result.state === "ready" && result.url) { setSource(result.url); setFailed(false); }
    } catch (error) { setJob({ state: "failed", progress: 0, error: error instanceof Error ? error.message : "Conversione non avviata" }); }
  };
  return { source, failed, job, onError: () => setFailed(true), prepare };
}

function CompatibleVideoNotice({ playback }: { playback: ReturnType<typeof useCompatibleVideo> }) {
  if (!playback.failed && playback.job?.state !== "pending" && playback.job?.state !== "running") return null;
  const working = playback.job?.state === "pending" || playback.job?.state === "running";
  return <div className="compatible-video-notice" role="status">
    <Film size={24} />
    <strong>{working ? "Preparo il video completo" : "Il browser non legge questo formato video"}</strong>
    <p>{working ? `Conversione compatibile in corso · ${playback.job?.progress ?? 0}%` : playback.job?.error ?? "L’originale è disponibile, ma serve una versione compatibile per riprodurlo qui dall’inizio alla fine."}</p>
    {working ? <progress value={playback.job?.progress ?? 0} max={100} /> : <button type="button" onClick={() => void playback.prepare()}>Prepara versione completa</button>}
  </div>;
}

function PerformerHomeHeader({ person, globalGalleries, onManageImages, onCreateGallery, onAssignGallery }: {
  person: TaxonomyEntry;
  globalGalleries: TaxonomyGroup[];
  onManageImages: () => void;
  onCreateGallery: (name: string) => Promise<boolean>;
  onAssignGallery: (id: string) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [galleryId, setGalleryId] = useState("");
  const [busy, setBusy] = useState(false);
  return <section className="performer-home-header">
    <div><UsersRound size={22} /><span><h2>{person.name}</h2><p>Una home unica per tutte le gallerie.</p></span><button onClick={onManageImages}><ImagePlus size={16} /> Foto performer</button></div>
    <details><summary>Gestisci gallerie</summary><div className="performer-home-gallery-actions">
      <form onSubmit={async (event) => { event.preventDefault(); if (busy || !name.trim()) return; setBusy(true); try { if (await onCreateGallery(name.trim())) setName(""); } finally { setBusy(false); } }}>
        <input aria-label="Nome nuova galleria performer" placeholder="Nuova galleria" maxLength={64} value={name} onChange={(event) => setName(event.target.value)} disabled={busy} />
        <button disabled={busy || !name.trim()}><Plus size={15} /> Crea</button>
      </form>
      {globalGalleries.length ? <form onSubmit={async (event) => { event.preventDefault(); if (busy || !galleryId) return; setBusy(true); try { if (await onAssignGallery(galleryId)) setGalleryId(""); } finally { setBusy(false); } }}>
        <select aria-label="Galleria da assegnare al performer" value={galleryId} onChange={(event) => setGalleryId(event.target.value)} disabled={busy}><option value="">Scegli galleria esistente</option>{globalGalleries.map((gallery) => <option key={gallery.id} value={gallery.id}>{gallery.name}</option>)}</select>
        <button disabled={busy || !galleryId}>Assegna</button>
      </form> : null}
    </div></details>
  </section>;
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
  selectionMode,
  quickMode,
  quickTags,
  onOpen,
  onOpenLarge,
  onOpenGallery,
  onSelect,
  onFavorite,
  onHomeVisibility,
  onQuickTag
}: {
  item: MediaItem;
  selected: boolean;
  selectionMode: boolean;
  quickMode: boolean;
  quickTags: Array<{ name: string; color: string }>;
  onOpen: (item: MediaItem) => void;
  onOpenLarge: (item: MediaItem) => void;
  onOpenGallery: (item: MediaItem) => void;
  onSelect: (item: MediaItem, event: MouseEvent) => void;
  onFavorite: (item: MediaItem, event: MouseEvent) => void;
  onHomeVisibility: (item: MediaItem) => Promise<void>;
  onQuickTag: (item: MediaItem, tag: string, event: MouseEvent) => void;
}) {
  const [homeSaving, setHomeSaving] = useState(false);
  const isProcessing = item.status === "processing";
  const hoverVideoRef = useRef<HTMLVideoElement>(null);
  const inlineVideoRef = useRef<HTMLVideoElement>(null);
  const [previewing, setPreviewing] = useState(false);
  const [inlinePlaying, setInlinePlaying] = useState(false);
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
  }, [inlinePlaying]);

  useEffect(() => {
    setInlinePlaying(false);
  }, [item.id]);

  const inlineSource = item.streamUrl?.endsWith(".mp4") ? item.streamUrl : item.originalUrl ?? item.previewUrl ?? item.src;

  return (
    <article
      className={[
        "media-card",
        `is-${item.aspect}`,
        selected ? "is-selected" : "",
        isProcessing ? "is-processing" : "",
        inlinePlaying ? "is-inline-playing" : ""
      ].join(" ")}
      onClick={(event) => selectionMode ? onSelect(item, event) : quickMode ? undefined : onOpen(item)}
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
              setInlinePlaying(false);
              onOpenLarge(item);
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
          aria-pressed={selected}
          aria-label={selected ? `Deseleziona ${item.title}` : `Seleziona ${item.title}`}
        >
          {selected ? <Check size={15} strokeWidth={3} /> : null}
        </button>

        <div className="media-topline">
          <span className="media-type">
            {item.type === "video" ? <Film size={13} /> : <ImageIcon size={13} />}
            {item.type === "video" ? "VIDEO" : "FOTO"}
          </span>
          {item.showOnTv ? <span className="media-tv-badge" title="Presente nella Galleria TV" aria-label="Presente nella Galleria TV"><Tv size={12} /> TV</span> : null}
          <button
            className={item.favorite ? "favorite is-favorite" : "favorite"}
            onClick={(event) => onFavorite(item, event)}
            aria-label="Aggiungi ai preferiti"
          >
            <Heart size={15} fill={item.favorite ? "currentColor" : "none"} />
          </button>
        </div>

        {item.type === "video" ? <button
          type="button"
          className={`card-home-toggle ${item.hideFromRandomHome ? "is-excluded" : "is-included"}`}
          aria-label={`${item.hideFromRandomHome ? "Includi" : "Escludi"} ${item.title} ${item.hideFromRandomHome ? "nella" : "dalla"} home`}
          aria-pressed={!item.hideFromRandomHome}
          disabled={homeSaving}
          onClick={async (event) => { event.stopPropagation(); if (homeSaving) return; setHomeSaving(true); try { await onHomeVisibility(item); } finally { setHomeSaving(false); } }}
          title={homeSaving ? "Salvataggio…" : item.hideFromRandomHome ? "Includi nella home" : "Escludi dalla home"}
        ><Shuffle size={12} /><span>{homeSaving ? "…" : "Home"}</span></button> : null}

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
          {item.people.length > 1 ? (
            <span className="collaboration-badge"><UsersRound size={11} /> COLLAB · {item.people.length}</span>
          ) : null}
          <button
            onClick={(event) => {
              event.stopPropagation();
              onOpenGallery(item);
            }}
            aria-label={`Apri ${item.title} nella galleria`}
            title="Apri nella galleria"
          >
            <GalleryVerticalEnd size={16} />
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
          <div className="card-gallery-labels" aria-label="Gallerie di appartenenza">
            {(item.galleries?.length ? item.galleries.map(({ name }) => name) : [item.group === "Da catalogare" ? "Senza galleria" : item.group]).map((name) => <span key={name}><Layers3 size={12} />{name}</span>)}
          </div>
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
  const playback = useCompatibleVideo(item);

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
              {playback.source === item.originalUrl ? "QUALITÀ ORIGINALE" : "VERSIONE COMPATIBILE"}
              {item.dimensions !== "Analisi in corso" ? ` · ${item.dimensions}` : ""}
            </em>
            <button onClick={onClose} aria-label="Chiudi player"><X size={20} /></button>
          </div>
        </header>
        <div className="full-player-stage" style={{ backgroundColor: item.accent }}>
          <video
            ref={playerRef}
            key={playback.source}
            src={playback.source}
            poster={item.thumbnailUrl ?? item.src}
            controls
            autoPlay
            playsInline
            preload="metadata"
            onDoubleClick={() => void playerRef.current?.requestFullscreen?.()}
            onError={playback.onError}
          />
          <CompatibleVideoNotice playback={playback} />
        </div>
        <footer>
          <p>
            {playback.source === item.originalUrl
              ? "Riproduzione diretta del file originale."
              : "Riproduzione della versione completa compatibile con il browser."}
          </p>
          <button onClick={() => void playerRef.current?.requestFullscreen?.()}>
            <Maximize2 size={16} /> Schermo intero
          </button>
        </footer>
      </section>
    </div>
  );
}

function MediaGallery({
  items,
  initialId,
  onClose
}: {
  items: MediaItem[];
  initialId: string;
  onClose: () => void;
}) {
  const initialIndex = Math.max(0, items.findIndex(({ id }) => id === initialId));
  const [index, setIndex] = useState(initialIndex);
  const [fallback, setFallback] = useState(false);
  const touchStart = useRef<number | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const item = items[index];
  const playback = useCompatibleVideo({ id: item?.id ?? "", originalUrl: item?.originalUrl, streamUrl: item?.streamUrl, previewUrl: item?.previewUrl, src: item?.src });

  const move = (direction: number) => {
    setIndex((current) => {
      if (!items.length) return 0;
      return (current + direction + items.length) % items.length;
    });
  };

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") move(-1);
      if (event.key === "ArrowRight") move(1);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  useEffect(() => {
    stripRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [index]);

  useEffect(() => setFallback(false), [item?.id]);

  if (!item) return null;
  const source = item.type === "video" ? playback.source : fallback ? item.originalUrl ?? item.previewUrl ?? item.src : item.previewUrl ?? item.originalUrl ?? item.src;

  return (
    <div className="media-gallery-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="media-gallery"
        role="dialog"
        aria-modal="true"
        aria-label="Galleria media"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>GALLERIA</span>
            <h2>{item.title}</h2>
          </div>
          <p>{index + 1} / {items.length}</p>
          <button onClick={onClose} aria-label="Chiudi galleria"><X size={20} /></button>
        </header>
        <div
          className="media-gallery-stage"
          onTouchStart={(event) => {
            touchStart.current = event.changedTouches[0]?.clientX ?? null;
          }}
          onTouchEnd={(event) => {
            if (touchStart.current === null) return;
            const distance = (event.changedTouches[0]?.clientX ?? touchStart.current) - touchStart.current;
            if (Math.abs(distance) > 45) move(distance > 0 ? -1 : 1);
            touchStart.current = null;
          }}
        >
          <button className="gallery-direction is-previous" onClick={() => move(-1)} aria-label="Media precedente">
            <ChevronLeft size={25} />
          </button>
          {item.type === "video" ? (
            <video
              key={item.id}
              src={source}
              poster={item.thumbnailUrl ?? item.src}
              controls
              autoPlay
              playsInline
              preload="metadata"
              onError={playback.onError}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={item.id}
              src={source}
              alt={item.title}
              onError={() => {
                if (!fallback && item.originalUrl && source !== item.originalUrl) {
                  setFallback(true);
                }
              }}
            />
          )}
          {item.type === "video" ? <CompatibleVideoNotice playback={playback} /> : null}
          <button className="gallery-direction is-next" onClick={() => move(1)} aria-label="Media successivo">
            <ChevronRight size={25} />
          </button>
        </div>
        <footer>
          <div className="media-gallery-strip" ref={stripRef}>
            {items.map((entry, itemIndex) => (
              <button
                className={itemIndex === index ? "is-active" : ""}
                data-active={itemIndex === index}
                onClick={() => setIndex(itemIndex)}
                aria-label={`Apri ${entry.title}`}
                key={entry.id}
              >
                {entry.type === "video" ? <Film size={14} /> : <ImageIcon size={14} />}
                {entry.type === "image" || entry.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={
                      entry.thumbnailUrl ??
                      `/api/media/${encodeURIComponent(entry.id)}/display?width=240`
                    }
                    alt=""
                    loading="lazy"
                  />
                ) : null}
                <span>{entry.title}</span>
              </button>
            ))}
          </div>
          <small>Scorri le miniature, usa ← → oppure fai swipe sul contenuto.</small>
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
  onRandomHomeVisibility,
  onTvVisibility,
  tvSaving,
  onAddTag,
  onRemoveTag,
  onAddPerson,
  onRemovePerson,
  onSetGroup,
  onAddMarker,
  onEdit,
  onRename,
  onCapture,
  onQuickCapture,
  onOpenDuplicate,
  onDeleteDuplicate,
  onDelete
}: {
  item: MediaItem;
  availablePeople: TaxonomyEntry[];
  availableTags: TaxonomyEntry[];
  availableGroups: TaxonomyGroup[];
  onClose: () => void;
  onFavorite: () => void;
  onRandomHomeVisibility: () => void;
  onTvVisibility: () => void;
  tvSaving: boolean;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onAddPerson: (name: string) => void;
  onRemovePerson: (name: string) => void;
  onSetGroup: (group: TaxonomyGroup) => void;
  onAddMarker: (marker: HighlightMarker) => void;
  onEdit: () => void;
  onRename: (name: string) => void;
  onCapture: (positionMs: number) => void;
  onQuickCapture: (positionMs: number) => void;
  onOpenDuplicate: (id: string) => void;
  onDeleteDuplicate: (id: string) => void;
  onDelete: () => void;
}) {
  const [tab, setTab] = useState<"info" | "organizza" | "attivita">("info");
  const [openPicker, setOpenPicker] = useState<"people" | "tags" | "groups" | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");
  const [markerOpen, setMarkerOpen] = useState(false);
  const [markerLabel, setMarkerLabel] = useState("");
  const [markerStartMs, setMarkerStartMs] = useState(0);
  const [markerEndMs, setMarkerEndMs] = useState(10_000);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(item.title);
  const [duplicates, setDuplicates] = useState<DuplicateDetailRecord[]>([]);
  const playerRef = useRef<HTMLVideoElement>(null);
  const [currentPosition, setCurrentPosition] = useState(
    Math.min(18_000, item.durationMs ?? 18_000)
  );
  const playback = useCompatibleVideo(item);
  const seekTo = (milliseconds: number) => {
    const bounded = Math.max(0, Math.min(milliseconds, item.durationMs ?? milliseconds));
    setCurrentPosition(bounded);
    if (playerRef.current) playerRef.current.currentTime = bounded / 1000;
  };

  useEffect(() => {
    setRenameValue(item.title);
    setRenameOpen(false);
    setPickerQuery("");
    setOpenPicker(null);
  }, [item.id, item.title]);

  useEffect(() => {
    if (!item.duplicateCount) {
      setDuplicates([]);
      return;
    }
    let active = true;
    void fetch(`/api/media/${item.id}/duplicates`)
      .then((response) => response.ok ? response.json() : null)
      .then((payload: { duplicates?: DuplicateDetailRecord[] } | null) => {
        if (active) setDuplicates(payload?.duplicates ?? []);
      })
      .catch(() => {
        if (active) setDuplicates([]);
      });
    return () => { active = false; };
  }, [item.id, item.duplicateCount]);

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
            src={playback.source}
            poster={item.thumbnailUrl ?? undefined}
            controls
            playsInline
            preload="metadata"
            onError={playback.onError}
            onTimeUpdate={(event) => setCurrentPosition(event.currentTarget.currentTime * 1000)}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.src} alt={item.title} />
        )}
        {item.type === "video" ? <CompatibleVideoNotice playback={playback} /> : null}
        <div className="preview-actions">
          {item.type === "video" ? (
            <button type="button" onClick={() => onQuickCapture(currentPosition)} aria-label="Screenshot rapido" title="Screenshot rapido">
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
                    width: `${Math.max(1.2, ((marker.endMs - marker.startMs) / (item.durationMs ?? 60_000)) * 100)}%`,
                    background: marker.color
                  }}
                  title={`${marker.label} · ${formatDuration(marker.startMs)}`}
                  onClick={() => seekTo(marker.startMs)}
                />
              ))}
            </div>
            <span>{item.duration}</span>
          </div>
          <div className="marker-toolbar">
            <div>
              {(item.markers ?? []).slice(0, 3).map((marker) => (
                <button key={marker.id} onClick={() => seekTo(marker.startMs)}>
                  <i style={{ background: marker.color }} />
                  {marker.label}
                  <span>{formatDuration(marker.startMs)}</span>
                </button>
              ))}
            </div>
            <button className="add-marker-button" onClick={() => setMarkerOpen((value) => {
              if (!value) {
                setMarkerStartMs(Math.round(currentPosition));
                setMarkerEndMs(Math.min(Math.round(currentPosition + 10_000), item.durationMs ?? currentPosition + 10_000));
              }
              return !value;
            })}>
              <Plus size={14} /> Marker
            </button>
          </div>
          {markerOpen ? (
            <form
              className="marker-form marker-range-form"
              onSubmit={(event) => {
                event.preventDefault();
                onAddMarker({
                  id: `local-marker-${Date.now()}`,
                  label: markerLabel.trim() || `Momento ${formatDuration(markerStartMs)}`,
                  startMs: Math.round(markerStartMs),
                  endMs: Math.max(Math.round(markerStartMs + 250), Math.round(markerEndMs)),
                  color: "#6D5DFB",
                  featured: true
                });
                setMarkerLabel("");
                setMarkerOpen(false);
              }}
            >
              <div className="marker-range-title"><Sparkles size={15} /><input autoFocus value={markerLabel} onChange={(event) => setMarkerLabel(event.target.value)} placeholder="Titolo facoltativo" /></div>
              <div className="marker-range-inputs">
                <label><span>Inizio</span><input type="number" min={0} max={(item.durationMs ?? 0) / 1000} step="0.1" value={(markerStartMs / 1000).toFixed(1)} onChange={(event) => setMarkerStartMs(Math.max(0, Number(event.target.value) * 1000))} /><small>sec</small></label>
                <button type="button" onClick={() => setMarkerStartMs(Math.round(currentPosition))}>Usa {formatDuration(currentPosition)}</button>
                <label><span>Fine</span><input type="number" min={0} max={(item.durationMs ?? 0) / 1000} step="0.1" value={(markerEndMs / 1000).toFixed(1)} onChange={(event) => setMarkerEndMs(Math.max(markerStartMs + 250, Number(event.target.value) * 1000))} /><small>sec</small></label>
              </div>
              <div className="marker-duration-presets"><span>Durata rapida</span>{[5, 10, 20, 30, 60].map((seconds) => <button type="button" onClick={() => setMarkerEndMs(Math.min(markerStartMs + seconds * 1000, item.durationMs ?? markerStartMs + seconds * 1000))} key={seconds}>{seconds}s</button>)}<strong>{formatDuration(Math.max(0, markerEndMs - markerStartMs))}</strong></div>
              <button className="marker-range-submit" type="submit">Salva intervallo</button>
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
            <button className="capture-frame-from-inspector" onClick={() => onQuickCapture(currentPosition)}>
              <Camera size={15} />
              Screenshot rapido
              <span>1 CLICK</span>
            </button>
            <button className="capture-frame-from-inspector" onClick={() => onCapture(currentPosition)}>
              <ScanLine size={15} />
              Scegli thumbnail o cattura frame
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
            <section className="detail-section random-home-setting">
              <div>
                <Tv size={16} />
                <span>
                  <strong>Mostra nella Galleria TV</strong>
                  <small>Includi questa foto o questo video nella galleria della Fire Stick.</small>
                </span>
              </div>
              <button type="button" role="switch" aria-checked={Boolean(item.showOnTv)}
                aria-label="Mostra nella Galleria TV" disabled={tvSaving}
                className={item.showOnTv ? "toggle is-on" : "toggle"}
                onClick={onTvVisibility}><i /></button>
            </section>
            {item.type === "video" ? (
              <section className="detail-section random-home-setting">
                <div>
                  <Shuffle size={16} />
                  <span>
                    <strong>Mostra nella home</strong>
                    <small>Disattiva per non includere questo video nelle selezioni della home.</small>
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!item.hideFromRandomHome}
                  aria-label="Mostra nella home"
                  className={!item.hideFromRandomHome ? "toggle is-on" : "toggle"}
                  onClick={onRandomHomeVisibility}
                ><i /></button>
              </section>
            ) : null}
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
            {duplicates.length ? (
              <section className="detail-section inspector-duplicates">
                <div className="detail-section-title">
                  <h3><CopyCheck size={15} /> Altri duplicati</h3>
                  <span>{duplicates.length}</span>
                </div>
                <div>
                  {duplicates.map((duplicate) => (
                    <article key={duplicate.id}>
                      <button className="duplicate-detail-preview" onClick={() => onOpenDuplicate(duplicate.id)} aria-label={`Apri ${duplicate.title}`}>
                        {duplicate.thumbnailUrl ? <img src={duplicate.thumbnailUrl} alt="" /> : <Film size={18} />}
                      </button>
                      <button className="duplicate-detail-copy" onClick={() => onOpenDuplicate(duplicate.id)}>
                        <strong>{duplicate.title}</strong>
                        <small>{Math.round(duplicate.similarity * 100)}% · {formatBytes(Number(duplicate.bytes))}</small>
                        <em>{duplicate.reason}</em>
                      </button>
                      <button className="duplicate-detail-delete" onClick={() => onDeleteDuplicate(duplicate.id)} aria-label={`Elimina duplicato ${duplicate.title}`} title="Elimina duplicato"><Trash2 size={15} /></button>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}
            <section className="detail-section danger-zone">
              <div><Trash2 size={16} /><span><strong>Elimina definitivamente</strong><small>Rimuove originale, preview e record dal catalogo.</small></span></div>
              <button onClick={onDelete}>Elimina dal disco</button>
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
                {item.group === "Da catalogare"
                  ? <Inbox size={18} />
                  : <Folder size={18} />}
                <span>
                  <strong>{item.group}</strong>
                  <small>
                    {item.group === "Da catalogare"
                      ? "Nessun gruppo assegnato"
                      : "Gruppo assegnato"}
                  </small>
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
  const [checkNonce, setCheckNonce] = useState(0);

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
  }, [checkNonce, files]);

  const filesToImport = files.filter(
    (_, index) => !duplicateChecks[index]?.duplicate || forcedDuplicates.has(index)
  );
  const duplicateCount = duplicateChecks.filter(({ duplicate }) => duplicate).length;
  const duplicateIndexes = duplicateChecks.flatMap((check, index) =>
    check.duplicate ? [index] : []
  );
  const allDuplicatesForced =
    duplicateIndexes.length > 0 &&
    duplicateIndexes.every((index) => forcedDuplicates.has(index));
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
              <div>
                {duplicateCount ? (
                  <button
                    className={allDuplicatesForced ? "" : "import-all-duplicates"}
                    onClick={() => setForcedDuplicates(
                      allDuplicatesForced
                        ? new Set()
                        : new Set(duplicateIndexes)
                    )}
                  >
                    {allDuplicatesForced ? "Escludi duplicati" : "Importa comunque tutti"}
                  </button>
                ) : null}
                <button onClick={() => {
                  setFiles([]);
                  if (inputRef.current) inputRef.current.value = "";
                }}>
                  Rimuovi tutti
                </button>
              </div>
            </div>
            {files.slice(0, 8).map((file, index) => {
              const check = duplicateChecks[index];
              const forced = forcedDuplicates.has(index);
              return (
              <div
                className={check?.duplicate && !forced ? "upload-file-row is-duplicate" : "upload-file-row"}
                key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
              >
                <span>{isVideoUploadFile(file) ? <Film size={17} /> : <ImageIcon size={17} />}</span>
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
            {checkError ? (
              <div className="upload-check-error">
                <p>{checkError}</p>
                <button onClick={() => setCheckNonce((current) => current + 1)}>
                  Riprova verifica
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="upload-options">
          <label>
            <span>STATO INIZIALE</span>
            <div className="upload-catalog-state">
              <Inbox size={17} />
              <p>
                <strong>Da catalogare</strong>
                <small>Nessun performer, tag o gruppo assegnato</small>
              </p>
            </div>
          </label>
          <label>
            <span>ELABORAZIONE</span>
            <div className="upload-processing-state">
              <WandSparkles size={17} />
              <p>
                <strong>Automatica</strong>
                <small>Metadati, miniatura e anteprima</small>
              </p>
            </div>
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
              disabled={
                !files.length ||
                !filesToImport.length ||
                checking ||
                Boolean(checkError)
              }
              onClick={() => {
                onUpload(filesToImport, skippedFiles);
                onClose();
              }}
            >
              {checking
                ? "Verifica…"
                : filesToImport.length
                  ? `Importa ${filesToImport.length}`
                  : "Tutti già presenti"}
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
  selectedItems,
  onClear,
  onApply,
  onEdit,
  onOrganize,
  onTvSelection,
  tvSaving,
  onDelete
}: {
  count: number;
  tags: TaxonomyEntry[];
  people: TaxonomyEntry[];
  groups: TaxonomyGroup[];
  selectedItems: MediaItem[];
  onClear: () => void;
  onApply: (kind: "tags" | "people" | "groups", values: string[]) => Promise<boolean>;
  onEdit: () => void;
  onOrganize: () => void;
  onTvSelection: (showOnTv: boolean) => void;
  tvSaving: boolean;
  onDelete: () => void;
}) {
  const [openPicker, setOpenPicker] = useState<"tags" | "people" | "groups" | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [visibleViewportHeight, setVisibleViewportHeight] = useState(0);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      setKeyboardInset(Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)));
      setVisibleViewportHeight(Math.round(viewport.height));
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  const togglePicker = (picker: "tags" | "people" | "groups") => {
    setOpenPicker((current) => current === picker ? null : picker);
    setQuery("");
    setPicked([]);
  };

  const apply = async () => {
    if (!openPicker || !picked.length || busy) return;
    setBusy(true);
    try {
      if (await onApply(openPicker, picked)) {
        setOpenPicker(null);
        setQuery("");
        setPicked([]);
      }
    } finally {
      setBusy(false);
    }
  };

  const options = openPicker === "tags" ? tags : openPicker === "people" ? people : groups;
  const assignedCount = (kind: "tags" | "people" | "groups", value: string) => {
    if (kind === "tags") return selectedItems.filter(({ tags: itemTags }) => itemTags.includes(value)).length;
    if (kind === "people") return selectedItems.filter(({ people: itemPeople }) => itemPeople.includes(value)).length;
    const group = groups.find(({ id }) => id === value);
    return group ? selectedItems.filter((item) => item.galleries?.some(({ name }) => name === group.name) || item.group === group.name).length : 0;
  };

  const toolbarStyle = {
    "--bulk-keyboard-inset": `${keyboardInset}px`,
    "--bulk-visible-height": visibleViewportHeight ? `${visibleViewportHeight}px` : "100dvh"
  } as CSSProperties;

  return (
    <div className="bulk-toolbar" style={toolbarStyle}>
      <span className="bulk-count">{count}</span>
      <strong>{count === 1 ? "media selezionato" : "media selezionati"}</strong>
      <i />
      <div className="bulk-taxonomy-actions">
        <button onClick={() => togglePicker("tags")} className={openPicker === "tags" ? "is-active" : ""}><Tag size={16} /> Tag</button>
        <button onClick={() => togglePicker("people")} className={openPicker === "people" ? "is-active" : ""}><UsersRound size={16} /> Performer</button>
        <button onClick={() => togglePicker("groups")} className={openPicker === "groups" ? "is-active" : ""}><Layers3 size={16} /> Gallerie</button>
      </div>
      <div className="bulk-tv-actions">
        <button disabled={tvSaving || selectedItems.every((item) => item.showOnTv)} onClick={() => onTvSelection(true)}><Tv size={16} /> Aggiungi alla TV</button>
        <button disabled={tvSaving || selectedItems.every((item) => !item.showOnTv)} onClick={() => onTvSelection(false)}><X size={16} /> Rimuovi dalla TV</button>
      </div>
      <button className="bulk-secondary" onClick={onOrganize}>
        <FolderInput size={16} />
        Filesystem
      </button>
      <button className="bulk-secondary" onClick={onEdit}>
        <Scissors size={16} />
        Editor
      </button>
      <button className="danger" onClick={onDelete} aria-label={`Elimina ${count} media selezionati`}>
        <Trash2 size={16} /> Elimina
      </button>
      <button className="bulk-close" onClick={onClear} aria-label="Deseleziona tutto">
        <X size={17} />
      </button>
      {openPicker ? (
        <BulkTaxonomyPicker
          kind={openPicker}
          options={options}
          query={query}
          picked={picked}
          busy={busy}
          count={count}
          keyboardInset={keyboardInset}
          assignedCount={(value) => assignedCount(openPicker, value)}
          valueFor={(option) => openPicker === "groups" ? option.id : option.name}
          onQuery={setQuery}
          onToggle={(value) => setPicked((current) => current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value])}
          onApply={() => void apply()}
          onClose={() => setOpenPicker(null)}
        />
      ) : null}
    </div>
  );
}

function BulkTaxonomyPicker({
  kind,
  options,
  query,
  picked,
  busy,
  count,
  keyboardInset,
  assignedCount,
  valueFor,
  onQuery,
  onToggle,
  onApply,
  onClose
}: {
  kind: "tags" | "people" | "groups";
  options: Array<{ id: string; name: string; color?: string | null; count: number }>;
  query: string;
  picked: string[];
  busy: boolean;
  count: number;
  keyboardInset: number;
  assignedCount: (value: string) => number;
  valueFor: (option: { id: string; name: string }) => string;
  onQuery: (value: string) => void;
  onToggle: (value: string) => void;
  onApply: () => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (window.matchMedia("(min-width: 861px)").matches) inputRef.current?.focus();
    else inputRef.current?.closest("section")?.querySelector<HTMLButtonElement>("header button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) closeRef.current();
      if (event.key === "Tab") {
        const buttons = inputRef.current?.closest("section")?.querySelectorAll<HTMLElement>('button:not(:disabled), input');
        if (!buttons?.length) return;
        const first = buttons[0]; const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = overflow; window.removeEventListener("keydown", onKey); previous?.focus(); };
  }, []);
  const filtered = options.filter(({ name }) => name.toLocaleLowerCase("it").includes(query.trim().toLocaleLowerCase("it")));
  const exactMatch = options.some(({ name }) => name.toLocaleLowerCase("it") === query.trim().toLocaleLowerCase("it"));
  const canCreate = kind !== "groups" && query.trim().length > 0 && !exactMatch;
  const title = kind === "tags" ? "Aggiungi tag" : kind === "people" ? "Assegna performer" : "Aggiungi alle gallerie";
  const newValue = query.trim();
  const style = { "--bulk-keyboard-inset": `${keyboardInset}px` } as CSSProperties;

  return (
    createPortal(<div className="bulk-picker-backdrop" style={style} onClick={busy ? undefined : onClose}><section className="bulk-picker-panel" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
      <header><div><strong>{title}</strong><small>Seleziona voci per {count} media · massimo 30</small></div><button type="button" onClick={onClose} aria-label="Chiudi pannello" disabled={busy}><X size={17} /></button></header>
      <label className="bulk-picker-search"><Search size={16} /><input ref={inputRef} value={query} onChange={(event) => onQuery(event.target.value)} placeholder={kind === "tags" ? "Cerca o scrivi un nuovo tag" : kind === "people" ? "Cerca o scrivi un performer" : "Cerca una galleria"} /><span>{filtered.length}</span></label>
      <div className="bulk-picker-options">
        {filtered.map((option) => {
          const value = valueFor(option);
          const selected = picked.includes(value);
          const already = assignedCount(value);
          return <button type="button" disabled={picked.length >= 30 && !selected} className={selected ? "is-picked" : ""} key={option.id} onClick={() => onToggle(value)}>
            <i style={{ background: option.color ?? (kind === "groups" ? "#3f8d77" : "#6D5DFB") }}>{kind === "tags" ? <Tag size={13} /> : kind === "groups" ? <Layers3 size={13} /> : option.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</i>
            <span><strong>{option.name}</strong><small>{already === count ? "Già assegnato a tutti" : already ? `Già presente su ${already} di ${count}` : `${option.count.toLocaleString("it-IT")} media in libreria`}</small></span>
            <b aria-hidden="true">{selected ? <Check size={16} /> : <Plus size={16} />}</b>
          </button>;
        })}
        {canCreate ? <button type="button" disabled={picked.length >= 30 && !picked.includes(newValue)} className={`bulk-picker-create ${picked.includes(newValue) ? "is-picked" : ""}`} onClick={() => onToggle(newValue)}><i><Plus size={14} /></i><span><strong>Crea e assegna “{newValue}”</strong><small>La voce verrà aggiunta ai media selezionati</small></span><b>{picked.includes(newValue) ? <Check size={16} /> : null}</b></button> : null}
        {!filtered.length && !canCreate ? <p>Nessun risultato. Prova un’altra ricerca.</p> : null}
      </div>
      <footer><button type="button" className="bulk-picker-cancel" disabled={busy} onClick={onClose}>Annulla</button><button type="button" className="bulk-picker-apply" disabled={!picked.length || busy} onClick={onApply}>{busy ? "Salvataggio…" : `Applica ${picked.length || "selezione"} a ${count} media`}</button></footer>
    </section></div>, document.body)
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
        { label: "Gallerie", value: "Gruppi", icon: Layers3 },
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

function DeleteMediaDialog({ item, busy, onCancel, onConfirm }: {
  item: MediaItem;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="delete-media-backdrop" onMouseDown={() => !busy && onCancel()}>
      <section className="delete-media-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-media-title" onMouseDown={(event) => event.stopPropagation()}>
        <span><Trash2 size={22} /></span>
        <p>ELIMINAZIONE FISICA</p>
        <h2 id="delete-media-title">Eliminare “{item.title}”?</h2>
        <div><HardDrive size={17} /><span><strong>Il file verrà rimosso dal disco</strong><small>Anche thumbnail, preview, marker e collegamenti verranno eliminati. L’azione non è annullabile.</small></span></div>
        <footer><button onClick={onCancel} disabled={busy}>Annulla</button><button className="danger" onClick={onConfirm} disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}{busy ? "Eliminazione…" : "Elimina definitivamente"}</button></footer>
      </section>
    </div>
  );
}

function DeleteMultipleDialog({ items, busy, progress, onCancel, onConfirm }: {
  items: MediaItem[];
  busy: boolean;
  progress: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="delete-media-backdrop" onMouseDown={() => !busy && onCancel()}>
      <section className="delete-media-dialog" role="dialog" aria-modal="true" aria-labelledby="bulk-delete-title" onMouseDown={(event) => event.stopPropagation()}>
        <span><Trash2 size={22} /></span>
        <p>ELIMINAZIONE MULTIPLA</p>
        <h2 id="bulk-delete-title">Eliminare {items.length} media?</h2>
        <div><HardDrive size={17} /><span><strong>Originali e anteprime verranno rimossi dal disco</strong><small>{items.slice(0, 3).map(({ title }) => title).join(" · ")}{items.length > 3 ? ` · altri ${items.length - 3}` : ""}</small></span></div>
        {busy ? <small className="bulk-delete-progress">Eliminazione {Math.min(progress + 1, items.length)} di {items.length}…</small> : null}
        <footer><button onClick={onCancel} disabled={busy}>Annulla</button><button className="danger" onClick={onConfirm} disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}{busy ? "Eliminazione…" : "Elimina definitivamente"}</button></footer>
      </section>
    </div>
  );
}

export function MediaWorkspace() {
  const [activeNav, setActiveNav] = useState("Libreria");
  const [filter, setFilter] = useState<"all" | "tv" | MediaType>("all");
  const [sort, setSort] = useState<MediaSort>("smart");
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
  const [currentPage, setCurrentPage] = useState(1);
  const [homeRandomSeed, setHomeRandomSeed] = useState(createClientId);
  const [mediaLoading, setMediaLoading] = useState(true);
  const [externalScan, setExternalScan] = useState<ExternalScanState | null>(null);
  const [taxonomyPeople, setTaxonomyPeople] = useState<TaxonomyEntry[]>([]);
  const [taxonomyTags, setTaxonomyTags] = useState<TaxonomyEntry[]>([]);
  const [taxonomyGroups, setTaxonomyGroups] = useState<TaxonomyGroup[]>([]);
  const [performerGalleries, setPerformerGalleries] = useState<TaxonomyGroup[]>([]);
  const [performerGalleryRefresh, setPerformerGalleryRefresh] = useState(0);
  const [folderOptions, setFolderOptions] = useState<FolderOption[]>([]);
  const [folderFilter, setFolderFilter] = useState("");
  const [personFacets, setPersonFacets] = useState<PersonFacets | null>(null);
  const [referencePerson, setReferencePerson] = useState<TaxonomyEntry | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [inspected, setInspected] = useState<MediaItem | null>(null);
  const [expandedItem, setExpandedItem] = useState<MediaItem | null>(null);
  const [galleryItem, setGalleryItem] = useState<MediaItem | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [quickMode, setQuickMode] = useState(false);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [tvSaving, setTvSaving] = useState(false);
  const tvSavingRef = useRef(false);
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilterState>(
    emptyAdvancedFilters
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [moreToolsOpen, setMoreToolsOpen] = useState(false);
  const [highlightsOpen, setHighlightsOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editRefresh, setEditRefresh] = useState(0);
  const [organizerOpen, setOrganizerOpen] = useState(false);
  const [captureRequest, setCaptureRequest] = useState<{
    item: MediaItem;
    initialTimeMs: number;
  } | null>(null);
  const [deleteRequest, setDeleteRequest] = useState<MediaItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [bulkDeleteRequest, setBulkDeleteRequest] = useState<MediaItem[] | null>(null);
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false);
  const [bulkDeleteProgress, setBulkDeleteProgress] = useState(0);
  const scanCompletionRef = useRef<string | null>(null);
  const selectedPerson =
    advancedFilters.people.length === 1
      ? taxonomyPeople.find(({ name }) => name === advancedFilters.people[0]) ?? null
      : null;
  const performerHome = Boolean(
    selectedPerson &&
    activeNav === "Libreria" &&
    !advancedFilters.groups.length &&
    !advancedFilters.tags.length &&
    filter !== "image" && filter !== "tv"
  );

  const mediaQuery = useMemo(() => {
    const params = new URLSearchParams();
    const randomHome =
      activeNav === "Libreria" &&
      (sort === "smart" || sort === "random") &&
      filter === "all" &&
      !folderFilter &&
      countAdvancedFilters(advancedFilters) === 0;
    if (randomHome) {
      params.set("randomVideos", "true");
      params.set("seed", homeRandomSeed);
    } else if (activeNav === "Libreria" && sort === "smart") {
      params.set("discover", "true");
    }
    if (filter === "tv") { params.set("kind", "video"); params.set("tv", "true"); }
    else if (filter !== "all") params.set("kind", filter);
    if (performerHome && selectedPerson) {
      params.set("kind", "video");
      params.set("performerHome", selectedPerson.id);
    }
    params.set("sort", sort);
    if (sort === "random") params.set("seed", homeRandomSeed);
    if (activeNav === "Preferiti" || advancedFilters.favoriteOnly) {
      params.set("favorite", "true");
    }
    if (activeNav === "Da catalogare") params.set("uncatalogued", "true");
    advancedFilters.people.forEach((name) => params.append("person", name));
    advancedFilters.excludePeople.forEach((name) => params.append("excludePerson", name));
    advancedFilters.tags.forEach((name) => params.append("tag", name));
    advancedFilters.excludeTags.forEach((name) => params.append("excludeTag", name));
    advancedFilters.groups.forEach((name) => params.append("group", name));
    advancedFilters.excludeGroups.forEach((name) => params.append("excludeGroup", name));
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
  }, [activeNav, advancedFilters, filter, folderFilter, homeRandomSeed, performerHome, selectedPerson, sort]);

  const visibleItems = useMemo(() => {
    let result = filter === "tv"
      ? items.filter((item) => item.type === "video" && item.showOnTv)
      : performerHome
      ? items.filter((item) => item.type === "video")
      : filter === "all"
        ? [...items]
        : items.filter((item) => item.type === filter);
    if (activeNav === "Preferiti") result = result.filter((item) => item.favorite);
    if (activeNav === "Da catalogare") {
      result = result.filter(
        (item) =>
          !item.people.length &&
          !item.tags.length &&
          item.group === "Da catalogare"
      );
    }
    if (activeNav === "Recenti") result = result.slice(0, 7);
    if (advancedFilters.people.length) {
      result = result.filter((item) =>
        advancedFilters.people.some((person) => item.people.includes(person))
      );
    }
    if (advancedFilters.excludePeople.length) {
      result = result.filter((item) =>
        advancedFilters.excludePeople.every((person) => !item.people.includes(person))
      );
    }
    if (advancedFilters.tags.length) {
      result = result.filter((item) =>
        advancedFilters.tags.some((tag) => item.tags.includes(tag))
      );
    }
    if (advancedFilters.excludeTags.length) {
      result = result.filter((item) =>
        advancedFilters.excludeTags.every((tag) => !item.tags.includes(tag))
      );
    }
    if (advancedFilters.groups.length) {
      result = result.filter((item) => advancedFilters.groups.some((name) => item.group === name || item.galleries?.some((gallery) => gallery.name === name)));
    }
    if (advancedFilters.excludeGroups.length) {
      result = result.filter((item) => !advancedFilters.excludeGroups.some((name) => item.group === name || item.galleries?.some((gallery) => gallery.name === name)));
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
    return result;
  }, [activeNav, advancedFilters, filter, items, performerHome, sort]);

  const selectedItems = useMemo(
    () => visibleItems.filter((item) => selectedIds.has(item.id)),
    [visibleItems, selectedIds]
  );
  useEffect(() => {
    const visibleIds = new Set(visibleItems.map(({ id }) => id));
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => visibleIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [visibleItems]);
  const advancedFilterCount = countAdvancedFilters(advancedFilters);
  const simpleHome =
    activeNav === "Libreria" &&
    filter === "all" &&
    sort === "smart" &&
    !folderFilter &&
    advancedFilterCount === 0;
  useEffect(() => {
    if (!selectedPerson) {
      setPerformerGalleries([]);
      return;
    }
    let active = true;
    void fetch(`/api/taxonomy/people/${selectedPerson.id}/galleries`)
      .then((response) => response.ok ? response.json() : null)
      .then((payload: { galleries?: TaxonomyGroup[] } | null) => {
        if (active) setPerformerGalleries(payload?.galleries ?? []);
      })
      .catch(() => {
        if (active) setPerformerGalleries([]);
      });
    return () => { active = false; };
  }, [selectedPerson?.id, performerGalleryRefresh]);
  useEffect(() => {
    if (activeNav === "Galleria" && !advancedFilters.groups.length) setActiveNav("Libreria");
  }, [activeNav, advancedFilters.groups.length]);

  const imageCount = libraryCounts.image;
  const videoCount = libraryCounts.video;
  const uncataloguedCount = libraryCounts.uncatalogued;
  const pageCount = Math.max(1, Math.ceil(libraryTotal / MEDIA_PAGE_SIZE));
  const pageStart = libraryTotal
    ? (currentPage - 1) * MEDIA_PAGE_SIZE + 1
    : 0;
  const pageEnd = Math.min(currentPage * MEDIA_PAGE_SIZE, libraryTotal);
  const paginationPages = [...new Set([
    1,
    currentPage - 2,
    currentPage - 1,
    currentPage,
    currentPage + 1,
    currentPage + 2,
    pageCount
  ])]
    .filter((page) => page >= 1 && page <= pageCount)
    .sort((left, right) => left - right);
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
    setCurrentPage(1);
    setSelectedIds(new Set());
  }, [mediaQuery]);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(mediaQuery);
    params.set("take", String(MEDIA_PAGE_SIZE));
    params.set("page", String(currentPage));
    setMediaLoading(true);
    void fetch(`/api/media?${params.toString()}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: {
        items?: PersistedMediaRecord[];
        mode?: string;
        total?: number;
        counts?: { all: number; image: number; video: number; uncatalogued: number };
      } | null) => {
        if (!active || !Array.isArray(payload?.items)) return;
        const demoTvSelection = payload.mode === "demo" ? readDemoTvSelection() : new Set<string>();
        setItems(
          payload.mode === "demo"
            ? demoMedia.slice(
                (currentPage - 1) * MEDIA_PAGE_SIZE,
                currentPage * MEDIA_PAGE_SIZE
              ).map((item) => ({ ...item, showOnTv: demoTvSelection.has(item.id) }))
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
              (item) =>
                !item.people.length &&
                !item.tags.length &&
                item.group === "Da catalogare"
            ).length
          });
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setMediaLoading(false);
      });
    return () => {
      active = false;
    };
  }, [currentPage, mediaQuery, mediaRefreshNonce]);

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
          images?: TaxonomyEntry["images"];
        }>;
        groups?: Array<string | {
          id: string;
          name: string;
          accent?: string | null;
          count?: number;
          images?: TaxonomyEntry["images"];
        }>;
      } | null) => {
        if (!active || !payload) return;
        setTaxonomyPeople((payload.people ?? []).map((entry) =>
          typeof entry === "string"
            ? {
                id: `demo-person-${entry}`,
                name: entry,
                count: demoMedia.filter((item) => item.people.includes(entry)).length,
                images: demoMedia.filter((item) => item.people.includes(entry)).slice(0, 4).map((item) => ({ mediaId: item.id, title: item.title, url: item.thumbnailUrl ?? item.src }))
              }
            : {
                id: entry.id,
                name: entry.name,
                count: entry.count ?? 0,
                images: entry.images
              }
        ));
        setTaxonomyTags((payload.tags ?? []).map((entry) => typeof entry === "string"
          ? { id: `demo-tag-${entry}`, name: entry, color: "#6D5DFB", count: demoMedia.filter((item) => item.tags.includes(entry)).length, images: demoMedia.filter((item) => item.tags.includes(entry)).slice(0, 4).map((item) => ({ mediaId: item.id, title: item.title, url: item.thumbnailUrl ?? item.src })) }
          : {
              id: entry.id,
              name: entry.name,
              color: entry.color ?? "#6D5DFB",
              count: entry.count ?? 0,
              images: entry.images
            }));
        setTaxonomyGroups((payload.groups ?? []).map((entry) =>
          typeof entry === "string"
            ? {
                id: `demo-group-${entry}`,
                name: entry,
                color: "#F97316",
                count: demoMedia.filter((item) => item.group === entry).length,
                images: demoMedia.filter((item) => item.group === entry).slice(0, 4).map((item) => ({ mediaId: item.id, title: item.title, url: item.thumbnailUrl ?? item.src }))
              }
            : {
                id: entry.id,
                name: entry.name,
                color: entry.accent ?? "#F97316",
                count: entry.count ?? 0,
                images: entry.images
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
    const previous = Boolean(item.favorite);
    const favorite = !previous;
    updateItem(item.id, (current) => ({ ...current, favorite }));
    void fetch(`/api/media/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ favorite })
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as { item?: PersistedMediaRecord; error?: string; mode?: string } | null;
        if (!response.ok || (!payload?.item && payload?.mode !== "demo")) throw new Error(payload?.error ?? "Preferito non salvato");
        if (payload.item) replacePersistedItem(payload.item);
        setToast(favorite ? "Aggiunto ai preferiti" : "Rimosso dai preferiti");
      })
      .catch((error) => {
        updateItem(item.id, (current) => ({ ...current, favorite: previous }));
        setToast(error instanceof Error ? error.message : "Preferito non salvato");
      });
  };

  const toggleRandomHomeVisibility = async (item: MediaItem) => {
    const previous = Boolean(item.hideFromRandomHome);
    const hideFromRandomHome = !previous;
    updateItem(item.id, (current) => ({ ...current, hideFromRandomHome }));
    await fetch(`/api/media/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hideFromRandomHome })
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as {
          item?: PersistedMediaRecord;
          error?: string;
          mode?: string;
        } | null;
        if (!response.ok || (!payload?.item && payload?.mode !== "demo")) {
          throw new Error(payload?.error ?? "Preferenza home non salvata");
        }
        if (payload.item) replacePersistedItem(payload.item);
        setToast(hideFromRandomHome ? "Video escluso dalla home" : "Video incluso nella home");
      })
      .catch((error) => {
        updateItem(item.id, (current) => ({ ...current, hideFromRandomHome: previous }));
        setToast(error instanceof Error ? error.message : "Preferenza home non salvata");
      });
  };

  const setTvSelection = async (targets: MediaItem[], showOnTv: boolean) => {
    if (tvSavingRef.current || !targets.length) return;
    tvSavingRef.current = true;
    setTvSaving(true);
    try {
      const response = await fetch("/api/media/tv-selection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaIds: targets.map(({ id }) => id), showOnTv })
      });
      const payload = await response.json().catch(() => null) as { mediaIds?: string[]; error?: string; mode?: string } | null;
      if (!response.ok || !payload?.mediaIds) throw new Error(payload?.error ?? "Selezione TV non salvata");
      if (payload.mode === "demo") saveDemoTvSelection(payload.mediaIds, showOnTv);
      const ids = new Set(payload.mediaIds);
      setItems((current) => current.map((item) => ids.has(item.id) ? { ...item, showOnTv } : item));
      setInspected((current) => current && ids.has(current.id) ? { ...current, showOnTv } : current);
      setToast(`${ids.size} ${ids.size === 1 ? "contenuto" : "contenuti"} ${showOnTv ? "aggiunti alla" : "rimossi dalla"} Galleria TV${payload.mode === "demo" ? " · Demo, solo questo browser" : ""}`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Selezione TV non salvata");
    } finally {
      tvSavingRef.current = false;
      setTvSaving(false);
    }
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
          images?: TaxonomyEntry["images"];
        }>;
        groups?: Array<{
          id: string;
          name: string;
          accent?: string | null;
          count?: number;
          images?: TaxonomyEntry["images"];
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
          count: entry.count ?? 0,
          images: entry.images
        })));
        setTaxonomyGroups((payload.groups ?? []).map((entry) => ({
          id: entry.id,
          name: entry.name,
          color: entry.accent ?? "#F97316",
          count: entry.count ?? 0,
          images: entry.images
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

  const applyTaxonomyToSelection = async (
    kind: "tags" | "people" | "groups",
    values: string[]
  ): Promise<boolean> => {
    const targetIds = selectedItems.map(({ id }) => id);
    if (!targetIds.length || !values.length) return false;
    const payload = {
      mediaIds: targetIds,
      ...(kind === "tags" ? { addTagNames: values } : {}),
      ...(kind === "people" ? { addPersonNames: values } : {}),
      ...(kind === "groups" ? { addGroupIds: values } : {})
    };
    try {
      const response = await fetch("/api/media/bulk-taxonomy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => null) as { updated?: number; error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "Assegnazione non riuscita");
      const selectedNames = kind === "groups"
        ? values.map((id) => [...taxonomyGroups, ...performerGalleries].find((group) => group.id === id)?.name ?? id)
        : values;
      const category = kind === "tags" ? "Tag" : kind === "people" ? "Performer" : "Gallerie";
      setToast(`${category} aggiornati su ${result?.updated ?? targetIds.length} media: ${selectedNames.join(", ")}`);
      setMediaRefreshNonce((current) => current + 1);
      reloadTaxonomy();
      if (kind === "groups" && values.some((id) => [...taxonomyGroups, ...performerGalleries].find((group) => group.id === id)?.ownerPersonId)) {
        setPerformerGalleryRefresh((current) => current + 1);
      }
      return true;
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Assegnazione non riuscita");
      setMediaRefreshNonce((current) => current + 1);
      return false;
    }
  };

  const addMarker = (item: MediaItem, marker: HighlightMarker) => {
    updateItem(item.id, (current) => ({
      ...current,
      markers: [...(current.markers ?? []), marker]
    }));
    setToast(`Salvo “${marker.label}”…`);
    void fetch(`/api/media/${item.id}/markers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(marker)
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as { marker?: HighlightMarker; error?: string } | null;
        if (!response.ok || !payload?.marker) throw new Error(payload?.error ?? "Marker non salvato");
        updateItem(item.id, (current) => ({
          ...current,
          markers: (current.markers ?? []).map((entry) => entry.id === marker.id ? payload.marker! : entry)
        }));
        setToast(`Momento “${payload.marker.label}” aggiunto`);
      })
      .catch((error) => {
        updateItem(item.id, (current) => ({ ...current, markers: (current.markers ?? []).filter(({ id }) => id !== marker.id) }));
        setToast(error instanceof Error ? error.message : "Marker non salvato");
      });
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

  const quickCapture = (item: MediaItem, timestampMs: number) => {
    setToast(`Cattura a ${formatDuration(timestampMs)}…`);
    void fetch(`/api/media/${item.id}/screenshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timestampMs: Math.max(0, Math.round(timestampMs)) })
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as { item?: PersistedMediaRecord; error?: string } | null;
        if (!response.ok || !payload?.item) throw new Error(payload?.error ?? "Screenshot non riuscito");
        addCapturedFrame(payload.item);
      })
      .catch((error) => setToast(error instanceof Error ? error.message : "Screenshot non riuscito"));
  };

  const setThumbnailFromFrame = async (item: MediaItem, timestampMs: number) => {
    setToast(`Imposto la thumbnail da ${formatDuration(timestampMs)}…`);
    try {
      const response = await fetch(`/api/media/${item.id}/thumbnail`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timestampMs: Math.max(0, Math.round(timestampMs)) })
      });
      const payload = await response.json().catch(() => null) as {
        item?: PersistedMediaRecord;
        error?: string;
        mode?: string;
      } | null;
      if (!response.ok || (!payload?.item && payload?.mode !== "demo")) {
        throw new Error(payload?.error ?? "Thumbnail non aggiornata");
      }
      if (payload.item) replacePersistedItem(payload.item);
      setToast(`Thumbnail aggiornata a ${formatDuration(timestampMs)}`);
      return true;
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Thumbnail non aggiornata");
      return false;
    }
  };

  const openMediaById = (id: string) => {
    const loaded = items.find((item) => item.id === id);
    if (loaded) {
      setInspected(loaded);
      return;
    }
    void fetch(`/api/media/${id}`)
      .then((response) => response.ok ? response.json() : null)
      .then((payload: { item?: PersistedMediaRecord } | null) => {
        if (payload?.item) setInspected(persistedToMedia(payload.item));
      })
      .catch(() => setToast("Media non disponibile"));
  };

  const requestDeleteMediaById = (id: string) => {
    const loaded = items.find((item) => item.id === id);
    if (loaded) {
      setDeleteRequest(loaded);
      return;
    }
    void fetch(`/api/media/${id}`)
      .then((response) => response.ok ? response.json() : null)
      .then((payload: { item?: PersistedMediaRecord } | null) => {
        if (payload?.item) setDeleteRequest(persistedToMedia(payload.item));
        else setToast("Duplicato non disponibile");
      })
      .catch(() => setToast("Duplicato non disponibile"));
  };

  const deleteMedia = () => {
    if (!deleteRequest || deleteBusy) return;
    const target = deleteRequest;
    setDeleteBusy(true);
    void fetch(`/api/media/${target.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true })
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        if (!response.ok) throw new Error(payload?.error ?? "Eliminazione non riuscita");
        setItems((current) => current.filter(({ id }) => id !== target.id));
        setLibraryTotal((current) => Math.max(0, current - 1));
        setInspected((current) => current?.id === target.id
          ? null
          : current
            ? { ...current, duplicateCount: Math.max(0, (current.duplicateCount ?? 0) - 1) }
            : current);
        setDeleteRequest(null);
        setMediaRefreshNonce((current) => current + 1);
        setToast(`“${target.title}” eliminato dal disco`);
      })
      .catch((error) => setToast(error instanceof Error ? error.message : "Eliminazione non riuscita"))
      .finally(() => setDeleteBusy(false));
  };

  const deleteSelectedMedia = async () => {
    if (!bulkDeleteRequest?.length || bulkDeleteBusy) return;
    const targets = bulkDeleteRequest;
    const deletedIds = new Set<string>();
    const failures: string[] = [];
    setBulkDeleteBusy(true);
    setBulkDeleteProgress(0);
    for (const [index, target] of targets.entries()) {
      try {
        const response = await fetch(`/api/media/${target.id}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: true })
        });
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        if (!response.ok) throw new Error(payload?.error ?? "Eliminazione non riuscita");
        deletedIds.add(target.id);
      } catch (error) {
        failures.push(`${target.title}: ${error instanceof Error ? error.message : "errore"}`);
      }
      setBulkDeleteProgress(index + 1);
    }
    if (deletedIds.size) {
      setItems((current) => current.filter(({ id }) => !deletedIds.has(id)));
      setLibraryTotal((current) => Math.max(0, current - deletedIds.size));
      setInspected((current) => current && deletedIds.has(current.id) ? null : current);
      setSelectedIds((current) => new Set([...current].filter((id) => !deletedIds.has(id))));
      setMediaRefreshNonce((current) => current + 1);
    }
    setBulkDeleteBusy(false);
    setBulkDeleteRequest(null);
    setToast(failures.length
      ? `${deletedIds.size} eliminati · ${failures.length} non riusciti: ${failures[0]}`
      : `${deletedIds.size} media eliminati dal disco`);
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
    const importIds = files.map(() => createClientId());
    const created = files.map((file, index): MediaItem => {
      const localUrl = URL.createObjectURL(file);
      const isVideo = isVideoUploadFile(file);
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
    if (files.length) setActiveNav("Gestione libreria");

    let nextUpload = 0;
    let succeeded = 0;
    let failed = 0;
    const failureMessages: string[] = [];
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
            throw new Error("Il server non ha restituito il media importato");
          }
          const serverItem = persistedToMedia(payload.item, localItem.src);
          succeeded += 1;
          setItems((current) =>
            current.map((item) => (item.id === localItem.id ? serverItem : item))
          );
          setInspected((current) =>
            current?.id === localItem.id ? serverItem : current
          );
        } catch (error) {
          failed += 1;
          failureMessages.push(
            error instanceof Error ? error.message : "Importazione non riuscita"
          );
          setItems((current) => current.filter((item) => item.id !== localItem.id));
          setInspected((current) => (current?.id === localItem.id ? null : current));
          URL.revokeObjectURL(localItem.src);
        }
      }
    };

    void Promise.all(
      Array.from({ length: Math.min(2, files.length) }, () => uploadNext())
    ).then(() => {
      if (succeeded) setMediaRefreshNonce((current) => current + 1);
      if (failed) {
        setToast(
          `${succeeded} importati · ${failed} non riusciti · ${failureMessages[0] ?? "Errore sconosciuto"}`
        );
      } else if (succeeded) {
        setToast(
          `${succeeded} ${succeeded === 1 ? "file caricato" : "file caricati"} · elaborazione visibile in Gestione libreria`
        );
      }
      window.setTimeout(() => {
        created.forEach(({ src }) => {
          if (src.startsWith("blob:")) URL.revokeObjectURL(src);
        });
      }, 2500);
    });
  };

  const startExternalScan = () => {
    void fetch("/api/library/scan", { method: "POST" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { scan?: ExternalScanState } | null) => {
        if (payload?.scan) setExternalScan(payload.scan);
      })
      .catch(() => undefined);
  };

  const createTaxonomyEntry = (kind: "PERSON" | "TAG" | "GROUP", name: string) => {
    return fetch("/api/taxonomy", {
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
        } else if (kind === "TAG") {
          setTaxonomyTags((current) => [
            ...current.filter(({ id }) => id !== entry.id),
            entry
          ].sort((left, right) => left.name.localeCompare(right.name)));
        } else {
          setTaxonomyGroups((current) => [
            ...current.filter(({ id }) => id !== entry.id),
            { ...entry, color: entry.color ?? "#F97316" }
          ].sort((left, right) => left.name.localeCompare(right.name)));
        }
        setToast(`${kind === "PERSON" ? "Performer" : kind === "GROUP" ? "Galleria" : "Tag"} “${name}” ${kind === "GROUP" ? "creata" : "creato"}`);
        return true;
      })
      .catch((error) => {
        setToast(error instanceof Error ? error.message : "Creazione non riuscita");
        return false;
      });
  };

  const createPerformerGallery = async (person: TaxonomyEntry, name: string) => {
    try {
      const response = await fetch(`/api/taxonomy/people/${person.id}/galleries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
      });
      const payload = await response.json().catch(() => null) as {
        gallery?: TaxonomyGroup;
        error?: string;
      } | null;
      if (!response.ok || !payload?.gallery) {
        throw new Error(payload?.error ?? "Galleria performer non creata");
      }
      setPerformerGalleries((current) => [
        ...current.filter(({ id }) => id !== payload.gallery?.id),
        payload.gallery as TaxonomyGroup
      ].sort((left, right) => left.name.localeCompare(right.name, "it")));
      setToast(`Galleria “${name}” creata per ${person.name}`);
      return true;
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Galleria performer non creata");
      return false;
    }
  };

  const assignGalleryToPerformer = async (person: TaxonomyEntry, galleryId: string) => {
    const source = taxonomyGroups.find(({ id }) => id === galleryId);
    if (!source) return false;
    try {
      const response = await fetch(`/api/taxonomy/people/${person.id}/galleries`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ galleryId })
      });
      const payload = await response.json().catch(() => null) as {
        gallery?: TaxonomyGroup;
        assignedMedia?: number;
        mode?: string;
        error?: string;
      } | null;
      if (!response.ok || !payload?.gallery) {
        throw new Error(payload?.error ?? "Galleria non assegnata");
      }
      const assigned = payload.mode === "demo"
        ? { ...source, ownerPersonId: person.id }
        : payload.gallery;
      setTaxonomyGroups((current) => current.filter(({ id }) => id !== galleryId));
      setPerformerGalleries((current) => [
        ...current.filter(({ id }) => id !== galleryId),
        assigned
      ].sort((left, right) => left.name.localeCompare(right.name, "it")));
      setItems((current) => current.map((item) =>
        item.group === source.name && !item.people.includes(person.name)
          ? { ...item, people: [...item.people, person.name] }
          : item
      ));
      setPerformerGalleryRefresh((current) => current + 1);
      setToast(`Galleria “${source.name}” assegnata a ${person.name} · ${payload.assignedMedia ?? source.count} media`);
      return true;
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Galleria non assegnata");
      return false;
    }
  };

  const goToPage = (page: number) => {
    const nextPage = Math.max(1, Math.min(page, pageCount));
    if (nextPage === currentPage) return;
    setMediaLoading(true);
    setCurrentPage(nextPage);
    setSelectedIds(new Set());
    setInspected(null);
    window.requestAnimationFrame(() => {
      document.querySelector(".library-toolbar")?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    });
  };

  const openGallery = (name: string) => {
    setAdvancedFilters({ ...emptyAdvancedFilters, groups: [name] });
    setFilter("all");
    setFolderFilter("");
    setCurrentPage(1);
    setSelectedIds(new Set());
    setInspected(null);
    setActiveNav("Galleria");
    setMobileSidebar(false);
  };

  const navigate = (value: string) => {
    if (value === "Cerca") {
      setCommandOpen(true);
      return;
    }
    if (value === "Libreria" && activeNav !== "Libreria") {
      setHomeRandomSeed(createClientId());
    }
    if (activeNav === "Galleria") setAdvancedFilters(emptyAdvancedFilters);
    setSelectedIds(new Set());
    setInspected(null);
    setActiveNav(value);
    setMobileSidebar(false);
  };

  return (
    <div className={inspected ? "app-shell has-inspector" : "app-shell"}>
      <div className={mobileSidebar ? "sidebar-drawer is-open" : "sidebar-drawer"}>
        <Sidebar
          active={activeNav}
          galleries={taxonomyGroups}
          activeGallery={activeNav === "Galleria" ? advancedFilters.groups[0] : undefined}
          onOpenGallery={openGallery}
          onCreateGallery={async (name) => {
            const created = await createTaxonomyEntry("GROUP", name);
            if (created) openGallery(name);
            return created;
          }}
          uncataloguedCount={uncataloguedCount}
          duplicateCount={duplicateCount}
          onNavigate={navigate}
        />
        <button className="drawer-scrim" onClick={() => setMobileSidebar(false)} aria-label="Chiudi menu" />
      </div>

      <Topbar
        editRefresh={editRefresh}
        onOpenResult={openMediaById}
        active={activeNav}
        onCommand={() => setCommandOpen(true)}
        onUpload={() => setUploadOpen(true)}
        onMobileMenu={() => setMobileSidebar(true)}
      />

      <main
        className={[
          "main-content",
          ["Persone", "Tag", "Gruppi"].includes(activeNav) ? "is-taxonomy-view" : "",
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
        {simpleHome ? (
          <section className="simple-home-intro">
            <div>
              <p className="eyebrow">HOME</p>
              <h1>Video casuali</h1>
              <p>
                Una selezione diversa dal tuo archivio a ogni apertura.
                {libraryCounts.video ? ` ${libraryCounts.video.toLocaleString("it-IT")} video disponibili.` : ""}
              </p>
            </div>
            <button
              onClick={() => {
                setMediaLoading(true);
                setCurrentPage(1);
                setHomeRandomSeed(createClientId());
              }}
            >
              <Shuffle size={17} />
              Nuova selezione
            </button>
          </section>
        ) : (
        <section className="page-intro">
          <div>
            <p className="eyebrow">
              {activeNav === "Persone" ? "CAST & PERFORMER" : "CATALOGO PRIVATO"}
            </p>
            <h1>
              {activeNav === "Galleria" ? (
                <>{advancedFilters.groups[0] ?? "Galleria"}</>
              ) : activeNav === "Persone" ? (
                <>I tuoi <em>performer.</em></>
              ) : (
                <>La tua collezione, <em>organizzata.</em></>
              )}
            </h1>
            <p className="page-subtitle">
              {activeNav === "Galleria"
                ? "Seleziona i media dalla libreria e usa Aggiungi alla galleria per inserirli qui."
                : activeNav === "Persone"
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
        )}

        {externalScan?.running || externalScan?.error ? (
          <ExternalLibraryRail scan={externalScan} onScan={startExternalScan} />
        ) : null}
        <StatusRail items={items} />

        <section className={`library-toolbar${simpleHome ? " is-simplified" : ""}${moreToolsOpen ? " show-more" : ""}`}>
          <div className="filter-tabs">
            {[
              { value: "all", label: "Tutti", count: libraryCounts.all },
              { value: "image", label: "Foto", count: imageCount },
              { value: "video", label: "Video", count: videoCount },
              { value: "tv", label: "In TV", count: filter === "tv" ? libraryTotal : undefined }
            ].map((entry) => (
              <button
                className={filter === entry.value ? "is-active" : ""}
                key={entry.value}
                onClick={() => {
                  setMediaLoading(true);
                  setFilter(entry.value as typeof filter);
                }}
              >
                {entry.label}
                {entry.count !== undefined ? <span>{entry.count.toLocaleString("it-IT")}</span> : null}
              </button>
            ))}
          </div>
          <div className="toolbar-actions">
            <label className={folderFilter ? "folder-filter is-active" : "folder-filter"}>
              <Folder size={16} />
              <select
                value={folderFilter}
                onChange={(event) => {
                  setMediaLoading(true);
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
            {simpleHome ? (
              <button
                className="tool-button toolbar-more-toggle"
                onClick={() => setMoreToolsOpen((value) => !value)}
                aria-expanded={moreToolsOpen}
              >
                <SlidersHorizontal size={16} />
                {moreToolsOpen ? "Meno" : "Altro"}
              </button>
            ) : null}
            <label className="tool-button sort-button" title="Ordina l’intero catalogo">
              <ArrowDownUp size={16} />
              <select aria-label="Ordinamento media" value={sort} onChange={(event) => {
                setMediaLoading(true);
                setCurrentPage(1);
                setSelectedIds(new Set());
                setSort(event.target.value as MediaSort);
                if (event.target.value === "random") setHomeRandomSeed(createClientId());
              }}>
                {mediaSortGroups.map((group) => <optgroup key={group.label} label={group.label}>
                  {group.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </optgroup>)}
              </select>
              <ChevronDown size={14} />
            </label>
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
              <button
                onClick={() => setGalleryItem(visibleItems[0] ?? null)}
                aria-label="Apri galleria"
                title="Apri galleria scorrevole"
                disabled={!visibleItems.length || mediaLoading}
              >
                <ImageIcon size={17} />
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
            {[
              ...advancedFilters.people.map((name) => ({ kind: "person", name })),
              ...advancedFilters.tags.map((name) => ({ kind: "tag", name })),
              ...advancedFilters.groups.map((name) => ({ kind: "group", name }))
            ].map(({ kind, name }) => (
              <button key={`include-${kind}-${name}`} onClick={() => setAdvancedFilters((current) => ({
                ...current,
                people: kind === "person"
                  ? current.people.filter((value) => value !== name)
                  : current.people,
                tags: kind === "tag"
                  ? current.tags.filter((value) => value !== name)
                  : current.tags,
                groups: kind === "group"
                  ? current.groups.filter((value) => value !== name)
                  : current.groups
              }))}>{name}<X size={12} /></button>
            ))}
            {[
              ...advancedFilters.excludePeople.map((name) => ({ kind: "person", name })),
              ...advancedFilters.excludeTags.map((name) => ({ kind: "tag", name })),
              ...advancedFilters.excludeGroups.map((name) => ({ kind: "group", name }))
            ].map(({ kind, name }) => (
              <button
                className="is-negative"
                key={`exclude-${kind}-${name}`}
                onClick={() => setAdvancedFilters((current) => ({
                  ...current,
                  excludePeople: kind === "person"
                    ? current.excludePeople.filter((value) => value !== name)
                    : current.excludePeople,
                  excludeTags: kind === "tag"
                    ? current.excludeTags.filter((value) => value !== name)
                    : current.excludeTags,
                  excludeGroups: kind === "group"
                    ? current.excludeGroups.filter((value) => value !== name)
                    : current.excludeGroups
                }))}
              >
                Senza {name}<X size={12} />
              </button>
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
                <strong>{activeNav === "Persone" ? "Performer" : activeNav === "Gruppi" ? "Gallerie" : activeNav === "Galleria" ? advancedFilters.groups[0] ?? "Galleria" : activeNav}</strong>
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
          <><PerformerHomeHeader
            key={selectedPerson.id}
            person={selectedPerson}
            globalGalleries={taxonomyGroups}
            onManageImages={() => setReferencePerson(selectedPerson)}
            onCreateGallery={(name) => createPerformerGallery(selectedPerson, name)}
            onAssignGallery={(galleryId) => assignGalleryToPerformer(selectedPerson, galleryId)}
          /><PersonFacetTabs
            person={selectedPerson.name}
            facets={personFacets}
            activeTag={advancedFilters.tags[0]}
            activeGroup={advancedFilters.groups[0]}
            onAll={() => {
              setMediaLoading(true);
              setAdvancedFilters((current) => ({
                ...current,
                tags: [],
                groups: []
              }));
            }}
            onTag={(name) => {
              setMediaLoading(true);
              setAdvancedFilters((current) => ({
                ...current,
                tags: [name],
                excludeTags: current.excludeTags.filter((entry) => entry !== name),
                groups: []
              }));
            }}
            onGroup={(name) => {
              setMediaLoading(true);
              setAdvancedFilters((current) => ({
                ...current,
                tags: [],
                groups: [name],
                excludeGroups: current.excludeGroups.filter((entry) => entry !== name)
              }));
            }}
          /></>
        ) : null}

        {activeNav === "Persone" ? (
          <TaxonomyManager
            kind="people"
            entries={taxonomyPeople}
            onCreate={(name) => createTaxonomyEntry("PERSON", name)}
            onOpen={(name) => {
              setMediaLoading(true);
              setFilter("all");
              setAdvancedFilters((current) => ({
                ...current,
                people: [name],
                excludePeople: current.excludePeople.filter((entry) => entry !== name)
              }));
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
              setMediaLoading(true);
              setAdvancedFilters((current) => ({
                ...current,
                tags: [name],
                excludeTags: current.excludeTags.filter((entry) => entry !== name)
              }));
              setActiveNav("Libreria");
            }}
          />
        ) : activeNav === "Gruppi" ? (
          <TaxonomyManager
            kind="groups"
            entries={taxonomyGroups}
            onCreate={(name) => createTaxonomyEntry("GROUP", name)}
            onOpen={openGallery}
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

            {pageCount > 1 ? (
              <div className="pagination-top"><span>Pagina {currentPage} di {pageCount}</span><Pagination currentPage={currentPage} pageCount={pageCount} pages={paginationPages} loading={mediaLoading} onPage={goToPage} /></div>
            ) : null}

            {mediaLoading ? (
              <section className="media-loading-state" aria-label="Caricamento pagina">
                <div>
                  <LoaderCircle className="spin" size={22} />
                  <span>
                    <strong>Carico la pagina {currentPage}</strong>
                    <small>Sto applicando filtri e ordinamento all’intero catalogo…</small>
                  </span>
                </div>
                <div className="media-loading-grid">
                  {Array.from({ length: 12 }).map((_, index) => <i key={index} />)}
                </div>
              </section>
            ) : (
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
                    selectionMode={selectedIds.size > 0}
                    quickMode={quickMode}
                    quickTags={taxonomyTags.map(({ name, color }) => ({
                      name,
                      color: color ?? "#6D5DFB"
                    }))}
                    onOpen={setInspected}
                    onOpenLarge={setExpandedItem}
                    onOpenGallery={setGalleryItem}
                    onSelect={toggleSelect}
                    onFavorite={toggleFavorite}
                    onHomeVisibility={toggleRandomHomeVisibility}
                    onQuickTag={addTag}
                    key={item.id}
                  />
                ))}
              </section>
            )}

            {!mediaLoading && !visibleItems.length ? (
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
                {libraryTotal
                  ? `${pageStart.toLocaleString("it-IT")}–${pageEnd.toLocaleString("it-IT")} di ${libraryTotal.toLocaleString("it-IT")} media`
                  : "Nessun media"}
              </span>
              <Pagination currentPage={currentPage} pageCount={pageCount} pages={paginationPages} loading={mediaLoading} onPage={goToPage} />
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
          onRandomHomeVisibility={() => toggleRandomHomeVisibility(inspected)}
          onTvVisibility={() => void setTvSelection([inspected], !inspected.showOnTv)}
          tvSaving={tvSaving}
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
          onQuickCapture={(positionMs) => quickCapture(inspected, positionMs)}
          onOpenDuplicate={openMediaById}
          onDeleteDuplicate={requestDeleteMediaById}
          onDelete={() => setDeleteRequest(inspected)}
        />
      ) : null}

      {expandedItem ? (
        <FullMediaPlayer
          item={expandedItem}
          onClose={() => setExpandedItem(null)}
        />
      ) : null}
      {galleryItem ? (
        <MediaGallery
          items={visibleItems}
          initialId={galleryItem.id}
          onClose={() => setGalleryItem(null)}
        />
      ) : null}

      {selectedItems.length ? (
        <BulkToolbar
          count={selectedItems.length}
          tags={taxonomyTags}
          people={taxonomyPeople}
          groups={selectedPerson ? [...taxonomyGroups, ...performerGalleries] : taxonomyGroups}
          selectedItems={selectedItems}
          onClear={() => setSelectedIds(new Set())}
          onApply={applyTaxonomyToSelection}
          onEdit={() => setEditorOpen(true)}
          onOrganize={() => setOrganizerOpen(true)}
          onTvSelection={(showOnTv) => void setTvSelection(selectedItems, showOnTv)}
          tvSaving={tvSaving}
          onDelete={() => setBulkDeleteRequest(selectedItems)}
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
          resultCount={libraryTotal}
          onApply={(filters) => {
            setMediaLoading(true);
            setAdvancedFilters(filters);
          }}
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
          onCreated={(message) => { setToast(message); setEditRefresh((value) => value + 1); }}
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
          onSetThumbnail={(positionMs) => setThumbnailFromFrame(captureRequest.item, positionMs)}
          onAddMarker={(marker) => addMarker(captureRequest.item, marker)}
        />
      ) : null}
      {deleteRequest ? (
        <DeleteMediaDialog item={deleteRequest} busy={deleteBusy} onCancel={() => setDeleteRequest(null)} onConfirm={deleteMedia} />
      ) : null}
      {bulkDeleteRequest ? (
        <DeleteMultipleDialog
          items={bulkDeleteRequest}
          busy={bulkDeleteBusy}
          progress={bulkDeleteProgress}
          onCancel={() => setBulkDeleteRequest(null)}
          onConfirm={() => void deleteSelectedMedia()}
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
