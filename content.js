class AutoIncrementContent {
    constructor() {
        this.targetElement = null;
        this.isRunning = false;
        this.isPaused = false;
        this.currentValue = 1;
        this.intervalId = null;
        this.progressInterval = null;
        this.selectingTarget = false;
        this.settings = {};
        this.trackerElement = null;
        this.trackerMinimized = false;
        this.focusModeActive = false;
        this.focusStyleElement = null;
        this.hiddenColumns = [];
        this.focusObserver = null;
        this.focusReapplyTimeout = null;
        this._destroyed = false;
        
        // Store bound handlers so they can be removed on destroy
        this._boundClickHandler = (e) => this.handleTargetSelection(e);
        this._boundKeydownHandler = (e) => this.handleArrowKey(e);
        this._boundMessageHandler = (message, sender, sendResponse) => {
            return this._handleMessage(message, sender, sendResponse);
        };
        this._boundBeforeUnload = () => {
            this.persistState();
            this.stopFocusObserver();
            this.stop();
        };
        
        this.bindEvents();
        this.restoreState();
        console.log('Auto-Increment Content Script loaded');
    }

    destroy() {
        this._destroyed = true;
        
        // Remove all event listeners
        document.removeEventListener('click', this._boundClickHandler, true);
        document.removeEventListener('keydown', this._boundKeydownHandler);
        window.removeEventListener('beforeunload', this._boundBeforeUnload);
        try {
            chrome.runtime.onMessage.removeListener(this._boundMessageHandler);
        } catch (err) {
            // Extension context may already be invalidated
        }
        
        // Clean up intervals, observers, and DOM elements
        this.clearIntervals();
        this.stopFocusObserver();
        this.removeFocusMode();
        this.removeTracker();
        this.removeSelectionOverlay();
        
        console.log('Auto-Increment Content Script destroyed');
    }

    _handleMessage(message, sender, sendResponse) {
        if (this._destroyed) return;
        console.log('Content script received message:', message);
        
        switch(message.action) {
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
                    hasTarget: !!this.targetElement
                });
                break;
            default:
                sendResponse({ error: 'Unknown action' });
        }
        return true;
    }

    bindEvents() {
        chrome.runtime.onMessage.addListener(this._boundMessageHandler);
        document.addEventListener('click', this._boundClickHandler, true);
        document.addEventListener('keydown', this._boundKeydownHandler);
        window.addEventListener('beforeunload', this._boundBeforeUnload);
    }

    startTargetSelection() {
        this.selectingTarget = true;
        document.body.style.cursor = 'crosshair';
        
        // Add visual indicator
        this.addSelectionOverlay();
        console.log('Target selection started - click on an input field');
    }

    addSelectionOverlay() {
        // Remove existing overlay
        const existing = document.getElementById('auto-increment-overlay');
        if (existing) existing.remove();
        
        // Create selection overlay
        const overlay = document.createElement('div');
        overlay.id = 'auto-increment-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 102, 204, 0.1);
            z-index: 999999;
            pointer-events: none;
            border: 3px dashed #0066cc;
            box-sizing: border-box;
        `;
        
        // Add instruction text
        const instruction = document.createElement('div');
        instruction.style.cssText = `
            position: absolute;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: #0066cc;
            color: white;
            padding: 10px 20px;
            border-radius: 5px;
            font-family: Arial, sans-serif;
            font-size: 14px;
            font-weight: bold;
            z-index: 1000000;
        `;
        instruction.textContent = '🎯 Click on any input field to select it';
        
        overlay.appendChild(instruction);
        document.body.appendChild(overlay);
    }

    removeSelectionOverlay() {
        const overlay = document.getElementById('auto-increment-overlay');
        if (overlay) overlay.remove();
        document.body.style.cursor = '';
    }

    handleTargetSelection(e) {
        if (this._destroyed) return;
        if (!this.selectingTarget) return;

        const target = e.target;
        
        // Check if it's a valid input element
        if (this.isValidInputElement(target)) {
            e.preventDefault();
            e.stopPropagation();
            
            this.targetElement = target;
            this.selectingTarget = false;
            this.removeSelectionOverlay();
            
            // Highlight the selected element
            this.highlightElement(target);
            
            // Show the floating tracker badge
            this.createTracker();
            this.updateTracker();
            this.persistState();
            
            // Send success message to popup
            try {
                chrome.runtime.sendMessage({
                    action: 'targetSelected',
                    data: {
                        success: true,
                        description: this.getElementDescription(target)
                    }
                });
            } catch (err) {
                console.log('Could not send target selected:', err.message);
            }
            
            console.log('Target selected:', target);
        } else {
            // Invalid target, cancel selection
            this.cancelTargetSelection();
            
            try {
                chrome.runtime.sendMessage({
                    action: 'targetSelected',
                    data: {
                        success: false,
                        error: 'Please click on a text input field'
                    }
                });
            } catch (err) {
                console.log('Could not send target selection error:', err.message);
            }
        }
    }

    isValidInputElement(element) {
        return element.tagName === 'INPUT' && 
               ['text', 'search', 'number', 'email', 'url', 'tel'].includes(element.type);
    }

    cancelTargetSelection() {
        this.selectingTarget = false;
        this.removeSelectionOverlay();
    }

    handleArrowKey(e) {
        if (this._destroyed) return;
        // Only handle left/right arrow keys
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        
        // Must have a target element selected
        if (!this.targetElement) return;
        
        // Don't interfere while auto-increment is running
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
        
        if (e.key === 'ArrowRight') {
            this.currentValue += increment;
        } else if (e.key === 'ArrowLeft') {
            this.currentValue -= increment;
        }
        
        // Input the value into the target field
        this.manualInputValue();
    }

    manualInputValue() {
        if (!this.targetElement || !document.contains(this.targetElement)) {
            return;
        }

        try {
            this.targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            this.targetElement.focus();
            this.targetElement.value = '';
            this.targetElement.value = this.currentValue.toString();
            
            this.targetElement.dispatchEvent(new Event('input', { bubbles: true }));
            this.targetElement.dispatchEvent(new Event('change', { bubbles: true }));
            
            this.flashElement(this.targetElement);
            
            // Press Enter if auto-submit is enabled, then blur to prevent scroll-to-top on reload
            if (this.settings.autoSubmit) {
                setTimeout(() => {
                    this.pressEnter(this.targetElement);
                    // Blur the input so the browser doesn't scroll to it on page reload
                    setTimeout(() => {
                        if (this.targetElement) this.targetElement.blur();
                        document.activeElement?.blur();
                    }, 50);
                }, 100);
            }
            
            // Update tracker and persist
            this.updateTracker();
            this.persistState();
            
            // Notify the popup of the new value
            chrome.runtime.sendMessage({
                action: 'manualIncrement',
                data: { currentValue: this.currentValue }
            });
            
            console.log(`Manual step: ${this.currentValue}`);
        } catch (error) {
            console.error('Error during manual input:', error);
        }
    }

    // ===== State Persistence =====

    persistState() {
        try {
            const state = {
                currentValue: this.currentValue,
                isRunning: this.isRunning,
                isPaused: this.isPaused,
                settings: this.settings,
                hasTarget: !!this.targetElement,
                focusModeActive: this.focusModeActive,
                scrollY: window.scrollY,
                url: window.location.href,
                timestamp: Date.now()
            };
            chrome.storage.local.set({ autoIncrementContentState: state });
        } catch (error) {
            // Extension context may have been invalidated (e.g. after extension reload)
            console.log('Could not persist state:', error.message);
        }
    }

    async restoreState() {
        try {
            const result = await chrome.storage.local.get('autoIncrementContentState');
            if (result.autoIncrementContentState) {
                const state = result.autoIncrementContentState;
                
                // Only restore if on the same page (base URL without query params) and less than 24 hours old
                const currentBase = window.location.origin + window.location.pathname;
                const savedBase = new URL(state.url).origin + new URL(state.url).pathname;
                const isSamePage = currentBase === savedBase;
                const isFresh = (Date.now() - state.timestamp) < 24 * 60 * 60 * 1000;
                
                if (isSamePage && isFresh) {
                    this.currentValue = state.currentValue || 1;
                    this.settings = state.settings || {};
                    this.focusModeActive = state.focusModeActive || false;
                    
                    // Immediately blur any focused element to prevent browser from
                    // auto-scrolling to the search input at the top of the page
                    document.activeElement?.blur();
                    
                    // Show the tracker with restored value so user sees where they left off
                    this.createTracker();
                    this.updateTracker();
                    
                    // Re-apply focus mode if it was active
                    if (this.focusModeActive) {
                        // Apply immediately, then retry a few times as the page loads dynamically
                        this.applyFocusMode();
                        this.startFocusObserver();
                        // Retry at increasing delays to catch late-loading content
                        setTimeout(() => { if (this.focusModeActive) this.applyFocusMode(); }, 500);
                        setTimeout(() => { if (this.focusModeActive) this.applyFocusMode(); }, 1500);
                        setTimeout(() => { if (this.focusModeActive) this.applyFocusMode(); }, 3000);
                    }
                    
                    // Restore scroll position - try to scroll to saved position,
                    // or scroll to the first table data row as a fallback
                    this.restoreScrollPosition();
                    
                    console.log(`Restored state: value=${this.currentValue}, focusMode=${this.focusModeActive}`);
                }
            }
        } catch (error) {
            console.error('Error restoring state:', error);
        }
    }

    restoreScrollPosition() {
        // Scroll to the listing row and keep blurring any focused element
        // to prevent eBay from scrolling back to the search input
        let elapsed = 0;
        const scrollInterval = setInterval(() => {
            // Keep blurring to fight eBay's auto-focus on the search input
            const active = document.activeElement;
            if (active && active.tagName === 'INPUT') {
                active.blur();
            }
            
            // Find the first data row in the listing table and scroll to it
            const dataRow = document.querySelector('table tbody tr') ||
                            document.querySelectorAll('table tr')[1];
            if (dataRow) {
                dataRow.scrollIntoView({ behavior: 'instant', block: 'start' });
            } else {
                // Table hasn't loaded yet, scroll to bottom as fallback
                window.scrollTo(0, document.body.scrollHeight);
            }
            
            elapsed += 200;
            if (elapsed >= 4000) {
                clearInterval(scrollInterval);
            }
        }, 200);
    }

    // ===== Floating Tracker Badge =====

    createTracker() {
        // Don't create duplicates
        if (this.trackerElement && document.contains(this.trackerElement)) {
            return;
        }

        const tracker = document.createElement('div');
        tracker.id = 'auto-increment-tracker';
        tracker.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 999998;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            pointer-events: auto;
            user-select: none;
        `;

        const focusBtnColor = this.focusModeActive ? '#00d4ff' : '#8899aa';
        const focusBtnBg = this.focusModeActive ? '#0a3a4a' : '#2a2a4a';
        const focusBtnText = this.focusModeActive ? '👁 Focus: ON' : '👁 Focus: OFF';

        tracker.innerHTML = `
            <div id="auto-increment-tracker-body" style="
                background: #1a1a2e;
                color: #e0e0e0;
                border-radius: 10px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                min-width: 180px;
                overflow: hidden;
                border: 1px solid #333;
                transition: all 0.2s ease;
            ">
                <div id="auto-increment-tracker-header" style="
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 6px 10px;
                    background: #16213e;
                    cursor: move;
                    border-bottom: 1px solid #333;
                    font-size: 11px;
                    font-weight: 600;
                    color: #8899aa;
                ">
                    <span>🔢 Auto-Increment</span>
                    <div style="display: flex; gap: 6px;">
                        <span id="auto-increment-tracker-minimize" style="cursor: pointer; font-size: 14px; line-height: 1; opacity: 0.7;" title="Minimize">−</span>
                        <span id="auto-increment-tracker-close" style="cursor: pointer; font-size: 14px; line-height: 1; opacity: 0.7;" title="Close">×</span>
                    </div>
                </div>
                <div id="auto-increment-tracker-content" style="padding: 10px 12px;">
                    <div style="text-align: center;">
                        <div style="font-size: 11px; color: #8899aa; margin-bottom: 2px;">CURRENT VALUE</div>
                        <div id="auto-increment-tracker-value" style="
                            font-size: 28px;
                            font-weight: bold;
                            color: #00d4ff;
                            line-height: 1.2;
                            letter-spacing: 1px;
                        ">1</div>
                    </div>
                    <div style="
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-top: 8px;
                        font-size: 10px;
                        color: #8899aa;
                    ">
                        <span id="auto-increment-tracker-status" style="
                            padding: 2px 6px;
                            border-radius: 3px;
                            background: #2a2a4a;
                            font-weight: 600;
                        ">Idle</span>
                        <span id="auto-increment-tracker-step">Step: 1</span>
                    </div>
                    <div id="auto-increment-tracker-focus-btn" style="
                        margin-top: 8px;
                        text-align: center;
                        padding: 5px 8px;
                        border-radius: 5px;
                        background: ${focusBtnBg};
                        color: ${focusBtnColor};
                        font-size: 11px;
                        font-weight: 600;
                        cursor: pointer;
                        border: 1px solid ${focusBtnColor}33;
                        transition: all 0.2s ease;
                    ">${focusBtnText}</div>
                </div>
            </div>
        `;

        document.body.appendChild(tracker);
        this.trackerElement = tracker;

        // Bind minimize button
        const minimizeBtn = tracker.querySelector('#auto-increment-tracker-minimize');
        minimizeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleTrackerMinimize();
        });

        // Bind close button
        const closeBtn = tracker.querySelector('#auto-increment-tracker-close');
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.removeTracker();
        });

        // Bind focus mode button
        const focusBtn = tracker.querySelector('#auto-increment-tracker-focus-btn');
        focusBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleFocusMode();
        });

        // Make draggable
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

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const x = e.clientX - offsetX;
            const y = e.clientY - offsetY;
            tracker.style.left = x + 'px';
            tracker.style.top = y + 'px';
            tracker.style.right = 'auto';
            tracker.style.bottom = 'auto';
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });
    }

    toggleTrackerMinimize() {
        this.trackerMinimized = !this.trackerMinimized;
        const content = this.trackerElement?.querySelector('#auto-increment-tracker-content');
        const minimizeBtn = this.trackerElement?.querySelector('#auto-increment-tracker-minimize');
        
        if (content) {
            content.style.display = this.trackerMinimized ? 'none' : 'block';
        }
        if (minimizeBtn) {
            minimizeBtn.textContent = this.trackerMinimized ? '+' : '−';
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
                statusEl.textContent = '● Running';
                statusEl.style.color = '#28a745';
                statusEl.style.background = '#1a3a1a';
            } else if (this.isPaused) {
                statusEl.textContent = '⏸ Paused';
                statusEl.style.color = '#ffc107';
                statusEl.style.background = '#3a3a1a';
            } else {
                statusEl.textContent = '● Idle';
                statusEl.style.color = '#8899aa';
                statusEl.style.background = '#2a2a4a';
            }
        }

        if (stepEl) {
            const step = this.settings.increment || 1;
            stepEl.textContent = `Step: ${step}`;
        }
    }

    removeTracker() {
        if (this.trackerElement) {
            this.trackerElement.remove();
            this.trackerElement = null;
        }
    }

    // ===== Focus Mode =====

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
            
            // Check if any mutation involves table-related elements or significant DOM changes
            let needsReapply = false;
            for (const mutation of mutations) {
                // Skip mutations caused by our own focus mode changes
                const target = mutation.target;
                if (target.id && target.id.startsWith('auto-increment-')) continue;
                if (target.getAttribute && target.getAttribute('data-focus-hidden') !== null) continue;
                if (target.getAttribute && target.getAttribute('data-focus-enlarged') !== null) continue;
                
                // Check if new nodes were added (table content refreshed)
                if (mutation.addedNodes.length > 0) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === 1) {
                            // Check if it's a table-related element or contains one
                            if (node.tagName === 'TABLE' || node.tagName === 'TR' || node.tagName === 'TD' ||
                                node.tagName === 'TBODY' || node.tagName === 'IMG' ||
                                (node.querySelector && (node.querySelector('table') || node.querySelector('tr') || node.querySelector('img')))) {
                                needsReapply = true;
                                break;
                            }
                        }
                    }
                }
                if (needsReapply) break;
            }
            
            if (needsReapply) {
                // Debounce - wait for the DOM to settle before re-applying
                if (this.focusReapplyTimeout) clearTimeout(this.focusReapplyTimeout);
                this.focusReapplyTimeout = setTimeout(() => {
                    if (this.focusModeActive) {
                        console.log('Focus Mode: re-applying after DOM change');
                        this.applyFocusMode();
                    }
                }, 300);
            }
        });
        
        // Observe the entire body for subtree changes
        this.focusObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        console.log('Focus Mode observer started');
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
            btn.textContent = '👁 Focus: ON';
            btn.style.color = '#00d4ff';
            btn.style.background = '#0a3a4a';
            btn.style.borderColor = '#00d4ff33';
        } else {
            btn.textContent = '👁 Focus: OFF';
            btn.style.color = '#8899aa';
            btn.style.background = '#2a2a4a';
            btn.style.borderColor = '#8899aa33';
        }
    }

    applyFocusMode() {
        this.removeFocusMode();
        
        // Keywords for columns to KEEP (case-insensitive match on header text)
        const keepKeywords = ['item', 'sku', 'custom label', 'quantity', 'qty', 'actions'];
        // Keywords for columns to ALWAYS hide (even if index alignment is off)
        const forceHideKeywords = ['promoted', 'discount', 'price'];
        
        // Find all tables on the page
        const tables = document.querySelectorAll('table');
        
        tables.forEach(table => {
            // Try thead first, then fall back to first tr
            const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
            if (!headerRow) return;
            
            const headerCells = headerRow.querySelectorAll('th, td');
            if (headerCells.length < 3) return;
            
            // Determine which column indices to hide based on headers
            const columnsToHide = [];
            
            headerCells.forEach((cell, index) => {
                const text = cell.textContent.trim().toLowerCase();
                
                // Always hide pure checkbox columns (no meaningful text)
                if (text === '' || text.length < 2) {
                    columnsToHide.push(index);
                    return;
                }
                
                // Check if this column should be kept
                const shouldKeep = keepKeywords.some(keyword => text.includes(keyword));
                if (!shouldKeep) {
                    columnsToHide.push(index);
                }
            });
            
            // Hide columns by index in all rows
            const allRows = table.querySelectorAll('tr');
            allRows.forEach(row => {
                const cells = row.querySelectorAll('th, td');
                cells.forEach((cell, index) => {
                    if (columnsToHide.includes(index)) {
                        cell.setAttribute('data-focus-hidden', 'true');
                        cell.style.setProperty('display', 'none', 'important');
                    }
                });
            });
            
            // Second pass: force-hide any cell whose text matches forceHideKeywords
            // This catches columns even when header/body cell counts don't align
            allRows.forEach(row => {
                const cells = row.querySelectorAll('th, td');
                cells.forEach(cell => {
                    if (cell.getAttribute('data-focus-hidden') === 'true') return;
                    const text = cell.textContent.trim().toLowerCase();
                    const shouldForceHide = forceHideKeywords.some(keyword => text.includes(keyword));
                    if (shouldForceHide) {
                        cell.setAttribute('data-focus-hidden', 'true');
                        cell.style.setProperty('display', 'none', 'important');
                    }
                });
            });
            
            this.hiddenColumns.push({ table, columnsToHide });
        });
        
        // Directly enlarge images via JavaScript (more reliable than CSS-only)
        this.enlargeListingImages();
        
        // Inject a style element for additional styling
        const style = document.createElement('style');
        style.id = 'auto-increment-focus-style';
        style.textContent = `
            /* Hidden columns */
            [data-focus-hidden="true"] {
                display: none !important;
            }
            
            /* Make the item title text bigger */
            table td a[href*="ebay"],
            table [role="gridcell"] a {
                font-size: 15px !important;
                font-weight: 500 !important;
                line-height: 1.4 !important;
            }
            
            /* Make remaining column text larger */
            table td:not([data-focus-hidden="true"]),
            table th:not([data-focus-hidden="true"]) {
                font-size: 15px !important;
                padding: 10px !important;
            }
            
            /* Give table rows more breathing room */
            table tr {
                border-bottom: 1px solid #e0e0e0 !important;
            }
        `;
        document.head.appendChild(style);
        this.focusStyleElement = style;
        
        console.log('Focus Mode enabled - showing Image, Edit, SKU, and Quantity');
    }

    enlargeListingImages() {
        const IMAGE_SIZE = 250;
        
        // Find all images inside tables
        const allTableImages = document.querySelectorAll('table img');
        
        allTableImages.forEach(img => {
            // Skip very large images (likely banners/headers) and tiny icons
            const naturalW = img.naturalWidth || img.width;
            if (naturalW > 300 || img.src.includes('icon')) return;
            
            // Store original dimensions for restoration
            img.setAttribute('data-focus-original-style', img.style.cssText);
            img.setAttribute('data-focus-original-width', img.getAttribute('width') || '');
            img.setAttribute('data-focus-original-height', img.getAttribute('height') || '');
            
            // Enlarge the image itself
            img.style.setProperty('width', IMAGE_SIZE + 'px', 'important');
            img.style.setProperty('height', IMAGE_SIZE + 'px', 'important');
            img.style.setProperty('max-width', IMAGE_SIZE + 'px', 'important');
            img.style.setProperty('max-height', IMAGE_SIZE + 'px', 'important');
            img.style.setProperty('object-fit', 'contain', 'important');
            img.style.setProperty('border-radius', '6px', 'important');
            img.setAttribute('width', IMAGE_SIZE);
            img.setAttribute('height', IMAGE_SIZE);
            img.setAttribute('data-focus-enlarged', 'true');
            
            // Walk up through ALL parent levels until we hit the table row,
            // expanding every container along the way including TD and TR
            let parent = img.parentElement;
            for (let i = 0; i < 10 && parent; i++) {
                parent.setAttribute('data-focus-parent-original', parent.style.cssText);
                parent.style.setProperty('width', 'auto', 'important');
                parent.style.setProperty('height', 'auto', 'important');
                parent.style.setProperty('max-width', 'none', 'important');
                parent.style.setProperty('max-height', 'none', 'important');
                parent.style.setProperty('min-height', IMAGE_SIZE + 'px', 'important');
                parent.style.setProperty('overflow', 'visible', 'important');
                parent.setAttribute('data-focus-parent-expanded', 'true');
                
                // Stop AFTER expanding the TR (row), not before
                if (parent.tagName === 'TR') break;
                parent = parent.parentElement;
            }
        });
        
        console.log(`Focus Mode: enlarged ${document.querySelectorAll('[data-focus-enlarged]').length} images to ${IMAGE_SIZE}px`);
    }

    removeFocusMode() {
        // Restore hidden columns
        document.querySelectorAll('[data-focus-hidden="true"]').forEach(cell => {
            cell.removeAttribute('data-focus-hidden');
            cell.style.removeProperty('display');
        });
        
        this.hiddenColumns = [];
        
        // Restore enlarged images
        document.querySelectorAll('[data-focus-enlarged="true"]').forEach(img => {
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
        
        // Restore expanded parent containers
        document.querySelectorAll('[data-focus-parent-expanded="true"]').forEach(el => {
            el.style.cssText = el.getAttribute('data-focus-parent-original') || '';
            el.removeAttribute('data-focus-parent-expanded');
            el.removeAttribute('data-focus-parent-original');
        });
        
        // Remove injected style
        if (this.focusStyleElement) {
            this.focusStyleElement.remove();
            this.focusStyleElement = null;
        }
        
        const existingStyle = document.getElementById('auto-increment-focus-style');
        if (existingStyle) existingStyle.remove();
        
        console.log('Focus Mode disabled - all columns and images restored');
    }

    getElementDescription(element) {
        let description = element.tagName.toLowerCase();
        if (element.placeholder) description += ` (${element.placeholder})`;
        if (element.name) description += ` [name="${element.name}"]`;
        if (element.id) description += ` [id="${element.id}"]`;
        if (element.type) description += ` [type="${element.type}"]`;
        return description;
    }

    highlightElement(element) {
        const originalStyle = element.style.cssText;
        element.style.cssText += '; border: 3px solid #0066cc !important; box-shadow: 0 0 10px rgba(0, 102, 204, 0.5) !important; background-color: rgba(0, 102, 204, 0.1) !important;';
        
        setTimeout(() => {
            element.style.cssText = originalStyle;
        }, 2000);
    }

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
        
        console.log('Auto-increment started with settings:', settings);
    }

    pause() {
        this.isPaused = true;
        this.isRunning = false;
        
        this.clearIntervals();
        this.updateTracker();
        this.persistState();
        this.sendStatusUpdate();
        
        console.log('Auto-increment paused');
    }

    resume() {
        if (!this.isPaused) return;
        
        this.isPaused = false;
        this.isRunning = true;
        
        this.updateTracker();
        this.persistState();
        this.sendStatusUpdate();
        this.startIncrementing();
        
        console.log('Auto-increment resumed');
    }

    stop() {
        this.isRunning = false;
        this.isPaused = false;
        
        this.clearIntervals();
        this.updateTracker();
        this.persistState();
        this.sendStatusUpdate();
        
        console.log('Auto-increment stopped');
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
        
        // Then continue with the interval
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
            // Scroll element into view
            this.targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            // Focus the element
            this.targetElement.focus();
            
            // Clear existing value
            this.targetElement.value = '';
            
            // Input new value
            this.targetElement.value = this.currentValue.toString();
            
            // Trigger input events to ensure the page recognizes the change
            this.targetElement.dispatchEvent(new Event('input', { bubbles: true }));
            this.targetElement.dispatchEvent(new Event('change', { bubbles: true }));
            
            // Visual feedback - briefly highlight the input
            this.flashElement(this.targetElement);
            
            // Press Enter if auto-submit is enabled, then blur to prevent scroll-to-top on reload
            if (this.settings.autoSubmit) {
                setTimeout(() => {
                    this.pressEnter(this.targetElement);
                    setTimeout(() => {
                        if (this.targetElement) this.targetElement.blur();
                        document.activeElement?.blur();
                    }, 50);
                }, 100);
            }
            
            // Update tracker and persist
            this.updateTracker();
            this.persistState();
            
            // Send update to popup
            try {
                chrome.runtime.sendMessage({
                    action: 'incrementComplete',
                    data: { currentValue: this.currentValue }
                });
            } catch (err) {
                console.log('Could not send increment update:', err.message);
            }
            
            console.log(`Inputted value: ${this.currentValue}`);
            
        } catch (error) {
            console.error('Error inputting value:', error);
            this.sendStatusUpdate('Error inputting value: ' + error.message, true);
            this.stop();
        }
    }

    flashElement(element) {
        const originalStyle = element.style.cssText;
        element.style.cssText += '; background-color: #90EE90 !important; transition: background-color 0.3s ease !important;';
        
        setTimeout(() => {
            element.style.cssText = originalStyle;
        }, 300);
    }

    pressEnter(element) {
        try {
            // Create and dispatch keyboard events
            const keyboardEventOptions = {
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                which: 13,
                bubbles: true,
                cancelable: true
            };
            
            element.dispatchEvent(new KeyboardEvent('keydown', keyboardEventOptions));
            element.dispatchEvent(new KeyboardEvent('keypress', keyboardEventOptions));
            element.dispatchEvent(new KeyboardEvent('keyup', keyboardEventOptions));
            
            // Also try to submit the form if the element is in one
            const form = element.closest('form');
            if (form) {
                form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            }
            
        } catch (error) {
            console.error('Error pressing Enter:', error);
        }
    }

    sendStatusUpdate(error = null, isError = false) {
        try {
            chrome.runtime.sendMessage({
                action: 'statusUpdate',
                data: {
                    isRunning: this.isRunning,
                    isPaused: this.isPaused,
                    error: error
                }
            });
        } catch (err) {
            console.log('Could not send status update:', err.message);
        }
    }
}

// Initialize content script - destroy old instance first to prevent duplicates on extension reload
if (window.autoIncrementContent) {
    try {
        window.autoIncrementContent.destroy();
    } catch (err) {
        console.log('Error destroying old instance:', err.message);
    }
}
window.autoIncrementContent = new AutoIncrementContent();