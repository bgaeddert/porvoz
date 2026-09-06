import koffi from "koffi";

let native;

export function getX11() {
  if (native) return native;
  const x11 = koffi.load("libX11.so.6");
  const open = x11.func("void * XOpenDisplay(const char *name)");
  const display = open(null);
  if (!display) throw new Error("Linux text input requires an X11 display.");
  const atom = x11.func("uintptr_t XInternAtom(void *display, const char *name, int only_if_exists)");
  const owner = x11.func("uintptr_t XGetSelectionOwner(void *display, uintptr_t selection)");
  const root = x11.func("uintptr_t XDefaultRootWindow(void *display)")(display);
  const property = x11.func("int XGetWindowProperty(void *display, uintptr_t window, uintptr_t property, long offset, long length, int remove, uintptr_t type, _Out_ uintptr_t *actual_type, _Out_ int *format, _Out_ unsigned long *count, _Out_ unsigned long *remaining, _Out_ void **data)");
  const free = x11.func("int XFree(void *data)");
  const activeAtom = atom(display, "_NET_ACTIVE_WINDOW", 0);
  native = {
    activeWindow() {
      const type = [0], format = [0], count = [0], remaining = [0], data = [null];
      const status = property(display, root, activeAtom, 0, 1, 0, 33, type, format, count, remaining, data);
      try {
        return status === 0 && format[0] === 32 && count[0] === 1
          ? Number(koffi.decode(data[0], "uintptr_t")) : 0;
      } finally {
        if (data[0]) free(data[0]);
      }
    },
    selectionOwner(name) {
      return Number(owner(display, atom(display, name, 0)));
    }
  };
  return native;
}
