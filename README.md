# Gym Tracker

A personal workout tracker that runs in your browser and installs on your phone's home screen.
**All your data stays on your device** (browser storage). Nothing is uploaded anywhere.
This repository only holds the empty app.

## Install on iPhone
1. Open the GitHub Pages link in **Safari**.
2. Tap **Share → Add to Home Screen**.
3. Open it from the home-screen icon. It works offline.

## Backups
Body tab → **Back up to iCloud Drive / Files** → *Save to Files* → iCloud Drive.
To restore: Settings → **Restore from backup** → pick the `gym-backup-….json` file.

Note: the home-screen app and Safari keep **separate** storage, so always use the home-screen icon.

## Updating the app
After you change a file, also change `VERSION` in `sw.js` (e.g. `gym-v2`) so phones download the update.

## Credits
Fonts: Inter and Space Grotesk, both under the SIL Open Font License 1.1 (https://openfontlicense.org).
