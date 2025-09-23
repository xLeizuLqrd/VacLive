chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "analyse-selection",
    title: "Анализировать выделенный текст",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "analyse-selection" && info.selectionText) {
    // Сохраняем выделенный текст в chrome.storage
    chrome.storage.local.set({ analysedText: info.selectionText }, () => {
      // Можно опционально открыть popup
      chrome.action.openPopup();
    });
  }
});
