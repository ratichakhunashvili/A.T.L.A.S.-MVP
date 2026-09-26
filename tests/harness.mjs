/**
 * Shared plumbing for the end-to-end suites.
 *
 * The suites drive the real application in a real browser — there is no
 * mocked map and no mocked engine — so they need a Chrome and a dev server.
 * Everything machine-specific is resolved here and overridable by environment
 * variable, so the same scripts run on someone else's laptop and in CI.
 *
 *   BASE_URL         the running dev server            (default :5180)
 *   CHROME_PATH      the browser binary                (auto-detected)
 *   PUPPETEER_PATH   puppeteer-core, if not installed  (default: resolved)
 *   TEST_OUT         where screenshots land            (default tests/output)
 */

import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const BASE = process.env.BASE_URL ?? "http://localhost:5180";

/** Where screenshots go. Git-ignored; they are evidence, not artefacts. */
export function outputDir(name) {
  const root = process.env.TEST_OUT ?? join(here, "output");
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/* ------------------------------------------------------------------------ */
/* Browser                                                                   */
/* ------------------------------------------------------------------------ */

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

function findChrome() {
  const found = CHROME_CANDIDATES.find((path) => existsSync(path));
  if (found) return found;
  throw new Error(
    `No Chrome found. Set CHROME_PATH to the browser binary.\nTried:\n  ${CHROME_CANDIDATES.join("\n  ")}`,
  );
}

/**
 * Resolves puppeteer-core.
 *
 * Preferred from this project's own dependencies; `PUPPETEER_PATH` is the
 * escape hatch for borrowing an install from elsewhere, which is how these
 * suites were originally run.
 */
async function loadPuppeteer() {
  if (process.env.PUPPETEER_PATH) {
    return (await import(pathToFileURL(resolve(process.env.PUPPETEER_PATH)).href)).default;
  }
  try {
    const require = createRequire(import.meta.url);
    return (await import(pathToFileURL(require.resolve("puppeteer-core")).href)).default;
  } catch {
    throw new Error(
      "puppeteer-core not found. Install it, or set PUPPETEER_PATH to an existing copy.",
    );
  }
}

/**
 * SwiftShader, not hardware GL.
 *
 * The map has to render for any of this to mean anything, and a headless
 * container has no GPU. It is slow, which is why these suites wait on
 * conditions rather than on fixed delays.
 */
const ARGS = [
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--hide-scrollbars",
];

export async function launch(options = {}) {
  const puppeteer = await loadPuppeteer();
  return puppeteer.launch({
    executablePath: findChrome(),
    headless: "new",
    args: ARGS,
    ...options,
  });
}

/* ------------------------------------------------------------------------ */
/* Assertions and reporting                                                  */
/* ------------------------------------------------------------------------ */

export function reporter() {
  const results = [];
  const problems = [];

  return {
    check(name, pass, detail = "") {
      results.push(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
    },
    watch(page) {
      page.on("pageerror", (error) => problems.push(`pageerror: ${error.message.slice(0, 150)}`));
      page.on("console", (message) => {
        if (message.type() === "error") problems.push(`console: ${message.text().slice(0, 150)}`);
      });
    },
    /** Prints the run and returns the failure count, for the exit code. */
    finish() {
      console.log(results.join("\n"));
      const failed = results.filter((line) => line.startsWith("FAIL")).length;
      console.log(`\nfailures: ${failed} of ${results.length}`);
      console.log(
        "console problems:",
        problems.length ? [...new Set(problems)].slice(0, 6).join("\n") : "(none)",
      );
      return failed;
    },
  };
}

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits for the map to have actually drawn something.
 *
 * Every suite that looks at the map needs this, and every suite that used a
 * fixed delay instead eventually went flaky on a slow run.
 */
export async function waitForMap(page, { tiles = true } = {}) {
  await page.waitForFunction(() => Boolean(window.__map), { timeout: 60000 });
  if (!tiles) return;
  await page
    .waitForFunction(() => window.__map.isStyleLoaded() && window.__map.areTilesLoaded(), {
      timeout: 90000,
      polling: 500,
    })
    .catch(() => undefined);
}

/** Sets a React-controlled input. Assigning `.value` does not reach React. */
export function setInput(page, selector, value) {
  return page.evaluate(
    (sel, val) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const proto =
        el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    selector,
    value,
  );
}
