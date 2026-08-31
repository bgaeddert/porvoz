import { createHash } from "node:crypto";

const CLIPBOARD_SETTLE_DELAY_MS = 500;
const BOOKMARK_MIME_TYPE = "electron application/bookmark";

export function createClipboardTextTransaction({
  clipboard,
  ClipboardItem,
  Blob: BlobImplementation = globalThis.Blob,
  delay = wait
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

  return { pasteText };

  async function pasteText(text, paste) {
    if (typeof text !== "string" || !text) return { clipboardChanged: false };
    if (typeof paste !== "function") throw new TypeError("A paste function is required.");

    const original = await readClipboardSnapshot();
    let temporarySnapshot;
    let operationError;
    let clipboardChanged = false;

    try {
      await clipboard.write([new ClipboardItem({ "text/plain": text })]);
      temporarySnapshot = await readClipboardSnapshot();
      await paste();
      await delay(CLIPBOARD_SETTLE_DELAY_MS);
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
    return { clipboardChanged };
  }

  async function readClipboardSnapshot() {
    const items = await clipboard.read();
    const snapshotItems = [];
    for (const item of Array.isArray(items) ? items : []) {
      const payloads = [];
      for (const type of Array.isArray(item?.types) ? item.types : []) {
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
      return new ClipboardItem(values);
    });
    await clipboard.write(items);
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

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
