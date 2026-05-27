// WhichCard - Content Script
// Detects credit card last-4-digit patterns on any page and injects nickname labels

(async function() {
  'use strict';

  const api = typeof browser !== 'undefined' ? browser : chrome;
  const PROCESSED_ATTR = 'data-whichcard';
  const SCAN_DEBOUNCE = 400;

  // Patterns that match masked card numbers with trailing 4-5 digits
  const CARD_PATTERNS = [
    /(?:ending|ends)\s+in\s+(\d{4,5})\b/i,
    /[•*·×•‣․●]{3,}\s?(\d{4,5})\b/,
    /\*{3,}\s?(\d{4,5})\b/,
    /\.{2,4}\s?(\d{4,5})\b/,
    /(?:last\s+(?:four|five|4|5)\s*(?:digits?)?[:\s]+)(\d{4,5})\b/i,
    /[Xx]{3,}\s?(\d{4,5})\b/,
  ];

  // Context keywords near card numbers reduce false positives
  const PAYMENT_CONTEXT = /\b(?:card|credit|debit|payment|visa|master\s?card|amex|american\s+express|discover|checking|savings|wallet|checkout|billing|pay\s+with|payment\s+method|ending|select\s+a?\s*payment|payment\s+selection|bank\s+account)\b/i;

  // Elements that should never themselves be labeled (the element itself, not ancestors)
  const SKIP_SELF = 'img,svg,button,select,option,input,textarea,script,style,noscript,iframe,[role="img"]';

  // Our own injected elements
  const OUR_ELEMENTS = '.whichcard-label,.whichcard-add,.whichcard-editor,.whichcard-float';

  // Network SVG icons for inline labels
  const NETWORK_SVGS = {
    visa: '<svg viewBox="0 0 24 16" width="20" height="13" style="vertical-align:middle"><rect width="24" height="16" rx="2" fill="#1A1F71"/><text x="12" y="11" text-anchor="middle" fill="#fff" font-size="7" font-weight="bold" font-family="sans-serif">VISA</text></svg>',
    mastercard: '<svg viewBox="0 0 24 16" width="20" height="13" style="vertical-align:middle"><rect width="24" height="16" rx="2" fill="#000"/><circle cx="9" cy="8" r="5" fill="#EB001B"/><circle cx="15" cy="8" r="5" fill="#F79E1B"/><path d="M12 4.27a5 5 0 010 7.46 5 5 0 010-7.46z" fill="#FF5F00"/></svg>',
    amex: '<svg viewBox="0 0 24 16" width="20" height="13" style="vertical-align:middle"><rect width="24" height="16" rx="2" fill="#2E77BC"/><text x="12" y="11" text-anchor="middle" fill="#fff" font-size="5.5" font-weight="bold" font-family="sans-serif">AMEX</text></svg>',
    discover: '<svg viewBox="0 0 24 16" width="20" height="13" style="vertical-align:middle"><rect width="24" height="16" rx="2" fill="#fff" stroke="#ddd" stroke-width="0.5"/><circle cx="14" cy="8" r="4" fill="#F76F20"/><text x="7" y="11" fill="#000" font-size="4.5" font-weight="bold" font-family="sans-serif">DISC</text></svg>',
    bank: '<svg viewBox="0 0 24 16" width="20" height="13" style="vertical-align:middle"><rect width="24" height="16" rx="2" fill="#5E5E5E"/><path d="M12 3l7 4H5l7-4z" fill="#fff"/><rect x="6" y="8" width="2" height="4" fill="#fff" rx="0.3"/><rect x="11" y="8" width="2" height="4" fill="#fff" rx="0.3"/><rect x="16" y="8" width="2" height="4" fill="#fff" rx="0.3"/><rect x="5" y="12.5" width="14" height="1.5" rx="0.3" fill="#fff"/></svg>',
  };

  // SHA-256 hash
  async function hashDigits(digits) {
    const data = new TextEncoder().encode(digits);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Get all stored cards from sync storage
  async function getCards() {
    return new Promise(resolve => {
      api.storage.sync.get('cards', result => resolve(result.cards || {}));
    });
  }

  // Save a card to sync storage
  async function saveCard(hash, cardData) {
    const cards = await getCards();
    cards[hash] = cardData;
    return new Promise(resolve => {
      api.storage.sync.set({ cards }, resolve);
    });
  }

  // Check if element or ancestors contain payment-related text
  function hasPaymentContext(element) {
    let el = element;
    for (let i = 0; i < 8 && el && el !== document.body; i++) {
      const text = el.textContent || '';
      if (text.length < 3000 && PAYMENT_CONTEXT.test(text)) return true;
      el = el.parentElement;
    }
    return false;
  }

  // Extract last 4-5 digits from text using card patterns
  function extractDigits(text) {
    for (const pattern of CARD_PATTERNS) {
      pattern.lastIndex = 0;
      const match = text.match(pattern);
      if (match) return match[1];
    }
    return null;
  }

  // Check if element itself (not ancestors) is something we should skip
  function shouldSkipElement(el) {
    if (!el || !el.parentElement) return true;
    if (el.matches && el.matches(SKIP_SELF)) return true;
    if (el.closest && el.closest(OUR_ELEMENTS)) return true;
    const rect = el.getBoundingClientRect();
    if (rect.height === 0 || rect.width === 0) return true;
    return false;
  }

  // Find the best injection point for a label near an element
  function findInjectionPoint(el) {
    // First try: inject after the element itself
    if (el.parentElement && !el.matches(SKIP_SELF)) {
      return { target: el, position: 'afterend' };
    }

    // Second try: inject after the parent
    const parent = el.parentElement;
    if (parent && parent !== document.body) {
      return { target: parent, position: 'afterend' };
    }

    return null;
  }

  // Check if this element is inside another element we already processed with the same digits
  function isNestedDuplicate(el, digits, processedMap) {
    let parent = el.parentElement;
    while (parent && parent !== document.body) {
      if (processedMap.has(parent) && processedMap.get(parent) === digits) return true;
      parent = parent.parentElement;
    }
    // Also check children - if a child has the same digits, skip the parent
    const children = el.querySelectorAll ? el.querySelectorAll(`[${PROCESSED_ATTR}]`) : [];
    for (const child of children) {
      if (processedMap.get(child) === digits) return true;
    }
    return false;
  }

  // Find the best single element for a set of digits within a region
  function findBestElement(candidates) {
    if (candidates.length === 1) return candidates[0];

    // Prefer the element whose own text (not descendants) contains the card pattern
    for (const c of candidates) {
      const ownText = Array.from(c.element.childNodes)
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent)
        .join('');
      if (extractDigits(ownText)) return c;
    }

    // Fallback: prefer deepest element
    let best = candidates[0];
    let bestDepth = 0;
    for (const c of candidates) {
      let depth = 0;
      let el = c.element;
      while (el.parentElement) { depth++; el = el.parentElement; }
      if (depth > bestDepth) { best = c; bestDepth = depth; }
    }
    return best;
  }

  // Find all card number elements on the page
  function findCardElements() {
    const digitGroups = new Map();
    const processedMap = new Map();

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const text = node.textContent.trim();
          if (text.length < 4 || text.length > 500) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.textContent.trim();
      const digits = extractDigits(text);
      if (!digits) continue;

      let target = node.parentElement;
      if (!target) continue;
      if (target.hasAttribute(PROCESSED_ATTR)) continue;
      if (target.closest(OUR_ELEMENTS)) continue;

      // Walk up to find a suitable target if the direct parent is bad
      if (shouldSkipElement(target)) {
        target = target.parentElement;
        if (!target || shouldSkipElement(target)) continue;
      }

      if (!hasPaymentContext(target)) continue;

      // Group by digits + approximate vertical position
      const rect = target.getBoundingClientRect();
      const regionKey = digits + '_' + Math.round(rect.top / 40);

      if (!digitGroups.has(regionKey)) {
        digitGroups.set(regionKey, []);
      }
      digitGroups.get(regionKey).push({ element: target, digits, rect });
    }

    // Pick best element per region
    const results = [];
    for (const [key, candidates] of digitGroups) {
      const best = findBestElement(candidates);
      if (isNestedDuplicate(best.element, best.digits, processedMap)) continue;
      processedMap.set(best.element, best.digits);
      results.push({ element: best.element, digits: best.digits });
    }

    return results;
  }

  // Create the nickname label element
  function createLabel(card) {
    const label = document.createElement('span');
    label.className = 'whichcard-label';
    label.style.backgroundColor = card.color || '#3D7575';

    if (card.network && NETWORK_SVGS[card.network]) {
      const iconWrap = document.createElement('span');
      iconWrap.className = 'whichcard-network-icon';
      iconWrap.innerHTML = NETWORK_SVGS[card.network];
      label.appendChild(iconWrap);
    }

    const name = document.createElement('span');
    name.textContent = card.nickname;
    label.appendChild(name);

    if (card.reward) {
      label.setAttribute('data-whichcard-reward', card.reward);
      label.title = card.reward;
    }

    return label;
  }

  // Create the "+ Name this card" button
  function createAddButton(digits, element) {
    const btn = document.createElement('span');
    btn.className = 'whichcard-add';
    btn.textContent = '+ Name this card';

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openInlineEditor(digits, element, btn);
    });

    return btn;
  }

  // Open inline editor for naming a card
  function openInlineEditor(digits, targetElement, trigger) {
    if (trigger && trigger.parentNode) trigger.remove();
    document.querySelectorAll('.whichcard-editor').forEach(ed => ed.remove());

    const editor = document.createElement('span');
    editor.className = 'whichcard-editor';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Card name';
    input.setAttribute('autocomplete', 'off');

    const hint = document.createElement('span');
    hint.className = 'whichcard-editor-hint';
    hint.textContent = 'Enter to save';

    editor.appendChild(input);
    editor.appendChild(hint);

    const injection = findInjectionPoint(targetElement);
    if (injection) {
      injection.target.insertAdjacentElement(injection.position, editor);
    } else {
      targetElement.insertAdjacentElement('afterend', editor);
    }
    input.focus();

    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        e.preventDefault();
        await saveAndLabel(digits, input.value.trim(), targetElement);
        editor.remove();
      }
      if (e.key === 'Escape') {
        editor.remove();
        const addBtn = createAddButton(digits, targetElement);
        const inj = findInjectionPoint(targetElement);
        if (inj) inj.target.insertAdjacentElement(inj.position, addBtn);
        else targetElement.insertAdjacentElement('afterend', addBtn);
        targetElement.setAttribute(PROCESSED_ATTR, 'pending');
      }
    });

    input.addEventListener('blur', async () => {
      setTimeout(async () => {
        if (editor.parentNode) {
          if (input.value.trim()) {
            await saveAndLabel(digits, input.value.trim(), targetElement);
          } else {
            const addBtn = createAddButton(digits, targetElement);
            const inj = findInjectionPoint(targetElement);
            if (inj) inj.target.insertAdjacentElement(inj.position, addBtn);
            else targetElement.insertAdjacentElement('afterend', addBtn);
            targetElement.setAttribute(PROCESSED_ATTR, 'pending');
          }
          editor.remove();
        }
      }, 150);
    });
  }

  // Save card and inject label
  async function saveAndLabel(digits, nickname, element) {
    const hash = await hashDigits(digits);
    const cardData = {
      nickname: nickname,
      color: '#3D7575',
      network: '',
      reward: '',
      lastDigits: digits,
    };

    await saveCard(hash, cardData);

    // Clean up any existing add buttons or editors near this element
    const next = element.nextElementSibling;
    if (next && (next.classList.contains('whichcard-add') || next.classList.contains('whichcard-editor'))) {
      next.remove();
    }

    const label = createLabel(cardData);
    const injection = findInjectionPoint(element);
    if (injection) {
      injection.target.insertAdjacentElement(injection.position, label);
    } else {
      element.insertAdjacentElement('afterend', label);
    }
    element.setAttribute(PROCESSED_ATTR, hash);
  }

  // Clear all injected elements
  function clearAllLabels() {
    document.querySelectorAll(OUR_ELEMENTS).forEach(el => el.remove());
    document.querySelectorAll(`[${PROCESSED_ATTR}]`).forEach(el => el.removeAttribute(PROCESSED_ATTR));
  }

  // Lookup a card by digits, trying both 4 and 5 digit hashes
  async function lookupCard(digits, cards) {
    const hash = await hashDigits(digits);
    if (cards[hash]) return { hash, card: cards[hash] };

    // If 5 digits, also try last 4
    if (digits.length === 5) {
      const hash4 = await hashDigits(digits.slice(-4));
      if (cards[hash4]) return { hash: hash4, card: cards[hash4] };
    }

    // If 4 digits, check if any 5-digit card ends with these 4
    if (digits.length === 4) {
      for (const [h, c] of Object.entries(cards)) {
        if (c.lastDigits && c.lastDigits.length === 5 && c.lastDigits.endsWith(digits)) {
          return { hash: h, card: c };
        }
      }
    }

    return null;
  }

  // Process all detected card elements
  async function processPage() {
    const cards = await getCards();
    const elements = findCardElements();

    for (const { element, digits } of elements) {
      const result = await lookupCard(digits, cards);

      const injection = findInjectionPoint(element);

      if (result) {
        const label = createLabel(result.card);
        if (injection) {
          injection.target.insertAdjacentElement(injection.position, label);
        } else {
          element.insertAdjacentElement('afterend', label);
        }
        element.setAttribute(PROCESSED_ATTR, result.hash);
      } else {
        const addBtn = createAddButton(digits, element);
        if (injection) {
          injection.target.insertAdjacentElement(injection.position, addBtn);
        } else {
          element.insertAdjacentElement('afterend', addBtn);
        }
        element.setAttribute(PROCESSED_ATTR, 'pending');
      }
    }
  }

  // Debounced scan
  let scanTimer = null;
  function debouncedScan() {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      clearAllLabels();
      processPage();
    }, SCAN_DEBOUNCE);
  }

  // Watch for DOM changes
  const observer = new MutationObserver((mutations) => {
    let shouldScan = false;
    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE && !node.closest(OUR_ELEMENTS)) {
            shouldScan = true;
            break;
          }
        }
      }
      if (shouldScan) break;
    }
    if (shouldScan) debouncedScan();
  });

  // Listen for storage changes
  api.storage.onChanged.addListener((changes) => {
    if (changes.cards) {
      clearAllLabels();
      processPage();
    }
  });

  // Initial scan
  await processPage();

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

})();
