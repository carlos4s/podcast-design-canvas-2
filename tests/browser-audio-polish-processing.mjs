// Running-product acceptance for audio polish asset processing (#197).
// Run: node tests/browser-audio-polish-processing.mjs
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 8770;

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
  await page.locator("#f-episodeName").fill("Indie Makers Weekly — Episode 3");
  await page.locator("#f-riversideLink").fill("https://riverside.fm/studio/indie-makers-ep3");
  await page.locator("#f-sp-0-name").fill("Jordan Lee");
  await page.locator("#f-sp-1-name").fill("Priya Shah");
  await page.locator("#f-sp-2-name").fill("Chris Ortiz");
  await page.locator(".setup-preset-card").first().click();
  await page.locator(".guided-workspace").waitFor({ state: "visible" });
}

async function openAudioPolish(page) {
  await page.locator(".workspace-checklist-open").filter({ hasText: /Polish audio|Change audio/ }).first().click();
  await page.locator(".audio-step").waitFor();
}

async function resumeEpisodeAfterReload(page) {
  await page.locator(".show-library-card").filter({ hasText: "Indie Makers Weekly" }).getByRole("button", { name: "Open" }).click();
  await page.getByRole("button", { name: "Resume →" }).click();
  await page.locator(".guided-workspace").waitFor({ state: "visible" });
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
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "networkidle" });

    await completeSetup(page);
    await openAudioPolish(page);
    await page.locator(".audio-preset-card").filter({ hasText: "Studio" }).click();
    await page.getByRole("button", { name: "Apply audio & continue →" }).click();
    await page.locator(".guided-workspace").waitFor({ state: "visible" });

    const checklist = await page.locator(".workspace-production-checklist").innerText();
    log(/polished audio tracks saved/i.test(checklist), "Workspace checklist shows polished audio tracks saved");

    const mediaAfterApply = await page.evaluate(() => {
      const raw = localStorage.getItem("pdc-episode-media");
      if (!raw) return null;
      const store = JSON.parse(raw);
      const assets = Object.values(store.assets || {});
      const polished = assets.filter((asset) => asset.kind === "polished");
      const rawTracks = assets.filter((asset) => asset.kind === "raw");
      return {
        polishedCount: polished.length,
        rawCount: rawTracks.length,
        polishedBytes: polished.map((asset) => asset.sizeBytes),
        hasDistinctChecksums: polished.length > 0 && rawTracks.length > 0
          ? polished.every((asset) => {
            const source = rawTracks.find((item) => item.id === asset.sourceAssetId);
            return source && source.checksum !== asset.checksum && asset.sizeBytes > 44;
          })
          : false,
      };
    });
    log(Boolean(mediaAfterApply && mediaAfterApply.polishedCount === 3), "Apply saved 3 polished WAV assets to media store");
    log(Boolean(mediaAfterApply && mediaAfterApply.rawCount === 3), "Apply registered 3 imported raw source assets");
    log(Boolean(mediaAfterApply && mediaAfterApply.hasDistinctChecksums), "Polished assets differ from raw source checksums");

    await openAudioPolish(page);
    await page.locator(".banner.audio-polish-result").waitFor({ state: "visible" });
    const audioText = await page.locator(".audio-step").innerText();
    log(audioText.includes("Polished"), "Reopened audio step shows Polished track status after Apply");
    log(audioText.includes("polished/"), "Reopened audio step shows saved polished asset paths");
    log(/bytes/.test(audioText), "Reopened audio step shows saved asset byte sizes");
    log(audioText.includes("Jordan Lee · Studio audio"), "Host track shows polished asset label");

    await page.reload({ waitUntil: "networkidle" });
    await resumeEpisodeAfterReload(page);
    const afterReload = await page.locator(".workspace-production-checklist").innerText();
    log(/polished audio tracks saved/i.test(afterReload), "Reload preserves polished audio in workspace checklist");

    const mediaAfterReload = await page.evaluate(() => {
      const raw = localStorage.getItem("pdc-episode-media");
      if (!raw) return null;
      const store = JSON.parse(raw);
      return Object.values(store.assets || {}).filter((asset) => asset.kind === "polished").length;
    });
    log(mediaAfterReload === 3, "Reload preserves polished WAV assets in media store");

    await page.screenshot({ path: join(root, "tests", "audio-polish-processing-workspace.png"), fullPage: false });
    log(true, "Screenshot saved to tests/audio-polish-processing-workspace.png");
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
