import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getX11 } from "./linux-x11.js";
import { abortableDelay, throwIfAborted } from "./operation-cancellation.js";

const CLIPBOARD_SETTLE_DELAY_MS = 500;
const COPY_POLL_INTERVAL_MS = 25;
const COPY_POLL_ATTEMPTS = 16;
const COPY_STABILITY_DELAY_MS = 25;
const SELECTION_SENTINEL_PREFIX = "porvoz-selection-sentinel:";
const MAX_CLIPBOARD_SNAPSHOT_BYTES = 64 * 1024 * 1024;
const XCLIP_TIMEOUT_MS = 1_000;
const BOOKMARK_MIME_TYPE = "electron application/bookmark";
const ELECTRON_OS_CLIPBOARD_TYPE_PREFIX = "electron application/osclipboard;";
const LINUX_DUPLICATE_PLAIN_TEXT_TYPE = "text/plain;charset=utf-8";
const LINUX_NON_TEXT_CLIPBOARD_TYPES = [
  "text/html",
  "text/rtf",
  "image/png",
  BOOKMARK_MIME_TYPE,
  "application/vnd.portal.filetransfer",
  "application/vnd.portal.files"
];
const LINUX_UNRESTORABLE_X11_TYPES = new Set([
  "application/vnd.portal.filetransfer",
  "application/vnd.portal.files"
]);
const execFileAsync = promisify(execFile);

export function createClipboardTextTransaction({
  clipboard,
  ClipboardItem,
  Blob: BlobImplementation = globalThis.Blob,
  delay = abortableDelay,
  platform = process.platform
} = {}) {
  if (!clipboard || typeof clipboard.read !== "function" || typeof clipboard.write !== "function") {
    throw new TypeError("An asynchronous Electron clipboard implementation is required.");
  }
  if (typeof ClipboardItem !== "function") {
    throw new TypeError("An Electron ClipboardItem implementation is required.");
  }
  if (typeof BlobImplementation !== "function") {
    throw new TypeError("A Blob implementation is required to restore clipboard data.");
  }

  let transactionQueue = Promise.resolve();

  return {
    pasteText: (...args) => enqueue(() => pasteText(...args)),
    readSelectedText: (...args) => enqueue(() => readSelectedText(...args))
  };

  function enqueue(operation) {
    const result = transactionQueue.then(operation, operation);
    transactionQueue = result.catch(() => {});
    return result;
  }

  async function pasteText(text, paste, { signal } = {}) {
    if (typeof text !== "string" || !text) return { clipboardChanged: false };
    if (typeof paste !== "function") throw new TypeError("A paste function is required.");

    throwIfAborted(signal);

    const original = await readClipboardSnapshot();
    if (original.linuxX11) {
      return pasteLinuxText(text, paste, original, signal);
    }
    let temporarySnapshot;
    let operationError;
    let clipboardChanged = false;

    try {
      throwIfAborted(signal);
      await writeTemporaryText(text);
      throwIfAborted(signal);
      temporarySnapshot = await readClipboardSnapshot();
      throwIfAborted(signal);
      await paste();
      await delay(CLIPBOARD_SETTLE_DELAY_MS, signal);
      throwIfAborted(signal);
    } catch (error) {
      operationError = error;
    } finally {
      if (temporarySnapshot) {
        try {
          const current = await readClipboardSnapshot();
          clipboardChanged = current.fingerprint !== temporarySnapshot.fingerprint;
          if (!clipboardChanged) await restoreClipboardSnapshot(original);
        } catch (error) {
          if (!operationError) operationError = error;
        }
      } else {
        // The temporary write may have succeeded before its confirmation read
        // failed. Restore the original contents rather than leaving our text
        // behind when the clipboard state cannot be verified.
        try {
          await restoreClipboardSnapshot(original);
        } catch (error) {
          if (!operationError) operationError = error;
        }
      }
    }

    if (operationError) throw operationError;
    throwIfAborted(signal);
    return { clipboardChanged };
  }

  async function pasteLinuxText(text, paste, original, signal) {
    let temporaryOwner = "";
    let operationError;
    let clipboardChanged = false;
    try {
      throwIfAborted(signal);
      await writeTemporaryText(text);
      temporaryOwner = getLinuxClipboardOwner();
      if (!temporaryOwner) throw new Error("Could not establish the temporary X11 clipboard owner.");
      throwIfAborted(signal);
      await paste();
      await delay(CLIPBOARD_SETTLE_DELAY_MS, signal);
      throwIfAborted(signal);
    } catch (error) {
      operationError = error;
    } finally {
      if (temporaryOwner) {
        const currentOwner = getLinuxClipboardOwner();
        clipboardChanged = !currentOwner || currentOwner !== temporaryOwner;
        if (!clipboardChanged) {
          try {
            await restoreClipboardSnapshot(original);
          } catch (error) {
            if (!operationError) operationError = error;
          }
        }
      }
    }

    if (operationError) throw operationError;
    throwIfAborted(signal);
    return { clipboardChanged };
  }

  async function readSelectedText(copy, { signal } = {}) {
    if (typeof copy !== "function") throw new TypeError("A copy function is required.");
    throwIfAborted(signal);

    if (platform === "linux" && typeof clipboard.readText === "function") {
      return readLinuxSelectedText(copy, signal);
    }

    const original = await readClipboardSnapshot({ protectLinuxNonText: true });
    const sentinel = `${SELECTION_SENTINEL_PREFIX}${randomUUID()}`;
    let sentinelSnapshot;
    let capturedSnapshot;
    let capturedText = "";

    try {
      await writeTemporaryText(sentinel);
      sentinelSnapshot = await readClipboardSnapshot();
      if (readTextFromSnapshot(sentinelSnapshot) !== sentinel) {
        throw new Error("Could not establish an isolated clipboard selection transaction.");
      }

      throwIfAborted(signal);
      await copy();
      for (let attempt = 0; attempt < COPY_POLL_ATTEMPTS; attempt += 1) {
        await delay(COPY_POLL_INTERVAL_MS, signal);
        const current = await readClipboardSnapshot();
        if (current.fingerprint === sentinelSnapshot.fingerprint) continue;
        capturedSnapshot = current;
        capturedText = readTextFromSnapshot(current);
        break;
      }

      if (!capturedSnapshot || !capturedText.trim()) return "";

      // Do not overwrite a clipboard change that arrived after the synthetic
      // copy. A stable fingerprint is the strongest ownership signal available
      // across both Win32 and X11 clipboard implementations.
      await delay(COPY_STABILITY_DELAY_MS, signal);
      const stableSnapshot = await readClipboardSnapshot();
      if (stableSnapshot.fingerprint !== capturedSnapshot.fingerprint) {
        capturedSnapshot = undefined;
        capturedText = "";
        return "";
      }
      return capturedText;
    } finally {
      if (!sentinelSnapshot) {
        await restoreClipboardSnapshot(original);
      } else {
        const current = await readClipboardSnapshot();
        const stillOwnsSentinel = current.fingerprint === sentinelSnapshot.fingerprint;
        const stillOwnsCapturedText = Boolean(
          capturedSnapshot
          && capturedText.trim()
          && current.fingerprint === capturedSnapshot.fingerprint
        );
        if (stillOwnsSentinel || stillOwnsCapturedText) {
          await restoreClipboardSnapshot(original);
        }
      }
    }
  }

  async function readLinuxSelectedText(copy, signal) {
    const original = await readClipboardSnapshot({ protectLinuxNonText: true });
    const sentinel = `${SELECTION_SENTINEL_PREFIX}${randomUUID()}`;
    let captured = "";
    try {
      throwIfAborted(signal);
      await writeTemporaryText(sentinel);
      throwIfAborted(signal);
      await copy();
      for (let attempt = 0; attempt < COPY_POLL_ATTEMPTS; attempt += 1) {
        await delay(COPY_POLL_INTERVAL_MS, signal);
        const text = await readLinuxText();
        if (text === sentinel) continue;
        captured = text;
        break;
      }
      return captured;
    } finally {
      // CopyQ may take over the copied text. Compare contents, rather than
      // treating its ownership handoff as an unrelated clipboard edit.
      const current = await readLinuxText();
      if (current === sentinel || (captured && current === captured)) {
        await restoreClipboardSnapshot(original);
      }
    }
  }

  async function readLinuxText() {
    const result = await execFileAsync("xclip", ["-selection", "clipboard", "-o"], {
      encoding: "utf8", timeout: XCLIP_TIMEOUT_MS, maxBuffer: MAX_CLIPBOARD_SNAPSHOT_BYTES
    });
    return result.stdout;
  }

  async function readClipboardSnapshot({ protectLinuxNonText = false } = {}) {
    if (platform === "linux"
      && typeof clipboard.readText === "function"
      && typeof clipboard.writeText === "function") {
      return readLinuxClipboardSnapshot({ protectLinuxNonText });
    }

    const items = await clipboard.read();
    const snapshotItems = [];
    for (const item of Array.isArray(items) ? items : []) {
      const payloads = [];
      for (const type of Array.isArray(item?.types) ? item.types.filter(isSnapshotType) : []) {
        payloads.push({
          type,
          payload: await readClipboardPayload(item, type)
        });
      }
      snapshotItems.push(payloads);
    }
    return {
      items: snapshotItems,
      fingerprint: fingerprint(snapshotItems)
    };
  }

  async function writeTemporaryText(text) {
    if (platform === "linux" && typeof clipboard.writeText === "function") {
      clipboardDebug("temporary-write-start");
      await writeLinuxClipboard([{ "text/plain": text }]);
      clipboardDebug("temporary-write-done");
      return;
    }
    await clipboard.write([new ClipboardItem({ "text/plain": text })]);
  }

  async function writeLinuxClipboard(items) {
    // Chromium's portable WriteText ALSO owns PRIMARY, clearing GTK selections.
    // Raw X11 targets bypass that behavior for temporary text AND restoration.
    const rawItems = items.map((values) => {
      const raw = {};
      for (const [type, value] of Object.entries(values)) {
        const name = `${ELECTRON_OS_CLIPBOARD_TYPE_PREFIX}format="${type}"`;
        raw[name] = typeof value === "string" ? new BlobImplementation([value]) : value;
        if (type === "text/plain") {
          raw[`${ELECTRON_OS_CLIPBOARD_TYPE_PREFIX}format="UTF8_STRING"`] = raw[name];
          raw[`${ELECTRON_OS_CLIPBOARD_TYPE_PREFIX}format="text/plain;charset=utf-8"`] = raw[name];
        }
      }
      // CopyQ skips CLIPBOARD -> PRIMARY synchronization for an owned write.
      raw["application/x-copyq-owner"] = new BlobImplementation(["porvoz"]);
      return new ClipboardItem(raw);
    });
    await clipboard.write(rawItems);
  }

  function isSnapshotType(type) {
    if (typeof type !== "string" || !type.trim()) return false;
    if (platform !== "linux") return true;
    const normalizedType = type.trim().toLowerCase();
    // Electron exposes X11 selection-management targets as readable types,
    // but asking getType() for them can block on Linux. They are transport
    // metadata, not user clipboard content, and must not be restored.
    if (normalizedType.startsWith(ELECTRON_OS_CLIPBOARD_TYPE_PREFIX)) return false;
    // Electron's Linux backend also exposes this duplicate target. The
    // canonical text/plain value contains the same user content and is the
    // portable format used by the paste transaction.
    if (normalizedType === LINUX_DUPLICATE_PLAIN_TEXT_TYPE) return false;
    return true;
  }

  async function readClipboardPayload(item, type) {
    const value = await item.getType(type);
    if (type === BOOKMARK_MIME_TYPE) {
      return { kind: "bookmark", value };
    }
    if (typeof value === "string") {
      return { kind: "string", value };
    }
    if (!value || typeof value.arrayBuffer !== "function") {
      throw new Error(`Could not snapshot clipboard format '${type}'.`);
    }
    return {
      kind: "bytes",
      value: Buffer.from(await value.arrayBuffer())
    };
  }

  async function restoreClipboardSnapshot(snapshot) {
    if (snapshot.textOnly) {
      const text = readTextFromSnapshot(snapshot);
      if (text) await writeLinuxClipboard([{ "text/plain": text }]);
      else if (typeof clipboard.clear === "function") clipboard.clear();
      return;
    }
    if (!snapshot.items.length) {
      if (typeof clipboard.clear === "function") clipboard.clear();
      return;
    }

    const items = snapshot.items.map((payloads) => {
      const values = {};
      for (const { type, payload } of payloads) {
        values[type] = payload.kind === "bookmark"
          ? payload.value
          : payload.kind === "string"
            ? payload.value
            : new BlobImplementation([payload.value], { type });
      }
      return values;
    });
    if (platform === "linux") await writeLinuxClipboard(items);
    else await clipboard.write(items.map((values) => new ClipboardItem(values)));
  }

  async function readLinuxClipboardSnapshot({ protectLinuxNonText }) {
    let targets;
    try {
      const result = await execFileAsync("xclip", [
        "-selection", "clipboard", "-t", "TARGETS", "-o"
      ], {
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
        timeout: XCLIP_TIMEOUT_MS,
        windowsHide: true
      });
      targets = result.stdout.split(/\r?\n/).map((type) => type.trim()).filter(Boolean);
    } catch (error) {
      if (error?.code === "ENOENT") {
        return readLinuxTextOnlySnapshot({ protectLinuxNonText });
      }
      if (await clipboard.readText() === "") {
        const items = [];
        return { items, fingerprint: fingerprint(items), linuxX11: true };
      }
      throw error;
    }

    if (protectLinuxNonText
      && targets.some((type) => LINUX_UNRESTORABLE_X11_TYPES.has(type.toLowerCase()))) {
      throw new Error("Selected-text capture was skipped to preserve a file clipboard transaction.");
    }

    const mimeTypes = [...new Set(targets.filter(isRestorableLinuxMimeType))];
    const payloads = [];
    let totalBytes = 0;
    for (const type of mimeTypes) {
      const result = await execFileAsync("xclip", [
        "-selection", "clipboard", "-t", type, "-o"
      ], {
        encoding: "buffer",
        maxBuffer: MAX_CLIPBOARD_SNAPSHOT_BYTES,
        timeout: XCLIP_TIMEOUT_MS,
        windowsHide: true
      });
      const value = Buffer.from(result.stdout);
      totalBytes += value.length;
      if (totalBytes > MAX_CLIPBOARD_SNAPSHOT_BYTES) {
        throw new Error("The clipboard is too large to preserve safely.");
      }
      payloads.push({ type, payload: { kind: "bytes", value } });
    }

    if (!payloads.some(({ type }) => type.toLowerCase() === "text/plain")) {
      const text = await clipboard.readText();
      if (text) payloads.push({ type: "text/plain", payload: { kind: "string", value: text } });
    }
    const items = payloads.length ? [payloads] : [];
    return { items, fingerprint: fingerprint(items), linuxX11: true };
  }

  async function readLinuxTextOnlySnapshot({ protectLinuxNonText }) {
    if (protectLinuxNonText && typeof clipboard.has === "function") {
      for (const type of LINUX_NON_TEXT_CLIPBOARD_TYPES) {
        if (await clipboard.has(type)) {
          throw new Error("Selected-text capture was skipped to preserve non-text clipboard data.");
        }
      }
    }
    const text = await clipboard.readText();
    const items = text
      ? [[{ type: "text/plain", payload: { kind: "string", value: text } }]]
      : [];
    return { items, fingerprint: fingerprint(items), textOnly: true };
  }

  function isRestorableLinuxMimeType(type) {
    const normalizedType = type.toLowerCase();
    if (!normalizedType.includes("/")) return false;
    if (normalizedType.startsWith("chromium/")) return false;
    if (normalizedType.startsWith("application/vnd.portal.")) return false;
    if (normalizedType.startsWith(ELECTRON_OS_CLIPBOARD_TYPE_PREFIX)) return false;
    return normalizedType !== LINUX_DUPLICATE_PLAIN_TEXT_TYPE;
  }

  function readTextFromSnapshot(snapshot) {
    for (const payloads of snapshot.items) {
      const plainText = payloads.find(({ type }) => type.trim().toLowerCase() === "text/plain");
      if (!plainText) continue;
      if (plainText.payload.kind === "string") return plainText.payload.value;
      if (plainText.payload.kind === "bytes") return plainText.payload.value.toString("utf8");
    }
    return "";
  }
}

function fingerprint(items) {
  const hash = createHash("sha256");
  for (const payloads of items) {
    for (const { type, payload } of payloads) {
      hash.update(type);
      hash.update("\0");
      hash.update(payload.kind);
      hash.update("\0");
      if (payload.kind === "bytes") {
        hash.update(payload.value);
      } else {
        hash.update(JSON.stringify(payload.value));
      }
      hash.update("\0");
    }
    hash.update("\n");
  }
  return hash.digest("hex");
}

function getLinuxClipboardOwner() {
  try {
    const owner = getX11().selectionOwner("CLIPBOARD");
    return owner ? String(owner) : "";
  } catch {
    return "";
  }
}

function clipboardDebug(message) {
  if (process.env.PORVOZ_CLIPBOARD_DEBUG === "1") {
    console.error(`[clipboard] ${message}`);
  }
}
