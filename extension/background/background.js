// ===== BACKGROUND SERVICE WORKER =====
// Bridges popup <-> content script communication

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Forward messages from popup to content script on active Hotstar tab
    if (message.target === 'content') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, message, sendResponse);
            }
        });
        return true; // async response
    }

    // Forward messages from content script to popup
    if (message.target === 'popup') {
        chrome.runtime.sendMessage(message);
    }
});

// Listen for tab updates to re-inject if needed
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
        if (tab.url.includes('hotstar.com') || tab.url.includes('jiohotstar.com')) {
            // Notify popup that we're on hotstar
            chrome.runtime.sendMessage({ action: 'on-hotstar', tabId });
        }
    }
});
