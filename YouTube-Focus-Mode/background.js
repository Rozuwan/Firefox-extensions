/* ============================================================
   YouTube Focus Mode — Background Script
   Tracks active cumulative watch time on YouTube tabs.
   Handles daily resets and message events.
   ============================================================ */

'use strict';

const TIMER_ALARM_NAME = 'yfm-watch-timer';

// Initialize defaults on install/startup
browser.runtime.onInstalled.addListener(() => {
  initializeTimer();
});

browser.runtime.onStartup.addListener(() => {
  initializeTimer();
});

function initializeTimer() {
  const todayStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD format
  browser.storage.local.get(['secondsWatchedToday', 'snoozedToday', 'lastResetDate'], (data) => {
    const updates = {};
    if (data.secondsWatchedToday === undefined) updates.secondsWatchedToday = 0;
    if (data.snoozedToday === undefined) updates.snoozedToday = false;
    if (!data.lastResetDate) updates.lastResetDate = todayStr;
    
    if (Object.keys(updates).length > 0) {
      browser.storage.local.set(updates);
    }
  });

  // Create alarm to poll active tab status every 1 minute
  browser.alarms.create(TIMER_ALARM_NAME, { periodInMinutes: 1 });
}

// Check if calendar date has changed and perform midnight reset
function checkDailyReset(callback) {
  const todayStr = new Date().toLocaleDateString('en-CA');
  browser.storage.local.get(['lastResetDate'], (data) => {
    if (data.lastResetDate !== todayStr) {
      browser.storage.local.set({
        secondsWatchedToday: 0,
        snoozedToday: false,
        lastResetDate: todayStr
      }, () => {
        if (callback) callback(true);
      });
    } else {
      if (callback) callback(false);
    }
  });
}

// Alarm Listener
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TIMER_ALARM_NAME) {
    checkDailyReset((resetPerformed) => {
      if (resetPerformed) return; // If reset was just performed, skip watch increment for this cycle
      
      // Query for the actively focused tab in the focused window
      browser.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        if (tabs && tabs[0] && tabs[0].url) {
          const url = tabs[0].url;
          // Verify if it is YouTube
          if (
            url.includes('youtube.com/watch') || 
            url.includes('youtube.com/results') || 
            url.includes('youtube.com/channel') || 
            url.includes('youtube.com/@') ||
            url.match(/^https?:\/\/(www\.)?youtube\.com\/?/)
          ) {
            // Check if user has a limit set
            browser.storage.sync.get({ watchLimitMinutes: 0, masterEnabled: true }, (settings) => {
              if (settings.masterEnabled && settings.watchLimitMinutes > 0) {
                browser.storage.local.get({ secondsWatchedToday: 0 }, (localData) => {
                  const newSeconds = localData.secondsWatchedToday + 60;
                  browser.storage.local.set({ secondsWatchedToday: newSeconds });
                });
              }
            });
          }
        }
      });
    });
  }
});

// Listener for Tab Close from Content Script
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'closeTab' && sender.tab) {
    browser.tabs.remove(sender.tab.id);
  }
});
