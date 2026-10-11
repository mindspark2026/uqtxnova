# UQTxNova — PWA + Android (PWABuilder) guide

**Deployed URL (taken from README.md):** `https://mindspark2026.github.io/uqtxnova/`
→ origin `https://mindspark2026.github.io`, base path `/uqtxnova/`.
**If your real URL is different, change `id` in `manifest.json` (currently `/uqtxnova/`) and use your real URL everywhere below.**
`start_url` and `scope` are `./`, so they follow the folder `manifest.json` is served from — no other edit is needed for a different repo name.

## What was done (verified) vs. what is still manual
| Step | Status |
|---|---|
| Manifest fixed (id, scope, start_url, lang, dir, categories, display_override, icons, shortcuts, screenshots) | Done and checked |
| Maskable + normal icons, 192/512 | Done and checked |
| 6 real screenshots (3 desktop, 3 mobile) | Done — **they use sample study data, see Warnings** |
| Service worker (base-path safe, offline shell, versioned cache) | Done and tested offline |
| Chrome "installable" check on a `/uqtxnova/` sub-path | Passed (0 installability errors) |
| Deploy to GitHub Pages | **You** (below) |
| Generate the APK | **You, in PWABuilder** — not built here |
| Digital Asset Links (`assetlinks.json`) | **You** — needs the signing fingerprint that only exists after you build |
| Publish on Google Play | **You** — separate, optional |

## Files
New: `icon-maskable-192.png`, `icon-maskable-512.png`, `screenshots/*.png` (6), `.nojekyll`, `PWA-ANDROID-GUIDE.md`
Modified: `manifest.json`, `sw.js`, `index.html` (SW registration with scope, `lang`, one meta tag), `enhancements.js` (`?page=` deep links for shortcuts), `theme.css` (stat numbers no longer wrap)
Untouched: Firebase files, auth, storage, all app logic.

## 1. Deploy to GitHub Pages
1. Commit and push everything to the branch Pages serves (Settings → Pages → Branch).
2. Wait ~1 minute, open `https://mindspark2026.github.io/uqtxnova/`, hard-refresh (Ctrl+Shift+R).
3. Open DevTools → Application → Manifest: no errors; Service Workers: "activated".
On each future deploy, bump `CACHE_VERSION` in `sw.js` (e.g. `v17`) so users get the new files.

## 2. Test with PWABuilder
Go to https://www.pwabuilder.com → enter the URL → Start. Manifest, Service Worker and Security should be green.
(GitHub Pages can cache files ~10 min; if you see old results, wait and retry.)

## 3. Generate the Android APK (free)
PWABuilder → **Package for stores → Android**. Suggested values:
- **Package ID:** `io.github.mindspark2026.uqtxnova` (your choice, but it is **permanent** once published)
- **App name / launcher name:** `UQTxNova`
- **Start URL:** `/uqtxnova/`   **Host:** `mindspark2026.github.io`
- **Display:** standalone  **Notifications:** off (see Limitations)
- **Signing key:** choose *Create new* and **download and back up the keystore file + passwords**. If you lose them you can never update the app.
Download the ZIP: it contains a signed `.apk` (install directly on a phone) and a `.aab` (for Google Play), the keystore, and an `assetlinks.json`.
Install the APK: copy it to the phone → open it → allow "install unknown apps" for that file manager.

## 4. Digital Asset Links (removes the browser address bar)
Without it the app still works but shows a Chrome URL bar at the top. To make it full-screen:
- Android checks `https://mindspark2026.github.io/.well-known/assetlinks.json` — the **domain root**, NOT `/uqtxnova/`.
- A *project* repo cannot serve that path. Create a repository named exactly **`mindspark2026.github.io`**, add:
  - `.nojekyll` (empty file — otherwise GitHub hides the `.well-known` folder)
  - `.well-known/assetlinks.json` with the content PWABuilder gave you (package ID + SHA-256 fingerprint).
- Format (**replace both values with real ones — never publish placeholders**):
```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "YOUR.PACKAGE.ID",
    "sha256_cert_fingerprints": ["AA:BB:...:FF"]
  }
}]
```
- **Where the fingerprint comes from:** from the `assetlinks.json` PWABuilder generates, or from your keystore:
  `keytool -list -v -keystore signing.keystore -alias <alias>` → copy the *SHA256* line.
  If you publish on Google Play with **Play App Signing**, also add the fingerprint shown in Play Console → Setup → App signing (list both).
- Check it: open `https://mindspark2026.github.io/.well-known/assetlinks.json` in a browser; then
  `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://mindspark2026.github.io&relation=delegate_permission/common.handle_all_urls`
- Fingerprint changes if you change the signing key, so keep the same keystore.

## 5. Google Play (optional, separate task)
One-time $25 developer account → upload the `.aab` → complete the **content-rating (IARC) questionnaire inside Play Console** (it issues the rating — don't invent one) → privacy policy URL, store listing, data-safety form. New personal accounts must run a closed test before production.

## PWABuilder recommendations, classified
**A — important for Android packaging (done):** `id`, `scope`, `start_url`, icons incl. maskable, service worker, HTTPS, HTTPS-safe paths.
**B — recommended (done):** screenshots, `categories`, `lang`/`dir`, `display_override`, shortcuts (Calendar, Revision, Focus timer).
**C — not needed now (skipped on purpose):** `related_applications` / "prefer native app" (no store app exists yet; add only after publishing), IARC rating (Play Console issues it), file/launch/protocol handlers, share target, widgets, edge side panel, tabbed display, Background Sync, Periodic Sync, Push (needs a push server; see Limitations).

## Remaining warnings (safe to ignore?)
- PWABuilder "IARC rating" / "related apps" — **ignore** until Play publishing.
- "Push notifications / background sync" — **ignore** for now.
- Screenshots use **sample data** (14 sample study entries, 4 sample tasks, 3 revision topics) in the real UI. Replace `screenshots/*.png` with shots of your own data if you prefer; keep the same file names and sizes (1280×720 and 780×1688) or update `manifest.json`.
- Firebase and Chart.js load from CDNs: first load needs internet. Offline, the app shell, your saved data and (once cached) charts work; cloud sync does not.
- Changing `id` makes browsers treat it as a new install; anyone who installed the old version should reinstall.

## Limitations
- No APK was built in this environment (Android tooling is blocked); steps 3–5 need you.
- **Reminders / notifications:** a TWA runs your web code, so reminders fire only while the app is open (a timer in the page). Reliable alerts when the app is closed need either web push (Firebase Cloud Messaging + a sender) or the Capacitor build delivered earlier (`uqtxnova-android.zip`), which schedules real Android notifications.
- Google sign-in works in Chrome/TWA; inside a Capacitor WebView it does not.
- `orientation` is `portrait-primary` (as before); set `"any"` in `manifest.json` if you want landscape on tablets.
