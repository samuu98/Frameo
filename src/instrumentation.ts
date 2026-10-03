export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { recoverProcessingQueue } = await import("@/lib/media-processor");
  await recoverProcessingQueue();
  if (process.env.DATABASE_URL && process.env.DEMO_MODE !== "true") {
    const { recoverCompatibleVideoJobs } = await import("@/lib/compatible-video");
    await recoverCompatibleVideoJobs();
  }
  if (process.env.DATABASE_URL && process.env.DEMO_MODE !== "true") {
    const { telegramDownloads } = await import("@/lib/telegram-downloads");
    telegramDownloads.startWorker();
    const { webDownloads } = await import("@/lib/web-downloads");
    webDownloads.startWorker();
  }
  if (process.env.FRAMEO_SCAN_EXTERNAL_ON_START === "true") {
    const { startExternalLibraryScan } = await import(
      "@/lib/external-library-scanner"
    );
    startExternalLibraryScan();
  }
}
