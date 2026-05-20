# Firefox Extensions

A growing collection of Firefox extensions — vanilla JS, no bundlers, no telemetry, browser-native APIs only.

![Firefox](https://img.shields.io/badge/Firefox-MV3-orange?logo=firefox) ![License](https://img.shields.io/badge/license-MIT-blue) ![APIs](https://img.shields.io/badge/APIs-browser.*%20only-green)

---

## Extensions

| Extension | Description | Version | Status |
|---|---|---|---|
| [SleepingTab](./SleepingTab) | Lightweight tab sleep and activity manager | 1.2.1 | [![AMO](https://img.shields.io/badge/Install-AMO-blue?logo=firefox)](https://addons.mozilla.org) |
| [YouTube Focus Mode](./YouTube-Focus-Mode) | Hide Shorts, recommendations, comments, and homepage feed | 1.1.0 | [![AMO](https://img.shields.io/badge/Install-AMO-blue?logo=firefox)](https://addons.mozilla.org) |

---

## Folder Structure

```
firefox/
├── SleepingTab/
│   ├── manifest.json
│   ├── background.js
│   ├── popup.html
│   └── ...
├── YouTube-Focus-Mode/
│   ├── manifest.json
│   ├── content.js
│   ├── popup.html
│   └── ...
└── README.md
```

---

## Philosophy

- **Firefox-native** — `browser.*` APIs only, no Chrome shims
- **No external requests** — no CDN, no Google Fonts, no telemetry
- **Vanilla JS** — no bundlers, no build step, no dependencies
- **Minimal permissions** — each extension requests only what it needs

---

## Load Locally

1. Clone the repo
2. Open `about:debugging` in Firefox
3. Click **Load Temporary Add-on**
4. Select the `manifest.json` inside any extension folder

No build step needed — what you see is what runs.

---

## License

MIT