/**
 * YouTube Music Downloader — Background Service Worker
 * Handles communication between popup and content scripts.
 */

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "getTabUrl") {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                sendResponse({ url: tabs[0].url, title: tabs[0].title });
            } else {
                sendResponse({ url: "", title: "" });
            }
        });
        return true; // async response
    }
});
