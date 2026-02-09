// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
    IMAGE_SIZE: 250,
    SCROLL_INTERVAL_MS: 300,
    SCROLL_DURATION_MS: 4000,
    FOCUS_REAPPLY_DEBOUNCE_MS: 300,
    FOCUS_REAPPLY_DELAYS: [500, 1500, 3000],
    RESELECT_RETRY_DELAYS: [0, 500, 1000, 2000],
    STATE_EXPIRY_MS: 24 * 60 * 60 * 1000,
    HIGHLIGHT_DURATION_MS: 2000,
    FLASH_DURATION_MS: 300,
    ENTER_DELAY_MS: 100,
    POST_ENTER_DELAY_MS: 50,
    VALID_INPUT_TYPES: ['text', 'search', 'number', 'email', 'url', 'tel'],
    KEEP_COLUMNS: ['item', 'sku', 'custom label', 'quantity', 'qty', 'actions'],
    FORCE_HIDE_COLUMNS: ['promoted', 'discount', 'price'],
    LOG_PREFIX: '[AutoIncrement]',
};

// ============================================================================
// Main Class
// ============================================================================

class AutoIncrementContent {
    constructor() {
        // Core state
        this.targetElement = null;
        this.targetSelector = null;
        this.isRunning = false;
        this.isPaused = false;
        this.currentValue = 1;
        this.selectingTarget = false;
        this.settings = {};
        this._destroyed = false;

        // Timer/interval IDs
        this.intervalId = null;
        this.progressInterval = null;
        this._scrollInterval = null;
        this._pendingTimeouts = [];

        // Tracker UI state
        this.trackerElement = null;
        this.trackerMinimized = false;

        // Focus mode state
        this.focusModeActive = false;
        this.focusStyleElement = null;
        this.hiddenColumns = [];
        this.focusObserver = null;
        this.focusReapplyTimeout = null;

        // Bound handlers (stored so they can be removed in destroy)
        this._boundClickHandler = (e) => this.handleTargetSelection(e);
        this._boundKeydownHandler = (e) => this.handleArrowKey(e);
        this._boundMessageHandler = (message, sender, sendResponse) => {
            return this._handleMessage(message, sender, sendResponse);
        };
        this._boundBeforeUnload = () => {
            this.persistState();
            this.stopFocusObserver();
            this.clearIntervals();
        };
        this._boundMouseMove = null;
        this._boundMouseUp = null;

        this.bindEvents();
        this.restoreState();
        console.log(`${CONFIG.LOG_PREFIX} Content script loaded`);
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

    destroy() {
        this._destroyed = true;

        // Remove global event listeners
        document.removeEventListener('click', this._boundClickHandler, true);
        document.removeEventListener('keydown', this._boundKeydownHandler);
        window.removeEventListener('beforeunload', this._boundBeforeUnload);
        if (this._boundMouseMove) {
            document.removeEventListener('mousemove', this._boundMouseMove);
        }
        if (this._boundMouseUp) {
            document.removeEventListener('mouseup', this._boundMouseUp);
        }
        try {
            chrome.runtime.onMessage.removeListener(this._boundMessageHandler);
        } catch {
            // Extension context may already be invalidated
        }

        // Clear all pending timeouts
        for (const id of this._pendingTimeouts) {
            clearTimeout(id);
        }
        this._pendingTimeouts = [];

        // Clear intervals, observers, and DOM elements
        this.clearIntervals();
        if (this._scrollInterval) {
            clearInterval(this._scrollInterval);
            this._scrollInterval = null;
        }
        this.stopFocusObserver();
        this.removeFocusMode();
        this.removeTracker();
        this.removeSelectionOverlay();

        console.log(`${CONFIG.LOG_PREFIX} Content script destroyed`);
    }

    bindEvents() {
        chrome.runtime.onMessage.addListener(this._boundMessageHandler);
        document.addEventListener('click', this._boundClickHandler, true);
        document.addEventListener('keydown', this._boundKeydownHandler);
        window.addEventListener('beforeunload', this._boundBeforeUnload);
    }

    // ========================================================================
    // Helpers
    // ========================================================================

    safeSendMessage(payload) {
        try {
            chrome.runtime.sendMessage(payload);
        } catch (err) {
            console.warn(`${CONFIG.LOG_PREFIX} sendMessage failed:`, err.message);
        }
    }

    /** Schedule a timeout and track its ID so destroy() can cancel it. */
    setTimeout(callback, delay) {
        const id = globalThis.setTimeout(() => {
            this._pendingTimeouts = this._pendingTimeouts.filter((t) => t !== id);
            callback();
        }, delay);
        this._pendingTimeouts.push(id);
        return id;
    }

    isValidInputElement(element) {
        return (
            element.tagName === 'INPUT' &&
            CONFIG.VALID_INPUT_TYPES.includes(element.type)
        );
    }

    getElementDescription(element) {
        let desc = element.tagName.toLowerCase();
        if (element.placeholder) desc += ` (${element.placeholder})`;
        if (element.name) desc += ` [name="${element.name}"]`;
        if (element.id) desc += ` [id="${element.id}"]`;
        if (element.type) desc += ` [type="${element.type}"]`;
        return desc;
    }

    // ========================================================================
    // Message Handling
    // ========================================================================

    _handleMessage(message, sender, sendResponse) {
        if (this._destroyed) return;
        console.log(`${CONFIG.LOG_PREFIX} Received message:`, message.action);

        switch (message.action) {
            case 'ping':
                sendResponse({ pong: true });
                break;
            case 'startTargetSelection':
                this.startTargetSelection();
                sendResponse({ success: true });
                break;
            case 'start':
                this.start(message.settings);
                sendResponse({ success: true });
                break;
            case 'pause':
                this.pause();
                sendResponse({ success: true });
                break;
            case 'resume':
                this.resume();
                sendResponse({ success: true });
                break;
            case 'stop':
                this.stop();
                sendResponse({ success: true });
                break;
            case 'syncSettings':
                this.settings = { ...this.settings, ...message.settings };
                if (!this.isRunning && !this.isPaused) {
                    this.currentValue = message.settings.startValue || this.currentValue;
                }
                this.updateTracker();
                this.persistState();
                sendResponse({ success: true });
                break;
            case 'getStatus':
                sendResponse({
                    isRunning: this.isRunning,
                    isPaused: this.isPaused,
                    currentValue: this.currentValue,
                    hasTarget: !!this.targetElement,
                });
                break;
            default:
                sendResponse({ error: 'Unknown action' });
        }
        return true;
    }

    // ========================================================================
    // Target Selection
    // ========================================================================

    startTargetSelection() {
        this.selectingTarget = true;
        document.body.style.cursor = 'crosshair';
        this.addSelectionOverlay();
        console.log(`${CONFIG.LOG_PREFIX} Target selection started`);
    }

    addSelectionOverlay() {
        const existing = document.getElementById('auto-increment-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'auto-increment-overlay';
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 102, 204, 0.1); z-index: 999999;
            pointer-events: none; border: 3px dashed #0066cc; box-sizing: border-box;
        `;

        const instruction = document.createElement('div');
        instruction.style.cssText = `
            position: absolute; top: 20px; left: 50%; transform: translateX(-50%);
            background: #0066cc; color: white; padding: 10px 20px; border-radius: 5px;
            font-family: Arial, sans-serif; font-size: 14px; font-weight: bold;
            z-index: 1000000;
        `;
        instruction.textContent = 'Click on any input field to select it';

        overlay.appendChild(instruction);
        document.body.appendChild(overlay);
    }

    removeSelectionOverlay() {
        const overlay = document.getElementById('auto-increment-overlay');
        if (overlay) overlay.remove();
        document.body.style.cursor = '';
    }

    handleTargetSelection(e) {
        if (this._destroyed || !this.selectingTarget) return;

        const target = e.target;

        if (this.isValidInputElement(target)) {
            e.preventDefault();
            e.stopPropagation();

            this.targetElement = target;
            this.targetSelector = this.buildTargetSelector(target);
            this.selectingTarget = false;
            this.removeSelectionOverlay();
            this.highlightElement(target);

            this.createTracker();
            this.updateTracker();
            this.persistState();

            this.safeSendMessage({
                action: 'targetSelected',
                data: { success: true, description: this.getElementDescription(target) },
            });
            console.log(`${CONFIG.LOG_PREFIX} Target selected:`, this.targetSelector);
        } else {
            this.cancelTargetSelection();
            this.safeSendMessage({
                action: 'targetSelected',
                data: { success: false, error: 'Please click on a text input field' },
            });
        }
    }

    cancelTargetSelection() {
        this.selectingTarget = false;
        this.removeSelectionOverlay();
    }

    buildTargetSelector(element) {
        if (element.id) {
            return `#${CSS.escape(element.id)}`;
        }
        if (element.name) {
            return `input[name="${element.name}"]`;
        }
        if (element.placeholder) {
            return `input[placeholder="${element.placeholder}"]`;
        }
        const type = element.type || 'text';
        const ariaLabel = element.getAttribute('aria-label');
        if (ariaLabel) {
            return `input[type="${type}"][aria-label="${ariaLabel}"]`;
        }
        return `input[type="${type}"]`;
    }

    autoReselectTarget(selector) {
        let found = false;

        const tryFind = (attempt) => {
            if (found || this._destroyed) return;
            try {
                const element = document.querySelector(selector);
                if (element && this.isValidInputElement(element)) {
                    found = true;
                    this.targetElement = element;
                    this.targetSelector = selector;
                    this.highlightElement(element);
                    this.updateTracker();
                    console.log(`${CONFIG.LOG_PREFIX} Auto-reselected target (attempt ${attempt + 1})`);
                } else if (attempt < CONFIG.RESELECT_RETRY_DELAYS.length - 1) {
                    console.log(`${CONFIG.LOG_PREFIX} Target not found, will retry...`);
                } else {
                    console.warn(`${CONFIG.LOG_PREFIX} Could not auto-reselect target after ${CONFIG.RESELECT_RETRY_DELAYS.length} attempts`);
                }
            } catch (err) {
                console.warn(`${CONFIG.LOG_PREFIX} Error during auto-reselect:`, err.message);
            }
        };

        CONFIG.RESELECT_RETRY_DELAYS.forEach((delay, index) => {
            if (delay === 0) {
                tryFind(index);
            } else {
                this.setTimeout(() => tryFind(index), delay);
            }
        });
    }

    // ========================================================================
    // Arrow Key Manual Stepping
    // ========================================================================

    handleArrowKey(e) {
        if (this._destroyed) return;
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        if (!this.targetElement) return;
        if (this.isRunning) return;

        // Don't interfere if the user is typing in an input/textarea/contenteditable
        const activeEl = document.activeElement;
        if (activeEl && activeEl !== this.targetElement) {
            const tag = activeEl.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || activeEl.isContentEditable) return;
        }

        e.preventDefault();
        e.stopPropagation();

        const increment = this.settings.increment || 1;
        this.currentValue += e.key === 'ArrowRight' ? increment : -increment;
        this.manualInputValue();
    }

    manualInputValue() {
        if (!this.targetElement || !document.contains(this.targetElement)) return;

        // Stop any scroll interval from a previous keypress to prevent it
        // from blurring the input while we're setting the value.
        if (this._scrollInterval) {
            clearInterval(this._scrollInterval);
            this._scrollInterval = null;
        }

        try {
            const valueStr = this.currentValue.toString();

            this.targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            this.targetElement.focus();
            this.targetElement.value = '';
            this.targetElement.value = valueStr;

            this.targetElement.dispatchEvent(new Event('input', { bubbles: true }));
            this.targetElement.dispatchEvent(new Event('change', { bubbles: true }));
            this.flashElement(this.targetElement);

            if (this.settings.autoSubmit) {
                this.setTimeout(() => {
                    // Re-set the value right before Enter in case eBay's AJAX
                    // response from a prior search overwrote it.
                    this.targetElement.focus();
                    this.targetElement.value = '';
                    this.targetElement.value = valueStr;
                    this.targetElement.dispatchEvent(new Event('input', { bubbles: true }));
                    this.targetElement.dispatchEvent(new Event('change', { bubbles: true }));

                    this.pressEnter(this.targetElement);
                    this.setTimeout(() => {
                        if (this.targetElement) this.targetElement.blur();
                        document.activeElement?.blur();
                        this.scrollToListing();
                    }, CONFIG.POST_ENTER_DELAY_MS);
                }, CONFIG.ENTER_DELAY_MS);
            }

            this.updateTracker();
            this.persistState();
            this.safeSendMessage({
                action: 'manualIncrement',
                data: { currentValue: this.currentValue },
            });
            console.log(`${CONFIG.LOG_PREFIX} Manual step: ${this.currentValue}`);
        } catch (error) {
            console.error(`${CONFIG.LOG_PREFIX} Error during manual input:`, error);
        }
    }

    // ========================================================================
    // State Persistence
    // ========================================================================

    persistState() {
        try {
            // Only save if we have meaningful data to prevent an unrelated page
            // from overwriting the good state on beforeunload.
            if (!this.targetElement && !this.targetSelector) return;

            const state = {
                currentValue: this.currentValue,
                isRunning: this.isRunning,
                isPaused: this.isPaused,
                settings: this.settings,
                hasTarget: !!this.targetElement,
                targetSelector: this.targetSelector,
                focusModeActive: this.focusModeActive,
                scrollY: window.scrollY,
                url: window.location.href,
                timestamp: Date.now(),
            };
            chrome.storage.local.set({ autoIncrementContentState: state });
        } catch (error) {
            console.warn(`${CONFIG.LOG_PREFIX} Could not persist state:`, error.message);
        }
    }

    async restoreState() {
        try {
            const result = await chrome.storage.local.get('autoIncrementContentState');
            const state = result.autoIncrementContentState;
            if (!state) return;

            const currentBase = window.location.origin + window.location.pathname;
            const savedBase = new URL(state.url).origin + new URL(state.url).pathname;
            const isSamePage = currentBase === savedBase;
            const isFresh = (Date.now() - state.timestamp) < CONFIG.STATE_EXPIRY_MS;

            if (!isSamePage || !isFresh) return;

            this.currentValue = state.currentValue || 1;
            this.settings = state.settings || {};
            this.focusModeActive = state.focusModeActive || false;
            this.targetSelector = state.targetSelector || null;

            // Blur immediately to prevent the browser from auto-scrolling to the search box
            document.activeElement?.blur();

            // Auto-reselect the target element
            if (this.targetSelector) {
                this.autoReselectTarget(this.targetSelector);
            }

            // Show the tracker with restored value
            this.createTracker();
            this.updateTracker();

            // Re-apply focus mode if it was active
            if (this.focusModeActive) {
                this.applyFocusMode();
                this.startFocusObserver();
                for (const delay of CONFIG.FOCUS_REAPPLY_DELAYS) {
                    this.setTimeout(() => {
                        if (this.focusModeActive) this.applyFocusMode();
                    }, delay);
                }
            }

            this.scrollToListing();
            console.log(
                `${CONFIG.LOG_PREFIX} Restored state: value=${this.currentValue}, focusMode=${this.focusModeActive}, selector=${this.targetSelector}`
            );
        } catch (error) {
            console.error(`${CONFIG.LOG_PREFIX} Error restoring state:`, error);
        }
    }

    // ========================================================================
    // Scroll Management
    // ========================================================================

    scrollToListing() {
        if (this._scrollInterval) clearInterval(this._scrollInterval);

        let elapsed = 0;
        this._scrollInterval = setInterval(() => {
            const active = document.activeElement;
            if (active && active.tagName === 'INPUT') {
                active.blur();
            }

            const dataRow =
                document.querySelector('table tbody tr') ||
                document.querySelectorAll('table tr')[1];
            if (dataRow) {
                dataRow.scrollIntoView({ behavior: 'instant', block: 'start' });
            }

            elapsed += CONFIG.SCROLL_INTERVAL_MS;
            if (elapsed >= CONFIG.SCROLL_DURATION_MS) {
                clearInterval(this._scrollInterval);
                this._scrollInterval = null;
            }
        }, CONFIG.SCROLL_INTERVAL_MS);
    }

    // ========================================================================
    // Floating Tracker Badge
    // ========================================================================

    createTracker() {
        if (this.trackerElement && document.contains(this.trackerElement)) return;

        const tracker = document.createElement('div');
        tracker.id = 'auto-increment-tracker';
        tracker.style.cssText = `
            position: fixed; bottom: 20px; right: 20px; z-index: 999998;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            pointer-events: auto; user-select: none;
        `;

        const focusBtnColor = this.focusModeActive ? '#00d4ff' : '#8899aa';
        const focusBtnBg = this.focusModeActive ? '#0a3a4a' : '#2a2a4a';
        const focusBtnText = this.focusModeActive ? 'Focus: ON' : 'Focus: OFF';

        tracker.innerHTML = `
            <div id="auto-increment-tracker-body" style="
                background: #1a1a2e; color: #e0e0e0; border-radius: 10px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.3); min-width: 180px;
                overflow: hidden; border: 1px solid #333; transition: all 0.2s ease;
            ">
                <div id="auto-increment-tracker-header" style="
                    display: flex; justify-content: space-between; align-items: center;
                    padding: 6px 10px; background: #16213e; cursor: move;
                    border-bottom: 1px solid #333; font-size: 11px; font-weight: 600; color: #8899aa;
                ">
                    <span>Auto-Increment</span>
                    <div style="display: flex; gap: 6px;">
                        <span id="auto-increment-tracker-minimize" style="cursor: pointer; font-size: 14px; line-height: 1; opacity: 0.7;" title="Minimize">&minus;</span>
                        <span id="auto-increment-tracker-close" style="cursor: pointer; font-size: 14px; line-height: 1; opacity: 0.7;" title="Close">&times;</span>
                    </div>
                </div>
                <div id="auto-increment-tracker-content" style="padding: 10px 12px;">
                    <div style="text-align: center;">
                        <div style="font-size: 11px; color: #8899aa; margin-bottom: 2px;">CURRENT VALUE</div>
                        <div id="auto-increment-tracker-value" style="
                            font-size: 28px; font-weight: bold; color: #00d4ff;
                            line-height: 1.2; letter-spacing: 1px;
                        ">1</div>
                    </div>
                    <div style="
                        display: flex; justify-content: space-between; align-items: center;
                        margin-top: 8px; font-size: 10px; color: #8899aa;
                    ">
                        <span id="auto-increment-tracker-status" style="
                            padding: 2px 6px; border-radius: 3px; background: #2a2a4a; font-weight: 600;
                        ">Idle</span>
                        <span id="auto-increment-tracker-step">Step: 1</span>
                    </div>
                    <div id="auto-increment-tracker-focus-btn" style="
                        margin-top: 8px; text-align: center; padding: 5px 8px; border-radius: 5px;
                        background: ${focusBtnBg}; color: ${focusBtnColor}; font-size: 11px;
                        font-weight: 600; cursor: pointer; border: 1px solid ${focusBtnColor}33;
                        transition: all 0.2s ease;
                    ">${focusBtnText}</div>
                </div>
            </div>
        `;

        document.body.appendChild(tracker);
        this.trackerElement = tracker;

        tracker.querySelector('#auto-increment-tracker-minimize').addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleTrackerMinimize();
        });
        tracker.querySelector('#auto-increment-tracker-close').addEventListener('click', (e) => {
            e.stopPropagation();
            this.removeTracker();
        });
        tracker.querySelector('#auto-increment-tracker-focus-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleFocusMode();
        });

        this.makeTrackerDraggable(tracker);
    }

    makeTrackerDraggable(tracker) {
        const header = tracker.querySelector('#auto-increment-tracker-header');
        let isDragging = false;
        let offsetX = 0;
        let offsetY = 0;

        header.addEventListener('mousedown', (e) => {
            if (e.target.id === 'auto-increment-tracker-minimize' || e.target.id === 'auto-increment-tracker-close') return;
            isDragging = true;
            const rect = tracker.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
            e.preventDefault();
        });

        this._boundMouseMove = (e) => {
            if (!isDragging) return;
            tracker.style.left = `${e.clientX - offsetX}px`;
            tracker.style.top = `${e.clientY - offsetY}px`;
            tracker.style.right = 'auto';
            tracker.style.bottom = 'auto';
        };

        this._boundMouseUp = () => {
            isDragging = false;
        };

        document.addEventListener('mousemove', this._boundMouseMove);
        document.addEventListener('mouseup', this._boundMouseUp);
    }

    toggleTrackerMinimize() {
        this.trackerMinimized = !this.trackerMinimized;
        const content = this.trackerElement?.querySelector('#auto-increment-tracker-content');
        const minimizeBtn = this.trackerElement?.querySelector('#auto-increment-tracker-minimize');

        if (content) {
            content.style.display = this.trackerMinimized ? 'none' : 'block';
        }
        if (minimizeBtn) {
            minimizeBtn.innerHTML = this.trackerMinimized ? '+' : '&minus;';
            minimizeBtn.title = this.trackerMinimized ? 'Expand' : 'Minimize';
        }
    }

    updateTracker() {
        if (!this.trackerElement || !document.contains(this.trackerElement)) return;

        const valueEl = this.trackerElement.querySelector('#auto-increment-tracker-value');
        const statusEl = this.trackerElement.querySelector('#auto-increment-tracker-status');
        const stepEl = this.trackerElement.querySelector('#auto-increment-tracker-step');

        if (valueEl) {
            valueEl.textContent = this.currentValue;
        }

        if (statusEl) {
            if (this.isRunning) {
                statusEl.textContent = 'Running';
                statusEl.style.color = '#28a745';
                statusEl.style.background = '#1a3a1a';
            } else if (this.isPaused) {
                statusEl.textContent = 'Paused';
                statusEl.style.color = '#ffc107';
                statusEl.style.background = '#3a3a1a';
            } else {
                statusEl.textContent = 'Idle';
                statusEl.style.color = '#8899aa';
                statusEl.style.background = '#2a2a4a';
            }
        }

        if (stepEl) {
            stepEl.textContent = `Step: ${this.settings.increment || 1}`;
        }
    }

    removeTracker() {
        if (this.trackerElement) {
            this.trackerElement.remove();
            this.trackerElement = null;
        }
    }

    // ========================================================================
    // Focus Mode
    // ========================================================================

    toggleFocusMode() {
        this.focusModeActive = !this.focusModeActive;

        if (this.focusModeActive) {
            this.applyFocusMode();
            this.startFocusObserver();
        } else {
            this.removeFocusMode();
            this.stopFocusObserver();
        }

        this.updateFocusButton();
        this.persistState();
    }

    startFocusObserver() {
        this.stopFocusObserver();

        this.focusObserver = new MutationObserver((mutations) => {
            if (!this.focusModeActive) return;

            let needsReapply = false;
            for (const mutation of mutations) {
                const target = mutation.target;
                if (target.id && target.id.startsWith('auto-increment-')) continue;
                if (target.getAttribute?.('data-focus-hidden') !== null) continue;
                if (target.getAttribute?.('data-focus-enlarged') !== null) continue;

                if (mutation.addedNodes.length > 0) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType !== 1) continue;
                        const isTableRelated =
                            node.tagName === 'TABLE' || node.tagName === 'TR' ||
                            node.tagName === 'TD' || node.tagName === 'TBODY' ||
                            node.tagName === 'IMG' ||
                            (node.querySelector && (node.querySelector('table') || node.querySelector('tr') || node.querySelector('img')));
                        if (isTableRelated) {
                            needsReapply = true;
                            break;
                        }
                    }
                }
                if (needsReapply) break;
            }

            if (needsReapply) {
                if (this.focusReapplyTimeout) clearTimeout(this.focusReapplyTimeout);
                this.focusReapplyTimeout = globalThis.setTimeout(() => {
                    if (this.focusModeActive) {
                        console.log(`${CONFIG.LOG_PREFIX} Focus Mode: re-applying after DOM change`);
                        this.applyFocusMode();
                    }
                }, CONFIG.FOCUS_REAPPLY_DEBOUNCE_MS);
            }
        });

        this.focusObserver.observe(document.body, { childList: true, subtree: true });
        console.log(`${CONFIG.LOG_PREFIX} Focus Mode observer started`);
    }

    stopFocusObserver() {
        if (this.focusObserver) {
            this.focusObserver.disconnect();
            this.focusObserver = null;
        }
        if (this.focusReapplyTimeout) {
            clearTimeout(this.focusReapplyTimeout);
            this.focusReapplyTimeout = null;
        }
    }

    updateFocusButton() {
        if (!this.trackerElement) return;
        const btn = this.trackerElement.querySelector('#auto-increment-tracker-focus-btn');
        if (!btn) return;

        if (this.focusModeActive) {
            btn.textContent = 'Focus: ON';
            btn.style.color = '#00d4ff';
            btn.style.background = '#0a3a4a';
            btn.style.borderColor = '#00d4ff33';
        } else {
            btn.textContent = 'Focus: OFF';
            btn.style.color = '#8899aa';
            btn.style.background = '#2a2a4a';
            btn.style.borderColor = '#8899aa33';
        }
    }

    applyFocusMode() {
        this.removeFocusMode();

        const tables = document.querySelectorAll('table');
        tables.forEach((table) => {
            const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
            if (!headerRow) return;

            const headerCells = headerRow.querySelectorAll('th, td');
            if (headerCells.length < 3) return;

            // Determine which columns to hide based on header text
            const columnsToHide = [];
            headerCells.forEach((cell, index) => {
                const text = cell.textContent.trim().toLowerCase();
                if (text === '' || text.length < 2) {
                    columnsToHide.push(index);
                    return;
                }
                const shouldKeep = CONFIG.KEEP_COLUMNS.some((kw) => text.includes(kw));
                if (!shouldKeep) {
                    columnsToHide.push(index);
                }
            });

            // Hide columns by index in all rows
            const allRows = table.querySelectorAll('tr');
            allRows.forEach((row) => {
                const cells = row.querySelectorAll('th, td');
                cells.forEach((cell, index) => {
                    if (columnsToHide.includes(index)) {
                        cell.setAttribute('data-focus-hidden', 'true');
                        cell.style.setProperty('display', 'none', 'important');
                    }
                });
            });

            // Second pass: force-hide cells matching forceHideKeywords
            allRows.forEach((row) => {
                const cells = row.querySelectorAll('th, td');
                cells.forEach((cell) => {
                    if (cell.getAttribute('data-focus-hidden') === 'true') return;
                    const text = cell.textContent.trim().toLowerCase();
                    if (CONFIG.FORCE_HIDE_COLUMNS.some((kw) => text.includes(kw))) {
                        cell.setAttribute('data-focus-hidden', 'true');
                        cell.style.setProperty('display', 'none', 'important');
                    }
                });
            });

            this.hiddenColumns.push({ table, columnsToHide });
        });

        this.enlargeListingImages();

        const style = document.createElement('style');
        style.id = 'auto-increment-focus-style';
        style.textContent = `
            [data-focus-hidden="true"] { display: none !important; }
            table td a[href*="ebay"], table [role="gridcell"] a {
                font-size: 15px !important; font-weight: 500 !important; line-height: 1.4 !important;
            }
            table td:not([data-focus-hidden="true"]), table th:not([data-focus-hidden="true"]) {
                font-size: 15px !important; padding: 10px !important;
            }
            table tr { border-bottom: 1px solid #e0e0e0 !important; }
        `;
        document.head.appendChild(style);
        this.focusStyleElement = style;

        console.log(`${CONFIG.LOG_PREFIX} Focus Mode enabled`);
    }

    enlargeListingImages() {
        const size = CONFIG.IMAGE_SIZE;
        const allTableImages = document.querySelectorAll('table img');

        allTableImages.forEach((img) => {
            const naturalW = img.naturalWidth || img.width;
            if (naturalW > 300 || img.src.includes('icon')) return;

            img.setAttribute('data-focus-original-style', img.style.cssText);
            img.setAttribute('data-focus-original-width', img.getAttribute('width') || '');
            img.setAttribute('data-focus-original-height', img.getAttribute('height') || '');

            img.style.setProperty('width', `${size}px`, 'important');
            img.style.setProperty('height', `${size}px`, 'important');
            img.style.setProperty('max-width', `${size}px`, 'important');
            img.style.setProperty('max-height', `${size}px`, 'important');
            img.style.setProperty('object-fit', 'contain', 'important');
            img.style.setProperty('border-radius', '6px', 'important');
            img.setAttribute('width', size);
            img.setAttribute('height', size);
            img.setAttribute('data-focus-enlarged', 'true');

            let parent = img.parentElement;
            for (let i = 0; i < 10 && parent; i++) {
                parent.setAttribute('data-focus-parent-original', parent.style.cssText);
                parent.style.setProperty('width', 'auto', 'important');
                parent.style.setProperty('height', 'auto', 'important');
                parent.style.setProperty('max-width', 'none', 'important');
                parent.style.setProperty('max-height', 'none', 'important');
                parent.style.setProperty('min-height', `${size}px`, 'important');
                parent.style.setProperty('overflow', 'visible', 'important');
                parent.setAttribute('data-focus-parent-expanded', 'true');

                if (parent.tagName === 'TR') break;
                parent = parent.parentElement;
            }
        });

        const count = document.querySelectorAll('[data-focus-enlarged]').length;
        console.log(`${CONFIG.LOG_PREFIX} Enlarged ${count} images to ${size}px`);
    }

    removeFocusMode() {
        document.querySelectorAll('[data-focus-hidden="true"]').forEach((cell) => {
            cell.removeAttribute('data-focus-hidden');
            cell.style.removeProperty('display');
        });
        this.hiddenColumns = [];

        document.querySelectorAll('[data-focus-enlarged="true"]').forEach((img) => {
            img.style.cssText = img.getAttribute('data-focus-original-style') || '';
            const origW = img.getAttribute('data-focus-original-width');
            const origH = img.getAttribute('data-focus-original-height');
            if (origW) img.setAttribute('width', origW); else img.removeAttribute('width');
            if (origH) img.setAttribute('height', origH); else img.removeAttribute('height');
            img.removeAttribute('data-focus-enlarged');
            img.removeAttribute('data-focus-original-style');
            img.removeAttribute('data-focus-original-width');
            img.removeAttribute('data-focus-original-height');
        });

        document.querySelectorAll('[data-focus-parent-expanded="true"]').forEach((el) => {
            el.style.cssText = el.getAttribute('data-focus-parent-original') || '';
            el.removeAttribute('data-focus-parent-expanded');
            el.removeAttribute('data-focus-parent-original');
        });

        if (this.focusStyleElement) {
            this.focusStyleElement.remove();
            this.focusStyleElement = null;
        }
        const existingStyle = document.getElementById('auto-increment-focus-style');
        if (existingStyle) existingStyle.remove();

        console.log(`${CONFIG.LOG_PREFIX} Focus Mode disabled`);
    }

    // ========================================================================
    // Visual Feedback
    // ========================================================================

    highlightElement(element) {
        const originalStyle = element.style.cssText;
        element.style.cssText += '; border: 3px solid #0066cc !important; box-shadow: 0 0 10px rgba(0,102,204,0.5) !important; background-color: rgba(0,102,204,0.1) !important;';

        this.setTimeout(() => {
            element.style.cssText = originalStyle;
        }, CONFIG.HIGHLIGHT_DURATION_MS);
    }

    flashElement(element) {
        const originalStyle = element.style.cssText;
        element.style.cssText += '; background-color: #90EE90 !important; transition: background-color 0.3s ease !important;';

        this.setTimeout(() => {
            element.style.cssText = originalStyle;
        }, CONFIG.FLASH_DURATION_MS);
    }

    // ========================================================================
    // Auto-Increment Control
    // ========================================================================

    start(settings) {
        if (!this.targetElement) {
            this.sendStatusUpdate('No target element selected', true);
            return;
        }

        this.settings = settings;
        this.currentValue = settings.startValue;
        this.isRunning = true;
        this.isPaused = false;

        this.createTracker();
        this.updateTracker();
        this.persistState();
        this.sendStatusUpdate();
        this.startIncrementing();

        console.log(`${CONFIG.LOG_PREFIX} Started with settings:`, settings);
    }

    pause() {
        this.isPaused = true;
        this.isRunning = false;

        this.clearIntervals();
        this.updateTracker();
        this.persistState();
        this.sendStatusUpdate();

        console.log(`${CONFIG.LOG_PREFIX} Paused`);
    }

    resume() {
        if (!this.isPaused) return;

        this.isPaused = false;
        this.isRunning = true;

        this.updateTracker();
        this.persistState();
        this.sendStatusUpdate();
        this.startIncrementing();

        console.log(`${CONFIG.LOG_PREFIX} Resumed`);
    }

    stop() {
        this.isRunning = false;
        this.isPaused = false;

        this.clearIntervals();
        this.updateTracker();
        this.persistState();
        this.sendStatusUpdate();

        console.log(`${CONFIG.LOG_PREFIX} Stopped`);
    }

    clearIntervals() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        if (this.progressInterval) {
            clearInterval(this.progressInterval);
            this.progressInterval = null;
        }
    }

    startIncrementing() {
        const intervalMs = this.settings.interval * 1000;

        // Input the first value immediately
        this.inputValue();

        this.intervalId = setInterval(() => {
            this.currentValue += this.settings.increment;
            this.inputValue();
        }, intervalMs);
    }

    inputValue() {
        if (!this.targetElement || !document.contains(this.targetElement)) {
            this.sendStatusUpdate('Target element no longer exists on page', true);
            this.stop();
            return;
        }

        try {
            const valueStr = this.currentValue.toString();

            this.targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            this.targetElement.focus();
            this.targetElement.value = '';
            this.targetElement.value = valueStr;

            this.targetElement.dispatchEvent(new Event('input', { bubbles: true }));
            this.targetElement.dispatchEvent(new Event('change', { bubbles: true }));
            this.flashElement(this.targetElement);

            if (this.settings.autoSubmit) {
                this.setTimeout(() => {
                    // Re-set the value right before Enter in case eBay's AJAX
                    // response from a prior search overwrote it.
                    this.targetElement.focus();
                    this.targetElement.value = '';
                    this.targetElement.value = valueStr;
                    this.targetElement.dispatchEvent(new Event('input', { bubbles: true }));
                    this.targetElement.dispatchEvent(new Event('change', { bubbles: true }));

                    this.pressEnter(this.targetElement);
                    this.setTimeout(() => {
                        if (this.targetElement) this.targetElement.blur();
                        document.activeElement?.blur();
                        this.scrollToListing();
                    }, CONFIG.POST_ENTER_DELAY_MS);
                }, CONFIG.ENTER_DELAY_MS);
            }

            this.updateTracker();
            this.persistState();
            this.safeSendMessage({
                action: 'incrementComplete',
                data: { currentValue: this.currentValue },
            });
            console.log(`${CONFIG.LOG_PREFIX} Inputted value: ${this.currentValue}`);
        } catch (error) {
            console.error(`${CONFIG.LOG_PREFIX} Error inputting value:`, error);
            this.sendStatusUpdate(`Error inputting value: ${error.message}`, true);
            this.stop();
        }
    }

    pressEnter(element) {
        try {
            const opts = {
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                which: 13,
                bubbles: true,
                cancelable: true,
            };

            element.dispatchEvent(new KeyboardEvent('keydown', opts));
            element.dispatchEvent(new KeyboardEvent('keypress', opts));
            element.dispatchEvent(new KeyboardEvent('keyup', opts));

            const form = element.closest('form');
            if (form) {
                form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            }
        } catch (error) {
            console.error(`${CONFIG.LOG_PREFIX} Error pressing Enter:`, error);
        }
    }

    sendStatusUpdate(error = null) {
        this.safeSendMessage({
            action: 'statusUpdate',
            data: {
                isRunning: this.isRunning,
                isPaused: this.isPaused,
                error,
            },
        });
    }
}

// ============================================================================
// Initialization -- destroy any stale instance before creating a new one
// ============================================================================

if (window.autoIncrementContent) {
    try {
        window.autoIncrementContent.destroy();
    } catch (err) {
        console.warn(`${CONFIG.LOG_PREFIX} Error destroying old instance:`, err.message);
    }
}
window.autoIncrementContent = new AutoIncrementContent();
