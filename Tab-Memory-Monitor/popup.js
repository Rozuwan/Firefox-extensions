/**
 * popup.js — Tab Memory Monitor
 * Handles: memory graph, metrics, tab list, sleep button, settings
 */

"use strict";

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_SAMPLES   = 30;   // 30 samples × 2s = 60s history
const UPDATE_MS     = 2000; // refresh every 2 seconds
const ACCENT        = "#1D9E75";
const ACCENT_DIM    = "#155c44";
const GRID_COLOR    = "#1e2330";
const BG_COLOR      = "#0f1117";
const TAB_LIMIT     = 6;    // how many recent tabs to show

// ─── State ────────────────────────────────────────────────────────────────────
let tabCountSamples = new Array(MAX_SAMPLES).fill(null);
let peakTabCount    = 0;
let updateTimer     = null;

// ─── DOM References ───────────────────────────────────────────────────────────
const metricCurrent   = document.getElementById("metricCurrent");
const metricPeak      = document.getElementById("metricPeak");
const metricSleeping = document.getElementById("metricSleeping");
const graphScale      = document.getElementById("graphScale");
const canvas          = document.getElementById("memoryGraph");
const ctx             = canvas.getContext("2d");
const tabList         = document.getElementById("tabList");
const tabCountBadge   = document.getElementById("tabCountBadge");
const btnSleep        = document.getElementById("btnSleep");
const autoSleepToggle = document.getElementById("autoSleepToggle");
const sleepTimer      = document.getElementById("sleepTimer");
const timerValue      = document.getElementById("timerValue");
const sliderRow       = document.getElementById("sliderRow");

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Get current tab count — works in Firefox.
 * Returns { total, active, sleeping } counts.
 */
async function getTabCounts() {
  try {
    const tabs = await browser.tabs.query({});
    const total = tabs.length;
    const active = tabs.filter(t => t.active).length;
    const sleeping = tabs.filter(t => t.discarded).length;
    return { total, active, sleeping };
  } catch (e) {
    return { total: 0, active: 0, sleeping: 0 };
  }
}

function truncate(str, max) {
  if (!str) return "New Tab";
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

// ─── Graph ────────────────────────────────────────────────────────────────────

function drawGraph() {
  const W = canvas.width;
  const H = canvas.height;

  // Clear
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, W, H);

  // Grid lines (horizontal)
  const gridLines = 3;
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  for (let i = 0; i <= gridLines; i++) {
    const y = Math.round(H * (i / gridLines)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  // Filter valid samples
  const validSamples = tabCountSamples.filter(v => v !== null);
  if (validSamples.length === 0) {
    ctx.fillStyle = "#3a4258";
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Gathering data…", W / 2, H / 2 + 4);
    return;
  }

  // Scale
  const maxVal = Math.max(...validSamples, 5);
  const minVal = 0;
  const range  = maxVal - minVal || 1;

  // Update scale label
  graphScale.textContent = maxVal + " tabs";

  // Map value → canvas Y (inverted: 0 = bottom)
  function toY(val) {
    return H - ((val - minVal) / range) * (H - 8) - 4;
  }

  // Map sample index → canvas X
  function toX(i) {
    return (i / (MAX_SAMPLES - 1)) * W;
  }

  // Draw fill under the line
  ctx.beginPath();
  let started = false;

  for (let i = 0; i < MAX_SAMPLES; i++) {
    const v = tabCountSamples[i];
    if (v === null) continue;
    const x = toX(i);
    const y = toY(v);
    if (!started) {
      ctx.moveTo(x, H);
      ctx.lineTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
  if (started) {
    ctx.lineTo(toX(MAX_SAMPLES - 1), H);
    ctx.closePath();
    ctx.fillStyle = ACCENT_DIM + "44";
    ctx.fill();
  }

  // Draw line
  ctx.beginPath();
  started = false;
  for (let i = 0; i < MAX_SAMPLES; i++) {
    const v = tabCountSamples[i];
    if (v === null) continue;
    const x = toX(i);
    const y = toY(v);
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.lineCap  = "round";
  ctx.stroke();

  // Draw dot at latest data point
  const lastIdx = tabCountSamples.reduceRight((found, v, i) => {
    return found === -1 && v !== null ? i : found;
  }, -1);

  if (lastIdx !== -1) {
    const dotX = toX(lastIdx);
    const dotY = toY(tabCountSamples[lastIdx]);
    ctx.beginPath();
    ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
    ctx.fillStyle = ACCENT;
    ctx.fill();
  }
}

// ─── Tab List ─────────────────────────────────────────────────────────────────

async function renderTabList() {
  let tabs;
  try {
    tabs = await browser.tabs.query({});
  } catch (e) {
    tabList.innerHTML = '<li class="tab-item tab-placeholder">Could not load tabs.</li>';
    return;
  }

  // Update tab count badge
  tabCountBadge.textContent = tabs.length + " tabs";

  // Sort: active tab first, then by lastAccessed desc
  tabs.sort((a, b) => {
    if (a.active && !b.active) return -1;
    if (!a.active && b.active) return 1;
    return (b.lastAccessed || 0) - (a.lastAccessed || 0);
  });

  const recent = tabs.slice(0, TAB_LIMIT);

  tabList.innerHTML = "";

  for (const tab of recent) {
    const li = document.createElement("li");
    li.className = "tab-item";
    li.setAttribute("role", "listitem");

    // Make clickable to activate tab
    li.addEventListener("click", () => {
      browser.tabs.update(tab.id, { active: true });
      window.close();
    });

    // Favicon
    let faviconEl;
    if (tab.favIconUrl && !tab.favIconUrl.startsWith("chrome://")) {
      faviconEl = document.createElement("img");
      faviconEl.className = "tab-favicon";
      faviconEl.src = tab.favIconUrl;
      faviconEl.alt = "";
      faviconEl.onerror = () => {
        faviconEl.replaceWith(makeFallbackFavicon());
      };
    } else {
      faviconEl = makeFallbackFavicon();
    }

    // Info container
    const infoEl = document.createElement("div");
    infoEl.className = "tab-info";

    // Name
    const nameEl = document.createElement("span");
    nameEl.className = "tab-name";
    nameEl.textContent = truncate(tab.title, 35);
    nameEl.title = tab.title || "";

    // URL
    const urlEl = document.createElement("span");
    urlEl.className = "tab-url";
    try {
      const url = new URL(tab.url);
      urlEl.textContent = url.hostname;
    } catch {
      urlEl.textContent = tab.url || "";
    }

    infoEl.appendChild(nameEl);
    infoEl.appendChild(urlEl);

    // Badge
    const badgeEl = document.createElement("span");
    const isDiscarded = tab.discarded;
    const isActive    = tab.active;
    if (isActive) {
      badgeEl.className = "tab-badge active";
      badgeEl.textContent = "active";
    } else if (isDiscarded) {
      badgeEl.className = "tab-badge sleeping";
      badgeEl.textContent = "sleeping";
    } else {
      badgeEl.className = "tab-badge idle";
      badgeEl.textContent = "idle";
    }

    li.appendChild(faviconEl);
    li.appendChild(infoEl);
    li.appendChild(badgeEl);
    tabList.appendChild(li);
  }
}

function makeFallbackFavicon() {
  const div = document.createElement("div");
  div.className = "tab-favicon-fallback";
  div.innerHTML = `<svg width="8" height="8" viewBox="0 0 8 8" fill="none">
    <rect x="0" y="0" width="8" height="8" rx="1.5" fill="#252b38"/>
    <rect x="2" y="2" width="4" height="4" rx="0.5" fill="#3a4258"/>
  </svg>`;
  return div;
}

// ─── Update Loop ──────────────────────────────────────────────────────────────

async function update() {
  // Tab counts
  const counts = await getTabCounts();
  tabCountSamples.shift();
  tabCountSamples.push(counts.total);

  if (counts.total > peakTabCount) peakTabCount = counts.total;

  metricCurrent.textContent = counts.total;
  metricPeak.textContent    = peakTabCount;
  metricSleeping.textContent = counts.sleeping;

  drawGraph();
  await renderTabList();
}

// ─── Sleep Tabs ───────────────────────────────────────────────────────────────

async function sleepInactiveTabs() {
  btnSleep.disabled = true;
  btnSleep.innerHTML = `<svg width="16" height="16" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M11.5 7.5C11.5 10.2614 9.26142 12.5 6.5 12.5C3.73858 12.5 1.5 10.2614 1.5 7.5C1.5 4.73858 3.73858 2.5 6.5 2.5C7.17 2.5 7.81 2.63 8.4 2.87C7.22 3.63 6.5 4.98 6.5 6.5C6.5 8.71 8.29 10.5 10.5 10.5C10.85 10.5 11.19 10.45 11.5 10.36V7.5Z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg> Sleeping…`;

  try {
    const tabs = await browser.tabs.query({ active: false, discarded: false });
    const promises = tabs.map(tab => {
      return browser.tabs.discard(tab.id).catch(() => {/* some tabs can't be discarded */});
    });
    await Promise.all(promises);

    btnSleep.innerHTML = `<svg width="16" height="16" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M9 2L5 6L9 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg> Slept ${tabs.length} tab${tabs.length !== 1 ? "s" : ""}`;
    btnSleep.classList.add("success");
    await update();

    setTimeout(() => {
      btnSleep.disabled = false;
      btnSleep.innerHTML = `<svg width="16" height="16" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M11.5 7.5C11.5 10.2614 9.26142 12.5 6.5 12.5C3.73858 12.5 1.5 10.2614 1.5 7.5C1.5 4.73858 3.73858 2.5 6.5 2.5C7.17 2.5 7.81 2.63 8.4 2.87C7.22 3.63 6.5 4.98 6.5 6.5C6.5 8.71 8.29 10.5 10.5 10.5C10.85 10.5 11.19 10.45 11.5 10.36V7.5Z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg> Sleep Inactive Tabs`;
      btnSleep.classList.remove("success");
    }, 2500);
  } catch (e) {
    btnSleep.disabled = false;
    btnSleep.innerHTML = `<svg width="16" height="16" viewBox="0 0 14 14" fill="none">
      <path d="M11.5 7.5C11.5 10.2614 9.26142 12.5 6.5 12.5C3.73858 12.5 1.5 10.2614 1.5 7.5C1.5 4.73858 3.73858 2.5 6.5 2.5C7.17 2.5 7.81 2.63 8.4 2.87C7.22 3.63 6.5 4.98 6.5 6.5C6.5 8.71 8.29 10.5 10.5 10.5C10.85 10.5 11.19 10.45 11.5 10.36V7.5Z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg> Error — try again`;
    setTimeout(() => {
      btnSleep.innerHTML = `<svg width="16" height="16" viewBox="0 0 14 14" fill="none">
      <path d="M11.5 7.5C11.5 10.2614 9.26142 12.5 6.5 12.5C3.73858 12.5 1.5 10.2614 1.5 7.5C1.5 4.73858 3.73858 2.5 6.5 2.5C7.17 2.5 7.81 2.63 8.4 2.87C7.22 3.63 6.5 4.98 6.5 6.5C6.5 8.71 8.29 10.5 10.5 10.5C10.85 10.5 11.19 10.45 11.5 10.36V7.5Z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg> Sleep Inactive Tabs`;
    }, 2000);
  }
}

// ─── Settings: Load & Save ────────────────────────────────────────────────────

async function loadSettings() {
  try {
    const data = await browser.storage.sync.get({
      autoSleep: false,
      sleepMinutes: 15,
    });
    autoSleepToggle.checked = data.autoSleep;
    sleepTimer.value        = data.sleepMinutes;
    timerValue.textContent  = data.sleepMinutes;
    sliderRow.classList.toggle("hidden", !data.autoSleep);
  } catch (e) {
    console.warn("Tab Memory Monitor: could not load settings", e);
  }
}

async function saveSettings() {
  const autoSleep    = autoSleepToggle.checked;
  const sleepMinutes = parseInt(sleepTimer.value, 10);

  try {
    await browser.storage.sync.set({ autoSleep, sleepMinutes });
    // Notify background script
    await browser.runtime.sendMessage({
      type: "settings-updated",
      autoSleep,
      sleepMinutes,
    }).catch(() => {/* background may not be ready */});
  } catch (e) {
    console.warn("Tab Memory Monitor: could not save settings", e);
  }
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

btnSleep.addEventListener("click", sleepInactiveTabs);

autoSleepToggle.addEventListener("change", () => {
  sliderRow.classList.toggle("hidden", !autoSleepToggle.checked);
  saveSettings();
});

sleepTimer.addEventListener("input", () => {
  timerValue.textContent = sleepTimer.value;
});

sleepTimer.addEventListener("change", () => {
  saveSettings();
});

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  await loadSettings();
  await update();
  updateTimer = setInterval(update, UPDATE_MS);
}

// Cleanup when popup is closed
window.addEventListener("unload", () => {
  if (updateTimer) clearInterval(updateTimer);
});

init();
