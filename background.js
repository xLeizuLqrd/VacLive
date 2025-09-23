chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "analyse-selection",
    title: "Анализировать выделенный текст",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "analyse-selection" && info.selectionText) {
    chrome.storage.local.set({ analysedText: info.selectionText }, () => {
      chrome.action.openPopup();
    });
  }
});
