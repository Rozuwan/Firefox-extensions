/* ============================================================
   YouTube Focus Mode — Popup Script
   Manages tactile switch state binds, daily watch limits,
   whitelists rendering, and advanced Custom CSS live tests.
   ============================================================ */

(function () {
  'use strict';

  const FEATURE_KEYS = [
    'hideShorts',
    'hideShortsInSearch',
    'hideHomepageFeed',
    'hideSidebar',
    'hideLiveChat',
    'expandPlayer',
    'hideComments',
    'hideEndcards',
    'hideMerch',
    'hideNotificationBell'
  ];

  const DEFAULTS = {
    masterEnabled: true,
    hideShorts: true,
    hideShortsInSearch: true,
    hideHomepageFeed: false,
    hideComments: false,
    hideSidebar: true,
    hideLiveChat: false,
    expandPlayer: true,
    hideEndcards: false,
    hideMerch: false,
    hideNotificationBell: false,
    watchLimitMinutes: 0
  };

  // ── DOM Element Selectors ──────────────────────────────────
  const masterCheckbox  = document.getElementById('master-enabled');
  const masterLabel     = document.getElementById('master-label');
  const scrollContainer = document.querySelector('.popup-scroll-container');
  const btnReset        = document.getElementById('btn-reset');
  
  // Watch limit elements
  const selectLimit     = document.getElementById('watch-limit');
  const timerStatus     = document.getElementById('timer-status');
  
  const toggleEls = {};
  const itemEls   = {};

  FEATURE_KEYS.forEach(key => {
    toggleEls[key] = document.getElementById(`toggle-${key}`);
    itemEls[key]   = document.getElementById(`item-${key}`);
  });

  // ───────────────────────────────────────────────────────────
  // ── UI State Update Handlers ───────────────────────────────
  // ───────────────────────────────────────────────────────────

  function setMasterUI(enabled) {
    masterCheckbox.checked = enabled;
    masterLabel.textContent = enabled ? 'ON' : 'OFF';
    masterLabel.classList.toggle('is-off', !enabled);
    scrollContainer.classList.toggle('toggles-disabled', !enabled);
  }

  function setFeatureUI(settings) {
    FEATURE_KEYS.forEach(key => {
      const val = !!settings[key];
      if (toggleEls[key]) toggleEls[key].checked = val;
      if (itemEls[key]) itemEls[key].classList.toggle('active', val);
    });

    // Set watch limit dropdown
    if (selectLimit) {
      selectLimit.value = settings.watchLimitMinutes !== undefined ? settings.watchLimitMinutes : 0;
    }

  }

  function applyFullUI(settings) {
    setMasterUI(!!settings.masterEnabled);
    setFeatureUI(settings);
    updateWatchTimeStatus(settings.watchLimitMinutes || 0);
  }

  // ───────────────────────────────────────────────────────────
  // ── Watch Time Limits Tracker ──────────────────────────────
  // ───────────────────────────────────────────────────────────

  function updateWatchTimeStatus(limitMinutes) {
    browser.storage.local.get({ secondsWatchedToday: 0 }, (localData) => {
      const minutesToday = Math.floor(localData.secondsWatchedToday / 60);
      if (limitMinutes > 0) {
        timerStatus.textContent = `Active today: ${minutesToday}m / ${limitMinutes}m limit`;
        timerStatus.style.color = minutesToday >= limitMinutes ? '#ff4e4e' : '#9090a8';
      } else {
        timerStatus.textContent = `Active today: ${minutesToday}m (No limit)`;
        timerStatus.style.color = '#9090a8';
      }
    });
  }



  // ───────────────────────────────────────────────────────────
  // ── Event Listener Binds ───────────────────────────────────
  // ───────────────────────────────────────────────────────────

  // Load Initial Settings
  browser.storage.sync.get(DEFAULTS, applyFullUI);

  // Master switch listener
  masterCheckbox.addEventListener('change', () => {
    const enabled = masterCheckbox.checked;
    setMasterUI(enabled);
    browser.storage.sync.set({ masterEnabled: enabled });
  });

  // Feature switch binders
  FEATURE_KEYS.forEach(key => {
    if (itemEls[key] && toggleEls[key]) {
      itemEls[key].addEventListener('click', (e) => {
        if (e.target.closest('.switch')) return;
        toggleEls[key].checked = !toggleEls[key].checked;
        handleFeatureToggle(key);
      });

      toggleEls[key].addEventListener('change', () => handleFeatureToggle(key));
    }
  });

  function handleFeatureToggle(key) {
    const val = toggleEls[key].checked;
    if (itemEls[key]) itemEls[key].classList.toggle('active', val);
    console.log(`Saving ${key}:`, val);
    browser.storage.sync.set({ [key]: val });
  }

  // Watch limit dropdown change listener
  if (selectLimit) {
    selectLimit.addEventListener('change', () => {
      const limitVal = parseInt(selectLimit.value);
      browser.storage.sync.set({ watchLimitMinutes: limitVal }, () => {
        updateWatchTimeStatus(limitVal);
      });
    });
  }

  // Reset all settings button listener
  btnReset.addEventListener('click', () => {
    browser.storage.sync.set(DEFAULTS, () => {
      applyFullUI(DEFAULTS);
      // Reset local counter as well for a completely clean start
      browser.storage.local.set({ secondsWatchedToday: 0, snoozedToday: false }, () => {
        updateWatchTimeStatus(0);
      });
      
      btnReset.textContent = '✓ Done';
      btnReset.style.color = '#34d399';
      btnReset.style.borderColor = 'rgba(52, 211, 153, 0.4)';
      setTimeout(() => {
        btnReset.textContent = 'Reset';
        btnReset.style.color = '';
        btnReset.style.borderColor = '';
      }, 1200);
    });
  });

  // Dynamic storage listener
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
      browser.storage.sync.get(DEFAULTS, applyFullUI);
    } else if (area === 'local') {
      browser.storage.sync.get({ watchLimitMinutes: 0 }, (settings) => {
        updateWatchTimeStatus(settings.watchLimitMinutes || 0);
      });
    }
  });

})();