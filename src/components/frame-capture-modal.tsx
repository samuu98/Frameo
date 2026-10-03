"use client";

import {
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Film,
  Keyboard,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  ScanLine,
  Sparkles,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { HighlightMarker, MediaItem, PersistedMediaRecord } from "@/types/media";

const pad = (value: number, length = 2) =>
  String(Math.max(0, Math.floor(value))).padStart(length, "0");

const timecode = (milliseconds: number, frameRate: number) => {
  const totalSeconds = Math.max(0, milliseconds) / 1000;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const frame = Math.min(
    Math.ceil(frameRate) - 1,
    Math.floor((totalSeconds - Math.floor(totalSeconds)) * frameRate)
  );
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(frame)}`;
};

const shortTime = (milliseconds: number) => {
  const totalSeconds = Math.max(0, milliseconds) / 1000;
  return `${pad(Math.floor(totalSeconds / 60))}:${pad(Math.floor(totalSeconds % 60))}.${pad(Math.floor(milliseconds % 1000), 3)}`;
};

export function FrameCaptureModal({
  item,
  initialTimeMs,
  onClose,
  onCaptured,
  onSetThumbnail,
  onAddMarker
}: {
  item: MediaItem;
  initialTimeMs: number;
  onClose: () => void;
  onCaptured: (item: PersistedMediaRecord) => void;
  onSetThumbnail: (positionMs: number) => Promise<boolean>;
  onAddMarker: (marker: HighlightMarker) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRate = Math.max(1, item.frameRate ?? 30);
  const frameDuration = 1000 / frameRate;
  const [durationMs, setDurationMs] = useState(
    Math.max(frameDuration, item.durationMs ?? 60_000)
  );
  const initial = Math.max(0, Math.min(initialTimeMs, durationMs - frameDuration));
  const [positionMs, setPositionMs] = useState(initial);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [settingThumbnail, setSettingThumbnail] = useState(false);
  const [captured, setCaptured] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customName, setCustomName] = useState(false);
  const [markers, setMarkers] = useState<HighlightMarker[]>(item.markers ?? []);
  const [markerLabel, setMarkerLabel] = useState("");
  const [markerStartMs, setMarkerStartMs] = useState(initial);
  const [markerEndMs, setMarkerEndMs] = useState(Math.min(initial + 10_000, durationMs));
  const suggestedName = useMemo(
    () => `${item.title} — frame ${shortTime(positionMs)}`,
    [item.title, positionMs]
  );
  const [name, setName] = useState(suggestedName);

  useEffect(() => {
    if (!customName) setName(suggestedName);
  }, [customName, suggestedName]);

  useEffect(() => {
    setMarkers(item.markers ?? []);
    setMarkerStartMs(initial);
    setMarkerEndMs(Math.min(initial + 10_000, durationMs));
  }, [durationMs, initial, item.id, item.markers]);

  const seek = useCallback((nextPosition: number) => {
    const bounded = Math.max(0, Math.min(nextPosition, durationMs - frameDuration));
    const aligned = Math.round(bounded / frameDuration) * frameDuration;
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.currentTime = aligned / 1000;
    }
    setPlaying(false);
    setPositionMs(aligned);
    setCaptured(false);
  }, [durationMs, frameDuration]);

  const step = useCallback((frames: number) => {
    seek(positionMs + frames * frameDuration);
  }, [frameDuration, positionMs, seek]);

  const togglePlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().then(() => setPlaying(true)).catch(() => undefined);
    } else {
      video.pause();
      setPlaying(false);
    }
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT") return;
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        step(event.shiftKey ? -10 : -1);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        step(event.shiftKey ? 10 : 1);
      }
      if (event.key === " ") {
        event.preventDefault();
        togglePlayback();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, step, togglePlayback]);

  const capture = () => {
    if (!item.originalUrl || capturing) return;
    setCapturing(true);
    setError(null);
    setCaptured(false);
    videoRef.current?.pause();
    setPlaying(false);
    void fetch(`/api/media/${item.id}/screenshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        timestampMs: Math.max(0, Math.round(positionMs)),
        title: name.trim() || suggestedName
      })
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as {
          item?: PersistedMediaRecord;
          error?: string;
        } | null;
        if (!response.ok || !payload?.item) {
          throw new Error(payload?.error ?? "Impossibile catturare questo frame");
        }
        onCaptured(payload.item);
        setCaptured(true);
      })
      .catch((captureError) => {
        setError(
          captureError instanceof Error
            ? captureError.message
            : "Impossibile catturare questo frame"
        );
      })
      .finally(() => setCapturing(false));
  };

  const frameNumber = Math.round(positionMs / frameDuration);

  const addMarker = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const startMs = Math.max(0, Math.min(Math.round(markerStartMs), durationMs - 250));
    const endMs = Math.max(startMs + 250, Math.min(Math.round(markerEndMs), durationMs));
    const marker: HighlightMarker = {
      id: `local-marker-${Date.now()}`,
      label: markerLabel.trim() || `Momento ${shortTime(startMs)}`,
      startMs,
      endMs,
      color: "#6D5DFB",
      featured: true
    };
    setMarkers((current) => [...current, marker]);
    onAddMarker(marker);
    setMarkerLabel("");
    setMarkerStartMs(Math.round(positionMs));
    setMarkerEndMs(Math.min(Math.round(positionMs) + 10_000, durationMs));
  };

  const setThumbnail = () => {
    if (!item.originalUrl || settingThumbnail) return;
    setSettingThumbnail(true);
    setError(null);
    videoRef.current?.pause();
    setPlaying(false);
    void onSetThumbnail(Math.max(0, Math.round(positionMs)))
      .then((success) => {
        if (success) onClose();
      })
      .finally(() => setSettingThumbnail(false));
  };

  return (
    <div className="frame-capture-backdrop" onMouseDown={onClose}>
      <section className="frame-capture-modal" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span><ScanLine size={15} /> FRAME LAB</span>
            <h2>Trova il fotogramma perfetto.</h2>
            <p>Scorri un frame alla volta e salva uno screenshot originale nella libreria.</p>
          </div>
          <button onClick={onClose} aria-label="Chiudi cattura frame"><X size={20} /></button>
        </header>

        <div className="frame-capture-body">
          <div className="frame-stage" style={{ backgroundColor: item.accent }}>
            {item.originalUrl ? (
              <video
                ref={videoRef}
                src={item.originalUrl}
                poster={item.src}
                muted
                playsInline
                preload="metadata"
                onLoadedMetadata={(event) => {
                  const measuredDuration = Math.round(event.currentTarget.duration * 1000);
                  if (Number.isFinite(measuredDuration) && measuredDuration > frameDuration) {
                    setDurationMs(measuredDuration);
                  }
                  event.currentTarget.currentTime = positionMs / 1000;
                  setReady(true);
                }}
                onSeeked={(event) => setPositionMs(event.currentTarget.currentTime * 1000)}
                onTimeUpdate={(event) => {
                  if (playing) setPositionMs(event.currentTarget.currentTime * 1000);
                }}
                onEnded={() => setPlaying(false)}
                onClick={togglePlayback}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.src} alt="" />
            )}
            <div className="frame-stage-topline">
              <span><i /> FRAME BY FRAME</span>
              <span>{frameRate.toFixed(frameRate % 1 ? 2 : 0)} FPS</span>
            </div>
            <div className="frame-guide" aria-hidden="true"><i /><i /><i /><i /></div>
            <div className="frame-stage-time">
              <span>TC</span>
              <strong>{timecode(positionMs, frameRate)}</strong>
            </div>
          </div>

          <aside className="frame-workbench">
            <div className="frame-readout">
              <div>
                <span>TIMECODE PRECISO</span>
                <strong>{timecode(positionMs, frameRate)}</strong>
              </div>
              <div>
                <span>FOTOGRAMMA</span>
                <strong>#{frameNumber.toLocaleString("it-IT")}</strong>
              </div>
            </div>

            <div className="frame-stepper" aria-label="Controlli frame">
              <button onClick={() => step(-10)} title="Indietro di 10 frame">
                <ChevronLeft size={15} /><span>10</span>
              </button>
              <button className="single-frame" onClick={() => step(-1)}>
                <ChevronLeft size={18} /><span>1 frame</span>
              </button>
              <button className="frame-play-toggle" onClick={togglePlayback} disabled={!item.originalUrl}>
                {playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}
              </button>
              <button className="single-frame" onClick={() => step(1)}>
                <span>1 frame</span><ChevronRight size={18} />
              </button>
              <button onClick={() => step(10)} title="Avanti di 10 frame">
                <span>10</span><ChevronRight size={15} />
              </button>
            </div>

            <div className="frame-scrubber">
              <div className="frame-marker-track" aria-label="Marker del video">
                {markers.map((marker) => (
                  <button
                    type="button"
                    key={marker.id}
                    style={{
                      left: `${Math.min(100, (marker.startMs / durationMs) * 100)}%`,
                      width: `${Math.max(1, ((marker.endMs - marker.startMs) / durationMs) * 100)}%`,
                      background: marker.color
                    }}
                    title={`${marker.label} · ${shortTime(marker.startMs)}`}
                    onClick={() => seek(marker.startMs)}
                  />
                ))}
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(0, durationMs - frameDuration)}
                step={frameDuration}
                value={Math.min(positionMs, durationMs - frameDuration)}
                onChange={(event) => seek(Number(event.target.value))}
                aria-label="Posizione nel video"
              />
              <div><span>00:00.000</span><span>{shortTime(durationMs)}</span></div>
            </div>

            <section className="frame-marker-panel">
              <header><span><Sparkles size={15} /> MOMENTI DEL VIDEO</span><small>{markers.length} marker</small></header>
              <form onSubmit={addMarker}>
                <input value={markerLabel} onChange={(event) => setMarkerLabel(event.target.value)} placeholder="Nome del momento" aria-label="Nome del marker" />
                <div className="frame-marker-range">
                  <label><span>Inizio</span><input type="number" min={0} max={durationMs / 1000} step="0.1" value={(markerStartMs / 1000).toFixed(1)} onChange={(event) => setMarkerStartMs(Math.max(0, Number(event.target.value) * 1000))} /></label>
                  <button type="button" onClick={() => setMarkerStartMs(Math.round(positionMs))}>Usa frame</button>
                  <label><span>Fine</span><input type="number" min={0} max={durationMs / 1000} step="0.1" value={(markerEndMs / 1000).toFixed(1)} onChange={(event) => setMarkerEndMs(Math.max(markerStartMs + 250, Number(event.target.value) * 1000))} /></label>
                  <button type="button" onClick={() => setMarkerEndMs(Math.min(Math.round(positionMs), durationMs))}>Fine qui</button>
                </div>
                <div className="frame-marker-presets">Durata <span>{[5, 10, 20].map((seconds) => <button type="button" key={seconds} onClick={() => setMarkerEndMs(Math.min(markerStartMs + seconds * 1000, durationMs))}>{seconds}s</button>)}</span><button className="frame-marker-save" type="submit"><Sparkles size={13} /> Aggiungi marker</button></div>
              </form>
              {markers.length ? (
                <div className="frame-marker-list">
                  {markers.map((marker) => <button type="button" key={marker.id} onClick={() => seek(marker.startMs)}><i style={{ background: marker.color }} /><span><strong>{marker.label}</strong><small>{shortTime(marker.startMs)} – {shortTime(marker.endMs)}</small></span><ChevronRight size={14} /></button>)}
                </div>
              ) : <p>Nessun momento salvato. Imposta inizio e fine per creare il primo marker.</p>}
            </section>

            <div className="frame-keyboard-help">
              <Keyboard size={16} />
              <p><strong>Scorciatoie</strong><span><kbd>←</kbd><kbd>→</kbd> 1 frame · <kbd>⇧</kbd> + freccia 10 frame · <kbd>spazio</kbd> play</span></p>
            </div>

            <label className="frame-name-field">
              <span>NOME DELLO SCREENSHOT</span>
              <div><Camera size={15} /><input value={name} onChange={(event) => { setName(event.target.value); setCustomName(true); }} /></div>
            </label>

            {error ? <div className="frame-capture-error">{error}</div> : null}
            {!item.originalUrl ? (
              <div className="frame-capture-error">Questa demo non ha un file sorgente. Carica un video per catturare i frame reali.</div>
            ) : null}
          </aside>
        </div>

        <footer>
          <span><Film size={15} /> L’originale resta intatto · output PNG alla risoluzione sorgente</span>
          <div>
            <button onClick={() => seek(initial)}><RotateCcw size={15} /> Posizione iniziale</button>
            <button
              className="set-thumbnail-action"
              onClick={setThumbnail}
              disabled={!ready || settingThumbnail || capturing || !item.originalUrl}
            >
              {settingThumbnail ? <LoaderCircle className="is-spinning" size={16} /> : <Film size={16} />}
              {settingThumbnail ? "Impostazione…" : "Usa come thumbnail"}
            </button>
            <button
              className={captured ? "capture-frame-action is-captured" : "capture-frame-action"}
              onClick={capture}
              disabled={!ready || capturing || !item.originalUrl}
            >
              {capturing ? <LoaderCircle className="is-spinning" size={16} /> : captured ? <Check size={16} /> : <Camera size={16} />}
              {capturing ? "Cattura…" : captured ? "Salvato nella libreria" : "Cattura fotogramma"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
