import { readdir } from "node:fs/promises";
import path from "node:path";
import { MediaKind } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/access-control";
import {
  getLibrarySettings,
  libraryPaths,
  librarySettingsSchema,
  resolveStorageFolder,
  saveLibrarySettings
} from "@/lib/library-settings";
import { getExternalScanStatus } from "@/lib/external-library-scanner";
import { getPreviewQueueStatus } from "@/lib/preview-queue";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireLibraryAdmin(request: Request) {
  try {
    await requireAdmin(request);
    return null;
  } catch {
    return NextResponse.json(
      { error: "Permessi amministratore richiesti" },
      { status: 403 }
    );
  }
}

async function availableFolders() {
  if (!libraryPaths.externalRoot) return [];
  try {
    const firstLevel = await readdir(libraryPaths.externalRoot, {
      withFileTypes: true
    });
    const folders = firstLevel
      .filter((entry) => !entry.name.startsWith(".") && entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
    const nested = await Promise.all(
      folders.slice(0, 80).map(async (folder) => {
        try {
          const children = await readdir(
            path.join(libraryPaths.externalRoot as string, folder),
            { withFileTypes: true }
          );
          return children
            .filter(
              (entry) => !entry.name.startsWith(".") && entry.isDirectory()
            )
            .slice(0, 40)
            .map((entry) => `${folder}/${entry.name}`);
        } catch {
          return [];
        }
      })
    );
    return ["", ...folders, ...nested.flat()].slice(0, 800);
  } catch {
    return [];
  }
}

async function libraryPayload() {
  const settings = await getLibrarySettings();
  const [
    total,
    videos,
    images,
    videosWithoutThumbnail,
    videosWithoutPreview,
    imagesWithoutThumbnail,
    folders
  ] = await Promise.all([
    prisma.mediaAsset.count(),
    prisma.mediaAsset.count({ where: { kind: MediaKind.VIDEO } }),
    prisma.mediaAsset.count({ where: { kind: MediaKind.IMAGE } }),
    prisma.mediaAsset.count({
      where: { kind: MediaKind.VIDEO, thumbnailPath: null }
    }),
    prisma.mediaAsset.count({
      where: { kind: MediaKind.VIDEO, previewPath: null }
    }),
    prisma.mediaAsset.count({
      where: { kind: MediaKind.IMAGE, thumbnailPath: null }
    }),
    availableFolders()
  ]);

  return {
    settings,
    paths: {
      scanRoot: libraryPaths.externalRoot,
      uploadRoot: path.join(libraryPaths.storageRoot, settings.uploadFolder),
      storageRoot: libraryPaths.storageRoot
    },
    availableFolders: folders,
    stats: {
      total,
      videos,
      images,
      videosWithoutThumbnail,
      videosWithoutPreview,
      imagesWithoutThumbnail
    },
    scan: getExternalScanStatus(),
    previews: getPreviewQueueStatus()
  };
}

export async function GET(request: Request) {
  const denied = await requireLibraryAdmin(request);
  if (denied) return denied;
  return NextResponse.json(await libraryPayload());
}

export async function PATCH(request: Request) {
  const denied = await requireLibraryAdmin(request);
  if (denied) return denied;
  const parsed = librarySettingsSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Configurazione cartelle non valida", issues: parsed.error.issues },
      { status: 422 }
    );
  }
  try {
    resolveStorageFolder(parsed.data.uploadFolder);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Destinazione upload non valida"
      },
      { status: 422 }
    );
  }
  await saveLibrarySettings(parsed.data);
  return NextResponse.json(await libraryPayload());
}
