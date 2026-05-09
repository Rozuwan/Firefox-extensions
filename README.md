# Firefox Extensions

A monorepo for developing and managing Firefox browser extensions.

## Extensions

| Extension | Description |
|-----------|-------------|
| [YouTube-Focus-Mode](./YouTube-Focus-Mode) | Distraction-free YouTube viewing by hiding recommended videos, comments, and sidebars |

## Requirements

- [Firefox Browser](https://www.mozilla.org/firefox/) (latest version recommended)
- For building: `zip` command (or any archive tool)

## Loading Extensions for Development

1. Open Firefox and navigate to `about:debugging`
2. Click **This Firefox** in the sidebar
3. Click **Load Temporary Add-on**
4. Navigate to an extension folder and select its `manifest.json`

Temporary add-ons are removed when Firefox closes. To keep them installed, sign through Mozilla Add-ons.

## Building for Distribution

```bash
# Navigate to the extension
cd YouTube-Focus-Mode

# Create XPI package (Firefox add-on format)
zip -r ../YouTube-Focus-Mode.xpi .

# Or create a ZIP for manual installation
zip -r ../YouTube-Focus-Mode.zip .
```

## Directory Structure

```
Firefox_Extensions/
├── .gitignore
├── README.md
└── YouTube-Focus-Mode/
    ├── manifest.json      # Extension manifest
    ├── background.js      # Background script
    ├── content.js         # Content script
    ├── popup.html/css/js  # Popup UI
    └── icons/             # Extension icons
```

## License

MIT