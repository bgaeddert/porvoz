const SIZE = 552;
const CENTER = SIZE / 2;
const OUTER_RADIUS = 264;
const INNER_RADIUS = 128;
const CENTER_RADIUS = 117;
const SEGMENT_ANGLE = 360 / 12;
const SEGMENT_GAP = 2.4;

const surface = document.querySelector("#radial-surface");
const segments = document.querySelector("#radial-segments");
const center = document.querySelector("#radial-center");
const centerRing = document.querySelector("#radial-center-ring");
const centerLabel = document.querySelector("#radial-center-label");
let menu;
let selectedSlot = "center";
let lastSentSelection;

window.porvozRadial?.onOpen(({ menu: nextMenu, selectedSlot: initialSelection } = {}) => {
  surface.dataset.open = "false";
  menu = nextMenu || { slots: [] };
  selectedSlot = initialSelection || "center";
  render();
  sendSelection(selectedSlot);
  surface.dataset.open = "true";
});
window.porvozRadial?.onSelection(({ slotId } = {}) => {
  if (slotId) setSelection(slotId, false);
});
window.porvozRadial?.onClose(() => {
  surface.dataset.open = "false";
});

surface.addEventListener("pointermove", (event) => {
  setSelection(selectionForPoint(event.clientX, event.clientY), true);
});
surface.addEventListener("pointerleave", () => setSelection("outside", true));
surface.addEventListener("pointerdown", (event) => event.preventDefault());
center.addEventListener("focus", () => setSelection("center", true));
center.addEventListener("keydown", (event) => {
  if (event.key === "Escape") event.preventDefault();
});

function render() {
  segments.replaceChildren();
  const slotMap = new Map((Array.isArray(menu?.slots) ? menu.slots : []).map((slot) => [String(slot.id), slot]));
  for (let index = 0; index < 12; index += 1) {
    const id = String(index + 1);
    const slot = slotMap.get(id) || { id, label: "", action: null };
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.classList.add("radial-segment");
    group.dataset.slot = id;
    group.setAttribute("role", "button");
    group.setAttribute("tabindex", "0");
    group.setAttribute("aria-label", slotLabel(slot, id));

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.classList.add("radial-segment-shape");
    path.setAttribute("d", segmentPath(index));
    group.append(path);

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.classList.add("radial-segment-label");
    const point = polarPoint(190, -90 + index * SEGMENT_ANGLE);
    text.setAttribute("x", point.x);
    text.setAttribute("y", point.y - (slot.label ? 4 : 0));
    text.setAttribute("text-anchor", "middle");
    text.textContent = displayLabel(slot, "");
    group.append(text);
    segments.append(group);
  }

  const centerSlot = slotMap.get("center") || { id: "center", label: "", action: null };
  const centerText = displayLabel(centerSlot, "");
  centerLabel.textContent = centerText;
  center.setAttribute("aria-label", slotLabel(centerSlot, "Center"));
  selectedSlot = "center";
  updateSelection();
}

function setSelection(slotId, report) {
  const next = slotId === "center" || slotId === "outside" || /^([1-9]|1[0-2])$/.test(slotId)
    ? slotId
    : "outside";
  if (next === selectedSlot && (!report || lastSentSelection === next)) return;
  selectedSlot = next;
  updateSelection();
  if (report) sendSelection(next);
}

function sendSelection(slotId) {
  if (lastSentSelection === slotId) return;
  lastSentSelection = slotId;
  window.porvozRadial?.select(slotId);
}

function updateSelection() {
  segments.querySelectorAll(".radial-segment").forEach((segment) => {
    segment.classList.toggle("selected", segment.dataset.slot === selectedSlot);
  });
  center.classList.toggle("selected", selectedSlot === "center");
  centerRing.classList.toggle("selected", selectedSlot === "center");
  surface.classList.toggle("outside", selectedSlot === "outside");
}

function selectionForPoint(x, y) {
  const dx = x - CENTER;
  const dy = y - CENTER;
  const distance = Math.hypot(dx, dy);
  if (distance > OUTER_RADIUS + 8) return "outside";
  if (distance <= CENTER_RADIUS) return "center";
  const angle = (Math.atan2(dy, dx) * 180 / Math.PI + 450) % 360;
  return String(Math.floor((angle + SEGMENT_ANGLE / 2) / SEGMENT_ANGLE) % 12 + 1);
}

function segmentPath(index) {
  const centerAngle = -90 + index * SEGMENT_ANGLE;
  const startAngle = centerAngle - SEGMENT_ANGLE / 2 + SEGMENT_GAP / 2;
  const endAngle = centerAngle + SEGMENT_ANGLE / 2 - SEGMENT_GAP / 2;
  const outerStart = polarPoint(OUTER_RADIUS, startAngle);
  const outerEnd = polarPoint(OUTER_RADIUS, endAngle);
  const innerEnd = polarPoint(INNER_RADIUS, endAngle);
  const innerStart = polarPoint(INNER_RADIUS, startAngle);
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${OUTER_RADIUS} ${OUTER_RADIUS} 0 0 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${INNER_RADIUS} ${INNER_RADIUS} 0 0 0 ${innerStart.x} ${innerStart.y}`,
    "Z"
  ].join(" ");
}

function polarPoint(radius, angle) {
  const radians = angle * Math.PI / 180;
  return { x: CENTER + radius * Math.cos(radians), y: CENTER + radius * Math.sin(radians) };
}

function displayLabel(slot, fallback) {
  const label = typeof slot?.label === "string" ? slot.label.trim() : "";
  if (label) return label;
  if (!slot?.action) return fallback;
  if (slot.action.type === "navigation") return slot.action.command === "forward" ? "Forward" : "Back";
  return typeof slot.action.label === "string" ? slot.action.label : "Assigned";
}

function slotLabel(slot, fallback) {
  const label = displayLabel(slot, fallback);
  return label ? `${fallback}: ${label}` : fallback;
}
