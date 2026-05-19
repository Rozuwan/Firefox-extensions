# YouTube Focus Mode

A Firefox extension that removes distractions from YouTube — hides Shorts, recommended videos, comments, and homepage feed.

![Screenshot](./screenshot.png)

## Features

- **Hide Shorts** — Removes Shorts from sidebar, home page, and search results
- **Hide Recommendations** — Hides the right-side video suggestion panel
- **Hide Comments** — Collapses the comments section on video pages
- **Hide Homepage Feed** — Removes the main video feed from YouTube home

## Installation

1. Open Firefox and go to `about:debugging`
2. Click **This Firefox** → **Load Temporary Add-on**
3. Select `manifest.json` from this folder
4. Click the puzzle icon in Firefox toolbar to open the popup

The extension loads as a temporary add-on. To keep it permanently, submit to [Mozilla Add-ons](https://addons.mozilla.org/).

## Permissions

- `storage` — Saves your toggle preferences

## Files

```
YouTube-Focus-Mode/
├── manifest.json    # Extension manifest
├── background.js    # Background script (handles storage)
├── content.js       # Content script (hides elements on YouTube)
├── popup.html/css/js  # Popup UI
├── icons/           # Extension icons
└── README.md
```

## License

MIT