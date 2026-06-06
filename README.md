# WhichCard

WhichCard shows the names you give your cards next to their last digits on any payment page, so you can tell which saved card a number belongs to. It stores your labels and preferences in your browser. It never stores card numbers; a card is identified by the SHA-256 hash of its last four or five digits. WhichCard runs in Chrome and Firefox.

## Install

The extension lives in the `whichcard/` subfolder of this repository, where `manifest.json` is.

Chrome:

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Click Load unpacked and select the `whichcard/` subfolder.

Firefox:

1. Open `about:debugging#/runtime/this-firefox`.
2. Click Load Temporary Add-on.
3. Select `manifest.json` in the `whichcard/` subfolder.

## Usage

Click the toolbar icon to open WhichCard. The icon opens a popup by default, or the side panel if you set that in preferences.

Add a card by entering its last 4 or 5 digits and a name. Give it a color, a network, and an optional note. On a payment page, WhichCard labels recognized card numbers in place. You can also click "+ Name this card" next to a number on the page to label it without opening the popup.

Preferences cover theme, what the toolbar icon opens, 5-digit card numbers, an optional CVV field, notes, a PIN lock, excluded sites, and data export, import, and wipe.

## How it works

A content script scans payment pages for the card numbers a site displays. It hashes the last digits with SHA-256 and matches that hash against your saved cards, then renders the matching label next to the number. Card labels and preferences are kept in your browser's synced storage. A PIN, if you set one, is stored in local storage on this device only and is never synced.

## Known limitations

- Runs on `https` pages only.
- Detection depends on how each site renders card numbers, so some pages will not match.
- Sync uses your browser account's storage quota.
- On Firefox, the side panel opens from Firefox's own sidebar controls.

## Privacy

No card numbers are stored. WhichCard keeps only SHA-256 hashes of the last 4 or 5 digits, your labels, and your preferences. Nothing is sent to any server. There is no analytics, no tracking, and no backend.

The optional CVV field, if you enable it, is stored in browser storage and syncs with your other settings. The PIN is stored locally and is never synced. Turning off CVV or PIN removes that data.

## Colophon

Licensed under the MIT License. See [LICENSE](LICENSE).

Published by AppCaddy.
