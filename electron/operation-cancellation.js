export class OperationCanceledError extends Error {
  constructor(message = "Canceled by user.") {
    super(message);
    this.name = "AbortError";
    this.code = "ERR_CANCELED";
  }
}

export function createOperationCanceledError(message) {
  return new OperationCanceledError(message);
}

export function isCancellationError(error) {
  return Boolean(error && (
    error.code === "ERR_CANCELED"
    || error.name === "AbortError"
    || error.name === "CanceledError"
    || error instanceof OperationCanceledError
  ));
}

export function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof OperationCanceledError) throw signal.reason;
  const message = typeof signal.reason?.message === "string" && signal.reason.message.trim()
    ? signal.reason.message
    : undefined;
  throw new OperationCanceledError(message);
}

export function abortableDelay(milliseconds, signal) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    let timer;
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new OperationCanceledError());
    };

    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function cancellationErrorFor(error, signal) {
  if (isCancellationError(error)) return error;
  if (signal?.aborted) return new OperationCanceledError();
  return null;
}
