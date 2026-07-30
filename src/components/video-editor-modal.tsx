"use client";

import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Film,
  GitMerge,
  GripVertical,
  Plus,
  Scissors,
  Split,
  Trash2,
  WandSparkles,
  X
} from "lucide-react";
import { useMemo, useState } from "react";
import type { MediaItem } from "@/types/media";

type Operation = "TRIM" | "SPLIT" | "MERGE";

interface Clip {
  localId: string;
  media: MediaItem;
  startMs: number;
  endMs: number;
}

const formatTime = (milliseconds: number) => {
  const total = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

export function VideoEditorModal({
  items,
  onClose,
  onCreated
}: {
  items: MediaItem[];
  onClose: () => void;
  onCreated: (message: string) => void;
}) {
  const videos = useMemo(() => items.filter((item) => item.type === "video"), [items]);
  const [operation, setOperation] = useState<Operation>(videos.length > 1 ? "MERGE" : "TRIM");
  const [clips, setClips] = useState<Clip[]>(
    videos.slice(0, videos.length > 1 ? videos.length : 1).map((media) => ({
      localId: `${media.id}-${Date.now()}`,
      media,
      startMs: 0,
      endMs: media.durationMs ?? 60_000
    }))
  );
  const [name, setName] = useState(videos[0] ? `${videos[0].title} — edit` : "Nuovo montaggio");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateClip = (id: string, patch: Partial<Clip>) =>
    setClips((current) => current.map((clip) => clip.localId === id ? { ...clip, ...patch } : clip));

  const moveClip = (index: number, direction: -1 | 1) => {
    setClips((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const createProject = () => {
    if (!clips.length || !name.trim()) return;
    setSubmitting(true);
    setError(null);
    void fetch("/api/editor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        operation,
        outputFileName: name,
        segments: clips.map((clip) => ({
          mediaId: clip.media.id,
          startMs: clip.startMs,
          endMs: clip.endMs
        }))
      })
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as {
          error?: string;
        } | null;
        if (!response.ok) {
          throw new Error(payload?.error ?? "Impossibile avviare il montaggio");
        }
        onCreated(`Montaggio “${name}” avviato in background`);
        onClose();
      })
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Impossibile avviare il montaggio"
        )
      )
      .finally(() => setSubmitting(false));
  };

  return (
    <div className="editor-backdrop" onMouseDown={onClose}>
      <section className="video-editor-modal" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><span><WandSparkles size={15} /> EDITOR LEGGERO</span><h2>Taglia, dividi, unisci.</h2><p>Gli originali restano intatti. Frameo crea sempre un nuovo media.</p></div>
          <button onClick={onClose}><X size={20} /></button>
        </header>
        <div className="editor-operation-tabs">
          {[
            { value: "TRIM", label: "Taglia", copy: "Mantieni un intervallo", icon: Scissors },
            { value: "SPLIT", label: "Dividi", copy: "Crea più clip", icon: Split },
            { value: "MERGE", label: "Unisci", copy: "Concatena più video", icon: GitMerge }
          ].map(({ value, label, copy, icon: Icon }) => (
            <button
              className={operation === value ? "is-active" : ""}
              key={value}
              onClick={() => {
                setOperation(value as Operation);
                if (value !== "MERGE" && clips.length > 1) setClips([clips[0]]);
              }}
            >
              <Icon size={18} /><span><strong>{label}</strong><small>{copy}</small></span>{operation === value ? <Check size={14} /> : null}
            </button>
          ))}
        </div>
        <div className="editor-body">
          <div className="editor-preview" style={{ backgroundColor: clips[0]?.media.accent ?? "#282824" }}>
            {clips[0] ? (
              <video
                key={clips[0].localId}
                src={clips[0].media.originalUrl ?? clips[0].media.previewUrl ?? clips[0].media.src}
                poster={clips[0].media.thumbnailUrl ?? clips[0].media.src}
                controls
                playsInline
                preload="metadata"
                onLoadedMetadata={(event) => {
                  if (clips[0].media.durationMs) return;
                  const durationMs = Math.round(event.currentTarget.duration * 1000);
                  if (!Number.isFinite(durationMs) || durationMs <= 0) return;
                  updateClip(clips[0].localId, {
                    media: { ...clips[0].media, durationMs, duration: formatTime(durationMs) },
                    endMs: durationMs
                  });
                }}
              />
            ) : <Film size={34} />}
            <div><span>{clips[0] ? formatTime(clips[0].startMs) : "00:00"}</span><i /><span>{clips[0] ? formatTime(clips[0].endMs) : "00:00"}</span></div>
          </div>
          <div className="editor-clips">
            <div className="editor-section-title"><div><strong>{operation === "MERGE" ? "Sequenza clip" : "Intervallo"}</strong><small>{clips.length} {clips.length === 1 ? "clip" : "clip"} · trascina gli estremi</small></div>{operation === "SPLIT" ? <button onClick={() => {
              const source = clips[0];
              if (!source) return;
              const middle = Math.round((source.startMs + source.endMs) / 2);
              setClips([
                { ...source, localId: `${source.localId}-a`, endMs: middle },
                { ...source, localId: `${source.localId}-b`, startMs: middle }
              ]);
            }}><Plus size={14} /> Aggiungi taglio</button> : null}</div>
            <div className="clip-list">
              {clips.map((clip, index) => {
                const duration = clip.media.durationMs ?? 60_000;
                return (
                  <article className="editor-clip" key={clip.localId}>
                    <GripVertical size={16} />
                    <img src={clip.media.src} alt="" />
                    <div className="clip-data">
                      <div><strong>{clip.media.title}</strong><small>{formatTime(clip.startMs)} → {formatTime(clip.endMs)} · {formatTime(clip.endMs - clip.startMs)}</small></div>
                      <div className="dual-range">
                        <span style={{ left: `${(clip.startMs / duration) * 100}%`, right: `${100 - (clip.endMs / duration) * 100}%` }} />
                        <input type="range" min={0} max={Math.max(1000, duration - 1000)} step={100} value={clip.startMs} onChange={(event) => updateClip(clip.localId, { startMs: Math.min(Number(event.target.value), clip.endMs - 500) })} />
                        <input type="range" min={1000} max={duration} step={100} value={clip.endMs} onChange={(event) => updateClip(clip.localId, { endMs: Math.max(Number(event.target.value), clip.startMs + 500) })} />
                      </div>
                    </div>
                    <div className="clip-actions">
                      <button disabled={index === 0} onClick={() => moveClip(index, -1)}><ArrowUp size={14} /></button>
                      <button disabled={index === clips.length - 1} onClick={() => moveClip(index, 1)}><ArrowDown size={14} /></button>
                      <button onClick={() => setClips((current) => current.filter((entry) => entry.localId !== clip.localId))}><Trash2 size={14} /></button>
                    </div>
                  </article>
                );
              })}
            </div>
            {operation === "MERGE" ? (
              <label className="add-video-select"><Plus size={15} /><span>Aggiungi un video</span><select defaultValue="" onChange={(event) => {
                const media = videos.find((item) => item.id === event.target.value);
                if (media) setClips((current) => [...current, { localId: `${media.id}-${Date.now()}`, media, startMs: 0, endMs: media.durationMs ?? 60_000 }]);
                event.target.value = "";
              }}><option value="" disabled>Scegli dalla selezione…</option>{videos.map((video) => <option value={video.id} key={video.id}>{video.title}</option>)}</select><ChevronDown size={14} /></label>
            ) : null}
          </div>
        </div>
        <footer>
          <label><span>NOME FILE RISULTATO</span><div><Film size={15} /><input value={name} onChange={(event) => setName(event.target.value)} /><em>.mp4</em></div></label>
          <div className="editor-output-copy"><strong>{formatTime(clips.reduce((total, clip) => total + clip.endMs - clip.startMs, 0))}</strong><span>durata stimata</span></div>
          <div className="editor-footer-actions">
            {error ? <p role="alert">{error}</p> : null}
            <button onClick={onClose}>Annulla</button>
            <button disabled={submitting || !clips.length || !name.trim()} onClick={createProject}><WandSparkles size={15} /> {submitting ? "Avvio…" : "Crea nuovo video"}</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
