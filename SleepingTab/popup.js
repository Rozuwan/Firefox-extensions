/**
 * popup.js — SleepingTab v3 (Production Ready)
 * Handles: tab-count graph, metrics, tab list, sleep button, settings, whitelist.
 *
 * Architecture:
 *   - Completely EVENT-DRIVEN (no setInterval polling).
 *   - Syncs statistics and history via storage.session directly (0ms load latency).
 *   - Manual sleep button respects ignoring rules and whitelisted domains.
 *   - All interface updates are consolidated into a debounced event loop.
 */

"use strict";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_SAMPLES  = 30;    // 30 samples of history
const TAB_LIMIT    = 6;     // max tabs shown in list
const ACCENT       = "#00d4ff";
const ACCENT_DIM   = "#005f73";
const GRID_COLOR   = "#1a1d2a";
const BG_COLOR     = "#0a0b0f";
const SAFE_PROTOCOLS = ["http:", "https:"];

// ─── State ────────────────────────────────────────────────────────────────────

let samples        = new Array(MAX_SAMPLES).fill(null);
let saveDebounce   = null;
let renderDebounce = null;
let lastSampleHash = "";

// ─── DOM References ───────────────────────────────────────────────────────────

const metricCurrent   = document.getElementById("metricCurrent");
const metricSleeping  = document.getElementById("metricSleeping");
const metricIdle      = document.getElementById("metricIdle");
const metricSaved     = document.getElementById("metricSaved");
const graphScale      = document.getElementById("graphScale");
const canvas          = document.getElementById("tabGraph");
const ctx             = canvas.getContext("2d");
const tabList         = document.getElementById("tabList");
const tabCountBadge   = document.getElementById("tabCountBadge");
const btnSleep        = document.getElementById("btnSleep");
const btnSleepLabel   = document.getElementById("btnSleepLabel");
const autoSleepToggle = document.getElementById("autoSleepToggle");
const autoSleepDesc   = document.getElementById("autoSleepDesc");
const sliderGroup     = document.getElementById("sliderGroup");
const ignoreRules     = document.getElementById("ignoreRules");
const whitelistGroup  = document.getElementById("whitelistGroup");
const whitelistInput  = document.getElementById("whitelistInput");
const sleepTimer      = document.getElementById("sleepTimer");
const timerValue      = document.getElementById("timerValue");
const ignorePinned    = document.getElementById("ignorePinned");
const ignoreAudio     = document.getElementById("ignoreAudio");

// ─── HiDPI Canvas Setup ───────────────────────────────────────────────────────

function initCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width  = Math.round((rect.width  || 296) * dpr);
  canvas.height = Math.round((rect.height || 64)  * dpr);
  ctx.scale(dpr, dpr);
}

// ─── Formatting & Security Helpers ───────────────────────────────────────────

function truncate(str, max) {
  if (!str) return "New Tab";
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

function isSafeFaviconUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    return SAFE_PROTOCOLS.includes(url.protocol);
  } catch {
    return false;
  }
}

function makeFallbackFavicon() {
  const d = document.createElement("div");
  d.className = "tab-favicon-fallback";
  return d;
}

// ─── Graph Drawing ────────────────────────────────────────────────────────────

function drawGraph() {
  const hash = samples.join(",");
  if (hash === lastSampleHash) return; // skip redundant frames
  lastSampleHash = hash;

  const dpr = window.devicePixelRatio || 1;
  const W = canvas.width  / dpr;
  const H = canvas.height / dpr;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, W, H);

  // Horizontal grid lines
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 3; i++) {
    const y = Math.round(H * (i / 3)) + 0.5;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  const valid = samples.filter(v => v !== null);
  if (valid.length === 0) {
    ctx.fillStyle = "#2a3040";
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Gathering data…", W / 2, H / 2 + 4);
    return;
  }

  const maxVal = Math.max(...valid, 4);
  const range  = maxVal || 1;

  graphScale.textContent = maxVal + " tabs";

  const toY = v  => H - (v / range) * (H - 8) - 4;
  const toX = i  => (i / (MAX_SAMPLES - 1)) * W;

  // Filled area
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < MAX_SAMPLES; i++) {
    const v = samples[i];
    if (v === null) continue;
    const x = toX(i), y = toY(v);
    if (!started) { ctx.moveTo(x, H); ctx.lineTo(x, y); started = true; }
    else ctx.lineTo(x, y);
  }
  if (started) {
    ctx.lineTo(toX(MAX_SAMPLES - 1), H);
    ctx.closePath();
    ctx.fillStyle = ACCENT_DIM + "28";
    ctx.fill();
  }

  // Line
  ctx.beginPath();
  started = false;
  for (let i = 0; i < MAX_SAMPLES; i++) {
    const v = samples[i];
    if (v === null) continue;
    const x = toX(i), y = toY(v);
    if (!started) { ctx.moveTo(x, y); started = true; }
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth   = 1.5;
  ctx.lineJoin    = "round";
  ctx.lineCap     = "round";
  ctx.stroke();

  // Dot at latest point
  const lastIdx = samples.reduceRight((f, v, i) => f === -1 && v !== null ? i : f, -1);
  if (lastIdx !== -1) {
    ctx.beginPath();
    ctx.arc(toX(lastIdx), toY(samples[lastIdx]), 3, 0, Math.PI * 2);
    ctx.fillStyle = ACCENT;
    ctx.fill();
  }
}

// ─── Tab List Rendering ───────────────────────────────────────────────────────

async function renderTabList(tabs) {
  const scrollTop = tabList.scrollTop;
  tabCountBadge.textContent = tabs.length;

  tabs.sort((a, b) => {
    if (a.active && !b.active) return -1;
    if (!a.active && b.active) return 1;
    return (b.lastAccessed || 0) - (a.lastAccessed || 0);
  });

  const recent = tabs.slice(0, TAB_LIMIT);
  const frag   = document.createDocumentFragment();

  for (const tab of recent) {
    const li = document.createElement("li");
    li.className = "tab-item";
    li.setAttribute("role", "listitem");
    li.addEventListener("click", () => {
      browser.tabs.update(tab.id, { active: true });
      browser.windows.update(tab.windowId, { focused: true });
      window.close();
    });

    // Favicon (Strict protocol check)
    let favicon;
    if (tab.favIconUrl && isSafeFaviconUrl(tab.favIconUrl)) {
      favicon = document.createElement("img");
      favicon.className = "tab-favicon";
      favicon.src = tab.favIconUrl;
      favicon.alt = "";
      favicon.onerror = () => favicon.replaceWith(makeFallbackFavicon());
    } else {
      favicon = makeFallbackFavicon();
    }

    // Info
    const info = document.createElement("div");
    info.className = "tab-info";

    const name = document.createElement("span");
    name.className = "tab-name";
    name.textContent = truncate(tab.title, 36);
    name.title = tab.title || "";

    const url = document.createElement("span");
    url.className = "tab-url";
    try { url.textContent = new URL(tab.url).hostname; }
    catch { url.textContent = tab.url || ""; }

    info.appendChild(name);
    info.appendChild(url);

    // Badge
    const badge = document.createElement("span");
    if (tab.active) {
      badge.className = "tab-badge active"; badge.textContent = "active";
    } else if (tab.discarded) {
      badge.className = "tab-badge sleeping"; badge.textContent = "sleep";
    } else {
      badge.className = "tab-badge idle"; badge.textContent = "idle";
    }

    li.appendChild(favicon); li.appendChild(info); li.appendChild(badge);
    frag.appendChild(li);
  }

  tabList.innerHTML = "";
  tabList.appendChild(frag);
  tabList.scrollTop = scrollTop;
}

// ─── Update Loop ──────────────────────────────────────────────────────────────

async function updateMetricsAndGraph() {
  let tabs;
  try {
    tabs = await browser.tabs.query({});
  } catch {
    tabs = [];
  }

  const currentCount  = tabs.length;
  const sleepingCount = tabs.filter(t => t.discarded).length;
  const idleCount     = tabs.filter(t => !t.active && !t.discarded).length;

  // Retrieve cached data from background session storage
  const data = await browser.storage.session.get({
    peakTabCount: 0,
    history:      []
  });

  // Calculate estimated RAM saved: 100MB per discarded tab
  const totalSavedMb = sleepingCount * 100;
  if (totalSavedMb >= 1024) {
    metricSaved.textContent = (totalSavedMb / 1024).toFixed(1) + " GB";
  } else {
    metricSaved.textContent = totalSavedMb + " MB";
  }

  // Ensure counts are backed in session storage
  const peak = Math.max(currentCount, data.peakTabCount);
  await browser.storage.session.set({
    currentTabCount: currentCount,
    peakTabCount:    peak
  });

  metricCurrent.textContent  = currentCount;
  metricSleeping.textContent = sleepingCount;
  metricIdle.textContent     = idleCount;

  // Format samples for graph (pad to 30)
  let historySamples = data.history;
  if (historySamples.length === 0) {
    historySamples = new Array(MAX_SAMPLES).fill(currentCount);
  } else {
    while (historySamples.length < MAX_SAMPLES) {
      historySamples.unshift(historySamples[0] !== undefined ? historySamples[0] : currentCount);
    }
    if (historySamples.length > MAX_SAMPLES) {
      historySamples = historySamples.slice(-MAX_SAMPLES);
    }
  }

  samples = historySamples;
  drawGraph();
  await renderTabList(tabs);
}

// ─── Debounced Event Handler ──────────────────────────────────────────────────

function scheduleUpdateUI() {
  if (renderDebounce) clearTimeout(renderDebounce);
  renderDebounce = setTimeout(async () => {
    await updateMetricsAndGraph();
  }, 50);
}

// ─── Sleep Button Action ──────────────────────────────────────────────────────

async function sleepInactiveTabs() {
  btnSleep.disabled = true;
  btnSleepLabel.textContent = "Sleeping…";

  try {
    const data = await browser.storage.sync.get({
      ignorePinned: true,
      ignoreAudio:  true,
      whitelist:    []
    });

    const tabs = await browser.tabs.query({ active: false, discarded: false });
    const toSleep = [];

    for (const tab of tabs) {
      if (data.ignorePinned && tab.pinned)  continue;
      if (data.ignoreAudio  && tab.audible) continue;

      if (data.whitelist && data.whitelist.length > 0) {
        let hostname = "";
        try {
          hostname = new URL(tab.url).hostname.toLowerCase();
        } catch {
          // Ignore invalid URL formatting
        }
        if (hostname) {
          const matches = data.whitelist.some(domain => {
            const clean = domain.trim().toLowerCase();
            if (!clean) return false;
            return hostname === clean || hostname.endsWith("." + clean);
          });
          if (matches) continue;
        }
      }
      toSleep.push(tab);
    }

    if (toSleep.length === 0) {
      btnSleepLabel.textContent = "No tabs to sleep";
      btnSleep.classList.add("success");
      setTimeout(() => {
        btnSleep.disabled = false;
        btnSleepLabel.textContent = "Sleep Inactive Tabs";
        btnSleep.classList.remove("success");
      }, 2000);
      return;
    }

    await Promise.all(toSleep.map(t => browser.tabs.discard(t.id).catch(() => {})));

    btnSleepLabel.textContent = `Slept ${toSleep.length} tab${toSleep.length !== 1 ? "s" : ""}`;
    btnSleep.classList.add("success");
    await updateMetricsAndGraph();

    setTimeout(() => {
      btnSleep.disabled = false;
      btnSleepLabel.textContent = "Sleep Inactive Tabs";
      btnSleep.classList.remove("success");
    }, 2500);
  } catch (e) {
    console.error("SleepingTab: manual sleep failed", e);
    btnSleep.disabled = false;
    btnSleepLabel.textContent = "Sleep Inactive Tabs";
  }
}

// ─── Settings Panel Logic ─────────────────────────────────────────────────────

function updateSettingsUI(autoSleep) {
  sliderGroup.classList.toggle("hidden", !autoSleep);
  ignoreRules.classList.toggle("hidden", !autoSleep);
  whitelistGroup.classList.toggle("hidden", !autoSleep);
  autoSleepDesc.textContent = autoSleep
    ? `Every ${sleepTimer.value}m`
    : "Disabled";
}

async function loadSettings() {
  try {
    const data = await browser.storage.sync.get({
      autoSleep:    false,
      sleepMinutes: 15,
      ignorePinned: true,
      ignoreAudio:  true,
      whitelist:    []
    });
    const validatedMinutes  = Math.max(5, Math.min(60, parseInt(data.sleepMinutes, 10) || 15));
    autoSleepToggle.checked = data.autoSleep;
    sleepTimer.value        = validatedMinutes;
    timerValue.textContent  = validatedMinutes;
    ignorePinned.checked    = data.ignorePinned;
    ignoreAudio.checked     = data.ignoreAudio;
    whitelistInput.value    = data.whitelist.join(", ");
    updateSettingsUI(data.autoSleep);
  } catch (e) {
    console.warn("SleepingTab: could not load settings", e);
  }
}

function saveSettings() {
  clearTimeout(saveDebounce);
  saveDebounce = setTimeout(async () => {
    const whitelist = whitelistInput.value
      .split(",")
      .map(d => d.trim().toLowerCase())
      .filter(d => d.length > 0);

    const settings = {
      autoSleep:    autoSleepToggle.checked,
      sleepMinutes: parseInt(sleepTimer.value, 10),
      ignorePinned: ignorePinned.checked,
      ignoreAudio:  ignoreAudio.checked,
      whitelist:    whitelist
    };
    try {
      await browser.storage.sync.set(settings);
    } catch (e) {
      console.warn("SleepingTab: could not save settings", e);
    }
  }, 300);
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

btnSleep.addEventListener("click", sleepInactiveTabs);

autoSleepToggle.addEventListener("change", () => {
  updateSettingsUI(autoSleepToggle.checked);
  saveSettings();
});

sleepTimer.addEventListener("input", () => {
  timerValue.textContent = sleepTimer.value;
  autoSleepDesc.textContent = `Every ${sleepTimer.value}m`;
});

sleepTimer.addEventListener("change", saveSettings);

ignorePinned.addEventListener("change", saveSettings);
ignoreAudio.addEventListener("change", saveSettings);
whitelistInput.addEventListener("input", saveSettings);

// Keyboard: Esc closes popup
document.addEventListener("keydown", e => {
  if (e.key === "Escape") window.close();
});

// Event-driven updates (completely reactive, no polling)
browser.tabs.onCreated.addListener(scheduleUpdateUI);
browser.tabs.onRemoved.addListener(scheduleUpdateUI);
browser.tabs.onActivated.addListener(scheduleUpdateUI);
browser.tabs.onUpdated.addListener((_id, change) => {
  if ("discarded" in change || "title" in change || "favIconUrl" in change) {
    scheduleUpdateUI();
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  initCanvas();
  await loadSettings();
  await updateMetricsAndGraph();
  
  // Set focus on primary sleep button for keyboard users
  btnSleep.focus();
}

window.addEventListener("unload", () => {
  clearTimeout(saveDebounce);
  clearTimeout(renderDebounce);
});

init().catch(err => {
  console.error("SleepingTab: popup init failed", err);
  document.body.innerHTML = `
    <div style="padding: 20px; color: #ff0055; font-family: monospace; font-size: 11px; text-align: center; background: #0a0b0f; height: 100vh; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 8px;">
      <span style="font-weight: bold; font-size: 13px; color: #dde4f0;">Initialization Error</span>
      <span>Failed to load SleepingTab. Reopen the popup to retry.</span>
    </div>`;
});
