# PrintShelf

Local desktop library for STL and 3MF files — grid thumbnails, live 3D preview, search, and Finder/Explorer integration. Built for large personal print archives.

Default library on Scott’s machine: `/Volumes/Crucial X9/3D Prints` (change anytime with **Choose folder**).

## Downloads (v0.1.0)

Built installers live in `release/`:

| Platform | File |
|----------|------|
| macOS (Apple Silicon) | `PrintShelf-0.1.0-arm64.dmg` |
| Windows (x64 portable) | `PrintShelf-0.1.0-win-x64.exe` |
| Windows (x64 zip) | `PrintShelf-0.1.0-win-x64.zip` |

These builds are **not code-signed**. That’s normal for early releases — use the first-launch steps below once per machine.

## First launch (macOS)

Gatekeeper will say the app can’t be opened because it’s from an unidentified developer.

1. Open the DMG and drag **PrintShelf** to **Applications** (or run it from the DMG).
2. If macOS blocks it, **don’t** just double-click again.
3. In Finder, **Control-click** (or right-click) **PrintShelf** → **Open**.
4. In the dialog, click **Open**.
5. After that once, normal double-clicks work.

Alternate: **System Settings → Privacy & Security**, scroll to the blocked-app message, click **Open Anyway**.

## First launch (Windows)

SmartScreen may say Windows protected your PC.

**Portable `.exe`**
1. Double-click `PrintShelf-0.1.0-win-x64.exe`.
2. If SmartScreen appears, click **More info**.
3. Click **Run anyway**.

**Zip**
1. Unzip `PrintShelf-0.1.0-win-x64.zip`.
2. Run `PrintShelf.exe` inside the folder.
3. Same **More info → Run anyway** if SmartScreen appears.

Windows Defender may scan on first run; that’s expected for unsigned apps.

## Dev run

```bash
export PATH="$HOME/.local/node/bin:$PATH"   # if using the local Node install
cd printshelf
npm install
npm run dev
```

Or: `./launch.sh`

## Package again

```bash
npm run dist:mac    # DMG
npm run dist:win    # Windows portable + zip
npm run dist        # both
```

## Stack

Electron · React · Vite · Three.js · JSZip (Bambu 3MF thumbs + meshes)

## License

**Free for personal use.** See [LICENSE](LICENSE).

Commercial / business use requires written permission — contact scott@frenchsolutionsllc.com.

