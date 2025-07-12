// MessengerGuard Content Script - Trimmed and Optimized Version

class MessengerGuardWithBlur {
    constructor() {
        this.processedMessages = new Set();
        this.blurredChats = new Map();
        this.observer = null;
        this.styleSheet = null;
        this.pendingStorageUpdate = false;
        
        this.init();
    }
    
    async init() {
        // Load saved data
        const result = await chrome.storage.local.get(['processedMessageIds', 'blurredChats']);
        if (result.processedMessageIds) {
            this.processedMessages = new Set(result.processedMessageIds);
        }
        if (result.blurredChats) {
            this.blurredChats = new Map(result.blurredChats);
        }
        
        this.createBlurStyles();
        
        if (document.body) {
            this.startMonitoring();
        } else {
            document.addEventListener('DOMContentLoaded', () => this.startMonitoring());
        }
        
        // Batch storage updates every 30 seconds
        setInterval(() => this.batchSaveToStorage(), 30000);
        
        // Less frequent blur reapplication
        setInterval(() => this.reapplyBlurStates(), 2000);
    }
    
    createBlurStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .messenger-guard-blurred {
                filter: blur(10px) !important;
                user-select: none !important;
                pointer-events: none !important;
            }
            .messenger-guard-sidebar-message-blurred {
                filter: blur(8px) !important;
                user-select: none !important;
            }
            .messenger-guard-sidebar-indicator {
                position: absolute;
                right: 10px;
                top: 50%;
                transform: translateY(-50%);
                width: 8px;
                height: 8px;
                background: #ff4444;
                border-radius: 50%;
                z-index: 10;
            }
        `;
        document.head.appendChild(style);
        this.styleSheet = style;
    }
    
    startMonitoring() {
        if (!document.body) {
            setTimeout(() => this.startMonitoring(), 1000);
            return;
        }
        
        try {
            this.observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                        mutation.addedNodes.forEach((node) => {
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                this.scanForNewMessages(node);
                                this.scanForSidebarMessages(node);
                            }
                        });
                    }
                });
            });
            
            this.observer.observe(document.body, {
                childList: true,
                subtree: true
            });
            
            // Initial scan
            this.scanForNewMessages(document.body);
            this.scanForSidebarMessages(document.body);
            
        } catch (error) {
            console.error('Error setting up MutationObserver:', error);
        }
    }
    
    getChatIdentifier(element) {
        const chatItem = element.closest('a[role="link"]') || 
                        element.closest('div[role="gridcell"]') || 
                        element.closest('[data-testid="mwthreadlist-item"]');
        
        if (!chatItem) return null;
        
        const ariaLabel = chatItem.getAttribute('aria-label');
        const href = chatItem.getAttribute('href');
        
        return ariaLabel || href || 'unknown';
    }
    
    scanForNewMessages(container) {
        // Simplified selectors - keep only the most reliable ones
        const messageSelectors = [
            '[data-testid="message-container"]',
            '[role="gridcell"] div[dir="auto"]'
        ];
        
        messageSelectors.forEach(selector => {
            const elements = container.querySelectorAll ? container.querySelectorAll(selector) : [];
            elements.forEach(element => {
                const text = this.extractText(element);
                if (text && text.length > 0) {
                    const messageId = this.generateMessageId(element, 'main');
                    this.analyzeMessage(text, messageId, element, 'main');
                }
            });
        });
    }
    
    scanForSidebarMessages(container) {
        // Simplified sidebar selectors
        const sidebarMessageSelectors = [
            'a[role="link"] div[style*="webkit-box"] span[dir="auto"]',
            'a[role="link"] div[style*="webkit-line-clamp"] span'
        ];
        
        sidebarMessageSelectors.forEach(selector => {
            const elements = container.querySelectorAll ? container.querySelectorAll(selector) : [];
            elements.forEach(element => {
                if (this.isNameElement(element)) {
                    return;
                }
                
                const text = this.extractText(element);
                if (text && text.length > 0) {
                    const chatId = this.getChatIdentifier(element);
                    const messageId = this.generateMessageId(element, 'sidebar');
                    this.analyzeMessage(text, messageId, element, 'sidebar', chatId);
                }
            });
        });
    }
    
    isNameElement(element) {
        // Simplified name detection - just check font weight
        const style = window.getComputedStyle(element);
        return style.fontWeight === 'bold' || parseInt(style.fontWeight) > 500;
    }
    
    extractText(element) {
        if (!element) return '';
        
        // Simplified text extraction - remove only common unwanted elements
        const clone = element.cloneNode(true);
        const unwantedSelectors = [
            '[data-testid="message-timestamp"]',
            '.timestamp',
            'time'
        ];
        
        unwantedSelectors.forEach(selector => {
            clone.querySelectorAll(selector).forEach(el => el.remove());
        });
        
        return clone.textContent.trim();
    }
    
    generateMessageId(element, context = 'main') {
        const text = this.extractText(element);
        const position = Array.from(element.parentNode?.children || []).indexOf(element);
        
        return `${context}_msg_${text.substring(0, 20).replace(/\s/g, '_')}_${position}_${Date.now()}`;
    }
    
    async analyzeMessage(text, messageId, element, context = 'main', chatId = null) {
        if (!text || text.length < 2) return;
        
        if (this.processedMessages.has(messageId)) {
            return;
        }
        
        try {
            // Mark as processed
            this.processedMessages.add(messageId);
            this.pendingStorageUpdate = true;
            
            // Send to background script
            const result = await this.sendMessageSafely({
                action: 'analyzeMessage',
                text: text,
                messageId: messageId
            });
            
            if (result && result.shouldBlock) {
                if (context === 'sidebar' && chatId) {
                    this.blurredChats.set(chatId, true);
                    this.applyBlur(element, context, result);
                } else {
                    this.applyBlur(element, context, result);
                }
            }
            
        } catch (error) {
            console.error('Error processing message:', error);
        }
    }
    
    async batchSaveToStorage() {
        // Only save if there are pending updates
        if (!this.pendingStorageUpdate) return;
        
        try {
            await chrome.storage.local.set({
                processedMessageIds: Array.from(this.processedMessages),
                blurredChats: Array.from(this.blurredChats.entries())
            });
            this.pendingStorageUpdate = false;
        } catch (error) {
            console.error('Error saving to storage:', error);
        }
    }
    
    applyBlur(element, context = 'main', analysisResult = null) {
        if (!element) return;
        
        if (context === 'sidebar') {
            element.classList.add('messenger-guard-sidebar-message-blurred');
            
            // Add indicator to chat item
            const chatItem = element.closest('a[role="link"]') || 
                            element.closest('div[role="gridcell"]') || 
                            element.closest('[data-testid="mwthreadlist-item"]');
            
            if (chatItem && !chatItem.querySelector('.messenger-guard-sidebar-indicator')) {
                const indicator = document.createElement('div');
                indicator.className = 'messenger-guard-sidebar-indicator';
                chatItem.style.position = 'relative';
                chatItem.appendChild(indicator);
            }
        } else {
            element.classList.add('messenger-guard-blurred');
        }
    }
    
    reapplyBlurStates() {
        this.blurredChats.forEach((isBlurred, chatId) => {
            if (isBlurred) {
                const chatItems = document.querySelectorAll('a[role="link"], div[role="gridcell"]');
                
                chatItems.forEach(chatItem => {
                    const currentChatId = this.getChatIdentifier(chatItem);
                    if (currentChatId === chatId) {
                        const messageElements = chatItem.querySelectorAll('span[dir="auto"]');
                        
                        messageElements.forEach(msgElement => {
                            if (!this.isNameElement(msgElement)) {
                                if (!msgElement.classList.contains('messenger-guard-sidebar-message-blurred')) {
                                    msgElement.classList.add('messenger-guard-sidebar-message-blurred');
                                }
                            }
                        });
                        
                        // Ensure indicator
                        if (!chatItem.querySelector('.messenger-guard-sidebar-indicator')) {
                            const indicator = document.createElement('div');
                            indicator.className = 'messenger-guard-sidebar-indicator';
                            chatItem.style.position = 'relative';
                            chatItem.appendChild(indicator);
                        }
                    }
                });
            }
        });
    }
    
    async sendMessageSafely(message) {
        try {
            if (!this.isExtensionContextValid()) {
                console.warn('Extension context invalid, skipping message send');
                return null;
            }
            
            return await chrome.runtime.sendMessage(message);
        } catch (error) {
            console.error('Error sending message:', error);
            return null;
        }
    }
    
    isExtensionContextValid() {
        return typeof chrome !== 'undefined' && 
               chrome.runtime &&
               typeof chrome.runtime.sendMessage === 'function';
    }
    
    destroy() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        
        if (this.styleSheet && this.styleSheet.parentNode) {
            this.styleSheet.parentNode.removeChild(this.styleSheet);
        }
    }
}

// Initialize when document is ready
function initializeMessengerGuard() {
    if (window.messengerGuard) {
        window.messengerGuard.destroy();
    }
    
    window.messengerGuard = new MessengerGuardWithBlur();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeMessengerGuard);
} else {
    initializeMessengerGuard();
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        initializeMessengerGuard();
    }
});