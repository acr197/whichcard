// WhichCard Options
// Auto-saves on every change. Reads/writes chrome.storage.sync.

const api = typeof browser !== 'undefined' ? browser : chrome;

const DEFAULTS = {
  darkMode:      true,
  openAsSidebar: false,
  allow5Digit:   false,
  enableCVV:     false,
  enableNotes:   false,
  notesDisplay:  'inline',
  enablePin:     false,
  pinTimeout:    'everytime',
  pinDailyTime:  '00:00',
  pinDailyTZ:    '',
};

// Common IANA timezones for the daily lock time picker
const TZ_LIST = [
  { v: 'America/New_York',     l: 'Eastern (ET)' },
  { v: 'America/Chicago',      l: 'Central (CT)' },
  { v: 'America/Denver',       l: 'Mountain (MT)' },
  { v: 'America/Los_Angeles',  l: 'Pacific (PT)' },
  { v: 'America/Anchorage',    l: 'Alaska (AKT)' },
  { v: 'America/Honolulu',     l: 'Hawaii (HST)' },
  { v: 'America/Toronto',      l: 'Toronto (ET)' },
  { v: 'America/Vancouver',    l: 'Vancouver (PT)' },
  { v: 'America/Sao_Paulo',    l: 'São Paulo (BRT)' },
  { v: 'America/Buenos_Aires', l: 'Buenos Aires (ART)' },
  { v: 'Europe/London',        l: 'London (GMT/BST)' },
  { v: 'Europe/Paris',         l: 'Paris (CET)' },
  { v: 'Europe/Berlin',        l: 'Berlin (CET)' },
  { v: 'Europe/Rome',          l: 'Rome (CET)' },
  { v: 'Europe/Madrid',        l: 'Madrid (CET)' },
  { v: 'Europe/Amsterdam',     l: 'Amsterdam (CET)' },
  { v: 'Europe/Helsinki',      l: 'Helsinki (EET)' },
  { v: 'Europe/Athens',        l: 'Athens (EET)' },
  { v: 'Europe/Moscow',        l: 'Moscow (MSK)' },
  { v: 'Europe/Istanbul',      l: 'Istanbul (TRT)' },
  { v: 'Asia/Dubai',           l: 'Dubai (GST)' },
  { v: 'Asia/Karachi',         l: 'Karachi (PKT)' },
  { v: 'Asia/Kolkata',         l: 'India (IST)' },
  { v: 'Asia/Bangkok',         l: 'Bangkok (ICT)' },
  { v: 'Asia/Singapore',       l: 'Singapore (SGT)' },
  { v: 'Asia/Shanghai',        l: 'China (CST)' },
  { v: 'Asia/Tokyo',           l: 'Tokyo (JST)' },
  { v: 'Asia/Seoul',           l: 'Seoul (KST)' },
  { v: 'Asia/Hong_Kong',       l: 'Hong Kong (HKT)' },
  { v: 'Australia/Sydney',     l: 'Sydney (AEST)' },
  { v: 'Australia/Perth',      l: 'Perth (AWST)' },
  { v: 'Pacific/Auckland',     l: 'Auckland (NZST)' },
  { v: 'Africa/Cairo',         l: 'Cairo (EET)' },
  { v: 'Africa/Johannesburg',  l: 'Johannesburg (SAST)' },
  { v: 'Africa/Lagos',         l: 'Lagos (WAT)' },
  { v: 'UTC',                  l: 'UTC' },
];

async function getSettings() {
  return new Promise(r => api.storage.sync.get('settings', res => {
    r({ ...DEFAULTS, ...(res.settings || {}) });
  }));
}

async function saveSettings(settings) {
  return new Promise(r => api.storage.sync.set({ settings }, r));
}

async function getCards() {
  return new Promise(r => api.storage.sync.get('cards', res => r(res.cards || {})));
}

// Apply theme to the page
function applyTheme(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}

// Wire a toggle to auto-save on change
function wireToggle(id, key, settings, onChange) {
  const input = document.getElementById(id);
  if (!input) return;
  input.checked = settings[key];
  input.addEventListener('change', async () => {
    settings[key] = input.checked;
    await saveSettings(settings);
    if (onChange) onChange(input.checked);
  });
}

// Wire radio buttons
function wireRadio(name, key, settings) {
  const radios = document.querySelectorAll(`input[name="${name}"]`);
  radios.forEach(r => {
    r.checked = (r.value === settings[key]);
    r.addEventListener('change', async () => {
      if (r.checked) {
        settings[key] = r.value;
        await saveSettings(settings);
      }
    });
  });
}

// Show/hide notes display sub-option
function setNotesSubVisible(visible) {
  const row = document.getElementById('row-notesDisplay');
  if (!row) return;
  row.classList.toggle('hidden', !visible);
}

// Export cards as JSON
async function exportCards() {
  const cards = await getCards();
  const order = await new Promise(r => api.storage.sync.get('cardOrder', res => r(res.cardOrder || [])));
  const blob = new Blob([JSON.stringify({ cards, cardOrder: order }, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'whichcard-backup.json'; a.click();
  URL.revokeObjectURL(url);
}

// Import cards from JSON
function importCards(file) {
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const data = JSON.parse(e.target.result);
      const imported = data.cards || data;
      const importedOrder = data.cardOrder || [];
      if (typeof imported !== 'object') throw new Error('Invalid format');
      const existing = await getCards();
      await new Promise(r => api.storage.sync.set({ cards: { ...existing, ...imported } }, r));
      if (importedOrder.length) {
        const existingOrder = await new Promise(r => api.storage.sync.get('cardOrder', res => r(res.cardOrder || [])));
        await new Promise(r => api.storage.sync.set({
          cardOrder: [...existingOrder, ...importedOrder.filter(h => !existingOrder.includes(h))]
        }, r));
      }
      alert('Import complete.');
    } catch (err) {
      alert('Import failed: ' + err.message);
    }
  };
  reader.readAsText(file);
}

// PIN stored in local storage (not synced across devices)
async function getLocalPin() {
  return new Promise(r => api.storage.local.get('pin', res => r(res.pin || '')));
}
async function setLocalPin(pin) {
  return new Promise(r => api.storage.local.set({ pin }, r));
}

// Show/hide the Security sub-rows based on current PIN settings
function setPinSubVisible(enablePin) {
  ['row-pinSetup', 'row-pinTimeout'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', !enablePin);
  });
}
function setPinDailyVisible(timeout) {
  const row = document.getElementById('row-pinDaily');
  if (row) row.classList.toggle('hidden', timeout !== 'daily');
}

// Clear all data
async function clearAllData() {
  if (!confirm('Remove all saved cards and settings? This cannot be undone.')) return;
  await new Promise(r => api.storage.sync.clear(r));
  alert('All data cleared.');
  location.reload();
}

// Shared PIN UI helpers — used by initPinSetup and the timeout lock gate

function makePinInput(placeholder) {
  const el = document.createElement('input');
  el.type = 'text';
  el.className = 'setting-input pin-step-input';
  el.placeholder = placeholder;
  el.maxLength = 16;
  el.autocomplete = 'off';
  return el;
}

// Eye button toggles visibility; default is visible (type=text), click to hide
function makePinEye(inputEl) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pin-eye-btn';
  btn.innerHTML = '&#x1F441;';
  btn.title = 'Hide';
  btn.addEventListener('click', () => {
    const hide = inputEl.type === 'text';
    inputEl.type = hide ? 'password' : 'text';
    btn.style.opacity = hide ? '0.45' : '1';
    btn.title = hide ? 'Show' : 'Hide';
  });
  return btn;
}

function makePinBtn(label, handler) {
  const btn = document.createElement('button');
  btn.className = 'data-btn';
  btn.textContent = label;
  btn.addEventListener('click', handler);
  return btn;
}

function makePinErr() {
  const el = document.createElement('span');
  el.className = 'pin-step-error hidden';
  return el;
}

function makePinLabel(text) {
  const el = document.createElement('span');
  el.className = 'pin-step-label';
  el.textContent = text;
  return el;
}

function makePinRow(...children) {
  const row = document.createElement('div');
  row.className = 'pin-step-row';
  children.forEach(c => row.appendChild(c));
  return row;
}

function showPinErr(errEl, inputEl, msg) {
  errEl.textContent = msg;
  errEl.classList.remove('hidden');
  inputEl.style.borderColor = 'var(--danger)';
  inputEl.value = '';
  setTimeout(() => { errEl.classList.add('hidden'); inputEl.style.borderColor = ''; }, 2500);
  inputEl.focus();
}

// PIN setup state machine — renders all steps dynamically into #pinSetWrap
// States: idle → (if PIN exists: verify_current) → enter_new → confirm_new
async function initPinSetup() {
  const wrap = document.getElementById('pinSetWrap');
  if (!wrap) return;

  let currentPin = await getLocalPin();
  let pendingPin = '';

  function renderIdle() {
    wrap.innerHTML = '';
    if (currentPin) {
      const status = document.createElement('span');
      status.className = 'pin-status';
      status.textContent = 'PIN set';
      wrap.appendChild(makePinRow(status, makePinBtn('Change', renderVerifyCurrent)));
    } else {
      wrap.appendChild(makePinBtn('Set PIN', renderEnterNew));
    }
  }

  function renderVerifyCurrent() {
    wrap.innerHTML = '';
    const err       = makePinErr();
    const input     = makePinInput('Enter current PIN');
    const eye       = makePinEye(input);
    const cancelBtn = makePinBtn('Cancel', renderIdle);
    cancelBtn.className += ' pin-cancel-btn';

    function verify() {
      if (input.value !== currentPin) { showPinErr(err, input, 'Incorrect PIN'); return; }
      renderEnterNew();
    }
    input.addEventListener('keydown', e => { if (e.key === 'Enter') verify(); });

    wrap.appendChild(err);
    wrap.appendChild(makePinLabel('Current PIN'));
    wrap.appendChild(makePinRow(input, eye, makePinBtn('Verify', verify), cancelBtn));
    input.focus();
  }

  function renderEnterNew() {
    wrap.innerHTML = '';
    const err       = makePinErr();
    const input     = makePinInput('4–16 characters');
    const eye       = makePinEye(input);
    const cancelBtn = makePinBtn('Cancel', renderIdle);
    cancelBtn.className += ' pin-cancel-btn';

    function next() {
      const val = input.value.trim();
      if (val.length < 4) { showPinErr(err, input, 'At least 4 characters'); return; }
      pendingPin = val;
      renderConfirmNew();
    }
    input.addEventListener('keydown', e => { if (e.key === 'Enter') next(); });

    wrap.appendChild(err);
    wrap.appendChild(makePinLabel(currentPin ? 'New PIN' : 'Create PIN'));
    wrap.appendChild(makePinRow(input, eye, makePinBtn('Next', next), cancelBtn));
    input.focus();
  }

  function renderConfirmNew() {
    wrap.innerHTML = '';
    const err       = makePinErr();
    const input     = makePinInput('Enter PIN again');
    const eye       = makePinEye(input);
    const cancelBtn = makePinBtn('Cancel', renderIdle);
    cancelBtn.className += ' pin-cancel-btn';

    async function save() {
      const val = input.value.trim();
      if (val !== pendingPin) { showPinErr(err, input, 'PINs do not match'); return; }
      await setLocalPin(pendingPin);
      currentPin = pendingPin;
      pendingPin = '';
      renderIdle();
      const flash = document.createElement('span');
      flash.className = 'pin-saved';
      flash.textContent = 'Saved';
      wrap.appendChild(flash);
      setTimeout(() => flash.remove(), 2000);
    }
    input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });

    wrap.appendChild(err);
    wrap.appendChild(makePinLabel('Confirm PIN'));
    wrap.appendChild(makePinRow(input, eye, makePinBtn('Save', save), cancelBtn));
    input.focus();
  }

  renderIdle();
}

document.addEventListener('DOMContentLoaded', async () => {
  const settings = await getSettings();

  // Apply theme immediately
  applyTheme(settings.darkMode);

  // Wire all toggles
  wireToggle('darkMode',      'darkMode',      settings, dark => applyTheme(dark));
  wireToggle('openAsSidebar', 'openAsSidebar', settings);
  wireToggle('allow5Digit',   'allow5Digit',   settings);
  wireToggle('enableCVV',     'enableCVV',     settings);
  wireToggle('enableNotes',   'enableNotes',   settings, on => {
    setNotesSubVisible(on);
  });

  // Wire radio buttons
  wireRadio('notesDisplay', 'notesDisplay', settings);

  // Show/hide notes sub-option based on current state
  setNotesSubVisible(settings.enableNotes);

  // ── PIN / Security ──────────────────────────────────────────────────────────

  // Populate timezone select
  const tzSelect = document.getElementById('pinDailyTZ');
  if (tzSelect) {
    const userTZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
    let matched = false;
    TZ_LIST.forEach(tz => {
      const opt = document.createElement('option');
      opt.value = tz.v;
      opt.textContent = tz.l;
      if (tz.v === userTZ || (!matched && tz.v === settings.pinDailyTZ)) {
        opt.selected = true; matched = true;
      }
      tzSelect.appendChild(opt);
    });
    // If stored TZ isn't in our list, keep the stored value
    if (settings.pinDailyTZ && !TZ_LIST.find(t => t.v === settings.pinDailyTZ)) {
      const opt = document.createElement('option');
      opt.value = settings.pinDailyTZ;
      opt.textContent = settings.pinDailyTZ;
      opt.selected = true;
      tzSelect.insertBefore(opt, tzSelect.firstChild);
    }
    tzSelect.value = settings.pinDailyTZ || userTZ;
    tzSelect.addEventListener('change', async () => {
      settings.pinDailyTZ = tzSelect.value;
      await saveSettings(settings);
    });
  }

  // Daily time input
  const dailyTimeInput = document.getElementById('pinDailyTime');
  if (dailyTimeInput) {
    dailyTimeInput.value = settings.pinDailyTime || '00:00';
    dailyTimeInput.addEventListener('change', async () => {
      settings.pinDailyTime = dailyTimeInput.value;
      await saveSettings(settings);
    });
  }

  // Lock timeout select
  const pinTimeoutSelect = document.getElementById('pinTimeout');
  if (pinTimeoutSelect) {
    pinTimeoutSelect.value = settings.pinTimeout || 'everytime';
    setPinDailyVisible(pinTimeoutSelect.value);
    pinTimeoutSelect.addEventListener('change', async () => {
      settings.pinTimeout = pinTimeoutSelect.value;
      await saveSettings(settings);
      setPinDailyVisible(pinTimeoutSelect.value);
    });
  }

  // Enable PIN toggle
  wireToggle('enablePin', 'enablePin', settings, async on => {
    setPinSubVisible(on);
    setPinDailyVisible(on ? (settings.pinTimeout || 'everytime') : '');
    if (!on) {
      // Clear PIN from local storage when disabled
      await new Promise(r => api.storage.local.remove('pin', r));
    }
  });
  setPinSubVisible(settings.enablePin);
  setPinDailyVisible(settings.enablePin ? (settings.pinTimeout || 'everytime') : '');

  // PIN setup UI — state machine renders into #pinSetWrap
  await initPinSetup();

  // Lock timeout/daily controls — always requires PIN per change, no session unlock
  const savedPin = await getLocalPin();
  if (settings.enablePin && savedPin && pinTimeoutSelect) {
    pinTimeoutSelect.disabled = true;
    if (dailyTimeInput) dailyTimeInput.disabled = true;
    if (tzSelect)       tzSelect.disabled       = true;

    // Wrap the timeout select in a container so we can append gate UI beside it
    const timeoutRow = document.getElementById('row-pinTimeout');
    if (timeoutRow) {
      const ctrl = document.createElement('div');
      ctrl.className = 'pin-timeout-control';
      pinTimeoutSelect.parentNode.insertBefore(ctrl, pinTimeoutSelect);
      ctrl.appendChild(pinTimeoutSelect);

      function lockControls() {
        pinTimeoutSelect.disabled = true;
        if (dailyTimeInput) dailyTimeInput.disabled = true;
        if (tzSelect)       tzSelect.disabled       = true;
      }

      function renderGateLocked() {
        const old = ctrl.querySelector('.pin-gate-row');
        if (old) old.remove();
        const gateRow = document.createElement('div');
        gateRow.className = 'pin-gate-row';
        gateRow.appendChild(makePinBtn('🔒 Unlock to edit', showGateVerify));
        ctrl.appendChild(gateRow);
      }

      function showGateVerify() {
        const old = ctrl.querySelector('.pin-gate-row');
        if (old) old.remove();
        const gateRow = document.createElement('div');
        gateRow.className = 'pin-gate-row';
        const err   = makePinErr();
        const input = makePinInput('PIN');
        const eye   = makePinEye(input);

        async function verify() {
          const pin = await getLocalPin();
          if (input.value !== pin) { showPinErr(err, input, 'Incorrect PIN'); return; }
          // Enable controls for one change, then re-lock immediately after
          pinTimeoutSelect.disabled = false;
          if (dailyTimeInput) dailyTimeInput.disabled = false;
          if (tzSelect)       tzSelect.disabled       = false;
          gateRow.remove();

          function relockAfterChange() {
            lockControls();
            pinTimeoutSelect.removeEventListener('change', relockAfterChange);
            if (dailyTimeInput) dailyTimeInput.removeEventListener('change', relockAfterChange);
            if (tzSelect)       tzSelect.removeEventListener('change',       relockAfterChange);
            renderGateLocked();
          }
          pinTimeoutSelect.addEventListener('change', relockAfterChange);
          if (dailyTimeInput) dailyTimeInput.addEventListener('change', relockAfterChange);
          if (tzSelect)       tzSelect.addEventListener('change',       relockAfterChange);
        }
        input.addEventListener('keydown', e => { if (e.key === 'Enter') verify(); });
        input.addEventListener('input', async () => {
          if (input.value.length < 4) return;
          const p = await getLocalPin();
          if (input.value === p) verify();
        });

        gateRow.appendChild(err);
        gateRow.appendChild(makePinRow(input, eye, makePinBtn('Verify', verify)));
        ctrl.appendChild(gateRow);
        input.focus();
      }

      renderGateLocked();
    }
  }

  // Data actions
  document.getElementById('exportBtn').addEventListener('click', exportCards);
  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });
  document.getElementById('importFile').addEventListener('change', e => {
    if (e.target.files.length) { importCards(e.target.files[0]); e.target.value = ''; }
  });
  document.getElementById('clearBtn').addEventListener('click', clearAllData);
});
