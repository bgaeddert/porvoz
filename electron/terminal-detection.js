// Match application identities, never titles or substrings ("st", for example,
// must not match an ordinary editor). Embedded terminal panes share their
// editor's identity and cannot be distinguished by this policy.
const TERMINAL_IDENTITIES = new Set([
  "consolewindowclass", "pseudoconsolewindow", "cascadia_hosting_window_class", "windowsTerminal",
  "windowsterminalpreview", "conhost", "openconsole", "mintty",
  "virtualconsoleclass", "conemu", "conemu64", "conemu-cyg-64",
  "putty", "kitty", "alacritty", "wezterm", "wezterm-gui", "org.wezfurlong.wezterm",
  "hyper", "tmobaxterm", "mobaxterm", "termius", "tabby", "wave", "waveterm",
  "rio", "ghostty", "com.mitchellh.ghostty", "warp", "warp-terminal", "dev.warp.warp",
  "konsole", "org.kde.konsole", "yakuake", "org.kde.yakuake",
  "gnome-terminal", "gnome-terminal-server", "org.gnome.terminal",
  "kgx", "org.gnome.console", "ptyxis", "org.gnome.ptyxis",
  "xfce4-terminal", "xfce4-terminal-dropdown", "mate-terminal", "lxterminal",
  "qterminal", "terminator", "terminology", "tilix", "com.gexperts.tilix",
  "xterm", "uxterm", "urxvt", "urxvtc", "urxvtd", "rxvt", "st", "st-256color",
  "foot", "footclient", "guake", "tilda", "sakura", "cool-retro-term",
  "cosmic-term", "com.system76.cosmicterm", "io.elementary.terminal", "pantheon-terminal"
].map(value => value.toLowerCase()));

export function isTerminalWindow({ windowClasses = [], executable = "" } = {}) {
  return [...windowClasses, executable].some(value => {
    if (typeof value !== "string") return false;
    const identity = value.trim().replaceAll("\\", "/").split("/").pop().toLowerCase()
      .replace(/\.exe$/, "");
    return TERMINAL_IDENTITIES.has(identity);
  });
}
