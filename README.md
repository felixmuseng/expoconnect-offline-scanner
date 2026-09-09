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
3. Scan a QR or type an ID. The scanner fills the page; nothing else needs scrolling.
4. The search button (top right) opens the attendee list: search by name or email, or
   Print and Reprint any row. Each check-in rewrites the CSV in place.

## Printer on Linux

The USB node is owned by group `lp`, so the browser gets `Failed to execute 'open' on
'USBDevice': Access denied.` Run once per machine:

```
./scripts/linux-printer-access.sh
```

It installs a udev rule that hands any USB printer to whoever is logged in at the
screen. Not printer-specific — it matches USB interface class 07, so it covers the
XP-420B and any other label or receipt printer.

Replug the printer, then reload the page. Windows and macOS need nothing.

The Docker image cannot do this: the browser holds the USB device, and the browser runs
on the host, outside the container.

## Docker Hub

One-time setup:

1. Create the account at https://hub.docker.com.
2. My Hub → Settings → **Default privacy** → Public. A `docker push` to a repository
   that does not exist yet creates it with this setting, so set it before the first push.
3. `docker login`

Then, per release:

```
./publish.sh              # build, tag, push, write out/docker/
./publish.sh --no-push    # build and tag only
```

Versions follow the QuantumBytes scheme, `ENV-YYYY.MM.PATCH-SHA`:

- `ENV` comes from the branch — `master`/`main`/`production` → `prod`, `stag` → `stag`, anything else → `dev`.
- `PATCH` counts releases within the calendar month, read back from the pushed git tags.
- Each release pushes three tags: the version, `ENV-latest`, and `latest`. The version is
  also pushed as a git tag, so a running container traces back to a commit.
- `.docker-version` records what was published.

Each release is one manifest list covering `linux/amd64` and `linux/arm64`. That
covers Windows and Intel Macs (Docker Desktop runs Linux containers on WSL 2 and
its Mac VM), Apple Silicon, and Linux on either architecture. No Windows-container
image exists or is needed.

Override the repository with `IMAGE_NAME=you/offline-checkin ./publish.sh`, or the
targets with `PLATFORMS=linux/amd64 ./publish.sh`.

Operator: Docker Desktop → search the image → Pull → Run → Optional settings → host port `8000` → open `http://localhost:8000` in Edge or Chrome. Or use the `out/docker/` folder (`start.bat`), which pins `prod-latest` so `update.bat` picks up the next release.

The image holds only the built app and nginx — the build stage is discarded, so `sample/`
and the repo never reach the published layers.

## Plain folder (no Docker)

```
./pack.sh   # -> out/offline-checkin-win/ with caddy.exe, start.bat, start.sh
```
