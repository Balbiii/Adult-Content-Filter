// Adult Content Filter — Background Script
browser.runtime.onInstalled.addListener(() => {
  browser.storage.local.set({ filterEnabled: true });
});
