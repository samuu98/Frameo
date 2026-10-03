"use client";

import { useEffect, useRef, useState } from "react";
import { demoMedia } from "@/data/media";
import { demoTvStorageKey, readDemoTvSelection } from "@/lib/demo-tv-selection";
import type { PersistedMediaRecord } from "@/types/media";

type TvItem = Pick<PersistedMediaRecord, "id" | "title" | "kind" | "thumbnailUrl" | "previewUrl" | "originalUrl" | "streamUrl" | "favorite" | "showOnTv" | "durationMs"> & { demo?: boolean };
type Filter = "all" | "video" | "image" | "favorites";
const filters: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "Tutti" }, { value: "video", label: "Video" },
  { value: "image", label: "Foto" }, { value: "favorites", label: "Preferiti" }
];
const pageSize = 24;
const demoItems: TvItem[] = demoMedia.filter((item) => item.status === "ready").map((item) => ({
  id: item.id, title: item.title, kind: item.type === "video" ? "VIDEO" : "IMAGE",
  thumbnailUrl: item.src, previewUrl: null, originalUrl: item.src, streamUrl: null,
  favorite: Boolean(item.favorite), showOnTv: false, durationMs: item.durationMs ?? null, demo: true
}));

function focus(element?: HTMLElement | null) {
  element?.focus({ preventScroll: true });
  element?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

// Spatial navigation also works when the responsive grid changes column count.
function moveFocus(root: HTMLElement, key: string) {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]"))
    .filter((element) => element.getClientRects().length > 0);
  const current = document.activeElement as HTMLElement;
  if (!candidates.includes(current)) { focus(candidates[0]); return; }
  const rect = current.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const horizontal = key === "ArrowLeft" || key === "ArrowRight";
  const sign = key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1;
  const next = candidates.filter((element) => element !== current).map((element) => {
    const target = element.getBoundingClientRect();
    const dx = target.left + target.width / 2 - x;
    const dy = target.top + target.height / 2 - y;
    const forward = (horizontal ? dx : dy) * sign;
    const sideways = Math.abs(horizontal ? dy : dx);
    return { element, forward, sideways, score: forward + sideways * 4 };
  }).filter(({ forward, sideways }) => forward > 1 && (!horizontal || sideways < rect.height / 2))
    .sort((a, b) => a.score - b.score)[0];
  focus(next?.element);
}

function time(seconds: number) {
  if (!Number.isFinite(seconds)) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export function TvGallery() {
  const root = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const viewerHistory = useRef(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<TvItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ take: String(pageSize), page: String(page), status: "ready", tv: "true" });
    if (filter === "video" || filter === "image") params.set("kind", filter);
    if (filter === "favorites") params.set("favorite", "true");
    void (async () => {
      try {
        const response = await fetch(`/api/media?${params}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("La galleria non è disponibile. Riprova.");
        const payload = await response.json() as { items?: TvItem[]; total?: number; mode?: string };
        const isDemo = payload.mode === "demo";
        const demoSelection = isDemo ? readDemoTvSelection() : new Set<string>();
        const matching = demoItems.filter((item) => demoSelection.has(item.id) && (filter === "all" ||
          (filter === "favorites" ? item.favorite : item.kind === (filter === "video" ? "VIDEO" : "IMAGE"))));
        if (controller.signal.aborted) return;
        setDemo(isDemo);
        setItems(isDemo ? matching.slice((page - 1) * pageSize, page * pageSize) : payload.items ?? []);
        setTotal(isDemo ? matching.length : payload.total ?? 0);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Caricamento non riuscito.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [filter, page, retry]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === demoTvStorageKey) { setPage(1); setRetry((value) => value + 1); }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (!loading && !root.current?.contains(document.activeElement)) {
      focus(root.current?.querySelector<HTMLElement>("[data-tv-card], button:not(:disabled)"));
    }
  }, [loading]);

  useEffect(() => {
    const onPop = () => { viewerHistory.current = false; setSelected(null); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (selected === null && returnFocus.current) {
      focus(returnFocus.current);
      returnFocus.current = null;
    }
  }, [selected]);

  function closeViewer() {
    if (viewerHistory.current) window.history.back();
    else setSelected(null);
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (selected !== null) return; // The viewer has its own focus scope.
      const key = event.key || ({ 37: "ArrowLeft", 38: "ArrowUp", 39: "ArrowRight", 40: "ArrowDown" } as Record<number, string>)[event.keyCode];
      if (key?.startsWith("Arrow") && root.current) {
        event.preventDefault();
        moveFocus(root.current, key);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return <main className="tv-gallery" ref={root}>
    <header className="tv-header">
      <div><span className="tv-brand">FRAMEO <b>TV</b></span><h1>La tua galleria</h1></div>
      <p>Frecce per spostarti · OK per aprire<br />Indietro per tornare alla galleria</p>
    </header>
    <nav className="tv-filters" aria-label="Filtra la galleria">
      {filters.map(({ value, label }) => <button key={value} aria-pressed={filter === value}
        onClick={() => { setFilter(value); setPage(1); }}>{label}</button>)}
    </nav>
    <div className="tv-summary" aria-live="polite">{demo ? "Modalità demo · " : ""}{loading ? "Caricamento…" : `${total} contenuti · Pagina ${page} di ${pageCount}`}</div>
    {error ? <div className="tv-message" role="alert"><p>{error}</p><button onClick={() => setRetry((value) => value + 1)}>Riprova</button></div>
      : loading ? <div className="tv-message" role="status">Caricamento della galleria…</div>
      : !items.length ? <div className="tv-message">{filter === "all" ? "La Galleria TV è vuota. Dalla libreria sul computer, attiva “Mostra nella Galleria TV” sui contenuti che vuoi vedere qui." : "Nessun contenuto disponibile con questo filtro."}</div>
      : <section className="tv-grid" aria-label="Foto e video">
        {items.map((item, index) => <button className="tv-card" data-tv-card key={item.id}
          onClick={(event) => {
            returnFocus.current = event.currentTarget;
            window.history.pushState({ frameoTvViewer: true }, "");
            viewerHistory.current = true;
            setSelected(index);
          }} aria-label={`${item.kind === "VIDEO" ? "Video" : "Foto"}: ${item.title}`}>
          <div className="tv-thumbnail">
            <TvThumbnail item={item} active={selected === null} />
            <span className="tv-badge">{item.kind === "VIDEO" ? `▶ ${time((item.durationMs ?? 0) / 1000)}` : "Foto"}{item.favorite ? " · ♥" : ""}</span>
          </div><strong>{item.title}</strong>
        </button>)}
      </section>}
    <footer className="tv-pagination">
      <button disabled={loading || page <= 1} onClick={() => setPage((value) => value - 1)}>← Pagina precedente</button>
      <button disabled={loading || page >= pageCount} onClick={() => setPage((value) => value + 1)}>Pagina successiva →</button>
    </footer>
    {selected !== null && items[selected] ? <TvViewer key={items[selected].id} item={items[selected]} index={selected} count={items.length}
      onClose={closeViewer} onPrevious={selected > 0 ? () => setSelected(selected - 1) : undefined}
      onNext={selected < items.length - 1 ? () => setSelected(selected + 1) : undefined} /> : null}
  </main>;
}

function TvThumbnail({ item, active }: { item: TvItem; active: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: .15 });
    observer.observe(element);
    const updateVisibility = () => setPageVisible(!document.hidden);
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", updateVisibility); };
  }, []);
  const preview = active && visible && pageVisible && !failed && item.kind === "VIDEO" && !item.demo && item.previewUrl;
  return <div ref={container} className="tv-preview">
    {item.thumbnailUrl || item.kind === "IMAGE" ? <img loading="lazy" alt=""
      src={item.kind === "IMAGE" && !item.demo ? `/api/media/${item.id}/display?width=900` : item.thumbnailUrl ?? item.originalUrl} /> : <span className="tv-placeholder">▶</span>}
    {preview ? <video src={preview} poster={item.thumbnailUrl ?? undefined} muted loop autoPlay playsInline preload="none" aria-hidden="true"
      onError={() => setFailed(true)} /> : null}
  </div>;
}

function TvViewer({ item, index, count, onClose, onPrevious, onNext }: {
  item: TvItem; index: number; count: number; onClose: () => void; onPrevious?: () => void; onNext?: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const playButton = useRef<HTMLButtonElement>(null);
  const [playing, setPlaying] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState((item.durationMs ?? 0) / 1000);
  const [source, setSource] = useState(item.streamUrl && !item.streamUrl.includes(".m3u8") ? item.streamUrl : item.originalUrl);
  const isVideo = item.kind === "VIDEO" && !item.demo;

  useEffect(() => {
    const element = root.current;
    const change = () => setFullscreen(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", change);
    return () => {
      document.removeEventListener("fullscreenchange", change);
      if (document.fullscreenElement === element) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  function enterFullscreen() {
    if (!document.fullscreenElement && root.current?.requestFullscreen) {
      void root.current.requestFullscreen().catch(() => undefined);
    }
  }
  function close() {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    onClose();
  }

  useEffect(() => {
    focus(playButton.current ?? root.current?.querySelector<HTMLElement>("button:not(:disabled)"));
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);

  useEffect(() => {
    if (!isVideo) return;
    const controller = new AbortController();
    void fetch(`/api/media/${item.id}/compatible`, { signal: controller.signal, cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((result: { state?: string; url?: string } | null) => {
        if (!controller.signal.aborted && result?.state === "ready" && result.url) { setSource(result.url); setError(""); }
      }).catch(() => undefined);
    return () => controller.abort();
  }, [isVideo, item.id]);

  function togglePlayback() {
    if (!video.current) return;
    if (video.current.paused) {
      enterFullscreen();
      void video.current.play().catch(() => setError("Riproduzione non riuscita. Se il formato non è supportato, prepara il video compatibile dalla libreria sul computer."));
    }
    else video.current.pause();
  }
  function seek(offset: number) {
    if (video.current && Number.isFinite(video.current.duration)) {
      video.current.currentTime = Math.max(0, Math.min(video.current.duration, video.current.currentTime + offset));
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const code = event.keyCode;
      if (["Escape", "Backspace", "BrowserBack", "GoBack"].includes(event.key) || code === 4) {
        event.preventDefault(); close();
      } else if (isVideo && (event.key === "MediaPlayPause" || event.key === " " || code === 179)) {
        event.preventDefault(); togglePlayback();
      } else if (isVideo && (event.key === "MediaRewind" || code === 227)) {
        event.preventDefault(); seek(-10);
      } else if (isVideo && (event.key === "MediaFastForward" || code === 228)) {
        event.preventDefault(); seek(10);
      } else {
        const key = event.key || ({ 37: "ArrowLeft", 38: "ArrowUp", 39: "ArrowRight", 40: "ArrowDown" } as Record<number, string>)[code];
        if (key?.startsWith("Arrow") && root.current) { event.preventDefault(); moveFocus(root.current, key); }
        // Keep keyboard Tab navigation within the viewer as well.
        if (event.key === "Tab" && root.current) {
          const buttons = Array.from(root.current.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
          const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
          event.preventDefault(); focus(buttons[(current + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return <div className="tv-viewer" role="dialog" aria-modal="true" aria-label={item.title} ref={root}>
    <header><div><h2>{item.title}</h2><p>{index + 1} / {count} in questa pagina{item.demo ? " · Anteprima demo" : ""}</p></div>
      <button onClick={close}>Chiudi ✕</button></header>
    <div className="tv-stage">
      {isVideo ? <video key={source} ref={video} src={source} poster={item.thumbnailUrl ?? undefined} playsInline preload="metadata"
        onPlay={() => { setPlaying(true); setError(""); }} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
        onTimeUpdate={(event) => setElapsed(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onError={() => setError("Questo video non è riproducibile. Prepara il video compatibile dalla libreria sul computer e riaprilo qui.")} />
        : <img src={item.demo ? item.originalUrl : `/api/media/${item.id}/display?width=1600`} alt={item.title}
          onError={() => setError("Immagine non disponibile. Prova un altro contenuto.")} />}
      {error ? <p className="tv-player-error" role="alert">{error}</p> : null}
    </div>
    <footer className="tv-controls">
      <button disabled={!onPrevious} onClick={onPrevious}>← Precedente</button>
      {isVideo ? <><button onClick={() => seek(-10)}>−10 s</button>
        <button ref={playButton} onClick={togglePlayback}>{playing ? "Pausa" : "Riproduci"}</button>
        <button onClick={() => seek(10)}>+10 s</button><span>{time(elapsed)} / {time(duration)}</span></> : null}
      <button onClick={() => fullscreen ? void document.exitFullscreen().catch(() => undefined) : enterFullscreen()}>{fullscreen ? "Esci da schermo intero" : "Schermo intero"}</button>
      <button disabled={!onNext} onClick={onNext}>Successivo →</button>
    </footer>
  </div>;
}
