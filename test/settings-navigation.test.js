import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const navigationSource = readFileSync(new URL("../public/settings-navigation.js", import.meta.url), "utf8");
const settingsHtml = readFileSync(new URL("../public/settings.html", import.meta.url), "utf8");

function createLink(hash) {
  const attributes = new Map();
  return {
    hash,
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); },
    getAttribute(name) { return attributes.get(name); }
  };
}

function createHarness(initialHash) {
  const links = ["provider", "capture", "keyboard", "sound"].map((page) => createLink(`#${page}`));
  const sections = ["provider", "capture", "keyboard", "sound"].map((page) => ({
    dataset: { settingsPage: page },
    hidden: true,
    querySelectorAll: () => []
  }));
  const pageTitle = { textContent: "" };
  const pageSummary = { textContent: "" };
  const listeners = new Map();
  const location = { hash: initialHash };
  const document = {
    title: "",
    querySelector(selector) {
      if (selector === "#settings-page-title") return pageTitle;
      if (selector === "#settings-page-summary") return pageSummary;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === ".section-nav a[href^='#']") return links;
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
  return { document, links, listeners, location, pageSummary, pageTitle, sections };
}

test("Keyboard and Sound are independent settings pages", () => {
  const harness = createHarness("#keyboard");
  assert.equal(harness.pageTitle.textContent, "Keyboard");
  assert.match(harness.pageSummary.textContent, /global shortcut/);
  assert.equal(harness.sections.find((section) => section.dataset.settingsPage === "keyboard").hidden, false);
  assert.equal(harness.sections.find((section) => section.dataset.settingsPage === "capture").hidden, true);
  assert.equal(harness.links.find((link) => link.hash === "#keyboard").getAttribute("aria-current"), "page");

  harness.location.hash = "#sound";
  harness.listeners.get("hashchange")();
  assert.equal(harness.pageTitle.textContent, "Sound");
  assert.match(harness.pageSummary.textContent, /recording start and stop cues/);
  assert.equal(harness.sections.find((section) => section.dataset.settingsPage === "sound").hidden, false);
  assert.equal(harness.sections.find((section) => section.dataset.settingsPage === "keyboard").hidden, true);
  assert.equal(harness.document.title, "Porvoz · Sound");
});

test("Prefixes and instructions is the first Configure destination", () => {
  const configureNav = settingsHtml.slice(
    settingsHtml.indexOf('<nav class="section-nav"'),
    settingsHtml.indexOf("</nav>", settingsHtml.indexOf('<nav class="section-nav"'))
  );
  assert.ok(configureNav.indexOf('href="#capture"') < configureNav.indexOf('href="#provider"'));

  const harness = createHarness("#capture");
  assert.equal(harness.pageTitle.textContent, "Prefixes & instructions");
  assert.equal(harness.document.title, "Porvoz · Prefixes & instructions");
});

test("Settings opens Prefixes and instructions by default", () => {
  const harness = createHarness("");
  assert.equal(harness.location.hash, "#capture");
  assert.equal(harness.pageTitle.textContent, "Prefixes & instructions");
  assert.equal(harness.sections.find((section) => section.dataset.settingsPage === "capture").hidden, false);
  assert.equal(harness.links.find((link) => link.hash === "#capture").getAttribute("aria-current"), "page");
});
