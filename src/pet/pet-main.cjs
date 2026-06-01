// Pet main process — thin wrapper around BrowserWindow.
// Architecture mirrors OpenPets: window/position/Ipc in main, all UI logic in renderer.

const { app, BrowserWindow, ipcMain, Menu, screen } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

// Singleton state (survive module reloads inside Claude's asar)
const STATE_KEY = Symbol.for("claude-tweak.pet");
if (!globalThis[STATE_KEY]) {
  globalThis[STATE_KEY] = {
    window: null,
    drag: null,
    momentumTimer: null,
    positionSaveTimer: null,
    scaleSaveTimer: null,
    ipcRegistered: false,
    scale: "medium",
    motion: { lastX: 0, lastSent: "idle", idleTimer: null, handler: null },
  };
}
const state = globalThis[STATE_KEY];

// === Sprite geometry ===
const SPRITE_WIDTH = 192;
const SPRITE_HEIGHT = 208;
const PET_BOTTOM = 22;
const BUBBLE_GAP = 8;
const BUBBLE_AREA = 80; // estimated vertical space for bubble + tail + padding
const SIDE_MARGIN = 14;

// === Pet scale presets ===
const SCALE_PRESETS = [
  { id: "small",  scale: 0.56, label: "Small"  },
  { id: "medium", scale: 0.72, label: "Medium" },
  { id: "large",  scale: 1.00, label: "Large"  },
];
const SCALE_BY_ID = Object.fromEntries(SCALE_PRESETS.map((p) => [p.id, p]));
const DEFAULT_SCALE_ID = "medium";

function currentScaleMeta() {
  return SCALE_BY_ID[state.scale] || SCALE_BY_ID[DEFAULT_SCALE_ID];
}

function windowSizeForScale(scaleId) {
  const preset = SCALE_BY_ID[scaleId] || SCALE_BY_ID[DEFAULT_SCALE_ID];
  const shellW = Math.round(SPRITE_WIDTH * preset.scale);
  const shellH = Math.round(SPRITE_HEIGHT * preset.scale);
  const width = Math.max(220, shellW + 2 * SIDE_MARGIN);
  const height = PET_BOTTOM + shellH + BUBBLE_GAP + BUBBLE_AREA;
  return { width, height, shellW, shellH };
}

// === Screen / position ===
const SCREEN_MARGIN = 24;
const POSITION_DEBOUNCE_MS = 150;

// === Motion detection (main process) ===
const MOTION_PIXEL_THRESHOLD = 3;
const MOTION_IDLE_TIMEOUT_MS = 180;

// === Throw momentum ===
const MOMENTUM_DECAY = 0.96;
const MOMENTUM_TICK_MS = 16;
const MOMENTUM_TERMINAL = 35;

// === Paths ===
const PET_DIR = path.join(process.resourcesPath, "claude-pet");
const HTML_PATH = path.join(PET_DIR, "pet.html");
const STATE_FILE = path.join(app.getPath("userData"), "claude-pet-state.json");

// === Display helpers ===
function clampToDisplay(x, y, width, height) {
  const displays = screen.getAllDisplays();
  const display = displays.find((d) => {
    const b = d.bounds;
    return x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height;
  }) || screen.getDisplayNearestPoint({ x, y });
  const b = display.bounds;
  return {
    x: Math.round(Math.max(b.x, Math.min(b.x + b.width - width, x))),
    y: Math.round(Math.max(b.y, Math.min(b.y + b.height - height, y))),
  };
}

function defaultPosition(size) {
  const w = size?.width || windowSizeForScale(state.scale).width;
  const h = size?.height || windowSizeForScale(state.scale).height;
  const b = screen.getPrimaryDisplay().bounds;
  return {
    x: Math.round(b.x + b.width - w - SCREEN_MARGIN),
    y: Math.round(b.y + b.height - h - SCREEN_MARGIN),
  };
}

function loadSavedState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (data?.scale && SCALE_BY_ID[data.scale]) state.scale = data.scale;
    if (Number.isFinite(data?.x) && Number.isFinite(data?.y)) {
      return { x: Math.round(data.x), y: Math.round(data.y) };
    }
  } catch {}
  return null;
}

function persistState() {
  if (state.positionSaveTimer) clearTimeout(state.positionSaveTimer);
  state.positionSaveTimer = setTimeout(() => {
    state.positionSaveTimer = null;
    if (!state.window || state.window.isDestroyed()) return;
    const { x, y } = state.window.getBounds();
    try {
      const existing = (() => {
        try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return {}; }
      })();
      fs.writeFileSync(STATE_FILE, JSON.stringify({ ...existing, x, y, scale: state.scale }));
    } catch {}
  }, POSITION_DEBOUNCE_MS);
}

// === Momentum (throw physics) ===
function startMomentum(velocityX, velocityY) {
  stopMomentum();
  let vx = velocityX;
  let vy = velocityY;
  const tick = () => {
    if (!state.window || state.window.isDestroyed()) {
      stopMomentum();
      return;
    }
    const b = state.window.getBounds();
    const next = clampToDisplay(
      b.x + vx * (MOMENTUM_TICK_MS / 1000),
      b.y + vy * (MOMENTUM_TICK_MS / 1000),
      b.width,
      b.height,
    );
    state.window.setBounds(next, false);
    vx *= MOMENTUM_DECAY;
    vy *= MOMENTUM_DECAY;
    if (Math.hypot(vx, vy) < MOMENTUM_TERMINAL) {
      stopMomentum();
      persistState();
      return;
    }
    state.momentumTimer = setTimeout(tick, MOMENTUM_TICK_MS);
    if (state.momentumTimer.unref) state.momentumTimer.unref();
  };
  state.momentumTimer = setTimeout(tick, MOMENTUM_TICK_MS);
  if (state.momentumTimer.unref) state.momentumTimer.unref();
}

function stopMomentum() {
  if (state.momentumTimer) {
    clearTimeout(state.momentumTimer);
    state.momentumTimer = null;
  }
}

// === Motion publisher (detects window dragging, sends to renderer) ===
function installMotionPublisher(win) {
  const m = state.motion;
  if (m.handler) {
    try { win.off("move", m.handler); } catch {}
  }
  m.lastX = 0;
  m.lastSent = "idle";
  if (m.idleTimer) {
    clearTimeout(m.idleTimer);
    m.idleTimer = null;
  }

  const send = (motion) => {
    if (m.lastSent === motion || win.isDestroyed()) return;
    m.lastSent = motion;
    try { win.webContents.send("pet:motion-state", motion); } catch {}
  };
  const scheduleIdle = () => {
    if (m.idleTimer) clearTimeout(m.idleTimer);
    m.idleTimer = setTimeout(() => {
      m.idleTimer = null;
      send("idle");
    }, MOTION_IDLE_TIMEOUT_MS);
  };

  m.handler = () => {
    if (win.isDestroyed()) return;
    let x;
    try { [x] = win.getPosition(); } catch { return; }
    if (m.lastX === 0) { m.lastX = x; return; }
    const deltaX = x - m.lastX;
    m.lastX = x;
    if (Math.abs(deltaX) >= MOTION_PIXEL_THRESHOLD) {
      send(deltaX > 0 ? "run-right" : "run-left");
    }
    scheduleIdle();
  };
  win.on("move", m.handler);
}

function uninstallMotionPublisher(win) {
  const m = state.motion;
  if (m.handler) {
    try { win.off("move", m.handler); } catch {}
  }
  if (m.idleTimer) {
    clearTimeout(m.idleTimer);
    m.idleTimer = null;
  }
  m.handler = null;
}

// === Click-through + keyboard focus ===
function applyPointerInteractivity(win, interactive) {
  if (!win || win.isDestroyed()) return;
  win.setIgnoreMouseEvents(!interactive, { forward: true });
}

function applyKeyboardInteractivity(win, interactive) {
  if (!win || win.isDestroyed()) return;
  if (interactive) {
    win.setFocusable(true);
    win.focus();
  } else {
    win.setFocusable(false);
  }
}

// === IPC: drag, throw, click-through, keyboard, open-state ===
function isFromPet(event) {
  return state.window && !state.window.isDestroyed() && event.sender === state.window.webContents;
}

function isPoint(p) {
  return p && Number.isFinite(p.screenX) && Number.isFinite(p.screenY);
}

function isVelocity(v) {
  return v && Number.isFinite(v.velocityX) && Number.isFinite(v.velocityY);
}

function registerIpc() {
  if (state.ipcRegistered) return;
  state.ipcRegistered = true;

  ipcMain.on("pet:drag-start", (event, point) => {
    if (!isFromPet(event) || !isPoint(point)) return;
    const win = state.window;
    if (!win || win.isDestroyed()) return;
    const [startX, startY] = win.getPosition();
    state.drag = { startX, startY, startScreenX: point.screenX, startScreenY: point.screenY };
    applyPointerInteractivity(win, true);
  });

  ipcMain.on("pet:drag-move", (event, point) => {
    if (!isFromPet(event) || !isPoint(point) || !state.drag) return;
    const win = state.window;
    if (!win || win.isDestroyed()) return;
    const a = state.drag;
    const b = win.getBounds();
    const next = clampToDisplay(
      a.startX + (point.screenX - a.startScreenX),
      a.startY + (point.screenY - a.startScreenY),
      b.width,
      b.height,
    );
    win.setBounds(next, false);
  });

  ipcMain.on("pet:drag-end", (event) => {
    if (!isFromPet(event)) return;
    state.drag = null;
    applyPointerInteractivity(state.window, false);
  });

  ipcMain.on("pet:drag-release", (event, velocity) => {
    if (!isFromPet(event) || !isVelocity(velocity)) return;
    if (Math.abs(velocity.velocityX) < 1 && Math.abs(velocity.velocityY) < 1) {
      persistState();
      return;
    }
    startMomentum(velocity.velocityX, velocity.velocityY);
  });

  ipcMain.on("pet:pointer-interactive", (event, interactive) => {
    if (!isFromPet(event)) return;
    applyPointerInteractivity(state.window, Boolean(interactive));
  });

  ipcMain.on("pet:keyboard-interactive", (event, interactive) => {
    if (!isFromPet(event)) return;
    applyKeyboardInteractivity(state.window, Boolean(interactive));
  });

  ipcMain.on("pet:open-state-request", (event) => {
    if (!isFromPet(event)) return;
    event.sender.send("pet:open-state", !state.window?.isDestroyed() && state.window?.isVisible());
  });

  ipcMain.on("pet:resize", (event, payload) => {
    if (!isFromPet(event) || !payload) return;
    const w = Math.round(Number(payload.width));
    const h = Math.round(Number(payload.height));
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 100 || h < 100) return;
    const win = state.window;
    if (!win || win.isDestroyed()) return;
    // Anchor resize to bottom-right corner so the pet stays visually anchored
    const b = win.getBounds();
    const newX = Math.round(b.x + b.width - w);
    const newY = Math.round(b.y + b.height - h);
    const clamped = clampToDisplay(newX, newY, w, h);
    win.setBounds(clamped, false);
    persistState();
  });
}

// === Context menu (size + hide) ===
function installContextMenu(win) {
  win.webContents.on("context-menu", (event) => {
    event.preventDefault();
    if (win.isDestroyed()) return;
    const current = state.scale;
    const template = [
      {
        label: "Size",
        submenu: SCALE_PRESETS.map((preset) => ({
          label: preset.label,
          type: "radio",
          checked: current === preset.id,
          click: () => setScale(preset.id),
        })),
      },
      { type: "separator" },
      {
        label: "Reset position",
        click: () => {
          if (win.isDestroyed()) return;
          const size = windowSizeForScale(state.scale);
          const pos = defaultPosition(size);
          const clamped = clampToDisplay(pos.x, pos.y, size.width, size.height);
          win.setBounds(clamped, false);
          persistState();
        },
      },
      { type: "separator" },
      { label: "Hide pet", click: () => win.hide() },
    ];
    Menu.buildFromTemplate(template).popup({ window: win });
  });
}

function setScale(scaleId) {
  if (!SCALE_BY_ID[scaleId]) return;
  state.scale = scaleId;
  persistState();
  if (state.window && !state.window.isDestroyed()) {
    state.window.webContents.send("pet:scale", scaleId);
  }
}

// === Chat observer (injects into Claude webContents, forwards to pet window) ===
// Mirrors OpenPets' pattern: monitor fetch responses, parse SSE, send events to pet.
function installChatObserver(win) {
  const observed = new Set();
  const allWebContents = () => require("electron").webContents.getAllWebContents();

  const observe = (contents) => {
    if (!contents || contents.isDestroyed() || observed.has(contents.id)) return;
    if (contents === win.webContents) return;
    const url = contents.getURL();
    if (!/^https:\/\/claude\.ai\b|^https:\/\/[^/]*\.anthropic\.com\b|^app:\/\/localhost\b/.test(url || "")) return;
    observed.add(contents.id);
    contents.on("destroyed", () => observed.delete(contents.id));
    contents.on("console-message", (_e, _lvl, message) => handleClaudeMessage(message));
    contents.on("did-finish-load", () => injectObserver(contents));
    contents.on("did-navigate", () => injectObserver(contents));
    contents.on("did-navigate-in-page", () => injectObserver(contents));
    injectObserver(contents);
  };

  const injectObserver = (contents) => {
    if (contents.isDestroyed()) return;
    contents.executeJavaScript(`(${observerSource.toString()})()`, true).catch(() => {});
  };

  const handleClaudeMessage = (message) => {
    if (typeof message !== "string") return;
    const marker = "CLAUDE_TWEAK_PET:";
    const idx = message.indexOf(marker);
    if (idx < 0) return;
    try {
      const payload = JSON.parse(message.slice(idx + marker.length));
      if (state.window && !state.window.isDestroyed()) {
        state.window.webContents.send("pet:chat-event", payload);
      }
    } catch {}
  };

  for (const c of allWebContents()) observe(c);
  win.on("web-contents-created", (_e, c) => setTimeout(() => observe(c), 500));
  setInterval(() => { for (const c of allWebContents()) observe(c); }, 3000).unref();
}

function observerSource() {
  if (window.__claudeTweakPetObserverInstalled) return;
  window.__claudeTweakPetObserverInstalled = true;
  const marker = "CLAUDE_TWEAK_PET:";
  let expectingUntil = 0;
  let running = false;
  let lastBody = "";
  let doneTimer = null;
  const lastEmit = Object.create(null);

  const emit = (type, data = {}) => {
    const now = Date.now();
    if (lastEmit[type] && now - lastEmit[type] < 900 && data.body === lastBody) return;
    lastEmit[type] = now;
    if (data.body) lastBody = data.body;
    console.log(marker + JSON.stringify(Object.assign({}, data, { type, at: now })));
  };

  const clean = (text) => String(text || "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/^[\s>*-]*[-*+]\s+/gm, "")
    .replace(/[~>#]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 260);

  const isNoisy = (text) => /^(copy|edit|retry|share|thumbs up|thumbs down|thinking|ready|stop|continue)$/i.test(text || "");

  const scheduleDone = () => {
    if (doneTimer) window.clearTimeout(doneTimer);
    doneTimer = window.setTimeout(() => {
      if (!running) return;
      running = false;
      expectingUntil = 0;
      const body = clean(lastBody);
      emit("chat:assistant-done", body ? { title: "Claude", body } : { title: "Claude", body: "Ready" });
    }, 2500);
  };

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function" && !originalFetch.__wrapped) {
    const wrapped = function (input, init) {
      const req = {
        method: String((init && init.method) || (input && input.method) || "GET").toUpperCase(),
        url: String((input && input.url) || input || ""),
        body: (() => {
          const b = init && "body" in init ? init.body : input && input.body;
          if (typeof b === "string") return b;
          if (b instanceof URLSearchParams) return b.toString();
          try { return JSON.stringify(b); } catch { return ""; }
        })(),
      };
      if (req.method !== "GET" && /completion|conversation|message|chat|content_block|model|prompt/.test(`${req.url} ${req.body}`.toLowerCase()) && !/telemetry|analytics|sentry|statsig|log|metric/.test(`${req.url} ${req.body}`.toLowerCase())) {
        expectingUntil = Date.now() + 90000;
        running = false;
        lastBody = "";
        emit("chat:user-message", { title: "Claude", body: "Waiting for Claude" });
        window.setTimeout(() => {
          if (Date.now() < expectingUntil && !running) {
            running = true;
            emit("chat:assistant-start", { title: "Claude", body: "Thinking" });
            scheduleDone();
          }
        }, 700);
      }
      return originalFetch.apply(this, arguments).then((response) => {
        if (!response || !response.ok || !response.body) return response;
        const ct = String(response.headers.get("content-type") || "");
        if (!/text\/event-stream|application\/x-ndjson|stream|completion|conversation|message|chat/.test(`${req.url} ${ct}`.toLowerCase())) return response;
        if (/telemetry|analytics|sentry|statsig|log|metric/.test(`${req.url} ${ct}`.toLowerCase())) return response;
        try {
          const clone = response.clone();
          if (clone.body && clone.body.getReader) {
            const reader = clone.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            const pump = () => reader.read().then(({ done, value }) => {
              if (value) {
                buffer += decoder.decode(value, { stream: !done });
                let split;
                while ((split = buffer.search(/\r?\n\r?\n/)) >= 0) {
                  const block = buffer.slice(0, split);
                  buffer = buffer.slice(split + (buffer[split] === "\r" ? 4 : 2));
                  const data = block.split(/\r?\n/).filter((l) => /^data\s*:/i.test(l)).map((l) => l.replace(/^data\s*:\s?/i, "")).join("\n").trim();
                  const text = (data || block).trim();
                  if (!text || text === "[DONE]") continue;
                  try {
                    const event = JSON.parse(text.slice(text.indexOf("{")));
                    for (const t of collectText(event)) {
                      const c = clean(t);
                      if (!c || isNoisy(c)) continue;
                      if (!running) { running = true; emit("chat:assistant-start", { title: "Claude", body: "Thinking" }); }
                      lastBody = `${lastBody}${t}`;
                      emit("chat:assistant-update", { title: "Claude", body: c });
                      scheduleDone();
                    }
                  } catch {}
                }
              }
              if (done) return;
              return pump();
            }).catch(() => {});
            pump();
          }
        } catch {}
        return response;
      });
    };
    wrapped.__wrapped = true;
    window.fetch = wrapped;
  }

  function* collectText(value) {
    if (!value || typeof value !== "object") return;
    if (value.type === "content_block_delta" && value.delta && typeof value.delta.text === "string") {
      yield value.delta.text;
      return;
    }
    if (value.type === "text_delta" && typeof value.text === "string") {
      yield value.text;
      return;
    }
    for (const v of Object.values(value)) {
      yield* collectText(v);
    }
  }
}

// === Window lifecycle ===
async function createWindow() {
  if (state.window && !state.window.isDestroyed()) return state.window;

  const size = windowSizeForScale(state.scale);
  const saved = loadSavedState();
  const initial = saved
    ? clampToDisplay(saved.x, saved.y, size.width, size.height)
    : defaultPosition(size);

  const win = new BrowserWindow({
    width: size.width,
    height: size.height,
    x: initial.x,
    y: initial.y,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
    },
  });

  win.setMenuBarVisibility(false);
  win.setAlwaysOnTop(true, "floating");
  win.setIgnoreMouseEvents(true, { forward: true });
  if (process.platform === "darwin") {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  } else {
    win.setVisibleOnAllWorkspaces(true);
  }

  installMotionPublisher(win);
  installChatObserver(win);
  installContextMenu(win);

  win.once("ready-to-show", () => {
    if (!win.isDestroyed()) win.showInactive();
  });
  win.webContents.once("did-finish-load", () => {
    if (!win.isDestroyed()) {
      try { win.webContents.send("pet:scale", state.scale); } catch {}
    }
  });
  win.on("moved", () => persistState());
  win.on("closed", () => {
    stopMomentum();
    if (state.positionSaveTimer) {
      clearTimeout(state.positionSaveTimer);
      state.positionSaveTimer = null;
    }
    uninstallMotionPublisher(win);
    if (state.window === win) {
      state.window = null;
      state.drag = null;
    }
  });

  state.window = win;
  await win.loadFile(HTML_PATH);
  return win;
}

registerIpc();

app.whenReady().then(() => {
  createWindow().catch(() => {});
});

app.on("activate", () => {
  if (!state.window || state.window.isDestroyed()) {
    createWindow().catch(() => {});
  }
});
