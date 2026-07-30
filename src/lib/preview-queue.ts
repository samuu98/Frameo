import { MediaKind, MediaStatus, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { processMediaAsset } from "@/lib/media-processor";

export type PreviewQueueMode =
  | "MISSING_THUMBNAIL"
  | "MISSING_PREVIEW"
  | "MISSING_ANY"
  | "REGENERATE";

export interface PreviewQueueStatus {
  running: boolean;
  cancelling: boolean;
  mode: PreviewQueueMode | null;
  kind: "VIDEO" | "IMAGE" | "ALL" | null;
  requested: number;
  completed: number;
  failed: number;
  currentId: string | null;
  currentTitle: string | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

const globalQueue = globalThis as unknown as {
  frameoPreviewQueue?: PreviewQueueStatus;
  frameoPreviewQueuePromise?: Promise<void>;
};

const queue =
  globalQueue.frameoPreviewQueue ??
  (globalQueue.frameoPreviewQueue = {
    running: false,
    cancelling: false,
    mode: null,
    kind: null,
    requested: 0,
    completed: 0,
    failed: 0,
    currentId: null,
    currentTitle: null,
    error: null,
    startedAt: null,
    completedAt: null
  });

export function getPreviewQueueStatus() {
  return { ...queue };
}

const previewWhere = (
  mode: PreviewQueueMode,
  kind: "VIDEO" | "IMAGE" | "ALL"
): Prisma.MediaAssetWhereInput => ({
  ...(kind === "VIDEO"
    ? { kind: MediaKind.VIDEO }
    : kind === "IMAGE"
      ? { kind: MediaKind.IMAGE }
      : {}),
  ...(mode === "MISSING_THUMBNAIL"
    ? { thumbnailPath: null }
    : mode === "MISSING_PREVIEW"
      ? { previewPath: null }
      : mode === "MISSING_ANY"
        ? { OR: [{ thumbnailPath: null }, { previewPath: null }] }
        : {})
});

export async function startPreviewQueue(options: {
  mode: PreviewQueueMode;
  kind: "VIDEO" | "IMAGE" | "ALL";
  limit?: number;
  ids?: string[];
}) {
  if (queue.running) return getPreviewQueueStatus();

  const limit = Math.max(1, Math.min(options.limit ?? 10_000, 10_000));
  const targets = await prisma.mediaAsset.findMany({
    where: {
      AND: [
        previewWhere(options.mode, options.kind),
        ...(options.ids?.length ? [{ id: { in: options.ids } }] : [])
      ]
    },
    select: { id: true, title: true },
    orderBy: [{ createdAt: "asc" }],
    take: limit
  });

  queue.running = true;
  queue.cancelling = false;
  queue.mode = options.mode;
  queue.kind = options.kind;
  queue.requested = targets.length;
  queue.completed = 0;
  queue.failed = 0;
  queue.currentId = null;
  queue.currentTitle = null;
  queue.error = null;
  queue.startedAt = new Date().toISOString();
  queue.completedAt = null;

  globalQueue.frameoPreviewQueuePromise = (async () => {
    for (const target of targets) {
      if (queue.cancelling) break;
      queue.currentId = target.id;
      queue.currentTitle = target.title;
      try {
        await prisma.mediaAsset.update({
          where: { id: target.id },
          data: { status: MediaStatus.PROCESSING }
        });
        await processMediaAsset(target.id);
        queue.completed += 1;
      } catch (error) {
        queue.failed += 1;
        queue.error =
          error instanceof Error
            ? error.message.slice(-600)
            : "Generazione anteprima non riuscita.";
      }
    }
  })()
    .catch((error) => {
      queue.error =
        error instanceof Error
          ? error.message.slice(-600)
          : "Coda anteprime interrotta.";
    })
    .finally(() => {
      queue.running = false;
      queue.cancelling = false;
      queue.currentId = null;
      queue.currentTitle = null;
      queue.completedAt = new Date().toISOString();
      globalQueue.frameoPreviewQueuePromise = undefined;
    });

  return getPreviewQueueStatus();
}

export function cancelPreviewQueue() {
  if (queue.running) queue.cancelling = true;
  return getPreviewQueueStatus();
}
