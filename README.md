# Offline Check-in (test)

Client-only React app for Chrome/Edge. Opens the attendee CSV, scans QR with webcam, writes `CheckIn Time` back into the same file, prints a badge over WebUSB (ESC/POS).

CSV columns: `Attendee ID, Full Name, Email, Company, Job Title, CheckIn Time`. QR content = Attendee ID.

## Dev

```
npm install
npm run dev                    # http://localhost:8000
node scripts/make-sample.mjs   # sample/attendee_list.csv + sample/qr/*.png
```

## Use

1. Open CSV. Browser asks once for read/write access. The file stays remembered across reloads.
2. Connect printer (optional). Without it, prints go to the on-screen log.
3. Scan QR, type an ID, search by name/email, or click Print in the table. Each check-in rewrites the CSV in place.

## Docker Hub

```
IMAGE=docker.io/you/offline-checkin:latest ./publish.sh
```

Operator: Docker Desktop → search the image → Pull → Run with host port `8000` → open `http://localhost:8000` in Edge or Chrome. Or use the `out/docker/` folder (`start.bat`).

## Plain folder (no Docker)

```
./pack.sh   # -> out/offline-checkin-win/ with caddy.exe, start.bat, start.sh
```
