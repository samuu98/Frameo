// Use Gofile's public web download button in an isolated browser. No Premium API
// endpoints, account credentials, or cookies from the user's own browser.
import { chromium } from "playwright-core";
import { mkdir, readdir, rename, stat } from "node:fs/promises";
import path from "node:path";

const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const request = JSON.parse(await new Promise((resolve, reject) => {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.once("end", () => resolve(input));
  process.stdin.once("error", reject);
}));

let browser;
try {
  const url = new URL(request.url);
  if (url.protocol !== "https:" || !["gofile.io", "www.gofile.io"].includes(url.hostname)
    || !/^\/d\/[A-Za-z0-9_-]+\/?$/.test(url.pathname) || url.username || url.password) {
    throw new Error("Inserisci un link pubblico Gofile nel formato https://gofile.io/d/…");
  }
  const directory = path.resolve(request.directory);
  const maxBytes = Number(request.maxBytes);
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("Limite dimensione non valido.");
  await mkdir(directory, { recursive: true });
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium-browser",
    headless: true,
    downloadsPath: directory,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--no-zygote",
      "--disable-extensions", "--disable-background-networking", "--mute-audio"]
  });
  const context = await browser.newContext({ acceptDownloads: true, serviceWorkers: "block" });
  await context.route("**/*", (route) => {
    try {
      const target = new URL(route.request().url());
      if (target.protocol === "https:" && (target.hostname === "gofile.io" || target.hostname.endsWith(".gofile.io"))) {
        return route.continue();
      }
    } catch { /* Non-HTTP browser URL. */ }
    return route.abort();
  });
  const page = await context.newPage();
  await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.locator(".fm-row[data-type='file'], [data-action='download']").first().waitFor({ timeout: 45000 });

  const rows = page.locator(".fm-row[data-type='file']");
  const videos = [];
  for (let index = 0; index < await rows.count(); index++) {
    const row = rows.nth(index);
    const name = (await row.locator("[data-action='open-file'] p").first().textContent() || "").trim();
    if (/\.(mp4|m4v|mov|mkv|webm|avi|wmv|mpeg|mpg)$/i.test(name)) videos.push({ row, name });
  }
  if (videos.length !== 1) throw new Error(videos.length
    ? "La cartella Gofile contiene più video: usa il link alla pagina del singolo file."
    : "Nessun video supportato trovato nella cartella Gofile.");
  const { row, name } = videos[0];
  const sizeText = (await row.locator("[data-action='open-file'] p").nth(1).textContent() || "");
  const sizeMatch = sizeText.match(/([\d.,]+)\s*(TB|GB|MB|KB|B)/i);
  const factors = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
  const estimatedBytes = sizeMatch
    ? Math.round(Number(sizeMatch[1].replace(",", ".")) * factors[sizeMatch[2].toUpperCase()]) : 0;
  if (estimatedBytes > maxBytes) throw new Error("Il video supera il limite massimo configurato per gli upload.");
  emit({ type: "metadata", fileName: name, totalBytes: estimatedBytes });

  const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
  await row.locator("button[data-action='download']").click();
  const download = await downloadPromise;
  const suggested = path.basename(download.suggestedFilename());
  if (!/\.(mp4|m4v|mov|mkv|webm|avi|wmv|mpeg|mpg)$/i.test(suggested)) {
    await download.cancel();
    throw new Error("Gofile non ha fornito un file video scaricabile.");
  }
  let finished = false;
  let probed = false;
  let previousBytes = 0;
  let previousTime = Date.now();
  let downloadPath;
  let downloadError;
  void download.path().then((value) => { downloadPath = value; finished = true; }, (error) => {
    downloadError = error; finished = true;
  });
  while (!finished) {
    await new Promise((resolve) => setTimeout(resolve, 750));
    const entries = await readdir(directory);
    let downloaded = 0;
    for (const entry of entries) {
      if (entry === "video" + path.extname(suggested)) continue;
      downloaded += await stat(path.join(directory, entry)).then((item) => item.isFile() ? item.size : 0).catch(() => 0);
    }
    if (downloaded > maxBytes) {
      await download.cancel();
      throw new Error("Il video supera il limite massimo configurato per gli upload.");
    }
    if (request.probeBytes && downloaded >= request.probeBytes) {
      await download.cancel();
      emit({ type: "probe", downloadedBytes: downloaded });
      probed = true;
      break;
    }
    const now = Date.now();
    const speed = Math.max(0, Math.round((downloaded - previousBytes) * 1000 / Math.max(1, now - previousTime)));
    emit({ type: "progress", downloadedBytes: downloaded, totalBytes: estimatedBytes,
      speedBps: speed, etaSeconds: estimatedBytes > downloaded && speed > 0
        ? Math.round((estimatedBytes - downloaded) / speed) : null });
    previousBytes = downloaded;
    previousTime = now;
  }
  if (!probed) {
    if (downloadError) throw downloadError;
    if (!downloadPath) throw new Error("Il download Gofile è stato interrotto.");
    const target = path.join(directory, "video" + path.extname(suggested).toLowerCase());
    await rename(downloadPath, target);
    const bytes = (await stat(target)).size;
    if (bytes > maxBytes) throw new Error("Il video supera il limite massimo configurato per gli upload.");
    emit({ type: "complete", filePath: target, fileName: suggested, bytes });
  }
} catch (error) {
  emit({ type: "error", message: error instanceof Error ? error.message.slice(0, 1200) : String(error).slice(0, 1200) });
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => undefined);
}
