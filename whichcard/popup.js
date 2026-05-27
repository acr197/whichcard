// WhichCard - Popup Script
// Card manager: renders cards, reads settings, handles CVV and notes

const api = typeof browser !== 'undefined' ? browser : chrome;

// ─── Color palette ──────────────────────────────────────────────────────────
const COLORS = [
  '#3D7575', '#3A7A4A', '#3060A0', '#9B3A3A',
  '#A07A20', '#6B4C9A', '#2C5858', '#5E5E5E',
];

function colorToTint(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},0.06)`;
}

// ─── Network config ──────────────────────────────────────────────────────────
const NETWORKS = ['visa', 'mastercard', 'amex', 'discover', 'bank'];
const NETWORK_LABELS = {
  visa: 'Visa', mastercard: 'Mastercard', amex: 'Amex',
  discover: 'Discover', bank: 'Bank Account', '': 'None',
};

// All SVGs use viewBox="0 0 64 40" for crisp rendering, displayed at given width/height (ratio 1.6:1)
function makeSVG(inner, w, h) {
  return `<svg viewBox="0 0 64 40" width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}
const SVG_DEFS = {
  visa:       `<rect width="64" height="40" rx="5" fill="#1A1F71"/><text x="32" y="26" text-anchor="middle" fill="#fff" font-size="15" font-weight="bold" font-family="Arial,Helvetica,sans-serif" letter-spacing="1">VISA</text>`,
  mastercard: `<rect width="64" height="40" rx="5" fill="#1A1A1A"/><circle cx="24" cy="20" r="12" fill="#EB001B"/><circle cx="40" cy="20" r="12" fill="#F79E1B"/><path d="M32 10.5a12 12 0 0 1 0 19 12 12 0 0 1 0-19z" fill="#FF5F00"/>`,
  amex:       `<rect width="64" height="40" rx="5" fill="#2E77BC"/><text x="32" y="26" text-anchor="middle" fill="#fff" font-size="13" font-weight="bold" font-family="Arial,Helvetica,sans-serif" letter-spacing="1">AMEX</text>`,
  discover:   `<rect width="64" height="40" rx="5" fill="#fff" stroke="#ddd" stroke-width="1"/><circle cx="42" cy="20" r="14" fill="#F76F20"/>`,
  bank:       `<rect width="64" height="40" rx="5" fill="#5E5E5E"/><polygon points="32,6 54,18 10,18" fill="#fff"/><rect x="14" y="20" width="7" height="11" rx="1" fill="#fff"/><rect x="28.5" y="20" width="7" height="11" rx="1" fill="#fff"/><rect x="43" y="20" width="7" height="11" rx="1" fill="#fff"/><rect x="10" y="33" width="44" height="3" rx="1" fill="#fff"/>`,
};
const SVG_NONE = `<rect width="64" height="40" rx="5" fill="#E0E2E0"/><text x="32" y="26" text-anchor="middle" fill="#5E5E5E" font-size="12" font-weight="bold" font-family="Arial,Helvetica,sans-serif">CARD</text>`;

// Generate SVG at a given size
function networkSVG(net, w, h) {
  return makeSVG(net && SVG_DEFS[net] ? SVG_DEFS[net] : SVG_NONE, w, h);
}

// ─── Hashing ─────────────────────────────────────────────────────────────────
async function hashDigits(digits) {
  const data = new TextEncoder().encode(digits);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// ─── Storage ─────────────────────────────────────────────────────────────────
async function getCards() {
  return new Promise(r => api.storage.sync.get('cards', res => r(res.cards || {})));
}
async function getCardOrder() {
  return new Promise(r => api.storage.sync.get('cardOrder', res => r(res.cardOrder || [])));
}
async function getSettings() {
  return new Promise(r => api.storage.sync.get('settings', res => {
    r({
      darkMode:     true,
      allow5Digit:  false,
      enableCVV:    false,
      enableNotes:  false,
      notesDisplay: 'inline',
      ...(res.settings || {})
    });
  }));
}
async function setCards(cards)     { return new Promise(r => api.storage.sync.set({ cards }, r)); }
async function setCardOrder(order) { return new Promise(r => api.storage.sync.set({ cardOrder: order }, r)); }

// Notes-expanded state — stored in local (not sync) so it survives popup close/reopen
// within the same browser session without eating into sync quota.
async function getNotesExpanded() {
  return new Promise(r => api.storage.local.get('notesExpanded', res =>
    r(new Set(res.notesExpanded || []))
  ));
}
async function setNotesExpanded(set) {
  return new Promise(r => api.storage.local.set({ notesExpanded: [...set] }, r));
}

async function getOrderedHashes(cards) {
  const order = await getCardOrder();
  const all   = Object.keys(cards);
  return [...order.filter(h => all.includes(h)), ...all.filter(h => !order.includes(h))];
}

// ─── Picker helpers ───────────────────────────────────────────────────────────
function closeAllPickers() {
  document.querySelectorAll('.color-picker.visible').forEach(p => p.classList.remove('visible'));
  document.querySelectorAll('.net-picker-popup, .add-net-picker').forEach(p => p.remove());
}

// Position a picker (already appended to body) so it fits in the viewport
function positionPicker(picker, anchorRect, preferDown = true) {
  const ph = picker.offsetHeight || 240;
  const pw = picker.offsetWidth  || 168;
  const vh = window.innerHeight;
  const vw = window.innerWidth;

  let top, left;

  if (preferDown && anchorRect.bottom + 4 + ph <= vh - 4) {
    top = anchorRect.bottom + 4;
  } else {
    // Open upward
    top = Math.max(4, anchorRect.top - ph - 4);
  }

  left = Math.max(4, Math.min(anchorRect.left, vw - pw - 4));
  picker.style.top  = top  + 'px';
  picker.style.left = left + 'px';
}

// ─── Network picker (for existing cards) ─────────────────────────────────────
function showNetworkPicker(anchor, hash, card) {
  closeAllPickers();

  const picker = document.createElement('div');
  picker.className = 'net-picker-popup';
  picker.style.visibility = 'hidden';
  picker.style.position = 'fixed';

  const options = ['', ...NETWORKS];
  for (const net of options) {
    const opt  = document.createElement('div');
    opt.className = 'net-option' + (net === (card.network || '') ? ' selected' : '');

    const icon  = document.createElement('span');
    icon.className = 'net-option-icon';
    icon.innerHTML = networkSVG(net, 32, 20);

    const lbl = document.createElement('span');
    lbl.className = 'net-option-label';
    lbl.textContent = NETWORK_LABELS[net];

    opt.appendChild(icon);
    opt.appendChild(lbl);
    opt.addEventListener('click', async e => {
      e.stopPropagation();
      await updateCardField(hash, 'network', net);
      picker.remove();
      renderCards();
    });
    picker.appendChild(opt);
  }

  document.body.appendChild(picker);
  // Measure then position
  const r = anchor.getBoundingClientRect();
  positionPicker(picker, r, true);
  picker.style.visibility = 'visible';

  setTimeout(() => {
    document.addEventListener('click', function h(e) {
      if (!picker.contains(e.target)) { picker.remove(); document.removeEventListener('click', h); }
    });
  }, 10);
}

// ─── Color picker ─────────────────────────────────────────────────────────────
function createColorPicker(hash, currentColor) {
  const picker = document.createElement('div');
  picker.className = 'color-picker';
  for (const color of COLORS) {
    const sw = document.createElement('div');
    sw.className = 'color-swatch' + (color === currentColor ? ' selected' : '');
    sw.style.backgroundColor = color;
    sw.addEventListener('click', async e => {
      e.stopPropagation();
      await updateCardField(hash, 'color', color);
      picker.classList.remove('visible');
      renderCards();
    });
    picker.appendChild(sw);
  }
  return picker;
}

// ─── Card field update ────────────────────────────────────────────────────────
async function updateCardField(hash, field, value) {
  const cards = await getCards();
  if (!cards[hash]) return;
  cards[hash][field] = value;
  await setCards(cards);
}

// ─── Delete card ──────────────────────────────────────────────────────────────
async function deleteCard(hash) {
  const cards = await getCards();
  delete cards[hash];
  await setCards(cards);
  await setCardOrder((await getCardOrder()).filter(h => h !== hash));
  renderCards();
}

// ─── CVV section ─────────────────────────────────────────────────────────────
function createCVVSection(hash, card) {
  const wrap = document.createElement('div');
  wrap.className = 'cvv-section';

  const cvvInput = document.createElement('input');
  cvvInput.type = 'password';
  cvvInput.className = 'cvv-input';
  cvvInput.maxLength = 4;
  cvvInput.placeholder = 'CVV';
  cvvInput.value = card.cvv || '';
  cvvInput.inputMode = 'numeric';
  cvvInput.title = 'CVV stored locally';

  // Toggle visibility
  const eyeBtn = document.createElement('button');
  eyeBtn.className = 'cvv-eye';
  eyeBtn.innerHTML = '&#x1F441;';
  eyeBtn.title = 'Show/hide CVV';
  eyeBtn.addEventListener('click', e => {
    e.stopPropagation();
    cvvInput.type = cvvInput.type === 'password' ? 'text' : 'password';
  });

  let cvvDebounce;
  cvvInput.addEventListener('input', () => {
    cvvInput.value = cvvInput.value.replace(/\D/g, '');
    clearTimeout(cvvDebounce);
    cvvDebounce = setTimeout(() => updateCardField(hash, 'cvv', cvvInput.value.trim()), 400);
  });

  wrap.appendChild(cvvInput);
  wrap.appendChild(eyeBtn);
  return wrap;
}

// ─── Notes section ────────────────────────────────────────────────────────────
// Never rebuilds DOM during typing — avoids cursor loss.
// Slots are added incrementally: one empty slot always available up to MAX_NOTES.
const MAX_NOTES = 3;

function createNotesSection(hash, card) {
  const wrap  = document.createElement('div');
  wrap.className = 'notes-section';

  const notes = Array.isArray(card.notes) ? [...card.notes] : [];

  const PLACEHOLDERS = ['e.g. 3x Online Purchases', 'e.g. 5x Travel', 'Another note'];

  function saveNotes() {
    const trimmed = [...notes];
    while (trimmed.length > 0 && trimmed[trimmed.length - 1] === '') trimmed.pop();
    updateCardField(hash, 'notes', trimmed);
  }

  function addRow(idx, val) {
    const row   = document.createElement('div');
    row.className = 'note-row';

    const input = document.createElement('input');
    input.type        = 'text';
    input.className   = 'note-input';
    input.placeholder = PLACEHOLDERS[idx] || 'Note';
    input.value       = val || '';
    input.maxLength   = 60;

    let nd;
    input.addEventListener('input', () => {
      notes[idx] = input.value;
      clearTimeout(nd);
      nd = setTimeout(() => {
        saveNotes();
        // Append a new empty slot if this was the last slot and is now non-empty
        const rowCount = wrap.querySelectorAll('.note-row').length;
        if (input.value !== '' && idx === rowCount - 1 && rowCount < MAX_NOTES) {
          notes.push('');
          addRow(rowCount, '');
        }
      }, 400);
    });
    // Immediate save on blur so closing popup never loses a pending edit
    input.addEventListener('blur', () => { clearTimeout(nd); saveNotes(); });

    row.appendChild(input);
    wrap.appendChild(row);
  }

  // Initial slots — existing notes + one empty if room
  const initial = [...notes];
  if (initial.length < MAX_NOTES && (initial.length === 0 || initial[initial.length - 1] !== '')) {
    initial.push('');
  }
  initial.forEach((v, i) => addRow(i, v));

  return wrap;
}

// ─── Single card item ─────────────────────────────────────────────────────────
function createCardItem(hash, card, settings, expanded) {
  const color = card.color || '#3D7575';
  const item  = document.createElement('div');
  item.className  = 'card-item';
  item.dataset.hash = hash;
  item.style.backgroundColor = colorToTint(color);
  item.draggable  = true;

  // Drag
  item.addEventListener('dragstart', e => {
    item.classList.add('dragging');
    e.dataTransfer.setData('text/plain', hash);
    e.dataTransfer.effectAllowed = 'move';
  });
  item.addEventListener('dragend', () => {
    item.classList.remove('dragging');
    document.querySelectorAll('.card-item.drag-over').forEach(el => el.classList.remove('drag-over'));
  });
  item.addEventListener('dragover', e => {
    e.preventDefault();
    const dh = document.querySelector('.card-item.dragging')?.dataset.hash;
    if (dh && dh !== hash) item.classList.add('drag-over');
  });
  item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
  item.addEventListener('drop', async e => {
    e.preventDefault();
    item.classList.remove('drag-over');
    const dh = e.dataTransfer.getData('text/plain');
    if (!dh || dh === hash) return;
    const cards = await getCards();
    const order = await getOrderedHashes(cards);
    const fi = order.indexOf(dh), ti = order.indexOf(hash);
    if (fi === -1 || ti === -1) return;
    order.splice(fi, 1); order.splice(ti, 0, dh);
    await setCardOrder(order); renderCards();
  });

  // Drag handle
  const handle = document.createElement('div');
  handle.className = 'card-drag-handle';
  handle.innerHTML = '&#x2261;';

  // Color dot
  const colorWrap = document.createElement('div');
  colorWrap.className = 'color-wrap';
  const colorDot = document.createElement('div');
  colorDot.className = 'card-color';
  colorDot.style.backgroundColor = color;
  const picker = createColorPicker(hash, color);
  colorWrap.appendChild(colorDot);
  colorWrap.appendChild(picker);
  colorDot.addEventListener('click', e => {
    e.stopPropagation();
    closeAllPickers();
    picker.classList.toggle('visible');
  });

  // Card info
  const info = document.createElement('div');
  info.className = 'card-info';

  // Top row: network icon + nickname + (CVV if enabled)
  const topRow = document.createElement('div');
  topRow.className = 'card-top-row';

  const netBtn = document.createElement('span');
  netBtn.className = 'card-network-btn';
  netBtn.innerHTML = networkSVG(card.network, 32, 20);
  netBtn.title = 'Change card type';
  netBtn.addEventListener('click', e => { e.stopPropagation(); closeAllPickers(); showNetworkPicker(netBtn, hash, card); });

  const nickInput = document.createElement('input');
  nickInput.type = 'text';
  nickInput.className = 'card-nickname';
  nickInput.value = card.nickname || '';
  nickInput.placeholder = 'Enter nickname';
  let nd;
  nickInput.addEventListener('input', () => { clearTimeout(nd); nd = setTimeout(() => updateCardField(hash, 'nickname', nickInput.value.trim()), 400); });

  topRow.appendChild(netBtn);
  topRow.appendChild(nickInput);

  // Bottom row: digits + reward note
  const bottomRow = document.createElement('div');
  bottomRow.className = 'card-bottom-row';

  const digits = document.createElement('span');
  digits.className = 'card-digits';
  const d = card.lastDigits || card.lastFour || '';
  digits.textContent = d ? `••${d}` : '••••';

  const rewardInput = document.createElement('input');
  rewardInput.type = 'text';
  rewardInput.className = 'card-reward';
  rewardInput.value = card.reward || '';
  rewardInput.placeholder = 'Note';
  let rd;
  // Debounce on input, immediate save on blur so closing popup never loses a change
  rewardInput.addEventListener('input', () => { clearTimeout(rd); rd = setTimeout(() => updateCardField(hash, 'reward', rewardInput.value.trim()), 400); });
  rewardInput.addEventListener('blur', () => { clearTimeout(rd); updateCardField(hash, 'reward', rewardInput.value.trim()); });

  bottomRow.appendChild(digits);
  bottomRow.appendChild(rewardInput);

  info.appendChild(topRow);
  info.appendChild(bottomRow);

  // Right column: CVV (top) + Notes button (bottom), stacked and right-aligned
  const rightCol = document.createElement('div');
  rightCol.className = 'card-right-col';

  if (settings.enableCVV) {
    rightCol.appendChild(createCVVSection(hash, card));
  }

  if (settings.enableNotes) {
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'notes-toggle-btn';
    toggleBtn.textContent = (card.notes && card.notes.length) ? `Notes (${card.notes.length})` : 'Notes';

    if (settings.notesDisplay === 'onclick') {
      // Popup mode: clicking opens a floating overlay; notes never appear inline
      toggleBtn.addEventListener('click', e => {
        e.stopPropagation();
        // If a popup for this card is already open, close it
        const existing = document.querySelector('.notes-popup[data-hash="' + hash + '"]');
        if (existing) { existing.remove(); toggleBtn.classList.remove('active'); return; }
        // Close any other open notes popups
        document.querySelectorAll('.notes-popup').forEach(p => p.remove());
        document.querySelectorAll('.notes-toggle-btn.active').forEach(b => b.classList.remove('active'));

        const popup = document.createElement('div');
        popup.className = 'notes-popup';
        popup.dataset.hash = hash;
        popup.style.visibility = 'hidden';
        popup.appendChild(createNotesSection(hash, card));
        document.body.appendChild(popup);

        const rect = toggleBtn.getBoundingClientRect();
        positionPicker(popup, rect, false);
        popup.style.visibility = 'visible';
        toggleBtn.classList.add('active');

        setTimeout(() => {
          document.addEventListener('click', function h(e) {
            if (!popup.contains(e.target)) {
              popup.remove();
              toggleBtn.classList.remove('active');
              document.removeEventListener('click', h);
            }
          });
        }, 10);
      });

    } else {
      // Inline mode: clicking expands/collapses notes within the card row
      let notesOpen = expanded ? expanded.has(hash) : false;
      let notesEl   = null;

      // Restore expanded state immediately on render
      if (notesOpen) {
        toggleBtn.classList.add('active');
        notesEl = createNotesSection(hash, card);
        info.appendChild(notesEl);
      }

      toggleBtn.addEventListener('click', async e => {
        e.stopPropagation();
        notesOpen = !notesOpen;
        toggleBtn.classList.toggle('active', notesOpen);
        const set = await getNotesExpanded();
        if (notesOpen) {
          set.add(hash);
          if (!notesEl) notesEl = createNotesSection(hash, card);
          info.appendChild(notesEl);
        } else {
          set.delete(hash);
          if (notesEl) { notesEl.remove(); notesEl = null; }
        }
        await setNotesExpanded(set);
      });
    }

    rightCol.appendChild(toggleBtn);
  }

  // Delete button
  const delBtn = document.createElement('button');
  delBtn.className = 'card-delete';
  delBtn.innerHTML = '&times;';
  delBtn.title = 'Remove card';
  delBtn.addEventListener('click', () => deleteCard(hash));

  item.appendChild(handle);
  item.appendChild(colorWrap);
  item.appendChild(info);
  item.appendChild(rightCol);
  item.appendChild(delBtn);
  return item;
}

// ─── Render card list ─────────────────────────────────────────────────────────
async function renderCards() {
  const [cards, settings, expanded] = await Promise.all([getCards(), getSettings(), getNotesExpanded()]);
  const list  = document.getElementById('cardList');
  const empty = document.getElementById('emptyState');

  list.innerHTML = '';
  const hashes = await getOrderedHashes(cards);

  if (hashes.length === 0) {
    empty.classList.remove('hidden');
    updateDigitsMax(settings);
    return;
  }
  empty.classList.add('hidden');
  for (const hash of hashes) {
    list.appendChild(createCardItem(hash, cards[hash], settings, expanded));
  }
  updateDigitsMax(settings);
}

// ─── Add card ─────────────────────────────────────────────────────────────────
async function addCard(digits, nickname, network) {
  const hash  = await hashDigits(digits);
  const cards = await getCards();
  cards[hash] = { nickname, color: '#3D7575', network: network || '', reward: '', lastDigits: digits };
  await setCards(cards);
  const order = await getCardOrder();
  order.push(hash);
  await setCardOrder(order);
  renderCards();
}

// ─── Add-card network picker ──────────────────────────────────────────────────
let addNet = '';

function showAddNetPicker(anchor) {
  closeAllPickers();
  const picker = document.createElement('div');
  picker.className = 'add-net-picker';
  picker.style.visibility = 'hidden';
  picker.style.position = 'fixed';

  const options = ['', ...NETWORKS];
  for (const net of options) {
    const opt = document.createElement('div');
    opt.className = 'net-option' + (net === addNet ? ' selected' : '');

    const icon = document.createElement('span');
    icon.className = 'net-option-icon';
    icon.innerHTML = networkSVG(net, 32, 20);

    const lbl = document.createElement('span');
    lbl.className = 'net-option-label';
    lbl.textContent = NETWORK_LABELS[net];

    opt.appendChild(icon);
    opt.appendChild(lbl);
    opt.addEventListener('click', e => {
      e.stopPropagation();
      addNet = net;
      refreshAddNetBtn();
      picker.remove();
      document.getElementById('newDigits').focus();
    });
    picker.appendChild(opt);
  }

  document.body.appendChild(picker);
  const r = anchor.getBoundingClientRect();
  // Add card row is at the bottom, so open upward
  positionPicker(picker, r, false);
  picker.style.visibility = 'visible';

  setTimeout(() => {
    document.addEventListener('click', function h(e) {
      if (!picker.contains(e.target)) { picker.remove(); document.removeEventListener('click', h); }
    });
  }, 10);
}

function refreshAddNetBtn() {
  const btn      = document.getElementById('addNetworkBtn');
  btn.innerHTML  = networkSVG(addNet, 32, 20);

  const digInput = document.getElementById('newDigits');
  getSettings().then(settings => {
    const is5 = settings.allow5Digit || addNet === 'amex';
    digInput.maxLength = is5 ? 5 : 4;
  });
}

function updateDigitsMax(settings) {
  const digInput = document.getElementById('newDigits');
  if (!digInput) return;
  const is5 = settings.allow5Digit || addNet === 'amex';
  digInput.maxLength = is5 ? 5 : 4;
}

// ─── PIN lock helpers ─────────────────────────────────────────────────────────

// Check whether the given daily lock time (HH:MM in tz) has passed since lastUnlocked
function isDailyLockExpired(now, lastUnlocked, dailyTime, tz) {
  try {
    const [hh, mm] = (dailyTime || '00:00').split(':').map(Number);
    // Convert 'now' to a local Date in the target timezone using offset trick
    const nowDate  = new Date(now);
    const tzLocal  = new Date(nowDate.toLocaleString('en-US', { timeZone: tz || 'UTC' }));
    const offset   = nowDate.getTime() - tzLocal.getTime(); // UTC - localTZ

    // Build today's lock timestamp: same date as tzLocal, at hh:mm
    const lockLocal = new Date(tzLocal.getFullYear(), tzLocal.getMonth(), tzLocal.getDate(), hh, mm, 0);
    let lockUTC = lockLocal.getTime() + offset;

    // If that lock time is in the future, use yesterday's occurrence
    if (lockUTC > now) lockUTC -= 86400000;

    return lastUnlocked < lockUTC;
  } catch {
    return true; // If anything fails, default to locked
  }
}

// Returns true if the popup should show the lock screen
async function isLocked(settings) {
  if (!settings.enablePin) return false;
  const local = await new Promise(r => api.storage.local.get(['pin', 'lastUnlocked'], r));
  if (!local.pin) return false; // PIN never configured

  const timeout = settings.pinTimeout || 'everytime';
  if (timeout === 'everytime') return true;

  const lastUnlocked = local.lastUnlocked || 0;
  const now = Date.now();

  if (timeout === 'daily') {
    return isDailyLockExpired(now, lastUnlocked, settings.pinDailyTime || '00:00', settings.pinDailyTZ || 'UTC');
  }

  const MS = { '30s': 30e3, '1m': 60e3, '2m': 120e3, '5m': 300e3, '30m': 1800e3, '1h': 3600e3 };
  return (now - lastUnlocked) > (MS[timeout] || 0);
}

// Show lock screen and wait for correct PIN before calling callback
function showLockScreen(onUnlock) {
  const screen = document.getElementById('lockScreen');
  // Hide everything else while locked
  document.querySelectorAll('body > *:not(#lockScreen)').forEach(el => el.classList.add('hidden'));
  screen.classList.remove('hidden');

  const pinEntry = document.getElementById('pinEntry');
  const pinError = document.getElementById('pinError');
  setTimeout(() => pinEntry.focus(), 50);

  async function tryUnlock() {
    const local = await new Promise(r => api.storage.local.get('pin', r));
    if (pinEntry.value === (local.pin || '')) {
      await new Promise(r => api.storage.local.set({ lastUnlocked: Date.now() }, r));
      screen.classList.add('hidden');
      document.querySelectorAll('body > *:not(#lockScreen)').forEach(el => el.classList.remove('hidden'));
      onUnlock();
    } else {
      pinError.classList.remove('hidden');
      pinEntry.value = '';
      pinEntry.style.borderColor = 'var(--danger)';
      setTimeout(() => { pinError.classList.add('hidden'); pinEntry.style.borderColor = ''; }, 2000);
      pinEntry.focus();
    }
  }

  document.getElementById('pinSubmit').addEventListener('click', tryUnlock);
  pinEntry.addEventListener('keydown', e => { if (e.key === 'Enter') tryUnlock(); });
  // Auto-unlock the moment the input matches the stored PIN — no button click needed
  pinEntry.addEventListener('input', async () => {
    if (pinEntry.value.length < 4) return;
    const local = await new Promise(r => api.storage.local.get('pin', r));
    if (pinEntry.value === (local.pin || '')) tryUnlock();
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Apply theme before anything renders to avoid flash
  const initSettings = await getSettings();
  document.documentElement.setAttribute('data-theme', initSettings.darkMode !== false ? 'dark' : 'light');

  // Show lock screen if PIN is active; proceed to initMain on successful unlock
  if (await isLocked(initSettings)) {
    showLockScreen(initMain);
    return;
  }

  initMain();
});

function initMain() {
  renderCards();
  refreshAddNetBtn();

  const digitsInput = document.getElementById('newDigits');
  const nameInput   = document.getElementById('newName');

  document.getElementById('addNetworkBtn').addEventListener('click', e => {
    e.stopPropagation();
    showAddNetPicker(document.getElementById('addNetworkBtn'));
  });

  digitsInput.addEventListener('input', () => {
    digitsInput.value = digitsInput.value.replace(/\D/g, '');
  });

  function tryAdd() {
    const digits = digitsInput.value.trim();
    const name   = nameInput.value.trim();
    if (/^\d{4,5}$/.test(digits) && name) {
      addCard(digits, name, addNet);
      digitsInput.value = ''; nameInput.value = '';
      addNet = ''; refreshAddNetBtn();
      digitsInput.focus();
    }
  }

  nameInput.addEventListener('keydown',   e => { if (e.key === 'Enter') tryAdd(); });
  digitsInput.addEventListener('keydown', e => { if (e.key === 'Enter' && digitsInput.value.length >= 4) nameInput.focus(); });

  document.getElementById('refreshBtn').addEventListener('click', () => {
    api.tabs.query({ active: true, currentWindow: true }, tabs => { if (tabs[0]) api.tabs.reload(tabs[0].id); });
  });
  document.getElementById('settingsBtn').addEventListener('click', () => {
    api.runtime.openOptionsPage();
  });

  document.body.addEventListener('click', closeAllPickers);
}
