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

// ─── Alarm Setup ──────────────────────────────────────────────────────────────

async function initAlarm() {
  try {
    const data = await browser.storage.sync.get({
      autoSleep:    false,
      sleepMinutes: 15
    });

    await browser.alarms.clear(ALARM_NAME);

    if (data.autoSleep) {
      // Dynamic alarm frequency: sleepMinutes / 3 (clamped between 5 and 15 mins)
      const period = Math.max(5, Math.min(15, Math.floor(data.sleepMinutes / 3)));
      browser.alarms.create(ALARM_NAME, { periodInMinutes: period });
      console.log(`[SleepingTab] Auto-sleep active. Alarm scheduled every ${period}m.`);
    } else {
      console.log("[SleepingTab] Auto-sleep disabled. Alarm cleared.");
    }
  } catch (e) {
    console.error("[SleepingTab] Error setting up alarm:", e);
  }
}

// ─── Tab Count Caching ────────────────────────────────────────────────────────

async function getOrSeedCount() {
  try {
    const data = await browser.storage.session.get({
      [CURRENT_KEY]: null,
      [PEAK_KEY]:    0,
      [HISTORY_KEY]: []
    });

    if (data[CURRENT_KEY] === null) {
      const tabs = await browser.tabs.query({});
      const count = tabs.length;
      const peak = Math.max(count, data[PEAK_KEY]);
      const history = data[HISTORY_KEY].length > 0 ? data[HISTORY_KEY] : new Array(30).fill(count);

      await browser.storage.session.set({
        [CURRENT_KEY]: count,
        [PEAK_KEY]:    peak,
        [HISTORY_KEY]: history
      });

      return { currentTabCount: count, peakTabCount: peak, history };
    }

    return {
      currentTabCount: data[CURRENT_KEY],
      peakTabCount:    data[PEAK_KEY],
      history:         data[HISTORY_KEY]
    };
  } catch (e) {
    console.error("[SleepingTab] Error seeding counts:", e);
    return { currentTabCount: 0, peakTabCount: 0, history: [] };
  }
}

async function handleTabCreated() {
  try {
    const data = await getOrSeedCount();
    const newCount = data.currentTabCount + 1;
    const newPeak = Math.max(newCount, data.peakTabCount);

    let history = data.history;
    history.push(newCount);
    if (history.length > 30) history.shift();

    await browser.storage.session.set({
      [CURRENT_KEY]: newCount,
      [PEAK_KEY]:    newPeak,
      [HISTORY_KEY]: history
    });
  } catch (e) {
    console.error("[SleepingTab] Error handling tab creation:", e);
  }
}

async function handleTabRemoved() {
  try {
    const data = await getOrSeedCount();
    const newCount = Math.max(0, data.currentTabCount - 1);

    let history = data.history;
    history.push(newCount);
    if (history.length > 30) history.shift();

    await browser.storage.session.set({
      [CURRENT_KEY]: newCount,
      [HISTORY_KEY]: history
    });
  } catch (e) {
    console.error("[SleepingTab] Error handling tab removal:", e);
  }
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
          return clean && hostname.includes(clean);
        });
        if (matches) continue;
      }

      const idleTime = now - (tab.lastAccessed || 0);
      if (idleTime >= thresholdMs) {
        try {
          await browser.tabs.discard(tab.id);
          console.log(`[SleepingTab] Discarded idle tab: ${tab.title}`);
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
  await getOrSeedCount();
  await initAlarm();
}

browser.runtime.onInstalled.addListener(init);
browser.runtime.onStartup.addListener(init);
