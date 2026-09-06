import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const navigationSource = readFileSync(new URL("../public/settings-navigation.js", import.meta.url), "utf8");
const settingsHtml = readFileSync(new URL("../public/settings.html", import.meta.url), "utf8");

const PAGES = ["provider", "prefixes", "keyboard", "sound"];

function createLink(hash) {
  const attributes = new Map();
  return {
    hash,
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); },
    getAttribute(name) { return attributes.get(name); }
  };
}

function createHarness(initialHash, { pages = PAGES } = {}) {
  const links = pages.map((page) => createLink(`#${page}`));
  const sections = pages.map((page) => ({
    dataset: { settingsPage: page },
    hidden: true,
    querySelectorAll: () => []
  }));
  const pageKicker = { textContent: "" };
  const pageTitle = { textContent: "" };
  const pageSummary = { textContent: "" };
  const listeners = new Map();
  const location = { hash: initialHash };
  const document = {
    title: "",
    querySelector(selector) {
      if (selector === "#settings-page-kicker") return pageKicker;
      if (selector === "#settings-page-title") return pageTitle;
      if (selector === "#settings-page-summary") return pageSummary;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === ".main-nav a[href*='#']") return links;
      if (selector === ".settings-stack > .settings-card[data-settings-page]") return sections;
      return [];
    }
  };
  const window = {
    location,
    history: {
      replaceState(_state, _title, hash) { location.hash = hash; }
    },
    addEventListener(type, listener) { listeners.set(type, listener); },
    scrollTo() {}
  };
  const context = vm.createContext({ document, window, requestAnimationFrame: (callback) => callback() });
  vm.runInContext(navigationSource, context);
  return { document, links, listeners, location, pageKicker, pageSummary, pageTitle, sections };
}

test("every settings page is a top-level navigation destination", () => {
  const harness = createHarness("#keyboard");
  assert.equal(harness.pageTitle.textContent, "Keyboard");
  assert.equal(harness.pageKicker.textContent, "This computer");
  assert.match(harness.pageSummary.textContent, /Global shortcut/);
  assert.equal(harness.sections.find((section) => section.dataset.settingsPage === "keyboard").hidden, false);
  assert.equal(harness.sections.find((section) => section.dataset.settingsPage === "prefixes").hidden, true);
  assert.equal(harness.links.find((link) => link.hash === "#keyboard").getAttribute("aria-current"), "page");

  harness.location.hash = "#sound";
  harness.listeners.get("hashchange")();
  assert.equal(harness.pageTitle.textContent, "Sound");
  assert.match(harness.pageSummary.textContent, /cue volume/i);
  assert.equal(harness.sections.find((section) => section.dataset.settingsPage === "sound").hidden, false);
  assert.equal(harness.sections.find((section) => section.dataset.settingsPage === "keyboard").hidden, true);
  assert.equal(harness.document.title, "Porvoz · Sound");

  harness.location.hash = "#provider";
  harness.listeners.get("hashchange")();
  assert.equal(harness.pageTitle.textContent, "Provider & models");
  assert.equal(harness.pageKicker.textContent, "Server settings");
  assert.equal(harness.links.find((link) => link.hash === "#keyboard").getAttribute("aria-current"), undefined);
});

test("the sidebar lists what you configure first, then what you check it with", () => {
  const navigation = settingsHtml.slice(
    settingsHtml.indexOf('<nav class="main-nav"'),
    settingsHtml.indexOf("</nav>", settingsHtml.indexOf('<nav class="main-nav"'))
  );
  const order = ["#provider", "#prefixes", "#keyboard", "#sound", "index.html", "logs.html"]
    .map((href) => navigation.indexOf(href));
  assert.ok(order.every((position) => position >= 0), "every destination is present");
  assert.deepEqual([...order].sort((first, second) => first - second), order);

  // There is no second level of navigation left to fall into.
  assert.equal(settingsHtml.includes('class="section-nav"'), false);
  // Log out belongs to the website and stays hidden in the desktop app.
  assert.match(navigation, /id="sign-out"[^>]*data-web-only/);
});

test("Porvoz opens on the first destination, and older links still find Prefixes", () => {
  const fresh = createHarness("");
  assert.equal(fresh.location.hash, "#provider");
  assert.equal(fresh.pageTitle.textContent, "Provider & models");
  assert.equal(fresh.sections.find((section) => section.dataset.settingsPage === "provider").hidden, false);
  assert.equal(fresh.links.find((link) => link.hash === "#provider").getAttribute("aria-current"), "page");

  // "capture" named the Prefixes page before the recorder page took that name.
  for (const legacy of ["#capture", "#instructions", "#advanced"]) {
    const harness = createHarness(legacy);
    assert.equal(harness.location.hash, "#prefixes", `${legacy} should resolve to Prefixes`);
    assert.equal(harness.pageTitle.textContent, "Prefixes");
  }

  // A hash that names nothing lands on the first destination rather than a blank page.
  assert.equal(createHarness("#nonsense").location.hash, "#provider");
});

test("a page the browser does not have falls back instead of showing an empty shell", () => {
  // The website removes the desktop-only cards, so their hashes lead nowhere.
  const harness = createHarness("#keyboard", { pages: ["provider", "prefixes"] });
  assert.equal(harness.location.hash, "#provider");
  assert.equal(harness.pageTitle.textContent, "Provider & models");
  assert.equal(harness.sections.find((section) => section.dataset.settingsPage === "provider").hidden, false);
});
