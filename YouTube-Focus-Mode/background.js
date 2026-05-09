// background.js — YouTube Focus Mode Service Worker

const DEFAULT_SETTINGS = {
  masterEnabled: true,
  hideShorts: true,
  hideRecommendations: true,
  hideComments: true
};

// Set defaults on first install
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.storage.sync.set(DEFAULT_SETTINGS);
  }
});
