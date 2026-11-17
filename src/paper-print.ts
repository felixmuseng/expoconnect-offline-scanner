import { boxHeight, fitText, loadBadgeFonts, normalizeLayout, printFontCss, type PaperLayout } from "./paper-layout";

let queue: Promise<void> = Promise.resolve();

// A print job owns its frame until the print dialog closes.
export function printPaperBadge(texts: { name: string; country: string }, rawLayout: PaperLayout, copies = 1): Promise<void> {
  const layout = normalizeLayout(rawLayout);
  const run = queue.catch(() => undefined).then(() => printFrame(texts, layout, copies));
  queue = run;
  return run;
}

async function printFrame(texts: { name: string; country: string }, layout: PaperLayout, copies: number): Promise<void> {
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const frame = document.createElement("iframe");
  frame.title = "Paper badge print";
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, { position: "fixed", left: "-10000px", top: "0", width: "1px", height: "1px", border: "0" });
  try {
    const loaded = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("The badge print page did not load.")), 10000);
      frame.onload = () => { window.clearTimeout(timeout); resolve(); };
    });
    // Only fixed CSS is written here. Attendee values are assigned with textContent below.
    frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>Badge</title><style>
      ${printFontCss()}
      @page { size: ${layout.widthMm}mm ${layout.heightMm}mm; margin: 0; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      .badge { position: relative; width: ${layout.widthMm}mm; height: ${layout.heightMm}mm;
        overflow: hidden; break-after: page; page-break-after: always; }
      .badge:last-child { break-after: auto; page-break-after: auto; }
      .text { position: absolute; margin: 0; padding: 0; white-space: pre; overflow: hidden;
        line-height: 1.15; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      </style></head><body></body></html>`;
    document.body.append(frame);
    await loaded;
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win) throw new Error("The badge print page is not available.");
    await loadBadgeFonts(doc, layout, texts);
    for (let i = 0; i < Math.min(9, Math.max(1, Math.floor(copies))); i++) {
      const page = doc.createElement("div");
      page.className = "badge";
      for (const field of ["country", "name"] as const) {
        const box = layout[field];
        const height = boxHeight(layout, field);
        const fit = fitText(doc, texts[field], box, height);
        const element = doc.createElement("div");
        element.className = "text";
        element.textContent = fit.text;
        Object.assign(element.style, { left: `${box.x}mm`, top: `${box.y}mm`, width: `${box.width}mm`,
          height: `${height}mm`, fontFamily: `"${box.font}"`, fontSize: `${fit.size}pt`,
          fontWeight: box.bold ? "700" : "400", textAlign: box.align, color: box.color });
        page.append(element);
      }
      doc.body.append(page);
    }
    await doc.fonts.ready;
    await new Promise<void>((resolve, reject) => {
      // Chromium print() blocks while its dialog is open. The timer is a backup
      // for installations that do not deliver afterprint.
      const timeout = window.setTimeout(finish, 60000);
      function finish() {
        window.clearTimeout(timeout);
        win!.removeEventListener("afterprint", finish);
        resolve();
      }
      win.addEventListener("afterprint", finish, { once: true });
      try {
        win.focus();
        win.print();
      } catch (error) {
        window.clearTimeout(timeout);
        win.removeEventListener("afterprint", finish);
        reject(error);
      }
    });
  } finally {
    frame.remove();
    if (active?.isConnected) active.focus({ preventScroll: true });
  }
}
