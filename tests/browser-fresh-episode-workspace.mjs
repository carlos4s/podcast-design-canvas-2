// Running-product acceptance for fresh episode setup workspace (#195).
// Run: node tests/browser-fresh-episode-workspace.mjs
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 8769;

const EPISODE_NAME = "Indie Makers Weekly — Episode 3";
const RIVERSIDE = "https://riverside.fm/studio/indie-makers-ep3";
const SPEAKERS = ["Jordan Lee", "Priya Shah", "Chris Ortiz"];
const DEMO_MARKERS = [/building in public/i, /founders unfiltered #7/i, /episode 12 — building in public/i];

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

function hasDemoLeak(text) {
  const value = String(text || "");
  return DEMO_MARKERS.some((pattern) => pattern.test(value));
}

async function expandSpeakerSocial(page, index) {
  const card = page.locator(`#f-sp-${index}-name`).locator("xpath=ancestor::*[contains(@class,'speaker-card')]");
  await card.locator("summary").click();
}

async function completeFreshSetup(page) {
  await page.getByRole("button", { name: "Start blank episode" }).click();
  await page.waitForSelector("form.setup-import");
  await page.locator("#f-episodeName").fill(EPISODE_NAME);
  await page.locator("#f-riversideLink").fill(RIVERSIDE);
  await page.locator("#f-sp-0-name").fill(SPEAKERS[0]);
  await expandSpeakerSocial(page, 0);
  await page.locator("#f-sp-0-social-twitter").fill("https://x.com/jordanlee");
  await page.locator("#f-sp-1-name").fill(SPEAKERS[1]);
  await page.locator("#f-sp-2-name").fill(SPEAKERS[2]);
  await expandSpeakerSocial(page, 2);
  await page.locator("#f-sp-2-social-linkedin").fill("https://linkedin.com/in/chrisortiz");
  await page.locator(".setup-preset-card").first().click();
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

    await completeFreshSetup(page);
    const workspaceText = await page.locator(".guided-workspace").innerText();
    log(workspaceText.includes(EPISODE_NAME), "Workspace headline shows the new episode name");
    log(workspaceText.includes(RIVERSIDE), "Workspace recap shows the entered Riverside link");
    log(workspaceText.includes("Jordan Lee"), "Workspace recap shows Host name Jordan Lee");
    log(workspaceText.includes("Priya Shah"), "Workspace recap shows Guest 1 name Priya Shah");
    log(!hasDemoLeak(workspaceText), "Workspace recap does not fall back to seeded demo episode data");

    const setupChecklist = await page.locator(".workspace-production-checklist").innerText();
    log(setupChecklist.includes("Jordan Lee · Host"), "Production checklist setup line uses fresh speaker identities");
    log(setupChecklist.includes("indie-makers-ep3"), "Production checklist setup line uses fresh source link");

    await page.locator("#workspace-primary-next, .workspace-checklist-open").filter({ hasText: "Polish audio" }).first().click();
    await page.locator(".audio-step").waitFor();
    const audioText = await page.locator(".audio-step").innerText();
    log(audioText.includes("Jordan Lee"), "Audio polish panel lists Host track Jordan Lee");
    log(audioText.includes("Priya Shah"), "Audio polish panel lists Guest 1 track Priya Shah");
    log(audioText.includes("Chris Ortiz"), "Audio polish panel lists Guest 2 track Chris Ortiz");
    log(!hasDemoLeak(audioText), "Audio polish panel does not show seeded demo speaker names");

    await page.screenshot({ path: join(root, "tests", "fresh-episode-workspace-audio.png"), fullPage: false });
    log(true, "Screenshot saved to tests/fresh-episode-workspace-audio.png");
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
  console.log("\nBrowser fresh episode workspace: all checks passed.");
}

main();
