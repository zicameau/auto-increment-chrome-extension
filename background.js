// Background service worker for the Auto-Increment Extension

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'ping') {
        sendResponse({ pong: true });
    }
});

// When the extension is installed, updated, or reloaded during development,
// refresh all tabs that have an active content script so stale VM instances
// are replaced with a single clean one.
chrome.runtime.onInstalled.addListener(async (details) => {
    console.log(`[AutoIncrement] onInstalled: ${details.reason}`);

    if (details.reason === 'install' || details.reason === 'update') {
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
            // Skip restricted pages that can't be refreshed by extensions
            if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
                continue;
            }
            try {
                chrome.tabs.reload(tab.id);
                console.log(`[AutoIncrement] Refreshed tab ${tab.id}: ${tab.url}`);
            } catch (err) {
                console.warn(`[AutoIncrement] Could not refresh tab ${tab.id}:`, err.message);
            }
        }
    }
});

console.log('[AutoIncrement] Background service worker loaded');
