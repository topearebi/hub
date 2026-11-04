# Make Hub Your Homepage, Startup Page or Home-Screen App

**Document Version:** 1.0.0 (specification — user-facing copy to be published with roadmap Phase 8)
**Parent specs:** [`PRD.md`](../PRD.md) §5.9, [`DESIGN.md`](../DESIGN.md) §7

Hub works best when it is one tap (or one keystroke) away. This guide lists the supported ways to do that. Menu names vary between browser versions; the principle is the same everywhere.

> **What is not possible without an extension:** replacing the browser's _new tab_ page. Browsers only allow that through an extension. A Hub `newtab` extension wrapper is planned for v2 (PRD §2.2). Until then, use the homepage / startup options below.

---

## 1. On a phone (recommended)

### Android (Chrome, Edge, Samsung Internet)

1. Open Hub in the browser and use it once while online (this lets Hub store itself for offline use).
2. Open the browser menu → **Install app** (or **Add to Home screen**).
3. Launch Hub from the home screen. It opens full-screen, works offline, and shows the number of open tasks on the icon.
4. Long-press the Hub icon for shortcuts: **New bookmark**, **New task**, **New note**.

### iPhone / iPad (Safari)

1. Open Hub in Safari and use it once while online.
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Launch Hub from the home screen.

Hub shows these steps in-app when it detects iOS (it cannot show a native install prompt there).

**Tip:** Add Hub's _share target_ by sharing a page to Hub from any app: Hub offers to save it as a bookmark or note.

---

## 2. On a computer

### Install as an app (Chrome, Edge, and other Chromium browsers)

1. Visit Hub, then click the **Install** icon in the address bar (or Settings → **Install & updates → Install Hub**).
2. Pin the installed app to the taskbar/dock. Launching it again focuses the existing window instead of opening a second one (`launch_handler`).

### Set Hub as the browser homepage / startup page

| Browser       | Where to look                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Chrome / Edge | Settings → **On startup** → _Open a specific page_ → add Hub's URL. Also Settings → **Appearance** → show _Home_ button → enter Hub's URL. |
| Firefox       | Settings → **Home** → _Homepage and new windows_ → _Custom URLs_ → paste Hub's URL.                                                        |
| Safari        | Settings → **General** → _Homepage_ → Hub's URL; set _New windows open with_ → _Homepage_.                                                 |

### Keyboard access

- Bookmark Hub and give it a keyword if your browser supports it (for example, type `hub` + Enter in the address bar).
- Inside Hub, press `/` to jump to search, `?` to see every shortcut.

---

## 3. Keep your data safe

- Hub stores everything on your device. Browsers can clear site data when storage is low, so Hub asks for **persistent storage**; check **Settings → Data** for the status and use **Export backup** regularly.
- Optional: connect GitHub sync (Settings → Sync) to keep devices in step. Use a fine-grained token limited to the single sync repository.
- Installing Hub as an app makes browsers far less likely to evict its data.

---

## 4. Troubleshooting

| Symptom                                           | Fix                                                                                                            |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| No install option appears                         | Visit Hub a second time; make sure you are on HTTPS and not in a private window.                               |
| App doesn't open offline                          | Open it once while online and wait for "Ready to work offline"; then relaunch.                                 |
| "A new version of Hub is ready"                   | Tap **Reload** when convenient; nothing changes until you do.                                                  |
| Hub opens in a new browser tab instead of the app | Open the installed app from the home screen/launcher, or enable "Open supported links in app" in your browser. |
| Data missing after clearing site data             | Restore from your exported backup (Settings → Data → Import) or re-sync from GitHub.                           |
