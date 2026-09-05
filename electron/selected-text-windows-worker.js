import { parentPort } from "node:worker_threads";
import koffi from "koffi";

const MAX_SELECTED_TEXT_CHARACTERS = 200_000;
const MAX_SELECTIONS = 32;
const MAX_ANCESTOR_DEPTH = 16;
const UIA_TEXT_PATTERN_ID = 10014;
let nativeApi;
let nativeUnavailable = false;

parentPort.on("message", ({ type, requestId } = {}) => {
  if (type !== "read") return;
  let text = "";
  try { text = readSelectedText(); } catch { text = ""; }
  parentPort.postMessage({ requestId, text });
});

function readSelectedText() {
  const api = getNativeApi();
  if (!api) return "";
  const initialized = succeeded(api.initialize());
  if (!initialized) return "";

  let automation;
  let element;
  let walker;
  try {
    automation = api.createAutomation();
    if (!automation) return "";
    element = api.getFocusedElement(automation);
    walker = api.getControlViewWalker(automation);
    if (!element || !walker) return "";
    for (let depth = 0; element && depth < MAX_ANCESTOR_DEPTH; depth += 1) {
      const text = getElementSelection(api, element);
      if (text) return text;
      const parent = api.getParentElement(walker, element);
      api.release(element);
      element = parent;
    }
    return "";
  } finally {
    api.release(element);
    api.release(walker);
    api.release(automation);
    api.uninitialize();
  }
}

function getElementSelection(api, element) {
  const pattern = api.getCurrentPattern(element, UIA_TEXT_PATTERN_ID);
  if (!pattern) return "";
  try {
    const ranges = api.getSelection(pattern);
    if (!ranges) return "";
    try {
      const parts = [];
      let remaining = MAX_SELECTED_TEXT_CHARACTERS;
      const count = Math.min(MAX_SELECTIONS, Math.max(0, api.getRangeCount(ranges)));
      for (let index = 0; index < count && remaining > 0; index += 1) {
        const range = api.getRange(ranges, index);
        if (!range) continue;
        try {
          const text = api.getText(range, remaining);
          if (text) {
            parts.push(text);
            remaining -= text.length;
          }
        } finally {
          api.release(range);
        }
      }
      return parts.join("\n");
    } finally {
      api.release(ranges);
    }
  } finally {
    api.release(pattern);
  }
}

function getNativeApi() {
  if (nativeApi || nativeUnavailable) return nativeApi;
  try { nativeApi = loadNativeApi(); } catch { nativeUnavailable = true; }
  return nativeApi;
}

function loadNativeApi() {
  const GUID = koffi.struct("PorvozUiaGuid", {
    Data1: "uint32_t",
    Data2: "uint16_t",
    Data3: "uint16_t",
    Data4: koffi.array("uint8_t", 8)
  });
  const ole32 = koffi.load("ole32.dll");
  const oleaut32 = koffi.load("oleaut32.dll");
  const CoInitializeEx = ole32.func("int32_t __stdcall CoInitializeEx(void *reserved, uint32_t flags)");
  const CoCreateInstance = ole32.func(`int32_t __stdcall CoCreateInstance(const ${GUID.name} *classId, void *outer, uint32_t context, const ${GUID.name} *interfaceId, _Out_ void **result)`);
  const CoUninitialize = ole32.func("void __stdcall CoUninitialize()");
  const SysFreeString = oleaut32.func("void __stdcall SysFreeString(void *value)");
  const prototypes = {
    release: koffi.proto("uint32_t __stdcall PorvozRelease(void *self)"),
    getFocusedElement: koffi.proto("int32_t __stdcall PorvozGetFocusedElement(void *self, _Out_ void **element)"),
    getControlViewWalker: koffi.proto("int32_t __stdcall PorvozGetControlViewWalker(void *self, _Out_ void **walker)"),
    getParentElement: koffi.proto("int32_t __stdcall PorvozGetParentElement(void *self, void *element, _Out_ void **parent)"),
    getCurrentPattern: koffi.proto("int32_t __stdcall PorvozGetCurrentPattern(void *self, int32_t patternId, _Out_ void **pattern)"),
    getSelection: koffi.proto("int32_t __stdcall PorvozGetSelection(void *self, _Out_ void **ranges)"),
    getLength: koffi.proto("int32_t __stdcall PorvozGetLength(void *self, _Out_ int32_t *length)"),
    getElement: koffi.proto("int32_t __stdcall PorvozGetElement(void *self, int32_t index, _Out_ void **range)"),
    getText: koffi.proto("int32_t __stdcall PorvozGetText(void *self, int32_t maxLength, _Out_ void **text)")
  };
  return {
    initialize: () => CoInitializeEx(null, 0),
    uninitialize: () => CoUninitialize(),
    createAutomation: () => readPointerOutput((output) => CoCreateInstance(
      parseGuid("ff48dba4-60ef-4201-aa87-54103eef594e"), null, 1,
      parseGuid("30cbe57d-d9d0-452a-ab13-7ac5ac4825ee"), output
    )),
    getFocusedElement: (object) => readPointerOutput((output) => invoke(object, 8, prototypes.getFocusedElement, output)),
    getControlViewWalker: (object) => readPointerOutput((output) => invoke(object, 14, prototypes.getControlViewWalker, output)),
    getParentElement: (object, element) => readPointerOutput((output) => invoke(object, 3, prototypes.getParentElement, element, output)),
    getCurrentPattern: (object, id) => readPointerOutput((output) => invoke(object, 16, prototypes.getCurrentPattern, id, output)),
    getSelection: (object) => readPointerOutput((output) => invoke(object, 5, prototypes.getSelection, output)),
    getRangeCount(object) {
      const output = [0];
      return succeeded(invoke(object, 3, prototypes.getLength, output)) ? output[0] : 0;
    },
    getRange: (object, index) => readPointerOutput((output) => invoke(object, 4, prototypes.getElement, index, output)),
    getText(object, maxLength) {
      const output = [null];
      if (!succeeded(invoke(object, 12, prototypes.getText, maxLength, output)) || !output[0]) return "";
      try { return koffi.decode(output[0], "char16_t", -1); }
      finally { SysFreeString(output[0]); }
    },
    release(object) { if (object) invoke(object, 2, prototypes.release); }
  };

  function invoke(object, index, prototype, ...args) {
    const table = koffi.decode(object, "void *");
    const pointer = koffi.decode(table, index * koffi.sizeof("void *"), "void *");
    return koffi.call(pointer, prototype, object, ...args);
  }
  function readPointerOutput(call) {
    const output = [null];
    return succeeded(call(output)) ? output[0] : null;
  }
  function parseGuid(value) {
    const parts = value.split("-");
    const tail = `${parts[3]}${parts[4]}`;
    return {
      Data1: Number.parseInt(parts[0], 16),
      Data2: Number.parseInt(parts[1], 16),
      Data3: Number.parseInt(parts[2], 16),
      Data4: Array.from({ length: 8 }, (_, index) => Number.parseInt(tail.slice(index * 2, index * 2 + 2), 16))
    };
  }
}

function succeeded(result) {
  return result >= 0;
}
