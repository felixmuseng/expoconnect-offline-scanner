# Offline Check-in

## What it is

A single-screen check-in desk for ExpoConnect events. Opens the attendee CSV the
organiser exported, scans an attendee's QR, writes `CheckIn Time` back into that
same file, and prints a thermal badge over USB or text on a pre-printed paper badge.

## Who uses it

One volunteer on a registration desk, standing, at the door of an exhibition
hall. Bright ambient light, a queue in front of them, a laptop they do not own
and did not configure. They have been shown the app once, five minutes ago.

## Constraints that shape the design

- **No internet.** No external fonts, CDN, or API at runtime. Badge fonts ship with the app and load from its local host.
- **No scrolling to do the job.** The scanner is the task. Anything that pushes
  it below the fold costs a scan.
- **Chrome or Edge only**, on `localhost`. Camera and WebUSB need a secure context.
- **The file is the database.** There is no server and no undo. A write lands in
  the operator's CSV immediately.
- **Speed over completeness.** A scan should resolve in one glance: who, and did
  it work.

## Register

Product. The tool disappears into the task. Familiar affordances, no decoration
that does not report state.

## Non-goals

- Editing or adding attendees. The CSV contract belongs to ExpoConnect.
- Multi-user or networked check-in. One laptop, one file.
- Mobile scanning. The desk uses a laptop. The paper badge editor can shrink to fit a smaller screen.

## Printing systems

- Thermal: keep the TSPL and ESC/POS USB paths and label controls.
- Paper: print the name and country through Chrome or Edge to an office printer.
- The same scan, list, batch, and reprint actions select the current printing system.
- Paper setup, guide photos, and named layouts stay in the local browser. Export the print layout to configure another desk.
- Paper printing asks the operator to confirm or reprint each badge. The browser cannot confirm physical output.
