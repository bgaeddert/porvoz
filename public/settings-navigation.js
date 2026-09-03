const pageDetails = {
  provider: {
    title: "Provider & models",
    summary: "Manage the API connection and choose the models Porvoz uses."
  },
  keyboard: {
    title: "Keyboard",
    summary: "Choose the global keyboard shortcut used to start recording."
  },
  sound: {
    title: "Sound",
    summary: "Set the playback level for recording start and stop cues."
  },
  instructions: {
    title: "Instructions",
    summary: "Set processing behavior and manage spoken instruction shortcuts."
  },
  advanced: {
    title: "Advanced",
    summary: "Restore the application to its packaged configuration."
  }
};

const links = [...document.querySelectorAll(".section-nav a[href^='#']")];
const sections = [...document.querySelectorAll(".settings-stack > .settings-card[data-settings-page]")];
const pageTitle = document.querySelector("#settings-page-title");
const pageSummary = document.querySelector("#settings-page-summary");

function getRequestedPage() {
  const requestedPage = window.location.hash.slice(1);
  return Object.hasOwn(pageDetails, requestedPage) ? requestedPage : "provider";
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

  requestAnimationFrame(() => {
    const visibleSections = sections.filter((section) => section.dataset.settingsPage === currentPage);
    visibleSections.forEach((section) => section.querySelectorAll("textarea").forEach((textarea) => {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    }));
  });
}

if (!window.location.hash || !Object.hasOwn(pageDetails, window.location.hash.slice(1))) {
  window.history.replaceState(null, "", "#provider");
}

window.addEventListener("hashchange", showRequestedPage);
showRequestedPage();
