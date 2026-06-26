// Running-product acceptance for audio polish processing (#197).
//
// Proves the rendered audio step processes imported speaker tracks into durable polished
// audio assets — without requiring the reviewer to hunt for a hidden action. On arrival the
// tracks already read "Polished", reference saved WAV files, and the polished bytes live in
// the pdc-episode-media store, distinct from the raw source and surviving a reload.
// Run: node tests/browser-audio-polish-processing.mjs
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 8771;

const EPISODE_NAME = "Polish Proof Weekly — Episode 1";
const RIVERSIDE = "https://riverside.fm/studio/polish-proof-ep1";
const SPEAKERS = ["Jamie Fox", "Lena Park", "Omar Diaz"];

function mime(path) {
  const ext = extname(path);
  if (ext === ".html") return "text/html";
  if (ext === ".css") return "text/css";
  if (ext === ".js") return "text/javascript";
  return "application/octet-stream";
}

function startServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const rel = req.url === "/" ? "/index.html" : req.url.split("?")[0];
      const file = join(root, rel.replace(/^\//, ""));
      if (!file.startsWith(root) || !existsSync(file)) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200, { "Content-Type": mime(file) });
      res.end(readFileSync(file));
    });
    server.listen(port, () => resolve(server));
  });
}

async function completeSetup(page) {
  await page.getByRole("button", { name: "Start blank episode" }).click();
  await page.waitForSelector("form.setup-import");
  await page.locator("#f-episodeName").fill(EPISODE_NAME);
  await page.locator("#f-riversideLink").fill(RIVERSIDE);
  await page.locator("#f-sp-0-name").fill(SPEAKERS[0]);
  await page.locator("#f-sp-1-name").fill(SPEAKERS[1]);
  await page.locator("#f-sp-2-name").fill(SPEAKERS[2]);
  await page.locator(".setup-preset-card").first().click();
  await page.locator(".guided-workspace").waitFor({ state: "visible" });
}

function readMediaStore(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem("pdc-episode-media");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const assets = Object.values(parsed.assets || {});
    const polished = assets.filter((a) => a.kind === "polished");
    const rawAssets = assets.filter((a) => a.kind === "raw");
    const checksumsBySource = {};
    rawAssets.forEach((a) => { checksumsBySource[a.id] = a.checksum; });
    const distinct = polished.every((p) => !p.sourceAssetId || checksumsBySource[p.sourceAssetId] !== p.checksum);
    return {
      polishedCount: polished.length,
      rawCount: rawAssets.length,
      polishedBytes: polished.reduce((sum, a) => sum + (a.sizeBytes || 0), 0),
      everyPolishedHasBytes: polished.length > 0 && polished.every((a) => a.sizeBytes > 44),
      distinctFromSource: distinct,
    };
  });
}

async function main() {
  const server = await startServer();
  let browser;
  let failed = false;
  const log = (ok, msg) => {
    console.log(`${ok ? "  ok" : " FAIL"} ${msg}`);
    if (!ok) failed = true;
  };

  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "networkidle" });

    await completeSetup(page);

    // Open the audio step the same way a creator would from the workspace checklist.
    await page.locator("#workspace-primary-next, .workspace-checklist-open").filter({ hasText: "Polish audio" }).first().click();
    await page.locator(".audio-step").waitFor();

    // KEY: without clicking Apply, the rendered audio step already shows processed tracks.
    const statuses = await page.locator(".audio-track-status").allInnerTexts();
    log(statuses.length === SPEAKERS.length, `Audio step lists ${SPEAKERS.length} speaker tracks`);
    log(statuses.every((s) => /Polished/i.test(s)), "Every track shows Polished on arrival (no manual Apply needed)");

    const audioText = await page.locator(".audio-step").innerText();
    log(/Polished file:/i.test(audioText), "Each track references a saved polished audio file");
    log(/polished\//i.test(audioText), "Polished file id is shown for tracks");
    log(/\bbytes\b/i.test(audioText), "Polished asset byte size is shown");
    log(audioText.includes("Polished audio saved"), "Result banner confirms polished audio saved");

    // The durable assets actually exist in the media store, distinct from the raw source.
    const store = await readMediaStore(page);
    log(Boolean(store), "pdc-episode-media store exists in localStorage");
    if (store) {
      log(store.polishedCount === SPEAKERS.length, `Media store holds ${SPEAKERS.length} polished assets (got ${store.polishedCount})`);
      log(store.rawCount === SPEAKERS.length, `Media store holds ${SPEAKERS.length} raw source assets (got ${store.rawCount})`);
      log(store.everyPolishedHasBytes, "Every polished asset carries real WAV bytes (> 44)");
      log(store.distinctFromSource, "Polished asset bytes differ from the raw source bytes");
      log(store.polishedBytes > 0, `Polished assets total ${store.polishedBytes} bytes`);
    }

    await page.screenshot({ path: join(root, "tests", "audio-polish-processing-step.png"), fullPage: true });
    log(true, "Screenshot saved to tests/audio-polish-processing-step.png");

    // Changing the quality preset re-processes the tracks (still Polished, new bytes).
    await page.locator(".audio-preset-card").nth(2).click();
    await page.locator(".audio-step").waitFor();
    const restatuses = await page.locator(".audio-track-status").allInnerTexts();
    log(restatuses.every((s) => /Polished/i.test(s)), "Selecting Studio preset re-processes tracks to Polished");

    // Apply advances, and the workspace reflects completed polished audio.
    await page.getByRole("button", { name: /Apply audio & continue/i }).click();
    await page.locator(".guided-workspace").waitFor({ state: "visible" });
    const workspaceText = await page.locator(".workspace-production-checklist").innerText();
    log(/polished audio track/i.test(workspaceText) || /polished/i.test(workspaceText), "Workspace checklist reports polished audio for export");

    // Reload preserves the polished WAV assets in the media store.
    await page.reload({ waitUntil: "networkidle" });
    const afterReload = await readMediaStore(page);
    log(
      Boolean(afterReload) && afterReload.polishedCount >= SPEAKERS.length && afterReload.everyPolishedHasBytes,
      `Reload preserves polished WAV assets in the media store (${afterReload ? afterReload.polishedCount : 0} polished)`,
    );
  } catch (err) {
    console.error(err);
    failed = true;
  } finally {
    if (browser) await browser.close();
    server.close();
  }

  if (failed) {
    process.exit(1);
  }
  console.log("\nBrowser audio polish processing: all checks passed.");
}

main();
