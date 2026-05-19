/**
 * background.js — Tab Memory Monitor
 * Handles: auto-sleep timer via browser.alarms API
 * Uses ES module syntax (manifest "type": "module")
 */

// ─── Constants ────────────────────────────────────────────────────────────────
const ALARM_NAME        = "tab-memory-monitor-autosleep";
const CHECK_INTERVAL_M  = 1; // check every 1 minute

// ─── State ────────────────────────────────────────────────────────────────────
let settings = {
  autoSleep:    false,
  sleepMinutes: 15,
};

// ─── Alarm Handler ────────────────────────────────────────────────────────────

/**
 * Called every CHECK_INTERVAL_M minutes when auto-sleep is enabled.
 * Discards tabs that have not been accessed for longer than sleepMinutes.
 */
async function runAutoSleep() {
  if (!settings.autoSleep) return;

  const thresholdMs  = settings.sleepMinutes * 60 * 1000;
  const nowMs        = Date.now();

  let tabs;
  try {
    tabs = await browser.tabs.query({ active: false, discarded: false });
  } catch (e) {
    console.error("Tab Memory Monitor [bg]: tabs.query failed", e);
    return;
  }

  for (const tab of tabs) {
    const lastAccessed = tab.lastAccessed || 0;
    const idleMs       = nowMs - lastAccessed;

    if (idleMs >= thresholdMs) {
      try {
        await browser.tabs.discard(tab.id);
      } catch (e) {
        // Some tabs (pinned, audible, etc.) cannot be discarded — ignore
      }
    }
  }
}

// ─── Alarm Registration ───────────────────────────────────────────────────────

async function applySettings(newSettings) {
  settings = { ...settings, ...newSettings };

  // Clear existing alarm
  try {
    await browser.alarms.clear(ALARM_NAME);
  } catch (e) {
    console.warn("Tab Memory Monitor [bg]: could not clear alarm", e);
  }

  if (settings.autoSleep) {
    // Create a repeating alarm
    browser.alarms.create(ALARM_NAME, {
      periodInMinutes: CHECK_INTERVAL_M,
    });
    console.log(
      `Tab Memory Monitor [bg]: auto-sleep enabled — checking every ${CHECK_INTERVAL_M}m, ` +
      `sleeping tabs idle > ${settings.sleepMinutes}m`
    );
  } else {
    console.log("Tab Memory Monitor [bg]: auto-sleep disabled");
  }
}

// ─── Message Handler (from popup) ────────────────────────────────────────────

browser.runtime.onMessage.addListener((message) => {
  if (message && message.type === "settings-updated") {
    const { autoSleep, sleepMinutes } = message;
    applySettings({ autoSleep, sleepMinutes });
  }
  // Return false — no async response needed
  return false;
});

// ─── Alarm Listener ───────────────────────────────────────────────────────────

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    runAutoSleep();
  }
});

// ─── Startup: Restore settings from storage ───────────────────────────────────

async function init() {
  try {
    const data = await browser.storage.sync.get({
      autoSleep:    false,
      sleepMinutes: 15,
    });
    await applySettings(data);
  } catch (e) {
    console.warn("Tab Memory Monitor [bg]: could not load settings on init", e);
  }
}

browser.runtime.onStartup.addListener(init);
browser.runtime.onInstalled.addListener(init);

// Also run immediately in case the background woke up mid-session
init();
