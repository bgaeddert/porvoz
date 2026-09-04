const pageDetails = {
  provider: {
    title: "Provider & models",
    summary: "Manage the API connection and choose the models Porvoz uses."
  },
  capture: {
    title: "Capture & instructions",
    summary: "Set the hotkey and cue volume, then manage how transcripts are processed."
  }
};

const legacyPageAliases = new Map([
  ["keyboard", "capture"],
  ["sound", "capture"],
  ["instructions", "capture"],
  ["advanced", "capture"]
]);

const links = [...document.querySelectorAll(".section-nav a[href^='#']")];
const sections = [...document.querySelectorAll(".settings-stack > .settings-card[data-settings-page]")];
const pageTitle = document.querySelector("#settings-page-title");
const pageSummary = document.querySelector("#settings-page-summary");

function getRequestedPage() {
  const requestedPage = window.location.hash.slice(1);
  return legacyPageAliases.get(requestedPage)
    || (Object.hasOwn(pageDetails, requestedPage) ? requestedPage : "provider");
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
if (!initialHash) {
  window.history.replaceState(null, "", "#provider");
} else if (legacyPageAliases.has(initialHash)) {
  window.history.replaceState(null, "", `#${legacyPageAliases.get(initialHash)}`);
} else if (!Object.hasOwn(pageDetails, initialHash)) {
  window.history.replaceState(null, "", "#provider");
}

window.addEventListener("hashchange", showRequestedPage);
showRequestedPage();
