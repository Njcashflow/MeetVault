// MeetVault Background Service Worker (Manifest V3)

chrome.runtime.onInstalled.addListener(() => {
  console.log('[MeetVault] Service worker initialized successfully.');
});

// Listener for background messaging if needed
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'GET_STATUS') {
    sendResponse({ active: true, timestamp: Date.now() });
  }
  return true;
});
