# Offline Check-in (test)

Client-only React app. Import attendee xlsx, scan QR with webcam, mark check-in, export xlsx. Printing is mocked.

## Dev

```
npm install
npm run dev        # http://localhost:8000
```

## Windows package

```
./pack.sh          # -> out/offline-checkin-win/
```

Copy that folder to the laptop. Double-click `start.bat`. It starts `caddy.exe` on `127.0.0.1:8000` and opens Edge in app mode. `stop.bat` kills the server.

Data lives in the browser's localStorage for `localhost:8000`. Reset button clears it.
