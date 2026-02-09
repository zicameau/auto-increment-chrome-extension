const LOG_PREFIX = '[AutoIncrement]';

class AutoIncrementPopup {
    constructor() {
        this.currentTab = null;
        this.targetElement = null;
        this.isRunning = false;
        this.isPaused = false;
        this.currentValue = 1;

        this.initializeElements();
        this.bindEvents();
        this.loadState();
        this.getCurrentTab();
    }

    initializeElements() {
        this.elements = {
            selectTarget: document.getElementById('selectTarget'),
            targetInfo: document.getElementById('targetInfo'),
            startValue: document.getElementById('startValue'),
            increment: document.getElementById('increment'),
            interval: document.getElementById('interval'),
            autoSubmit: document.getElementById('autoSubmit'),
            currentValue: document.getElementById('currentValue'),
            statusText: document.getElementById('statusText'),
            statusDisplay: document.getElementById('statusDisplay'),
            progressFill: document.getElementById('progressFill'),
            startBtn: document.getElementById('startBtn'),
            pauseBtn: document.getElementById('pauseBtn'),
            stopBtn: document.getElementById('stopBtn'),
        };
    }

    bindEvents() {
        this.elements.selectTarget.addEventListener('click', () => this.startTargetSelection());
        this.elements.startBtn.addEventListener('click', () => this.start());
        this.elements.pauseBtn.addEventListener('click', () => this.pause());
        this.elements.stopBtn.addEventListener('click', () => this.stop());

        this.elements.startValue.addEventListener('input', () => {
            this.currentValue = parseInt(this.elements.startValue.value) || 1;
            this.updateCurrentValueDisplay();
            this.saveState();
            this.syncSettingsToContent();
        });

        ['increment', 'interval'].forEach((id) => {
            this.elements[id].addEventListener('input', () => {
                this.saveState();
                this.syncSettingsToContent();
            });
        });

        this.elements.autoSubmit.addEventListener('change', () => {
            this.saveState();
            this.syncSettingsToContent();
        });

        chrome.runtime.onMessage.addListener((message) => {
            switch (message.action) {
                case 'targetSelected':
                    this.handleTargetSelected(message.data);
                    break;
                case 'statusUpdate':
                    this.handleStatusUpdate(message.data);
                    break;
                case 'incrementComplete':
                case 'manualIncrement':
                    this.currentValue = message.data.currentValue;
                    this.updateCurrentValueDisplay();
                    this.saveState();
                    break;
            }
        });
    }

    // ========================================================================
    // Tab Management
    // ========================================================================

    async getCurrentTab() {
        try {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            this.currentTab = tabs[0];

            if (this.currentTab && this.isRestrictedPage(this.currentTab.url)) {
                this.showTargetInfo('Cannot run on this page (restricted by Chrome)', 'error');
                this.currentTab = null;
                return;
            }

            this.checkCurrentState();
        } catch (error) {
            console.error(`${LOG_PREFIX} Error getting current tab:`, error);
            this.showTargetInfo('Cannot access current tab', 'error');
        }
    }

    isRestrictedPage(url) {
        if (!url) return true;
        const restrictedPrefixes = [
            'chrome://',
            'chrome-extension://',
            'edge://',
            'about:',
            'view-source:',
            'https://chrome.google.com/webstore',
        ];
        return restrictedPrefixes.some((prefix) => url.startsWith(prefix));
    }

    async checkCurrentState() {
        if (!this.currentTab) return;

        try {
            const response = await chrome.tabs.sendMessage(this.currentTab.id, {
                action: 'getStatus',
            });

            if (response) {
                this.isRunning = response.isRunning;
                this.isPaused = response.isPaused;
                this.currentValue = response.currentValue;
                this.targetElement = response.hasTarget;

                if (response.hasTarget) {
                    this.showTargetInfo('Target selected and ready', 'success');
                }

                this.updateUI();
            }
        } catch {
            console.log(`${LOG_PREFIX} Content script not ready or no active session`);
        }
    }

    // ========================================================================
    // Target Selection
    // ========================================================================

    async startTargetSelection() {
        if (!this.currentTab) {
            this.showTargetInfo('Cannot access current tab', 'error');
            return;
        }

        this.elements.selectTarget.textContent = 'Click on an input field...';
        this.elements.selectTarget.classList.add('selecting');
        this.showTargetInfo('Click on any input field on the page to select it', 'info');

        try {
            await this.ensureContentScriptLoaded();
            await chrome.tabs.sendMessage(this.currentTab.id, {
                action: 'startTargetSelection',
            });
            console.log(`${LOG_PREFIX} Target selection started`);
        } catch (error) {
            console.error(`${LOG_PREFIX} Error starting target selection:`, error);
            this.showTargetInfo(`Error: ${error.message}`, 'error');
            this.resetSelectButton();
        }
    }

    async ensureContentScriptLoaded() {
        try {
            await chrome.tabs.sendMessage(this.currentTab.id, { action: 'ping' });
        } catch {
            console.log(`${LOG_PREFIX} Content script not loaded, injecting...`);
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: this.currentTab.id },
                    files: ['content.js'],
                });
                console.log(`${LOG_PREFIX} Content script injected`);
                await new Promise((resolve) => setTimeout(resolve, 100));
            } catch (injectError) {
                console.error(`${LOG_PREFIX} Failed to inject content script:`, injectError);
                throw new Error('Cannot inject script on this page. Try a different website.');
            }
        }
    }

    handleTargetSelected(data) {
        this.targetElement = data.success;
        this.resetSelectButton();

        if (data.success) {
            this.showTargetInfo(`Target selected: ${data.description}`, 'success');
            this.syncSettingsToContent();
        } else {
            this.showTargetInfo(data.error, 'error');
        }

        this.saveState();
    }

    // ========================================================================
    // Settings Sync
    // ========================================================================

    async syncSettingsToContent() {
        if (!this.currentTab) return;

        try {
            await chrome.tabs.sendMessage(this.currentTab.id, {
                action: 'syncSettings',
                settings: {
                    startValue: parseInt(this.elements.startValue.value) || 1,
                    increment: parseInt(this.elements.increment.value) || 1,
                    interval: parseFloat(this.elements.interval.value) || 1,
                    autoSubmit: this.elements.autoSubmit.checked,
                },
            });
        } catch {
            console.log(`${LOG_PREFIX} Could not sync settings to content script`);
        }
    }

    // ========================================================================
    // Status Updates
    // ========================================================================

    handleStatusUpdate(data) {
        this.isRunning = data.isRunning;
        this.isPaused = data.isPaused;

        if (data.error) {
            this.showTargetInfo(data.error, 'error');
            this.isRunning = false;
            this.isPaused = false;
        }

        this.updateUI();
    }

    resetSelectButton() {
        this.elements.selectTarget.textContent = 'Select Input Field';
        this.elements.selectTarget.classList.remove('selecting');
    }

    showTargetInfo(message, type) {
        this.elements.targetInfo.textContent = message;
        this.elements.targetInfo.className = `target-info ${type}`;
        this.elements.targetInfo.classList.remove('hidden');

        if (type === 'info') {
            setTimeout(() => {
                this.elements.targetInfo.classList.add('hidden');
            }, 5000);
        }
    }

    // ========================================================================
    // Increment Controls
    // ========================================================================

    async start() {
        if (!this.targetElement) {
            this.showTargetInfo('Please select a target input field first', 'error');
            return;
        }
        if (!this.currentTab) {
            this.showTargetInfo('Cannot access current tab', 'error');
            return;
        }

        const settings = {
            startValue: parseInt(this.elements.startValue.value) || 1,
            increment: parseInt(this.elements.increment.value) || 1,
            interval: parseFloat(this.elements.interval.value) || 1,
            autoSubmit: this.elements.autoSubmit.checked,
        };

        try {
            await this.ensureContentScriptLoaded();

            if (this.isPaused) {
                await chrome.tabs.sendMessage(this.currentTab.id, { action: 'resume' });
            } else {
                this.currentValue = settings.startValue;
                await chrome.tabs.sendMessage(this.currentTab.id, {
                    action: 'start',
                    settings,
                });
            }

            this.isRunning = true;
            this.isPaused = false;
            this.updateUI();
        } catch (error) {
            this.showTargetInfo(`Error: ${error.message}`, 'error');
        }
    }

    async pause() {
        if (!this.currentTab) return;

        try {
            await chrome.tabs.sendMessage(this.currentTab.id, { action: 'pause' });
            this.isRunning = false;
            this.isPaused = true;
            this.updateUI();
        } catch (error) {
            this.showTargetInfo(`Error pausing: ${error.message}`, 'error');
        }
    }

    async stop() {
        if (!this.currentTab) return;

        try {
            await chrome.tabs.sendMessage(this.currentTab.id, { action: 'stop' });
            this.isRunning = false;
            this.isPaused = false;
            this.currentValue = parseInt(this.elements.startValue.value) || 1;
            this.updateUI();
        } catch (error) {
            this.showTargetInfo(`Error stopping: ${error.message}`, 'error');
        }
    }

    // ========================================================================
    // UI Updates
    // ========================================================================

    updateCurrentValueDisplay() {
        this.elements.currentValue.textContent = this.currentValue;
    }

    updateUI() {
        this.elements.startBtn.disabled = this.isRunning;
        this.elements.pauseBtn.disabled = !this.isRunning;
        this.elements.stopBtn.disabled = !this.isRunning && !this.isPaused;

        if (this.isPaused) {
            this.elements.startBtn.textContent = 'Resume';
            this.elements.startBtn.disabled = false;
        } else {
            this.elements.startBtn.textContent = 'Start';
        }

        if (this.isRunning) {
            this.elements.statusText.textContent = `Running (${this.elements.interval.value}s interval)`;
            this.elements.statusDisplay.classList.add('running');
        } else if (this.isPaused) {
            this.elements.statusText.textContent = 'Paused';
            this.elements.statusDisplay.classList.remove('running');
        } else {
            this.elements.statusText.textContent = this.targetElement ? 'Ready to start' : 'Select target first';
            this.elements.statusDisplay.classList.remove('running');
        }

        this.elements.startValue.disabled = this.isRunning;
        this.elements.increment.disabled = this.isRunning;
        this.elements.interval.disabled = this.isRunning;

        this.updateCurrentValueDisplay();
    }

    // ========================================================================
    // State Persistence
    // ========================================================================

    saveState() {
        const state = {
            startValue: this.elements.startValue.value,
            increment: this.elements.increment.value,
            interval: this.elements.interval.value,
            autoSubmit: this.elements.autoSubmit.checked,
            currentValue: this.currentValue,
            hasTarget: !!this.targetElement,
        };
        chrome.storage.local.set({ autoIncrementState: state });
    }

    async loadState() {
        try {
            const result = await chrome.storage.local.get('autoIncrementState');
            const state = result.autoIncrementState;
            if (!state) return;

            this.elements.startValue.value = state.startValue || 1;
            this.elements.increment.value = state.increment || 1;
            this.elements.interval.value = state.interval || 1;
            this.elements.autoSubmit.checked = state.autoSubmit !== false;
            this.currentValue = state.currentValue || 1;
            this.targetElement = state.hasTarget;

            this.updateCurrentValueDisplay();
        } catch (error) {
            console.error(`${LOG_PREFIX} Error loading state:`, error);
        }
    }
}

// Initialize when popup opens
document.addEventListener('DOMContentLoaded', () => {
    window.autoIncrementPopup = new AutoIncrementPopup();
});
