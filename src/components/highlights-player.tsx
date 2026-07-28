"use client";

import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Infinity as InfinityIcon,
  ListVideo,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Volume2,
  VolumeX,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AdvancedFilterState, HighlightMarker, MediaItem } from "@/types/media";

interface HighlightQueueItem {
  media: MediaItem;
  marker: HighlightMarker;
}

const formatTime = (milliseconds: number) => {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

export function HighlightsPlayer({
  items,
  filters,
  onClose,
  onOpenSource
}: {
  items: MediaItem[];
  filters: AdvancedFilterState;
  onClose: () => void;
  onOpenSource: (item: MediaItem) => void;
}) {
  const queue = useMemo<HighlightQueueItem[]>(
    () =>
      items
        .filter((item) => item.type === "video")
        .flatMap((media) =>
          (media.markers ?? [])
            .filter((marker) => marker.featured !== false)
            .map((marker) => ({ media, marker }))
        ),
    [items]
  );
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(true);
  const [progress, setProgress] = useState(0);
  const [loop, setLoop] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const current = queue[index];

  const move = (direction: 1 | -1) => {
    if (!queue.length) return;
    const next = index + direction;
    if (next >= queue.length) setIndex(loop ? 0 : queue.length - 1);
    else if (next < 0) setIndex(loop ? queue.length - 1 : 0);
    else setIndex(next);
    setProgress(0);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") move(1);
      if (event.key === "ArrowLeft") move(-1);
      if (event.key === " ") {
        event.preventDefault();
        setPlaying((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (!current || current.media.originalUrl || !playing) return;
    const duration = Math.max(current.marker.endMs - current.marker.startMs, 1200);
    const started = Date.now() - progress * duration;
    const timer = window.setInterval(() => {
      const value = (Date.now() - started) / duration;
      if (value >= 1) {
        move(1);
      } else {
        setProgress(value);
      }
    }, 80);
    return () => window.clearInterval(timer);
  }, [current, playing]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !current?.media.originalUrl) return;
    const seek = () => {
      video.currentTime = current.marker.startMs / 1000;
      if (playing) void video.play().catch(() => undefined);
    };
    if (video.readyState >= 1) seek();
    else video.addEventListener("loadedmetadata", seek, { once: true });
  }, [current, playing]);

  if (!current) {
    return (
      <div className="highlights-backdrop">
        <section className="highlights-empty">
          <span><Sparkles size={23} /></span>
          <h2>Nessun momento saliente in questa vista.</h2>
          <p>Aggiungi un marker a un video oppure allarga i filtri applicati.</p>
          <button onClick={onClose}>Torna alla libreria</button>
        </section>
      </div>
    );
  }

  const activeFilters = [
    ...filters.people,
    ...filters.tags,
    ...filters.groups,
    ...(filters.markerOnly ? ["con marker"] : [])
  ];

  return (
    <div className="highlights-backdrop">
      <section className="highlights-player">
        <header>
          <div>
            <span className="live-spark"><Sparkles size={14} /> HIGHLIGHTS</span>
            <strong>{queue.length} momenti · riproduzione continua</strong>
          </div>
          <div className="highlight-filter-summary">
            {activeFilters.slice(0, 4).map((filter) => <span key={filter}>{filter}</span>)}
            {!activeFilters.length ? <span>Tutta la libreria</span> : null}
          </div>
          <button onClick={onClose} aria-label="Chiudi highlights"><X size={20} /></button>
        </header>

        <div className="highlight-stage" style={{ backgroundColor: current.media.accent }}>
          {current.media.originalUrl ? (
            <video
              ref={videoRef}
              src={current.media.originalUrl}
              poster={current.media.src}
              muted={muted}
              playsInline
              onTimeUpdate={(event) => {
                const time = event.currentTarget.currentTime * 1000;
                const length = current.marker.endMs - current.marker.startMs;
                setProgress(Math.max(0, Math.min(1, (time - current.marker.startMs) / length)));
                if (time >= current.marker.endMs) move(1);
              }}
              onClick={() => setPlaying((value) => !value)}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img className={playing ? "is-playing" : ""} src={current.media.src} alt="" />
          )}
          <div className="highlight-vignette" />
          <button className="highlight-prev" onClick={() => move(-1)} aria-label="Momento precedente">
            <ChevronLeft size={24} />
          </button>
          <button className="highlight-next" onClick={() => move(1)} aria-label="Momento successivo">
            <ChevronRight size={24} />
          </button>
          <button
            className="highlight-main-play"
            onClick={() => {
              setPlaying((value) => {
                const next = !value;
                if (videoRef.current) {
                  if (next) void videoRef.current.play().catch(() => undefined);
                  else videoRef.current.pause();
                }
                return next;
              });
            }}
            aria-label={playing ? "Pausa" : "Riproduci"}
          >
            {playing ? <Pause size={23} fill="currentColor" /> : <Play size={23} fill="currentColor" />}
          </button>
          <div className="highlight-copy">
            <span>{current.media.people.join(" · ") || current.media.group}</span>
            <h2>{current.marker.label}</h2>
            <p>{current.media.title} · {formatTime(current.marker.startMs)}–{formatTime(current.marker.endMs)}</p>
          </div>
          <div className="highlight-progress">
            <span style={{ width: `${progress * 100}%` }} />
          </div>
        </div>

        <footer>
          <div className="highlight-controls">
            <button onClick={() => setPlaying((value) => !value)}>
              {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
            </button>
            <button onClick={() => setMuted((value) => !value)}>
              {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
            </button>
            <button className={loop ? "is-active" : ""} onClick={() => setLoop((value) => !value)}>
              <InfinityIcon size={18} /> Infinita
            </button>
          </div>
          <div className="highlight-position">
            <ListVideo size={15} />
            <strong>{index + 1}</strong> / {queue.length}
            <span>
              {queue.slice(Math.max(0, index - 1), index + 3).map((entry, queueIndex) => (
                <i
                  className={entry.marker.id === current.marker.id ? "is-active" : ""}
                  key={`${entry.media.id}-${entry.marker.id}`}
                  style={{ background: entry.marker.color }}
                  title={entry.marker.label}
                />
              ))}
            </span>
          </div>
          <div className="highlight-source-actions">
            <button onClick={() => { setProgress(0); setIndex(0); }}>
              <RotateCcw size={15} /> Ricomincia
            </button>
            <button className="open-source" onClick={() => onOpenSource(current.media)}>
              Apri video completo <ExternalLink size={15} />
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
