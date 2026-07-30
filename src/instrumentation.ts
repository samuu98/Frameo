export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { recoverProcessingQueue } = await import("@/lib/media-processor");
  await recoverProcessingQueue();
  if (process.env.FRAMEO_SCAN_EXTERNAL_ON_START === "true") {
    const { startExternalLibraryScan } = await import(
      "@/lib/external-library-scanner"
    );
    startExternalLibraryScan();
  }
}
