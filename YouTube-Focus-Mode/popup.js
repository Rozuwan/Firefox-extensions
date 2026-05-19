/* ============================================================
   YouTube Focus Mode — Popup Script
   Master toggle enables/disables the extension entirely.
   Individual toggles control each feature independently.
   ============================================================ */

(function () {
  'use strict';

  const FEATURE_KEYS = ['hideShorts', 'hideRecommendations', 'hideComments'];

  const DEFAULTS = {
    masterEnabled: true,
    hideShorts: true,
    hideRecommendations: true,
    hideComments: true
  };

  // ── DOM refs ──────────────────────────────────────────────
  const masterCheckbox = document.getElementById('master-enabled');
  const masterLabel    = document.getElementById('master-label');
  const toggleList     = document.querySelector('.toggle-list');
  const btnReset       = document.getElementById('btn-reset');

  const toggleEls = {};
  const itemEls   = {};

  FEATURE_KEYS.forEach(key => {
    toggleEls[key] = document.getElementById(`toggle-${key}`);
    itemEls[key]   = document.getElementById(`item-${key}`);
  });

  // ── UI helpers ────────────────────────────────────────────
  function setMasterUI(enabled) {
    masterCheckbox.checked = enabled;
    masterLabel.textContent = enabled ? 'ON' : 'OFF';
    masterLabel.classList.toggle('is-off', !enabled);
    toggleList.classList.toggle('toggles-disabled', !enabled);
  }

  function setFeatureUI(settings) {
    FEATURE_KEYS.forEach(key => {
      const val = !!settings[key];
      toggleEls[key].checked = val;
      itemEls[key].classList.toggle('active', val);
    });
  }

  function applyFullUI(settings) {
    setMasterUI(!!settings.masterEnabled);
    setFeatureUI(settings);
  }

  // ── Load saved settings on open ───────────────────────────
  chrome.storage.sync.get(DEFAULTS, applyFullUI);

  // ── Master toggle ─────────────────────────────────────────
  masterCheckbox.addEventListener('change', () => {
    const enabled = masterCheckbox.checked;
    setMasterUI(enabled);
    chrome.storage.sync.set({ masterEnabled: enabled });
  });

  // ── Individual feature toggles ────────────────────────────
  FEATURE_KEYS.forEach(key => {
    // Clicking the row also fires the toggle
    itemEls[key].addEventListener('click', (e) => {
      if (e.target.closest('.switch')) return;
      toggleEls[key].checked = !toggleEls[key].checked;
      handleFeatureToggle(key);
    });

    toggleEls[key].addEventListener('change', () => handleFeatureToggle(key));
  });

  function handleFeatureToggle(key) {
    const val = toggleEls[key].checked;
    itemEls[key].classList.toggle('active', val);
    chrome.storage.sync.set({ [key]: val });
  }

  // ── Reset button ──────────────────────────────────────────
  btnReset.addEventListener('click', () => {
    chrome.storage.sync.set(DEFAULTS, () => {
      applyFullUI(DEFAULTS);
      btnReset.textContent = '✓ Done';
      btnReset.style.color = '#34d399';
      setTimeout(() => {
        btnReset.textContent = 'Reset';
        btnReset.style.color = '';
      }, 1200);
    });
  });

  // ── Live-sync if storage changes from another context ─────
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    chrome.storage.sync.get(DEFAULTS, applyFullUI);
  });

})();
