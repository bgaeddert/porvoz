const pageDetails = {
  provider: {
    kicker: "Server settings",
    title: "Provider & models",
    summary: "API connection and model routing."
  },
  prefixes: {
    kicker: "Server settings",
    title: "Prefixes",
    summary: "Voice prefixes and reset."
  },
  keyboard: {
    kicker: "This computer",
    title: "Keyboard",
    summary: "Global shortcut and terminal selection copying."
  },
  sound: {
    kicker: "This computer",
    title: "Sound",
    summary: "Recording cue volume."
  }
};

// Older links and bookmarks keep working. "capture" named this page before the
// recorder page took that name.
const legacyPageAliases = new Map([
  ["capture", "prefixes"],
  ["instructions", "prefixes"],
  ["advanced", "prefixes"]
]);

const links = [...document.querySelectorAll(".main-nav a[href*='#']")];
const sections = [...document.querySelectorAll(".settings-stack > .settings-card[data-settings-page]")];
const pageKicker = document.querySelector("#settings-page-kicker");
const pageTitle = document.querySelector("#settings-page-title");
const pageSummary = document.querySelector("#settings-page-summary");
// Desktop-only pages are removed from the browser document, so the set of
// destinations comes from the sections this page actually has. A link or hash
// naming a page that is not here falls back to the default below.
const availablePages = new Set(sections.map((section) => section.dataset.settingsPage));

// Whatever sits at the top of the navigation is where Porvoz opens.
const DEFAULT_PAGE = "provider";

function resolvePage(requestedPage) {
  const page = legacyPageAliases.get(requestedPage) || requestedPage;
  return availablePages.has(page) && Object.hasOwn(pageDetails, page) ? page : DEFAULT_PAGE;
}

function getRequestedPage() {
  return resolvePage(window.location.hash.slice(1));
}

function showRequestedPage() {
  const currentPage = getRequestedPage();
  const details = pageDetails[currentPage];

  sections.forEach((section) => {
    section.hidden = section.dataset.settingsPage !== currentPage;
  });
  links.forEach((link) => {
    if (link.hash === `#${currentPage}`) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });

  if (pageKicker) pageKicker.textContent = details.kicker;
  pageTitle.textContent = details.title;
  pageSummary.textContent = details.summary;
  document.title = `Porvoz · ${details.title}`;
  window.scrollTo(0, 0);

  requestAnimationFrame(() => {
    const visibleSections = sections.filter((section) => section.dataset.settingsPage === currentPage);
    visibleSections.forEach((section) => section.querySelectorAll("textarea").forEach((textarea) => {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    }));
  });
}

const initialHash = window.location.hash.slice(1);
const initialPage = resolvePage(initialHash);
if (initialHash !== initialPage) window.history.replaceState(null, "", `#${initialPage}`);

window.addEventListener("hashchange", showRequestedPage);
showRequestedPage();
