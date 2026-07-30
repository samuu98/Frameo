import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const storageRoot = path.resolve(
  process.env.STORAGE_ROOT ??
    path.join(/* turbopackIgnore: true */ process.cwd(), "storage")
);

const settingsPath = path.join(storageRoot, "config", "library-settings.json");

const relativeFolder = z
  .string()
  .trim()
  .max(240)
  .transform((value) => value.replaceAll("\\", "/").replace(/^\/+|\/+$/g, ""))
  .refine(
    (value) =>
      value === "" ||
      (!path.posix.isAbsolute(value) &&
        !value.split("/").some((segment) => segment === ".." || segment === ".")),
    "La cartella deve essere relativa alla libreria configurata."
  );

export const librarySettingsSchema = z.object({
  scanFolders: z.array(relativeFolder).min(1).max(100),
  uploadFolder: relativeFolder.refine(
    (value) => value !== "",
    "Scegli una cartella di upload."
  )
});

export type LibrarySettings = z.infer<typeof librarySettingsSchema>;

const defaults: LibrarySettings = {
  scanFolders: [""],
  uploadFolder: "originals"
};

export async function getLibrarySettings(): Promise<LibrarySettings> {
  try {
    const saved = JSON.parse(await readFile(settingsPath, "utf8"));
    const parsed = librarySettingsSchema.safeParse(saved);
    return parsed.success ? parsed.data : defaults;
  } catch {
    return defaults;
  }
}

export async function saveLibrarySettings(
  input: unknown
): Promise<LibrarySettings> {
  const settings = librarySettingsSchema.parse(input);
  await mkdir(path.dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return settings;
}

export function resolveStorageFolder(relative: string) {
  const resolved = path.resolve(storageRoot, relative);
  if (
    resolved !== storageRoot &&
    !resolved.startsWith(`${storageRoot}${path.sep}`)
  ) {
    throw new Error("Cartella fuori dallo storage gestito.");
  }
  if (
    libraryPaths.externalRoot &&
    (resolved === libraryPaths.externalRoot ||
      resolved.startsWith(`${libraryPaths.externalRoot}${path.sep}`))
  ) {
    throw new Error("La destinazione upload non può essere una libreria in sola lettura.");
  }
  return resolved;
}

export const libraryPaths = {
  storageRoot,
  externalRoot: process.env.EXTERNAL_MEDIA_ROOT
    ? path.resolve(process.env.EXTERNAL_MEDIA_ROOT)
    : null
};
