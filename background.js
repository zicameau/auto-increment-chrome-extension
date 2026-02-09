// Background script for the Auto-Increment Extension
// Handles extension lifecycle and cross-tab communication

class AutoIncrementBackground {
    constructor() {
        this.sessions = new Map(); // Store sessions by tab ID
        this.bindEvents();
        console.log('Auto-Increment Background Script loaded');
    }

    bindEvents() {
        // Handle tab updates (refresh, navigation)
        chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            if (changeInfo.status === 'complete') {
                // Tab finished loading, inject content script if needed
                this.ensureContentScript(tabId);
            }
        });

        // Clean up when tabs are closed
        chrome.tabs.onRemoved.addListener((tabId) => {
            if (this.sessions.has(tabId)) {
                this.sessions.delete(tabId);
                console.log(`Cleaned up session for tab ${tabId}`);
            }
        });

        // Handle extension icon click
        chrome.action.onClicked.addListener((tab) => {
            // This will be handled by the popup, but we can add logic here if needed
            console.log('Extension icon clicked on tab:', tab.id);
        });

        // Handle messages from content scripts and popup
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            this.handleMessage(message, sender, sendResponse);
        });
    }

    async ensureContentScript(tabId) {
        try {
            // Check if content script is already loaded
            const response = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
            if (response && response.pong) {
                return; // Content script already loaded
            }
        } catch (error) {
            // Content script not loaded, inject it
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    files: ['content.js']
                });
                console.log(`Content script injected into tab ${tabId}`);
            } catch (injectError) {
                console.error(`Failed to inject content script into tab ${tabId}:`, injectError);
            }
        }
    }

    handleMessage(message, sender, sendResponse) {
        const tabId = sender.tab?.id;
        
        switch (message.action) {
            case 'ping':
                sendResponse({ pong: true });
                break;
                
            case 'sessionStart':
                this.startSession(tabId, message.data);
                sendResponse({ success: true });
                break;
                
            case 'sessionEnd':
                this.endSession(tabId);
                sendResponse({ success: true });
                break;
                
            case 'getSessionInfo':
                const session = this.sessions.get(tabId);
                sendResponse(session || null);
                break;
                
            default:
                sendResponse({ error: 'Unknown action in background script' });
        }
    }

    startSession(tabId, sessionData) {
        this.sessions.set(tabId, {
            ...sessionData,
            startTime: Date.now(),
            tabId: tabId
        });
        
        console.log(`Started session for tab ${tabId}:`, sessionData);
    }

    endSession(tabId) {
        if (this.sessions.has(tabId)) {
            const session = this.sessions.get(tabId);
            console.log(`Ended session for tab ${tabId}, duration: ${Date.now() - session.startTime}ms`);
            this.sessions.delete(tabId);
        }
    }

    // Utility method to get all active sessions
    getActiveSessions() {
        return Array.from(this.sessions.entries()).map(([tabId, session]) => ({
            tabId,
            ...session
        }));
    }
}

// Initialize background script
const autoIncrementBackground = new AutoIncrementBackground();