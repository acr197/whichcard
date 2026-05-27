// Service worker for WhichCard
// Handles messaging and sidebar/popup mode switching via setPanelBehavior

const api = typeof browser !== 'undefined' ? browser : chrome;

// Get all stored cards
async function getCards() {
  const result = await api.storage.sync.get('cards');
  return result.cards || {};
}

// Save a single card entry
async function saveCard(hash, cardData) {
  const cards = await getCards();
  cards[hash] = cardData;
  await api.storage.sync.set({ cards });
  return cards;
}

// Delete a card by hash
async function deleteCard(hash) {
  const cards = await getCards();
  delete cards[hash];
  await api.storage.sync.set({ cards });
  return cards;
}

// SHA-256 hash of digit string
async function hashLastFour(digits) {
  const data = new TextEncoder().encode(digits);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Import cards from JSON — merges into existing
async function importCards(importData) {
  const existing = await getCards();
  const merged = { ...existing, ...importData };
  await api.storage.sync.set({ cards: merged });
  return merged;
}

// Read settings with defaults
async function getSettings() {
  return new Promise(r => api.storage.sync.get('settings', res => {
    r({ openAsSidebar: false, ...(res.settings || {}) });
  }));
}

// Apply sidebar preference
// Chrome requires BOTH clearing the popup and setPanelBehavior for the side panel to
// open on action click. When openAsSidebar is off, restore the popup.
async function applySidebarMode(openAsSidebar) {
  try {
    if (openAsSidebar) {
      // Clear popup so onClicked fires, then tell Chrome to open the panel
      await chrome.action.setPopup({ popup: '' });
      if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
        await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
      }
    } else {
      await chrome.action.setPopup({ popup: 'popup.html' });
      if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
        await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
      }
    }
  } catch (err) {
    console.warn('WhichCard: applySidebarMode failed', err);
  }
}

// Apply on install and startup
chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  await applySidebarMode(settings.openAsSidebar);
});

chrome.runtime.onStartup.addListener(async () => {
  const settings = await getSettings();
  await applySidebarMode(settings.openAsSidebar);
});

// React to live setting changes from the options page
api.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'sync' || !changes.settings) return;
  const newSettings = changes.settings.newValue || {};
  if ('openAsSidebar' in newSettings) {
    await applySidebarMode(newSettings.openAsSidebar);
  }
});

// Message handler
api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = async () => {
    switch (message.action) {
      case 'getCards':
        return await getCards();

      case 'saveCard': {
        const hash = await hashLastFour(message.lastFour);
        return await saveCard(hash, message.cardData);
      }

      case 'deleteCard':
        return await deleteCard(message.hash);

      case 'hashLastFour':
        return await hashLastFour(message.lastFour);

      case 'importCards':
        return await importCards(message.cards);

      case 'exportCards':
        return await getCards();

      default:
        return { error: 'Unknown action' };
    }
  };

  handler().then(sendResponse).catch(err => sendResponse({ error: err.message }));
  return true;
});
