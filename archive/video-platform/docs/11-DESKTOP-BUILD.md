# 11 — Desktop app: building & distributing the Windows installer

How to produce the **AcademIQ Teacher** Windows app (`.exe`) to hand to academies for testing, and how
to reproduce that build later without starting from scratch. The app is **unsigned** for now (no code
certificate yet) — this doc includes exactly what that means for your customers and how they install past
Windows' warning.

> The desktop app is a thin **Electron shell** (`apps/desktop`) that loads the PRODUCTION web call client
> from `https://acadmyq.com`. It does **not** bundle the web app — so the `.exe` is small (~80 MB, mostly
> the Electron runtime) and every web change goes live via the normal deploy, no rebuild of the `.exe`
> needed. See [10-DESKTOP-CLIENT.md](./10-DESKTOP-CLIENT.md) for the architecture.

---

## 1. TL;DR — build it

```bash
# from the repo root
env -u ELECTRON_RUN_AS_NODE pnpm --filter @academiq/desktop dist:win
```

Output (git-ignored) lands in **`apps/desktop/dist/`**:

| File | What it is | Send this? |
|------|-----------|-----------|
| `AcademIQ Teacher-Setup-<version>.exe` | **NSIS installer** — installs to Program Files, adds Start-menu + desktop shortcuts, registers the `academiq://` deep link, and an uninstaller. | ✅ **Yes — the primary download.** |
| `AcademIQ Teacher-Portable-<version>.exe` | **Portable** — runs with no install (double-click). Handy for a quick trial or locked-down PCs. | Optional / power users. |
| `*.blockmap`, `latest.yml` | Auto-update metadata (unused until updates are wired). | No. |

That's the whole build. Everything below is detail: prerequisites, the unsigned situation + academy
instructions, versioning, the icon, and the future signing/auto-update path.

---

## 2. Prerequisites (one-time)

- **Node** ≥ 20 and **pnpm** (the repo's package manager).
- Repo deps installed: `pnpm install` at the repo root.
- **The Electron binary must be present.** The repo intentionally does NOT auto-download Electron on
  `pnpm install` (keeps CI/deploy lean). If a build/dev complains Electron is missing:
  ```bash
  pnpm --filter @academiq/desktop run rebuild:electron
  ```
- **No Wine / NSIS install needed.** electron-builder downloads its own bundled Wine + NSIS the first
  time (you'll see `wine-4.0.1-mac`, `nsis-3.0.4.1`, `winCodeSign` download once, then cached). This is
  why a **Windows `.exe` can be built straight from macOS** — no Windows machine required.
- **Only to regenerate the icon:** ImageMagick (`brew install imagemagick`). Not needed for a normal build.

---

## 3. What the build does (so you can trust/debug it)

`dist:win` = `electron-vite build` (compiles `main` / `preload` / `renderer` into `out/`) **then**
`electron-builder --win` (packages `out/` + the Electron runtime into the installers per
`electron-builder.yml`). Config highlights (`apps/desktop/electron-builder.yml`):

- `appId: com.academiq.teacher`, `productName: AcademIQ Teacher`.
- `win.icon: resources/icon.ico` — the app/installer icon (see §7).
- `win.target: [nsis, portable]` (x64).
- `nsis.oneClick: false` + `allowToChangeInstallationDirectory: true` — a normal "Next / choose folder"
  installer, not a silent one; adds desktop + Start-menu shortcuts.
- `protocols: academiq` — registers the `academiq://room/<token>` deep link on install.

The `.exe` targets **Windows x64** (covers essentially all academy PCs). Add `ia32`/`arm64` arches in the
config only if a customer needs them.

---

## 4. ⚠️ Unsigned — what academies will see, and what to tell them

We do **not** have a code-signing certificate yet, so Windows can't verify the publisher. This does **not**
make the app unsafe or "deleted" — it just adds a one-time prompt. Two things can appear:

### 4a. SmartScreen — "Windows protected your PC"
On first run of an unsigned app, Windows may show a blue box: *"Windows protected your PC … unknown
publisher."* **The app is not blocked — it's one extra click.** Tell academies:

> 1. Click **More info**.
> 2. Click **Run anyway**.
> 3. Continue the install / launch normally.

This appears **once per machine** for a given file. It is unavoidable for any unsigned app (including big
names before they were signed) — see §6 for how to remove it permanently.

### 4b. Antivirus false-positives
A brand-new unsigned installer occasionally gets a "low reputation" flag from Defender/AV. We minimise this
by shipping a **real NSIS installer with a proper icon + metadata** (not a bare `.exe`), which is what §1
produces. If a specific AV still quarantines it:
- Prefer the **installer** over the portable exe (portable self-extractors are flagged more often).
- The academy can allow-list the file, or you submit it to the vendor as a false positive.
- Signing (§6) eliminates this class of problem.

### What NOT to do
- **Self-signed certificate:** does **not** help — SmartScreen only trusts certs chaining to a public CA,
  and it adds "install this certificate" friction. Skip it.
- Renaming / zipping to dodge AV — makes it look *more* suspicious.

---

## 5. Distributing the `.exe` to academies

The file is ~80 MB (too big for the git repo — `dist/` is git-ignored on purpose). To share it:

- Upload `AcademIQ Teacher-Setup-<version>.exe` somewhere with a clean, stable link: your own site /
  a `downloads.acadmyq.com` page, an S3/R2 bucket, or Google Drive/Dropbox "anyone with link".
- Give academies the download link + the **"More info → Run anyway"** note from §4a. A short one-page
  install guide (screenshot of the SmartScreen click-through) removes almost all support questions.
- After install they open **AcademIQ Teacher** → paste their **meeting or host link** → join. No login,
  no dashboard (the app is meeting-only; a host link grants full control).

---

## 6. When you're ready to sign (removes SmartScreen + AV flags)

There is **no free** way to satisfy SmartScreen for a commercial closed-source app. Ranked by cost/effort:

1. **Azure Trusted Signing** — **~$10/month**, the cheapest legit modern option. Cloud-based (no hardware
   token), trusted by SmartScreen **immediately** (no reputation wait), and works with electron-builder.
   Requires verifying your business identity. **Recommended once you move past friends-and-family testing.**
2. **OV code-signing certificate** — ~$200–400/yr (Sectigo/DigiCert resellers). Trusted, but SmartScreen
   reputation still ramps up over the first N installs.
3. **EV code-signing certificate** — ~$300–600/yr, ships on a hardware token; instant SmartScreen trust.

Wiring it into this build later is small: add a `signtoolOptions` block under `win:` in
`electron-builder.yml` (or set the `CSC_LINK` / `CSC_KEY_PASSWORD` env vars for a `.pfx`, or the Azure
Trusted Signing fields). No other change to the pipeline. Until then, leave it unsigned — the app works
fine, it's just the one-time prompt.

**Auto-update** is pre-wired-ish: `electron-updater` is already a dependency and `electron-builder`
emits `latest.yml` + `.blockmap`. To enable later: host the `dist/` artifacts at a static URL, add a
`publish` provider to the config, and call `autoUpdater.checkForUpdatesAndNotify()` on launch. (Signing
first is strongly recommended before auto-update.)

---

## 7. The app icon

The Windows icon is `apps/desktop/resources/icon.ico` (a multi-resolution ICO: 256/128/96/64/48/32/16).
It's generated from the brand icon `apps/web/src/app/icon.png` (512×512). To regenerate after a brand
change:

```bash
cd apps/desktop
cp ../web/src/app/icon.png resources/icon.png
magick resources/icon.png -define icon:auto-resize=256,128,96,64,48,32,16 resources/icon.ico
```

Both `resources/icon.png` and `resources/icon.ico` are committed (they're build inputs, not outputs).

---

## 8. Versioning a release

1. Bump `version` in `apps/desktop/package.json` (e.g. `0.1.0` → `0.1.1`). The version flows into the
   artifact filenames (`…-Setup-0.1.1.exe`) and the app's About/props.
2. Rebuild (§1).
3. Upload + share the new file. (With auto-update wired, clients would pull it automatically — not yet.)

Keep the version moving forward each time you hand out a new build so academies can tell which one they
have ("Setup-0.1.3").

---

## 9. Troubleshooting

| Symptom | Fix |
|--------|-----|
| Build: *"Electron … not found"* / missing binary | `pnpm --filter @academiq/desktop run rebuild:electron`, then rebuild. |
| `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND` | You ran the command from the repo root without the filter — use the `--filter @academiq/desktop` form, or `cd apps/desktop`. |
| First build is slow / downloads a lot | Normal — electron-builder fetches the Windows Electron runtime (~115 MB) + bundled Wine/NSIS once, then caches them. |
| App opens but says "failed to join" | Not a build issue — the app loads prod `acadmyq.com`; check the room link and that the API is up. See [10-DESKTOP-CLIENT.md](./10-DESKTOP-CLIENT.md). |
| Want to test the packaged app on macOS | You can't run a Windows `.exe` on macOS. Use `pnpm --filter @academiq/desktop dev` for local testing; the `.exe` is for Windows machines. |
| Need an unpacked build (no installer) to inspect | `pnpm --filter @academiq/desktop pack:win` → `dist/win-unpacked/`. |

---

**Summary:** `env -u ELECTRON_RUN_AS_NODE pnpm --filter @academiq/desktop dist:win` → grab
`apps/desktop/dist/AcademIQ Teacher-Setup-<version>.exe` → host it → tell academies **"More info → Run
anyway."** Sign with Azure Trusted Signing (~$10/mo) when you outgrow the prompt.
