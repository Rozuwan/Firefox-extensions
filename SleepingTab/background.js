/**
 * background.js — SleepingTab v3 (Production Ready)
 * State-synchronized architecture using browser.storage.sync and browser.storage.session.
 * Zero custom messaging for metrics, dynamic alarms, and event-driven tab count caching.
 */

"use strict";

const ALARM_NAME  = "sleepingtab-autosleep";
const PEAK_KEY    = "peakTabCount";
const HISTORY_KEY = "history";
const CURRENT_KEY = "currentTabCount";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getHostname(urlStr) {
  try {
    return new URL(urlStr).hostname.toLowerCase();
  } catch {
    return "";
  }
}

const DEBUG = false; // Toggle to true during local development

function log(...args) {
  if (DEBUG) {
    console.log("[SleepingTab]", ...args);
  }
}


// ─── Alarm Setup ──────────────────────────────────────────────────────────────

async function initAlarm() {
  try {
    const data = await browser.storage.sync.get({
      autoSleep:    false,
      sleepMinutes: 15
    });

    await browser.alarms.clear(ALARM_NAME);

    if (data.autoSleep) {
      // Alarm period matches the sleepMinutes threshold (minimum 5 mins to save battery)
      const period = Math.max(5, data.sleepMinutes);
      browser.alarms.create(ALARM_NAME, { periodInMinutes: period });
      log(`Auto-sleep active. Alarm scheduled every ${period}m.`);
    } else {
      log("Auto-sleep disabled. Alarm cleared.");
    }
  } catch (e) {
    console.error("[SleepingTab] Error setting up alarm:", e);
  }
}

// ─── Tab Count Caching ────────────────────────────────────────────────────────

let updateQueue = Promise.resolve();

async function updateTabCache() {
  updateQueue = updateQueue.then(async () => {
    try {
      const tabs = await browser.tabs.query({});
      const count = tabs.length;

      const data = await browser.storage.session.get({
        [PEAK_KEY]:    0,
        [HISTORY_KEY]: []
      });

      const peak = Math.max(count, data[PEAK_KEY]);
      let history = data[HISTORY_KEY];
      if (history.length === 0) {
        history = new Array(30).fill(count);
      } else {
        history.push(count);
        if (history.length > 30) history.shift();
      }

      await browser.storage.session.set({
        [CURRENT_KEY]: count,
        [PEAK_KEY]:    peak,
        [HISTORY_KEY]: history
      });
    } catch (e) {
      console.error("[SleepingTab] Error updating tab cache:", e);
    }
  });
  return updateQueue;
}

function handleTabCreated() {
  updateTabCache();
}

function handleTabRemoved() {
  updateTabCache();
}

// ─── Auto Sleep Routine ───────────────────────────────────────────────────────

async function runAutoSleep() {
  try {
    const settings = await browser.storage.sync.get({
      autoSleep:    false,
      sleepMinutes: 15,
      ignorePinned: true,
      ignoreAudio:  true,
      whitelist:    []
    });

    if (!settings.autoSleep) return;

    const thresholdMs = settings.sleepMinutes * 60 * 1000;
    const now = Date.now();

    const tabs = await browser.tabs.query({ active: false, discarded: false });
    
    for (const tab of tabs) {
      if (settings.ignorePinned && tab.pinned)  continue;
      if (settings.ignoreAudio  && tab.audible) continue;

      // Whitelist matching
      if (settings.whitelist && settings.whitelist.length > 0) {
        const hostname = getHostname(tab.url);
        const matches = settings.whitelist.some(domain => {
          const clean = domain.trim().toLowerCase();
          if (!clean) return false;
          return hostname === clean || hostname.endsWith("." + clean);
        });
        if (matches) continue;
      }

      const idleTime = now - (tab.lastAccessed || 0);
      if (idleTime >= thresholdMs) {
        try {
          await browser.tabs.discard(tab.id);
          log(`Discarded idle tab: ${tab.title}`);
        } catch (_) {
          // Ignore failures for active media or active in another window
        }
      }
    }
  } catch (e) {
    console.error("[SleepingTab] Error in auto-sleep check:", e);
  }
}

// ─── Listeners ────────────────────────────────────────────────────────────────

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) runAutoSleep();
});

browser.tabs.onCreated.addListener(handleTabCreated);
browser.tabs.onRemoved.addListener(handleTabRemoved);

// Sync settings alarm updates
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && ("autoSleep" in changes || "sleepMinutes" in changes)) {
    initAlarm();
  }
});

// ─── Startup ──────────────────────────────────────────────────────────────────

async function init() {
  await updateTabCache();
  await initAlarm();
}

browser.runtime.onInstalled.addListener(init);
browser.runtime.onStartup.addListener(init);
