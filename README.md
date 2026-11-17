# Offline Check-in (test)

Client-only React app for Chrome/Edge. Opens the attendee CSV, scans QR with webcam, writes `CheckIn Time` back into the same file, and prints a badge. Select a thermal printer over WebUSB (TSPL or ESC/POS), or an office printer for custom paper badges.

CSV columns: `Attendee ID, Full Name, Email, Phone Number, Company, Job Title, Country, CheckIn Time`. QR content = Attendee ID. Optional column: `Tier`, with blank or `VIP`.

Older files without `Country` or `Phone Number` still open. The app adds empty columns in memory. It writes these columns into the CSV with the next check-in or attendee edit. Country is shown in the list, edit fields, search results, and scan result.

The file is the one ExpoConnect exports, and it goes back into the same importer, so:

- `Attendee ID` is a UUID.
- `Tier` is optional. If it exists, each value is blank or `VIP`.
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
2. Open Settings and select the printing system. For thermal printing, connect the printer, select the label size, and use Test print. Without a connected thermal printer, prints go to the on-screen log. For paper printing, follow the steps below.
3. Scan a QR or type an ID. The scanner fills the page; nothing else needs scrolling.
4. The search button (top right) opens the attendee list: search by name or email, or
   Print and Reprint any row. Each check-in rewrites the CSV in place.

## Custom paper badges

1. Open Settings. Select **Custom paper badge (office printer)**.
2. Select the paper size and orientation. Presets: 100 × 150 mm, A6, A5, 4 × 6 in, and CR80. Custom width and height must be from 50 to 297 mm.
3. If necessary, choose a guide photo of the pre-printed badge. Use JPEG, PNG, or WebP, up to 5 MB and 20 megapixels. The editor checks the file signature and decodes the image. The photo stays in this browser and is never printed or exported.
4. Place the Country and Name boxes on the badge. Drag the boxes, use their side handles, or enter X, Y, and width in mm. Arrow keys move a box 0.5 mm. Shift + arrow moves it 5 mm. Alt turns off snapping during a drag.
5. Select the font, size, smallest size, bold setting, alignment, and colour for each box. The six fonts ship with the app: Inter, Geist, Manrope, Roboto, Lora, and Oswald. No internet connection is needed.
6. Use **Print test badge**. Test printing uses the preview name and country. Select the office printer in the browser print dialog.
7. Set the printer paper to the selected size, margins to **None**, and scale to **100%**. Turn off browser headers and footers. Check the result on real paper before you use the desk.

Paper mode prints only the name and country. It does not print the guide photo, QR code, company, or job title. The default layout puts the country at 55 mm from the top and the name at 68 mm. Text wraps and then shrinks to fit the free space. Text beyond the smallest size limit ends with an ellipsis. Boxes stay on the page and keep a gap where their widths overlap. The preview scales down to fit its panel and shows the scale.

The current setup is saved after each change. Save up to 50 named layouts in this browser. Apply copies a layout into the current setup. Rename and Delete affect the saved layout. Export and Import move the print layout between desks as a JSON file. Guide photos are not included. Replaced photos are removed when the current setup and saved layouts no longer use them. Clearing browser storage removes the setup, saved layouts, and photos.

Scanning, typing an ID, list printing, batch printing, and reprinting all use the selected printing system. The app reads the current local settings before each badge. Tabs on the same browser also refresh settings when they become visible. Other computers use their own settings; import the layout at each desk.

The browser cannot tell whether you printed or cancelled. Both close the print dialog and mark the badge as printed. After each paper print, **Did the badge print?** lets you reprint or continue. A batch waits for this answer before the next badge. **Stop batch** keeps completed check-ins and leaves the other badges selected. Each completed badge saves its check-in before the next badge starts. An existing check-in time is kept.

The print page waits for the bundled fonts. It stays open until the browser sends `afterprint`, with a 60-second backup. Print requests wait in order. Focus returns to the previous control after printing. **Next scan** returns focus to the ID field when the attendee list is closed. See the [browser afterprint reference](https://developer.mozilla.org/en-US/docs/Web/API/Window/afterprint_event).

For printing without a dialog, start Chrome with `--kiosk-printing` and set the badge printer as the default printer.

This offline app has no events, user accounts, API, R2 storage, or Prisma database. Its setup and layouts are local. The database migration described in the reference app does not apply here. Handle any Prisma migration or generation in the other app yourself.

## Checks before use

These changes have had a source review only. The app, compiler, and tests were not run.

- Open an older CSV without Country. Add a country in the edit fields and save. Open the file again and confirm the value.
- In paper mode, print a test badge and confirm its physical size and text position. Confirm that the guide photo is absent.
- Try a long name, an empty country, accented text, A5 landscape, and CR80. Confirm that text stays within the page and does not cover the other field.
- Scan an attendee, cancel the print dialog, and use Reprint. Confirm that the time is saved once and the next badge waits.
- Print a batch. Stop after one badge. Confirm that the remaining rows are still selected and have no new check-in time.
- Save, apply, rename, delete, export, and import a layout. Reload the browser and confirm the current setup. Disconnect the internet and repeat a paper print.
- Select each thermal system and confirm its existing USB output with the printer. Country is not added to thermal output.

## Printer on Linux

The USB node is owned by group `lp`, so the browser gets `Failed to execute 'open' on
'USBDevice': Access denied.` Run once per machine:

```
./scripts/linux-printer-access.sh          # from the repo
./linux-printer-access.sh                  # from an operator folder
```

Both operator folders ship the script, and `start.sh` reminds the operator if the rule
is missing.

Two things, neither printer-specific — both match USB interface class 07, so they cover
the XP-420B and any other label or receipt printer:

- a udev rule handing the device to whoever is logged in at the screen (`uaccess`, plus
  group `plugdev` where logind sets no ACL). Without it: `open` fails.
- a blacklist for the `usblp` kernel driver, which otherwise holds the printer interface
  and makes `claimInterface` fail. CUPS still prints — its usb backend talks libusb.

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
