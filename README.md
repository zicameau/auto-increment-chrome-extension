# Auto-Increment Chrome Extension

A Chrome extension that automatically inputs incrementing values into web form fields, with manual arrow-key stepping, focus mode for eBay Seller Hub, and full session persistence.

## Install

1. Download this repository as a ZIP (green **Code** button > **Download ZIP**) or clone it
2. Unzip the folder if needed
3. Open Chrome and go to `chrome://extensions`
4. Enable **Developer mode** (toggle in the top-right corner)
5. Click **Load unpacked**
6. Select the `auto-increment-extension` folder
7. The extension icon will appear in your toolbar

## How to Use

1. Click the extension icon in your toolbar to open the popup
2. Click **Select Input Field**, then click on any text input on the page (e.g. eBay's search box)
3. Configure your settings (start value, increment, interval)
4. Use **arrow keys** to manually step through values, or click **Start** for automatic incrementing
5. Toggle **Focus Mode** on the floating tracker to simplify the eBay listings table

## Features

- **Arrow key stepping** -- press Left/Right arrow keys to manually increment or decrement the selected field
- **Auto-increment** -- automatically input values at a configurable interval with Start/Pause/Stop controls
- **Floating tracker badge** -- draggable, minimizable overlay that shows the current value, status, and step size
- **Focus mode** -- hides unnecessary columns on eBay Seller Hub, enlarges listing images to 250px, and keeps only SKU, quantity, item, and action columns visible
- **Session persistence** -- current value, settings, focus mode state, and selected field are saved and automatically restored when you return to the page
- **Auto-reselect target** -- the extension remembers which input field you selected using a CSS selector fingerprint and re-selects it on page load
- **Auto-submit** -- optionally presses Enter after each value input to trigger a search

## Tips

- When you reload the extension during development, all open tabs are automatically refreshed to ensure a clean single instance of the content script
- Focus mode re-applies automatically when eBay dynamically reloads the listings table after a search
- The extension works on any website with standard text input fields, not just eBay
