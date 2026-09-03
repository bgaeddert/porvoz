const ICON_PATHS = {
  "alert-triangle": [
    ["path", { d: "M12 9v4" }],
    ["path", { d: "M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0" }],
    ["path", { d: "M12 16h.01" }]
  ],
  "archive-off": [
    ["path", { d: "M8 4h11a2 2 0 1 1 0 4h-7m-4 0h-3a2 2 0 0 1 -.826 -3.822" }],
    ["path", { d: "M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 1.824 -1.18m.176 -3.82v-7" }],
    ["path", { d: "M10 12h2" }],
    ["path", { d: "M3 3l18 18" }]
  ],
  "arrow-down": [
    ["path", { d: "M12 5l0 14" }],
    ["path", { d: "M18 13l-6 6" }],
    ["path", { d: "M6 13l6 6" }]
  ],
  "chevron-down": [["path", { d: "M6 9l6 6l6 -6" }]],
  clipboard: [
    ["path", { d: "M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2h-2" }],
    ["path", { d: "M9 5a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2" }]
  ],
  copy: [
    ["path", { d: "M7 9.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667l0 -8.666" }],
    ["path", { d: "M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1" }]
  ],
  "device-floppy": [
    ["path", { d: "M6 4h10l4 4v10a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2" }],
    ["path", { d: "M10 14a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" }],
    ["path", { d: "M14 4l0 4l-6 0l0 -4" }]
  ],
  eraser: [
    ["path", { d: "M19 20h-10.5l-4.21 -4.3a1 1 0 0 1 0 -1.41l10 -10a1 1 0 0 1 1.41 0l5 5a1 1 0 0 1 0 1.41l-9.2 9.3" }],
    ["path", { d: "M18 13.3l-6.3 -6.3" }]
  ],
  keyboard: [
    ["path", { d: "M2 8a2 2 0 0 1 2 -2h16a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2l0 -8" }],
    ["path", { d: "M6 10l0 .01" }],
    ["path", { d: "M10 10l0 .01" }],
    ["path", { d: "M14 10l0 .01" }],
    ["path", { d: "M18 10l0 .01" }],
    ["path", { d: "M6 14l0 .01" }],
    ["path", { d: "M18 14l0 .01" }],
    ["path", { d: "M10 14l4 .01" }]
  ],
  microphone: [
    ["path", { d: "M9 5a3 3 0 0 1 3 -3a3 3 0 0 1 3 3v5a3 3 0 0 1 -3 3a3 3 0 0 1 -3 -3l0 -5" }],
    ["path", { d: "M5 10a7 7 0 0 0 14 0" }],
    ["path", { d: "M8 21l8 0" }],
    ["path", { d: "M12 17l0 4" }]
  ],
  pencil: [
    ["path", { d: "M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4" }],
    ["path", { d: "M13.5 6.5l4 4" }]
  ],
  plus: [
    ["path", { d: "M12 5l0 14" }],
    ["path", { d: "M5 12l14 0" }]
  ],
  "player-play": [["path", { d: "M7 4v16l13 -8l-13 -8" }]],
  "player-stop": [["path", { d: "M5 7a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2l0 -10" }]],
  refresh: [
    ["path", { d: "M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4" }],
    ["path", { d: "M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4" }]
  ],
  restore: [
    ["path", { d: "M3.06 13a9 9 0 1 0 .49 -4.087" }],
    ["path", { d: "M3 4.001v5h5" }],
    ["path", { d: "M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" }]
  ],
  search: [
    ["path", { d: "M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" }],
    ["path", { d: "M21 21l-6 -6" }]
  ],
  sparkles: [["path", { d: "M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6" }]],
  trash: [
    ["path", { d: "M4 7l16 0" }],
    ["path", { d: "M10 11l0 6" }],
    ["path", { d: "M14 11l0 6" }],
    ["path", { d: "M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12" }],
    ["path", { d: "M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3" }]
  ],
  volume: [
    ["path", { d: "M15 8a5 5 0 0 1 0 8" }],
    ["path", { d: "M17.7 5a9 9 0 0 1 0 14" }],
    ["path", { d: "M6 15h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l3.5 -4.5a.8 .8 0 0 1 1.5 .5v14a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5" }]
  ],
  x: [
    ["path", { d: "M18 6l-12 12" }],
    ["path", { d: "M6 6l12 12" }]
  ]
};

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

export function createIcon(name, className = "") {
  const paths = ICON_PATHS[name];
  if (!paths) throw new Error(`Unknown Tabler icon: ${name}`);

  const icon = document.createElementNS(SVG_NAMESPACE, "svg");
  icon.setAttribute("xmlns", SVG_NAMESPACE);
  icon.setAttribute("width", "24");
  icon.setAttribute("height", "24");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "2");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("focusable", "false");
  icon.classList.add("icon", "icon-tabler", `icon-tabler-${name}`);
  if (className) icon.classList.add(...className.split(/\s+/).filter(Boolean));

  for (const [tagName, attributes] of paths) {
    const path = document.createElementNS(SVG_NAMESPACE, tagName);
    for (const [attribute, value] of Object.entries(attributes)) path.setAttribute(attribute, value);
    icon.append(path);
  }
  return icon;
}

export function setButtonLabel(button, label) {
  const labelElement = button.querySelector(".button-label");
  if (labelElement) labelElement.textContent = label;
  else button.textContent = label;
}

export function createButtonLabel(label) {
  const labelElement = document.createElement("span");
  labelElement.className = "button-label";
  labelElement.textContent = label;
  return labelElement;
}

export function setButtonIcon(button, name, className = "") {
  const currentIcon = button.querySelector(":scope > .icon");
  const nextIcon = createIcon(name, className);
  if (currentIcon) currentIcon.replaceWith(nextIcon);
  else button.prepend(nextIcon);
}
