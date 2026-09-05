import { parentPort } from "node:worker_threads";
import koffi from "koffi";

const ATSPI_STATE_FOCUSED = 12;
const ATSPI_STATE_ACTIVE = 1;
const MAX_ACCESSIBLE_NODES = 10_000;
const MAX_TREE_DEPTH = 64;
const MAX_SELECTIONS = 32;
const MAX_SELECTED_TEXT_CHARACTERS = 200_000;
const debugEnabled = process.env.PORVOZ_SELECTED_TEXT_DEBUG === "1";

let nativeApi;
let nativeUnavailable = false;

parentPort.on("message", ({ type, requestId } = {}) => {
  if (type !== "read") return;
  let text = "";
  try {
    text = readSelectedText();
  } catch {
    text = "";
  }
  parentPort.postMessage({ requestId, text });
});

function readSelectedText() {
  const api = getNativeApi();
  if (!api) {
    debug("AT-SPI native libraries are unavailable.");
    return "";
  }
  const initResult = api.init();
  debug(`atspi_init=${initResult}`);
  if (initResult !== 0) return "";

  const budget = { visited: 0 };
  const desktopCount = Math.max(0, api.getDesktopCount());
  debug(`desktops=${desktopCount}`);
  for (let desktopIndex = 0; desktopIndex < desktopCount; desktopIndex += 1) {
    const desktop = api.getDesktop(desktopIndex);
    if (!desktop) continue;
    try {
      const activeResult = findSelectionInActiveWindow(api, desktop, budget);
      debug(`desktop=${desktopIndex} active=${activeResult.foundActiveWindow} visited=${budget.visited}`);
      if (activeResult.foundActiveWindow) return activeResult.text;
      const text = findFocusedSelection(api, desktop, [], 0, budget);
      if (text) return text;
    } finally {
      api.unref(desktop);
    }
  }
  return "";
}

function findSelectionInActiveWindow(api, desktop, budget) {
  let applicationCount = 0;
  try {
    applicationCount = Math.max(0, api.getChildCount(desktop, null));
  } catch {
    return { foundActiveWindow: false, text: "" };
  }

  for (let applicationIndex = 0; applicationIndex < applicationCount; applicationIndex += 1) {
    let application;
    try {
      application = api.getChild(desktop, applicationIndex, null);
      if (!application) continue;
      if (hasState(api, application, ATSPI_STATE_ACTIVE)) {
        debug(`active application index=${applicationIndex}`);
        return {
          foundActiveWindow: true,
          text: findFocusedSelection(api, application, [desktop], 1, budget)
        };
      }

      let windowCount = 0;
      try {
        windowCount = Math.max(0, api.getChildCount(application, null));
      } catch {
        continue;
      }
      for (let windowIndex = 0; windowIndex < windowCount; windowIndex += 1) {
        let window;
        try {
          window = api.getChild(application, windowIndex, null);
          if (!window || !hasState(api, window, ATSPI_STATE_ACTIVE)) continue;
          debug(`active window application=${applicationIndex} window=${windowIndex}`);
          return {
            foundActiveWindow: true,
            text: findFocusedSelection(api, window, [desktop, application], 2, budget)
          };
        } finally {
          if (window) api.unref(window);
        }
      }
    } catch {
      // Applications can disappear while the desktop accessibility tree is read.
    } finally {
      if (application) api.unref(application);
    }
  }
  return { foundActiveWindow: false, text: "" };
}

function findFocusedSelection(api, accessible, ancestors, depth, budget) {
  if (!accessible || depth > MAX_TREE_DEPTH || budget.visited >= MAX_ACCESSIBLE_NODES) return "";
  budget.visited += 1;

  if (isFocused(api, accessible)) {
    debug(`focused depth=${depth}`);
    const candidates = [accessible, ...ancestors.slice().reverse()];
    for (const candidate of candidates) {
      const text = selectionFromAccessible(api, candidate);
      if (text) return text;
    }
  }

  let childCount = 0;
  try {
    childCount = Math.max(0, api.getChildCount(accessible, null));
  } catch {
    return "";
  }
  for (let childIndex = 0; childIndex < childCount; childIndex += 1) {
    if (budget.visited >= MAX_ACCESSIBLE_NODES) break;
    let child;
    try {
      child = api.getChild(accessible, childIndex, null);
      if (!child) continue;
      const text = findFocusedSelection(api, child, [...ancestors, accessible], depth + 1, budget);
      if (text) return text;
    } catch {
      // An application can remove accessibility nodes while the tree is read.
    } finally {
      if (child) api.unref(child);
    }
  }
  return "";
}

function isFocused(api, accessible) {
  return hasState(api, accessible, ATSPI_STATE_FOCUSED);
}

function hasState(api, accessible, state) {
  let stateSet;
  try {
    stateSet = api.getStateSet(accessible);
    return Boolean(stateSet && api.stateSetContains(stateSet, state));
  } catch {
    return false;
  } finally {
    if (stateSet) api.unref(stateSet);
  }
}

function selectionFromAccessible(api, accessible) {
  let textInterface;
  try {
    textInterface = api.getTextInterface(accessible);
    if (!textInterface) return "";
    const selectionCount = Math.min(
      MAX_SELECTIONS,
      Math.max(0, api.getSelectionCount(textInterface, null))
    );
    debug(`text selection count=${selectionCount}`);
    const parts = [];
    let remaining = MAX_SELECTED_TEXT_CHARACTERS;
    for (let index = 0; index < selectionCount && remaining > 0; index += 1) {
      let rangePointer;
      let textPointer;
      try {
        rangePointer = api.getSelection(textInterface, index, null);
        if (!rangePointer) continue;
        const range = koffi.decode(rangePointer, api.AtspiRange);
        debug(`selection range=${range.start_offset}:${range.end_offset}`);
        if (range.end_offset <= range.start_offset) continue;
        textPointer = api.getText(textInterface, range.start_offset, range.end_offset, null);
        if (!textPointer) continue;
        const text = koffi.decode.string(textPointer).slice(0, remaining);
        if (text) {
          parts.push(text);
          remaining -= text.length;
        }
      } finally {
        if (textPointer) api.free(textPointer);
        if (rangePointer) api.free(rangePointer);
      }
    }
    return parts.join("\n");
  } catch {
    return "";
  } finally {
    if (textInterface) api.unref(textInterface);
  }
}

function getNativeApi() {
  if (nativeApi || nativeUnavailable) return nativeApi;
  try {
    const atspi = koffi.load("libatspi.so.0");
    const glib = koffi.load("libglib-2.0.so.0");
    const gobject = koffi.load("libgobject-2.0.so.0");
    const AtspiRange = koffi.struct("PorvozAtspiRange", {
      start_offset: "int32_t",
      end_offset: "int32_t"
    });
    nativeApi = {
      AtspiRange,
      init: atspi.func("int atspi_init()"),
      getDesktopCount: atspi.func("int atspi_get_desktop_count()"),
      getDesktop: atspi.func("void * atspi_get_desktop(int desktop_index)"),
      getChildCount: atspi.func("int atspi_accessible_get_child_count(void *accessible, void *error)"),
      getChild: atspi.func("void * atspi_accessible_get_child_at_index(void *accessible, int child_index, void *error)"),
      getStateSet: atspi.func("void * atspi_accessible_get_state_set(void *accessible)"),
      stateSetContains: atspi.func("int atspi_state_set_contains(void *state_set, int state)"),
      getTextInterface: atspi.func("void * atspi_accessible_get_text_iface(void *accessible)"),
      getSelectionCount: atspi.func("int atspi_text_get_n_selections(void *text, void *error)"),
      getSelection: atspi.func("void * atspi_text_get_selection(void *text, int selection_number, void *error)"),
      getText: atspi.func("void * atspi_text_get_text(void *text, int start_offset, int end_offset, void *error)"),
      free: glib.func("void g_free(void *pointer)"),
      unref: gobject.func("void g_object_unref(void *object)")
    };
  } catch {
    nativeUnavailable = true;
  }
  return nativeApi;
}

function debug(message) {
  if (debugEnabled) console.error(`[selected-text] ${message}`);
}
