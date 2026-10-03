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
  const candidates = Array.from(root.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled)"))
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
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  return `${hours ? `${hours}:` : ""}${hours ? String(minutes).padStart(2, "0") : minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export function TvGallery() {
  const root = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const viewerHistory = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const advanceAfterLoad = useRef(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<TvItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [demo, setDemo] = useState(false);
  const [seed, setSeed] = useState("");
  const [demoOrder, setDemoOrder] = useState(demoItems);

  useEffect(() => {
    setSeed(window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const shuffled = [...demoItems];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const other = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
    }
    setDemoOrder(shuffled);
  }, []);

  useEffect(() => {
    if (!seed) return;
    const controller = new AbortController();
    setLoading(true);
    loadingRef.current = true;
    setError("");
    const params = new URLSearchParams({ take: String(pageSize), page: String(page), status: "ready", tv: "true", sort: "random", seed });
    if (filter === "video" || filter === "image") params.set("kind", filter);
    if (filter === "favorites") params.set("favorite", "true");
    void (async () => {
      try {
        const response = await fetch(`/api/media?${params}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("La galleria non è disponibile. Riprova.");
        const payload = await response.json() as { items?: TvItem[]; total?: number; mode?: string };
        const isDemo = payload.mode === "demo";
        const demoSelection = isDemo ? readDemoTvSelection() : new Set<string>();
        const matching = demoOrder.filter((item) => demoSelection.has(item.id) && (filter === "all" ||
          (filter === "favorites" ? item.favorite : item.kind === (filter === "video" ? "VIDEO" : "IMAGE"))));
        if (controller.signal.aborted) return;
        setDemo(isDemo);
        const incoming = isDemo ? matching.slice((page - 1) * pageSize, page * pageSize) : payload.items ?? [];
        setItems((current) => {
          const combined = page === 1 ? incoming : [...current, ...incoming];
          return [...new Map(combined.map((item) => [item.id, item])).values()];
        });
        if (advanceAfterLoad.current && incoming.length) setSelected((current) => current === null ? null : current + 1);
        advanceAfterLoad.current = false;
        setTotal(isDemo ? matching.length : payload.total ?? 0);
      } catch (reason) {
        if (!controller.signal.aborted) {
          advanceAfterLoad.current = false;
          setError(reason instanceof Error ? reason.message : "Caricamento non riuscito.");
        }
      } finally {
        if (!controller.signal.aborted) { setLoading(false); loadingRef.current = false; }
      }
    })();
    return () => controller.abort();
  }, [filter, page, retry, seed, demoOrder]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === demoTvStorageKey) { setItems([]); setTotal(0); setPage(1); setRetry((value) => value + 1); }
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

  const hasMore = page * pageSize < total;
  function loadMore(advance = false) {
    if (loadingRef.current || !hasMore || error) return;
    loadingRef.current = true;
    advanceAfterLoad.current = advance;
    setPage((current) => current + 1);
  }
  useEffect(() => {
    if (loading || error || !hasMore || selected !== null || !sentinel.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !loadingRef.current) loadMore();
    }, { rootMargin: "400px" });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [loading, error, hasMore, selected, page]);
  return <main className="tv-gallery" ref={root}>
    <header className="tv-header">
      <div><span className="tv-brand">FRAMEO <b>TV</b></span><h1>La tua galleria</h1></div>
      <p>Frecce per spostarti · OK per aprire<br />Indietro per tornare alla galleria</p>
    </header>
    <nav className="tv-filters" aria-label="Filtra la galleria">
      {filters.map(({ value, label }) => <button key={value} aria-pressed={filter === value}
        onClick={() => { if (value === filter) return; advanceAfterLoad.current = false; setItems([]); setTotal(0); setFilter(value); setPage(1); }}>{label}</button>)}
    </nav>
    <div className="tv-summary" aria-live="polite">{demo ? "Modalità demo · " : ""}{loading ? "Caricamento…" : `${total} contenuti`}</div>
    {!items.length && error ? <div className="tv-message" role="alert"><p>{error}</p><button onClick={() => setRetry((value) => value + 1)}>Riprova</button></div>
      : !items.length && loading ? <div className="tv-message" role="status">Caricamento della galleria…</div>
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
    <div ref={sentinel} className="tv-load-more" aria-live="polite">
      {items.length && error ? <><p role="alert">{error}</p><button onClick={() => setRetry((value) => value + 1)}>Riprova caricamento</button></>
        : items.length && loading ? "Caricamento di altri contenuti…" : items.length && !hasMore ? "Hai visto tutti i contenuti" : null}
    </div>
    {selected !== null && items[selected] ? <TvViewer key={items[selected].id} item={items[selected]} index={selected} count={items.length}
      onClose={closeViewer} onPrevious={selected > 0 ? () => setSelected(selected - 1) : undefined}
      onNext={selected < items.length - 1 ? () => setSelected(selected + 1) : hasMore ? () => loadMore(true) : undefined} /> : null}
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
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [activity, setActivity] = useState(0);
  const [buffering, setBuffering] = useState(false);
  const [buffered, setBuffered] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [seekFeedback, setSeekFeedback] = useState("");
  const timeline = useRef<HTMLInputElement>(null);
  function revealControls() { setControlsVisible(true); setActivity((value) => value + 1); }
  useEffect(() => {
    if (!playing || error) { setControlsVisible(true); return; }
    const timeout = window.setTimeout(() => { focus(root.current); setControlsVisible(false); }, 3500);
    return () => window.clearTimeout(timeout);
  }, [playing, activity, error]);
  useEffect(() => {
    if (!seekFeedback) return;
    const timeout = window.setTimeout(() => setSeekFeedback(""), 900);
    return () => window.clearTimeout(timeout);
  }, [seekFeedback, activity]);
  const [fullscreen, setFullscreen] = useState(false);
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
  function seekTo(position: number) {
    const element = video.current;
    if (!element || !Number.isFinite(element.duration)) return;
    element.currentTime = Math.max(0, Math.min(element.duration, position));
    setElapsed(element.currentTime);
    revealControls();
  }
  function seek(offset: number) {
    if (!video.current) return;
    seekTo(video.current.currentTime + offset);
    setSeekFeedback(`${offset > 0 ? "+" : "−"}${Math.abs(offset)} s`);
  }
  function toggleMute() { if (video.current) { video.current.muted = !video.current.muted; setMuted(video.current.muted); } }
  function changeSpeed() {
    const rates = [1, 1.25, 1.5, 2, .5];
    const next = rates[(rates.indexOf(speed) + 1) % rates.length];
    if (video.current) video.current.playbackRate = next;
    setSpeed(next);
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const code = event.keyCode;
      const wasHidden = !controlsVisible;
      revealControls();
      if (["Escape", "Backspace", "BrowserBack", "GoBack"].includes(event.key) || code === 4) {
        event.preventDefault(); close();
      } else if (isVideo && (event.key === "MediaPlayPause" || event.key === " " || ((wasHidden || document.activeElement === root.current) && event.key === "Enter") || code === 179)) {
        event.preventDefault(); togglePlayback();
      } else if (isVideo && (event.key === "MediaRewind" || code === 227)) {
        event.preventDefault(); seek(-10);
      } else if (isVideo && (event.key === "MediaFastForward" || code === 228)) {
        event.preventDefault(); seek(10);
      } else {
        const key = event.key || ({ 37: "ArrowLeft", 38: "ArrowUp", 39: "ArrowRight", 40: "ArrowDown" } as Record<number, string>)[code];
        if (key?.startsWith("Arrow") && root.current) {
          event.preventDefault();
          if (isVideo && (wasHidden || document.activeElement === root.current || document.activeElement === timeline.current) && (key === "ArrowLeft" || key === "ArrowRight")) seek(key === "ArrowLeft" ? -10 : 10);
          else if (wasHidden || document.activeElement === root.current) requestAnimationFrame(() => focus(timeline.current ?? playButton.current));
          else moveFocus(root.current, key);
        }
        if (isVideo && document.activeElement === timeline.current && ["Home", "End"].includes(key)) {
          event.preventDefault(); seekTo(key === "Home" ? 0 : duration);
        }
        // Keep keyboard Tab navigation within the viewer as well.
        if (event.key === "Tab" && root.current) {
          const buttons = Array.from(root.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)"));
          const current = buttons.indexOf(document.activeElement as HTMLElement);
          event.preventDefault(); requestAnimationFrame(() => focus(buttons[(current + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]));
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return <div className={`tv-viewer${controlsVisible ? "" : " controls-hidden"}`} role="dialog" aria-modal="true" aria-label={item.title} ref={root} tabIndex={-1}
    onMouseMove={revealControls} onPointerDown={revealControls}>
    <header inert={!controlsVisible}><div><h2>{item.title}</h2><p>{index + 1} / {count} contenuti caricati{item.demo ? " · Anteprima demo" : ""}</p></div>
      <button onClick={close}>Chiudi ✕</button></header>
    <div className="tv-stage" onClick={isVideo ? togglePlayback : undefined}>
      {isVideo ? <video key={source} ref={video} src={source} poster={item.thumbnailUrl ?? undefined} playsInline preload="metadata"
        onPlay={() => { setPlaying(true); setError(""); }} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
        onTimeUpdate={(event) => setElapsed(event.currentTarget.currentTime)}
        onWaiting={() => setBuffering(true)} onSeeking={() => setBuffering(true)}
        onPlaying={() => setBuffering(false)} onSeeked={() => setBuffering(false)}
        onProgress={(event) => { const ranges = event.currentTarget.buffered; setBuffered(ranges.length ? ranges.end(ranges.length - 1) : 0); }}
        onLoadedMetadata={(event) => { setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0); event.currentTarget.muted = muted; event.currentTarget.playbackRate = speed; }}
        onError={() => setError("Questo video non è riproducibile. Prepara il video compatibile dalla libreria sul computer e riaprilo qui.")} />
        : <img src={item.demo ? item.originalUrl : `/api/media/${item.id}/display?width=1600`} alt={item.title}
          onError={() => setError("Immagine non disponibile. Prova un altro contenuto.")} />}
      {buffering && playing && !error ? <span className="tv-buffering" role="status" aria-label="Caricamento video" /> : null}
      {seekFeedback ? <span className="tv-seek-feedback" aria-live="polite">{seekFeedback}</span> : null}
      {error ? <p className="tv-player-error" role="alert">{error}</p> : null}
    </div>
    <footer className="tv-controls" inert={!controlsVisible} onFocus={revealControls}>
      {isVideo ? <div className="tv-timeline">
        <input ref={timeline} type="range" aria-label="Posizione di riproduzione" aria-valuetext={`${time(elapsed)} di ${time(duration)}`}
          min={0} max={duration || 0} step={1} value={Math.min(elapsed, duration)} disabled={!duration}
          style={{ background: `linear-gradient(to right, #b3a6ff ${duration ? elapsed / duration * 100 : 0}%, #727487 ${duration ? elapsed / duration * 100 : 0}%, #727487 ${duration ? buffered / duration * 100 : 0}%, #343540 ${duration ? buffered / duration * 100 : 0}%)` }}
          onChange={(event) => seekTo(Number(event.currentTarget.value))} />
        <div className="tv-timeline-times"><span>{time(elapsed)} / {time(duration)}</span><span>−{time(Math.max(0, duration - elapsed))}</span></div>
      </div> : null}
      <div className="tv-control-buttons">
      <button disabled={!onPrevious} onClick={onPrevious}>← Precedente</button>
      {isVideo ? <><button onClick={() => seek(-10)}>−10 s</button>
        <button ref={playButton} onClick={togglePlayback}>{playing ? "Pausa" : "Riproduci"}</button>
        <button onClick={() => seek(10)}>+10 s</button>
        <button onClick={toggleMute} aria-pressed={muted}>{muted ? "Attiva audio" : "Disattiva audio"}</button>
        <button onClick={changeSpeed} aria-label={`Velocità ${speed}×`}>{speed}×</button></> : null}
      <button onClick={() => fullscreen ? void document.exitFullscreen().catch(() => undefined) : enterFullscreen()}>{fullscreen ? "Esci da schermo intero" : "Schermo intero"}</button>
      <button disabled={!onNext} onClick={onNext}>Successivo →</button>
      </div>
      {isVideo ? <p className="tv-control-hint">Sulla barra: ← / → salta 10 s · OK sui comandi · Indietro chiude</p> : null}
    </footer>
  </div>;
}
