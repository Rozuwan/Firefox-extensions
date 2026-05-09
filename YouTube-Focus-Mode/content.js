/* ============================================================
   YouTube Focus Mode — Content Script
   Reads masterEnabled + individual toggles from storage.
   If masterEnabled is false, all injected CSS is stripped out.
   ============================================================ */

(function () {
  'use strict';

  const STYLE_ID = '__yfm_styles__';

  const DEFAULTS = {
    masterEnabled: true,
    hideShorts: true,
    hideRecommendations: true,
    hideComments: true
  };

  // ── Selector banks grouped by feature ─────────────────────
  const SELECTORS = {
    hideShorts: [
      'ytd-guide-entry-renderer a[title="Shorts"]',
      'ytd-mini-guide-entry-renderer[aria-label="Shorts"]',
      'ytd-rich-shelf-renderer[is-shorts]',
      'ytd-rich-shelf-renderer[feature="SHORTS"]',
      'ytd-reel-shelf-renderer',
      'ytd-shelf-renderer:has(ytd-reel-item-renderer)',
      '#related ytd-reel-shelf-renderer',
      'ytd-rich-item-renderer:has(ytd-rich-grid-slim-media[is-short])',
      'ytd-rich-item-renderer:has(a[href*="/shorts/"])',
      'yt-chip-cloud-chip-renderer:has(yt-formatted-string[title="Shorts"])'
    ],
    hideRecommendations: [
      '#secondary',
      '#related',
      'ytd-watch-next-secondary-results-renderer'
    ],
    hideComments: [
      '#comments',
      'ytd-comments#comments'
    ]
  };

  // ── Build CSS from current settings ───────────────────────
  function buildCSS(settings) {
    const rules = [];

    for (const [feature, selectors] of Object.entries(SELECTORS)) {
      if (settings[feature]) {
        rules.push(`${selectors.join(',\n')} { display: none !important; }`);
      }
    }

    if (settings.hideRecommendations) {
      rules.push(`
        ytd-watch-flexy #primary.ytd-watch-flexy {
          max-width: 100% !important;
          padding-right: 0 !important;
        }
        ytd-watch-flexy #columns.ytd-watch-flexy {
          max-width: 100% !important;
        }
        ytd-watch-flexy #movie_player,
        ytd-watch-flexy ytd-player {
          max-width: 100% !important;
        }
      `);
    }

    return rules.join('\n');
  }

  // ── Inject / remove the <style> tag ───────────────────────
  function applySettings(settings) {
    let el = document.getElementById(STYLE_ID);

    if (!settings.masterEnabled) {
      // Extension disabled — strip all rules
      if (el) el.remove();
      return;
    }

    if (!el) {
      el = document.createElement('style');
      el.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(el);
    }
    el.textContent = buildCSS(settings);
  }

  // ── MutationObserver: keep style tag alive on SPA navigation
  let observer = null;

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(() => {
      if (!document.getElementById(STYLE_ID)) {
        chrome.storage.sync.get(DEFAULTS, applySettings);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  // ── Bootstrap ─────────────────────────────────────────────
  chrome.storage.sync.get(DEFAULTS, (settings) => {
    applySettings(settings);
    startObserver();
  });

  // Re-apply whenever any toggle changes in the popup
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    chrome.storage.sync.get(DEFAULTS, applySettings);
  });
})();
