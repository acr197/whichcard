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

// Read the open-in preference, migrating the legacy openAsSidebar boolean
async function getOpenIn() {
  return new Promise(r => api.storage.sync.get('settings', res => {
    const s = res.settings || {};
    if (s.openIn !== undefined) return r(s.openIn);
    return r(s.openAsSidebar ? 'sidebar' : 'popup');
  }));
}

// Apply the open-in preference
// Set the panel behavior first (guarded for Firefox, where sidePanel does not exist),
// then set the popup unconditionally. The side panel opens on action click only when the
// popup is cleared, so clear it for sidebar and restore it for popup.
async function applyOpenIn(openIn) {
  const useSidebar = openIn === 'sidebar';
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    try {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: useSidebar });
    } catch (err) {
      console.warn('WhichCard: setPanelBehavior failed', err);
    }
  }
  chrome.action.setPopup({ popup: useSidebar ? '' : 'popup.html' });
}

// Apply on install and startup
chrome.runtime.onInstalled.addListener(async () => {
  await applyOpenIn(await getOpenIn());
});

chrome.runtime.onStartup.addListener(async () => {
  await applyOpenIn(await getOpenIn());
});

// React to live setting changes from the options page
api.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'sync' || !changes.settings) return;
  const s = changes.settings.newValue || {};
  const openIn = s.openIn !== undefined ? s.openIn : (s.openAsSidebar ? 'sidebar' : 'popup');
  await applyOpenIn(openIn);
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

      case 'setOpenIn':
        await applyOpenIn(message.openIn);
        return { ok: true };

      default:
        return { error: 'Unknown action' };
    }
  };

  handler().then(sendResponse).catch(err => sendResponse({ error: err.message }));
  return true;
});
