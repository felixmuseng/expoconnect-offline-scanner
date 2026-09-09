# Offline Check-in (test)

Client-only React app for Chrome/Edge. Opens the attendee CSV, scans QR with webcam, writes `CheckIn Time` back into the same file, prints a badge over WebUSB (TSPL label printers, or ESC/POS receipt printers).

CSV columns: `Attendee ID, Full Name, Email, Company, Job Title, CheckIn Time`. QR content = Attendee ID.

The file is the one ExpoConnect exports, and it goes back into the same importer, so:

- `Attendee ID` is a UUID.
- `CheckIn Time` is `YYYY-MM-DD HH:mm:ss` in WIB, whatever the laptop clock is set to.
- A row that already has a time keeps it; a second scan only reprints the badge.

## Dev

```
npm install
npm run dev                    # http://localhost:8000
node scripts/make-sample.mjs   # sample/attendee_list.csv + sample/qr/*.png
```

## Use

1. Open CSV. Browser asks once for read/write access. The file stays remembered across reloads.
2. Settings → Connect printer, pick the engine and label size, Test print. Without a printer, prints go to the on-screen log.
3. Scan QR, type an ID, search by name/email, or click Print in the table. Each check-in rewrites the CSV in place.

## Docker Hub

One-time setup:

1. Create the account at https://hub.docker.com.
2. My Hub → Settings → **Default privacy** → Public. A `docker push` to a repository
   that does not exist yet creates it with this setting, so set it before the first push.
3. `docker login`

Then, per release:

```
IMAGE=docker.io/you/offline-checkin:latest ./publish.sh
```

Operator: Docker Desktop → search the image → Pull → Run with host port `8000` → open `http://localhost:8000` in Edge or Chrome. Or use the `out/docker/` folder (`start.bat`).

The image holds only the built app and nginx — the build stage is discarded, so `sample/`
and the repo never reach the published layers.

## Plain folder (no Docker)

```
./pack.sh   # -> out/offline-checkin-win/ with caddy.exe, start.bat, start.sh
```
