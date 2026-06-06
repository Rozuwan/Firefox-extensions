/* ============================================================
   YouTube Focus Mode — Content Script
   Controls dynamic page hiding, whitelisting, auto-theater mode,
   custom CSS injection, and daily watch limit overlays.
   ============================================================ */

(function () {
  "use strict";

  const STYLE_ID = "__yfm_styles__";
  const OVERLAY_ID = "ytfm-limit-overlay";

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
    watchLimitMinutes: 0,
  };

  const SELECTORS = {
    hideShorts: [
      'ytd-guide-entry-renderer a[href="/shorts"]',
      'ytd-mini-guide-entry-renderer a[href="/shorts"]',
      "ytd-rich-shelf-renderer[is-shorts]",
      'ytd-rich-shelf-renderer[feature="SHORTS"]',
      "ytd-reel-shelf-renderer",
      "ytd-shelf-renderer:has(ytd-reel-item-renderer)",
      "#related ytd-reel-shelf-renderer",
      "ytd-rich-item-renderer:has(ytd-rich-grid-slim-media[is-short])",
      'ytd-rich-item-renderer:has(a[href*="/shorts/"])',
      'yt-chip-cloud-chip-renderer:has(a[href="/shorts"])',
    ],
    hideShortsInSearch: [
      'ytd-video-renderer:has(a[href*="/shorts/"])',
      "ytd-reel-item-renderer",
      "ytd-reel-shelf-renderer",
      "ytd-rich-shelf-renderer[is-shorts]",
      'ytd-shelf-renderer:has(a[href*="/shorts/"])',
    ],
    hideHomepageFeed: ["#contents", "ytd-rich-grid-renderer"],
    hideComments: ["#comments", "ytd-comments#comments"],
    hideSidebar: [
      "#secondary",
      "#related",
      "ytd-watch-next-secondary-results-renderer",
    ],
    hideLiveChat: [
      "#chat",
      "ytd-live-chat-frame",
    ],
    hideEndcards: [
      ".ytp-ce-element",
      ".ytp-ce-cover-image",
      ".ytp-ce-video",
      ".ytp-ce-playlist",
      ".ytp-ce-channel",
    ],
    hideMerch: [
      "ytd-merch-shelf-renderer",
      ".ytd-merch-shelf-renderer",
      "#merch-shelf",
    ],
    hideNotificationBell: [
      "ytd-notification-toggle-button-renderer",
      "#notification-preference-button",
      ".ytd-notification-toggle-button-renderer",
    ],
  };

  let observer = null;
  let currentSettings = null;
  let lastCheckedVideoId = "";
  let enforceLimitInterval = null;
  let theaterTriggeredForCurrentPage = false;
  let theaterPlayerObserver = null;  // Fix: module-level ref prevents observer accumulation
  let theaterSettleTimeout = null;   // Fix: module-level ref prevents timeout accumulation

  // ─────────────────────────────────────────────────────────────────────────────
  // ── Focus Limit Overlay & Active Play Enforcer ──────────────────────────────
  // ─────────────────────────────────────────────────────────────────────────────

  function checkFocusLimit() {
    if (
      !currentSettings ||
      !currentSettings.masterEnabled ||
      !currentSettings.watchLimitMinutes
    ) {
      removeLimitOverlay();
      return;
    }

    browser.storage.local.get(
      ["secondsWatchedToday", "snoozedToday", "snoozeExpiryTime"],
      (localData) => {
        const limitSeconds = currentSettings.watchLimitMinutes * 60;
        const secondsToday = localData.secondsWatchedToday || 0;
        const isSnoozed = !!localData.snoozedToday;
        const snoozeExpiry = localData.snoozeExpiryTime || 0;

        if (secondsToday >= limitSeconds) {
          if (isSnoozed) {
            if (Date.now() < snoozeExpiry) {
              // Under snooze period, do not overlay
              removeLimitOverlay();
              return;
            } else {
              // Snooze expired, show strict overlay with no snooze button
              injectLimitOverlay(true);
            }
          } else {
            // Limit hit, first time, show overlay with snooze button
            injectLimitOverlay(false);
          }
        } else {
          removeLimitOverlay();
        }
      },
    );
  }

  function injectLimitOverlay(snoozeUsed) {
    // Only overlay the video player to keep it non-blocking on the page layout
    const playerEl =
      document.getElementById("movie_player") ||
      document.querySelector(".html5-video-player");
    if (!playerEl) return;

    // Pause the video actively
    const video = playerEl.querySelector("video");
    if (video && !video.paused) {
      video.pause();
    }

    if (document.getElementById(OVERLAY_ID)) {
      // Overlay exists, update state of snooze button if expired
      const snoozeBtn = document.getElementById("ytfm-btn-snooze");
      if (snoozeBtn && snoozeUsed) {
        snoozeBtn.disabled = true;
        snoozeBtn.style.opacity = "0.35";
        snoozeBtn.textContent = "Snooze Limit Reached";
      }
      return;
    }

    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;

    const style = document.createElement("style");
    style.textContent = `#${OVERLAY_ID} { position: absolute; inset: 0; z-index: 2147483647; background: rgba(10, 10, 15, 0.72); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); display: flex; align-items: center; justify-content: center; font-family: "Inter", system-ui, sans-serif; color: #f0f0f5; } .yfm-limit-card { text-align: center; padding: 30px; background: rgba(24, 24, 31, 0.9); border: 1px solid rgba(255, 78, 78, 0.25); box-shadow: 0 0 30px rgba(255, 78, 78, 0.15); border-radius: 16px; max-width: 380px; width: 90%; } .yfm-limit-icon { font-size: 32px; margin-bottom: 12px; } .yfm-limit-card h2 { font-size: 18px; font-weight: 700; margin-bottom: 8px; color: #f0f0f5; letter-spacing: -0.3px; } .yfm-limit-card p { font-size: 13px; color: #9090a8; margin-bottom: 24px; line-height: 1.5; } .yfm-limit-btns { display: flex; gap: 12px; justify-content: center; } .yfm-limit-btn { font-size: 13px; font-weight: 600; padding: 8px 18px; border-radius: 20px; cursor: pointer; transition: 0.2s; border: none; font-family: inherit; } .yfm-btn-break { background: #ff4e4e; color: #ffffff; box-shadow: 0 0 10px rgba(255, 78, 78, 0.25); } .yfm-btn-break:hover { background: #ff3838; box-shadow: 0 0 15px rgba(255, 78, 78, 0.35); } .yfm-btn-snooze { background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255,255,255,0.08); color: #9090a8; } .yfm-btn-snooze:hover:not(:disabled) { background: rgba(255, 255, 255, 0.08); color: #f0f0f5; } .yfm-btn-snooze:disabled { cursor: not-allowed; opacity: 0.35; }`;
    overlay.appendChild(style);

    const card = document.createElement("div");
    card.className = "yfm-limit-card";

    const icon = document.createElement("div");
    icon.className = "yfm-limit-icon";
    icon.textContent = "🎯";

    const h2 = document.createElement("h2");
    h2.textContent = "You've hit your focus limit for today";

    const p = document.createElement("p");
    p.textContent = "Your scheduled screen limit has passed. Taking active breaks keeps your productivity high.";

    const btns = document.createElement("div");
    btns.className = "yfm-limit-btns";

    const breakBtn = document.createElement("button");
    breakBtn.id = "ytfm-btn-break";
    breakBtn.className = "yfm-limit-btn yfm-btn-break";
    breakBtn.textContent = "Take a break";

    const snoozeBtn = document.createElement("button");
    snoozeBtn.id = "ytfm-btn-snooze";
    snoozeBtn.className = "yfm-limit-btn yfm-btn-snooze";
    snoozeBtn.textContent = snoozeUsed ? "Snooze Limit Reached" : "5 more minutes";
    if (snoozeUsed) snoozeBtn.disabled = true;

    btns.appendChild(breakBtn);
    btns.appendChild(snoozeBtn);

    card.appendChild(icon);
    card.appendChild(h2);
    card.appendChild(p);
    card.appendChild(btns);

    overlay.appendChild(card);

    playerEl.appendChild(overlay);

    breakBtn.addEventListener("click", () => {
      browser.runtime.sendMessage({ action: "closeTab" });
    });
    if (snoozeBtn) {
      snoozeBtn.addEventListener("click", () => {
        const fiveMinutesMs = 5 * 60 * 1000;
        browser.storage.local.set(
          {
            snoozedToday: true,
            snoozeExpiryTime: Date.now() + fiveMinutesMs,
          },
          () => {
            removeLimitOverlay();
          },
        );
      });
    }

    // Keep active check interval to enforce pause when overlay is active
    if (!enforceLimitInterval) {
      enforceLimitInterval = setInterval(() => {
        const v = playerEl.querySelector("video");
        if (v && !v.paused && document.getElementById(OVERLAY_ID)) {
          v.pause();
        }
      }, 250);
    }
  }

  function removeLimitOverlay() {
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) overlay.remove();
    if (enforceLimitInterval) {
      clearInterval(enforceLimitInterval);
      enforceLimitInterval = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ── Auto Theater Mode ────────────────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────────────────────

  function tryEnableTheaterMode() {
    // Guard: only on watch pages, only when expandPlayer is on, only once per navigation
    if (!location.pathname.startsWith("/watch")) return;
    if (!currentSettings || !currentSettings.masterEnabled || !currentSettings.expandPlayer) return;
    if (theaterTriggeredForCurrentPage) return;

    // Fix: never eject the user from fullscreen into theater mode
    if (document.fullscreenElement) return;

    // Fix: never interfere with an active Mini Player session
    if (document.querySelector("ytd-miniplayer[active]")) return;

    // Already in theater mode — mark as done and exit
    if (document.querySelector("ytd-watch-flexy[theater]")) {
      theaterTriggeredForCurrentPage = true;
      return;
    }

    // Fix: clean up any observer/timeout left over from a previous rapid navigation
    if (theaterPlayerObserver) {
      theaterPlayerObserver.disconnect();
      theaterPlayerObserver = null;
    }
    if (theaterSettleTimeout) {
      clearTimeout(theaterSettleTimeout);
      theaterSettleTimeout = null;
    }

    // Wait for the theater toggle button using a one-shot MutationObserver
    let settled = false;
    const TIMEOUT_MS = 3000;

    function attemptClick() {
      if (settled) return;
      // Re-check theater state in case YouTube applied it between observer callbacks
      if (document.querySelector("ytd-watch-flexy[theater]")) {
        settled = true;
        theaterTriggeredForCurrentPage = true;
        return;
      }
      const btn = document.querySelector(".ytp-size-button");
      if (!btn) return; // Not yet in DOM; observer will retry
      settled = true;
      theaterTriggeredForCurrentPage = true;
      btn.click();
    }

    theaterPlayerObserver = new MutationObserver(() => {
      attemptClick();
      if (settled) {
        theaterPlayerObserver.disconnect();
        theaterPlayerObserver = null;
      }
    });

    theaterPlayerObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["theater"],
    });

    // Try immediately in case player is already present
    attemptClick();

    // Safety cleanup: disconnect observer after timeout regardless
    theaterSettleTimeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        theaterTriggeredForCurrentPage = true; // Prevent further attempts this navigation
      }
      if (theaterPlayerObserver) {
        theaterPlayerObserver.disconnect();
        theaterPlayerObserver = null;
      }
      theaterSettleTimeout = null;
    }, TIMEOUT_MS);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ── Focus Search Landing Page ────────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────────────────────

  const CARD_ID = "ytfm-focus-card";

  function focusYouTubeSearch() {
    const searchInput =
      document.querySelector("input#search") ||
      document.querySelector("input[name='search_query']");
    if (searchInput) {
      searchInput.focus();
      searchInput.select();
    }
  }

  function updateFocusLandingPage() {
    const shouldShow =
      currentSettings &&
      currentSettings.masterEnabled &&
      currentSettings.hideHomepageFeed &&
      location.pathname === "/";

    const existingCard = document.getElementById(CARD_ID);

    if (!shouldShow) {
      if (existingCard) {
        existingCard.remove();
      }
      return;
    }

    if (existingCard) {
      const targetParent =
        document.querySelector('ytd-browse[page-subtype="home"] #primary') ||
        document.querySelector('ytd-browse[page-subtype="home"]');
      if (targetParent && existingCard.parentNode !== targetParent) {
        targetParent.appendChild(existingCard);
      }
      return;
    }

    const targetParent =
      document.querySelector('ytd-browse[page-subtype="home"] #primary') ||
      document.querySelector('ytd-browse[page-subtype="home"]');
    if (!targetParent) return;

    const card = document.createElement("div");
    card.id = CARD_ID;
    card.innerHTML = `
      <style>
        #${CARD_ID} {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 40px;
          background: rgba(24, 24, 31, 0.75);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 24px;
          max-width: 480px;
          width: 90%;
          margin: 120px auto;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1);
          font-family: "Inter", system-ui, -apple-system, sans-serif;
          color: #f0f0f5;
          animation: ytfmFadeIn 0.3s ease-out forwards;
        }
        
        @keyframes ytfmFadeIn {
          from { opacity: 0; transform: translateY(15px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .ytfm-fc-icon {
          font-size: 48px;
          margin-bottom: 20px;
          filter: drop-shadow(0 0 12px rgba(255, 78, 78, 0.3));
        }

        .ytfm-fc-title {
          font-size: 28px;
          font-weight: 800;
          margin-bottom: 12px;
          letter-spacing: -0.5px;
          background: linear-gradient(135deg, #ffffff 0%, #a5a5b5 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .ytfm-fc-subtitle {
          font-size: 15px;
          font-weight: 400;
          color: #9090a8;
          margin-bottom: 30px;
          line-height: 1.6;
          max-width: 340px;
        }

        .ytfm-fc-btn {
          background: #ff4e4e;
          color: #ffffff;
          font-size: 15px;
          font-weight: 600;
          padding: 12px 32px;
          border-radius: 30px;
          border: none;
          cursor: pointer;
          box-shadow: 0 0 15px rgba(255, 78, 78, 0.25);
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          font-family: inherit;
        }

        .ytfm-fc-btn:hover {
          background: #ff3333;
          box-shadow: 0 0 25px rgba(255, 78, 78, 0.45);
          transform: translateY(-1px);
        }

        .ytfm-fc-btn:active {
          transform: translateY(1px);
        }

        .ytfm-fc-footer {
          margin-top: 32px;
          font-size: 11px;
          color: #55556a;
          letter-spacing: 0.5px;
          text-transform: uppercase;
        }
      </style>
      <div class="ytfm-fc-icon">🎯</div>
      <div class="ytfm-fc-title">Stay Focused</div>
      <div class="ytfm-fc-subtitle">Search intentionally and watch with purpose.</div>
      <button class="ytfm-fc-btn" id="ytfm-fc-btn-search">Search YouTube</button>
      <div class="ytfm-fc-footer">Distractions hidden by YouTube Focus Mode</div>
    `;

    targetParent.appendChild(card);

    const btn = card.querySelector("#ytfm-fc-btn-search");
    if (btn) {
      btn.addEventListener("click", focusYouTubeSearch);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ── CSS Hiding Stylesheet Logic ──────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────────────────────

  function buildCSS(settings) {
    const rules = [];

    for (const [feature, selectors] of Object.entries(SELECTORS)) {
      if (settings[feature]) {
        rules.push(`${selectors.join(",\n")} { display: none !important; }`);
      }
    }

    // Apply auto-stretching when Expand Player is enabled
    if (settings.expandPlayer) {
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

    return rules.join("\n");
  }

  function applySettings(settings) {
    currentSettings = settings;
    let el = document.getElementById(STYLE_ID);

    if (!settings.masterEnabled) {
      if (el) el.remove();
      removeLimitOverlay();
      stopObserver();
      updateFocusLandingPage();
      return;
    }

    // Standard Stylesheet Management
    if (!el) {
      el = document.createElement("style");
      el.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(el);
    }
    el.textContent = buildCSS(settings);

    // Active Feature Checks
    checkFocusLimit();
    updateFocusLandingPage();
    startObserver();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ── MutationObserver (SPA Navigation Friendly) ───────────────────────────────
  // ─────────────────────────────────────────────────────────────────────────────

  function startObserver() {
    if (!currentSettings || !currentSettings.masterEnabled) {
      stopObserver();
      return;
    }
    if (observer) return;
    observer = new MutationObserver(() => {
      if (currentSettings) {
        if (currentSettings.masterEnabled) {
          if (!document.getElementById(STYLE_ID)) {
            browser.storage.sync.get(DEFAULTS, applySettings);
          }
        }

        checkFocusLimit();
        updateFocusLandingPage();
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ── Storage and Event Synchronizers ──────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────────────────────

  function handleStorageChange(changes, area) {
    if (area === "sync") {
      browser.storage.sync.get(DEFAULTS, (settings) => {
        // Fetch local settings too for timers
        browser.storage.local.get(
          ["secondsWatchedToday", "snoozedToday", "snoozeExpiryTime"],
          (localData) => {
            applySettings(settings);
          },
        );
      });
    } else if (area === "local") {
      // Re-evaluate focus limits immediately on clock updates
      checkFocusLimit();
    }
  }

  // YouTube SPA dynamic page navigation triggers
  document.addEventListener("yt-navigate-finish", () => {
    // Reset theater trigger flag on every navigation so it fires once per page
    theaterTriggeredForCurrentPage = false;
    checkFocusLimit();
    if (currentSettings) {
      applySettings(currentSettings);
      tryEnableTheaterMode();
      updateFocusLandingPage();
    }
  });

  // Startup Initialization
  browser.storage.sync.get(DEFAULTS, (settings) => {
    applySettings(settings);
    tryEnableTheaterMode();
  });

  browser.storage.onChanged.addListener(handleStorageChange);
})();
