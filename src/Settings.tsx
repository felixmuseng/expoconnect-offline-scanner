import { useState } from "react";
import * as printer from "./print";
import { PRESETS, type Settings } from "./settings";
import { BadgeEditor } from "./BadgeEditor";

type Props = {
  value: Settings;
  onChange: (s: Settings) => void;
  onClose: () => void;
  printerName: string | null;
  onTogglePrinter: () => void;
  busy: boolean;
};

export function SettingsDialog({ value, onChange, onClose, printerName, onTogglePrinter, busy }: Props) {
  const [note, setNote] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testTexts, setTestTexts] = useState<{ name: string; country: string }>();
  const change = (next: Settings) => {
    try { onChange(next); setNote(null); return true; }
    catch { setNote("The settings could not be saved. Free browser storage and try again."); return false; }
  };
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => change({ ...value, [k]: v });
  const preset = PRESETS.find((p) => p.widthMm === value.widthMm && p.heightMm === value.heightMm);

  async function test(texts?: { name: string; country: string }) {
    if (testing || busy) return;
    setTesting(true);
    setTestTexts(texts);
    try {
      setNote(await printer.testPrint(value, texts));
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="scrim" onClick={() => { if (!testing) onClose(); }}>
      <div className={`sheet ${value.engine === "paper" ? "badge-settings" : "lg"}`} role="dialog" aria-modal="true" aria-label="Printer settings"
        onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (testing && e.key === "Escape") e.stopPropagation(); }}>
        <div className="sheet-head">
          <h2>Settings</h2>
          <div className="spacer" />
          <button className="icon-btn" onClick={onClose} disabled={testing} aria-label="Close">
            <XIcon />
          </button>
        </div>

        <div className="sheet-body">
          <div className="group">
            <h3>Printing system</h3>
            <label><span>Print with</span><select className="field" value={value.engine} disabled={busy || testing}
              onChange={(e) => set("engine", e.target.value as Settings["engine"])}>
              <option value="tspl">Thermal label printer (TSPL)</option>
              <option value="escpos">Thermal receipt printer (ESC/POS)</option>
              <option value="paper">Custom paper badge (office printer)</option>
            </select></label>
          </div>
          {value.engine === "paper" ? <>
            <div className="group">
              <h3>Office printer</h3>
              <p className="hint">Choose the office printer in the browser print dialog. A USB connection in this app is not required. Only the name and country are printed on the pre-printed paper.</p>
              <p className="hint">For printing without a dialog, start Chrome with --kiosk-printing and set the badge printer as the default printer.</p>
              <Num label="Copies" min={1} max={9} value={value.copies} onChange={(v) => { if (!testing && !busy) set("copies", Math.round(v)); }} />
            </div>
            <div className="group">
              <BadgeEditor value={value.paperLayout} onChange={(paperLayout) => change({ ...value, paperLayout })}
                onTest={test} disabled={testing || busy} />
            </div>
          </> : <>
          <div className="group">
            <h3>Printer</h3>
            <span className={printerName ? "chip live" : "chip"}>
              <span className="dot" />
              {printerName ??
                (printer.supported ? "Not connected — badges go to the log" : "WebUSB not available in this browser")}
            </span>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn" onClick={onTogglePrinter} disabled={!printer.supported}>
                {printerName ? "Disconnect" : "Connect printer"}
              </button>
              <button className="btn" onClick={() => test()} disabled={testing || busy}>
                Test print
              </button>
            </div>
          </div>

          <div className="group">
            <h3>Label</h3>
            <div className="grid2">
              <label>
                <span>Printer language</span>
                <select
                  className="field"
                  value={value.engine}
                  onChange={(e) => set("engine", e.target.value as Settings["engine"])}
                >
                  <option value="tspl">TSPL — label printer (XP-420B)</option>
                  <option value="escpos">ESC/POS — receipt printer</option>
                </select>
              </label>
              <label>
                <span>Paper size</span>
                <select
                  className="field"
                  value={preset ? preset.label : "custom"}
                  onChange={(e) => {
                    const p = PRESETS.find((x) => x.label === e.target.value);
                    if (p) change({ ...value, widthMm: p.widthMm, heightMm: p.heightMm });
                  }}
                >
                  {!preset && <option value="custom">Custom</option>}
                  {PRESETS.map((p) => (
                    <option key={p.label} value={p.label}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <Num label="Width (mm)" min={10} max={120} value={value.widthMm} onChange={(v) => set("widthMm", v)} />
              <Num label="Height (mm)" min={10} max={300} value={value.heightMm} onChange={(v) => set("heightMm", v)} />
              <Num label="Gap (mm)" min={0} max={10} value={value.gapMm} onChange={(v) => set("gapMm", v)} />
              <Num label="Copies" min={1} max={9} value={value.copies} onChange={(v) => set("copies", v)} />
              <Num label="Darkness (0–15)" min={0} max={15} value={value.density} onChange={(v) => set("density", v)} />
              <Num label="Speed (ips)" min={1} max={12} value={value.speed} onChange={(v) => set("speed", v)} />
              <Num label="QR cell (dots)" min={1} max={10} value={value.qrCell} onChange={(v) => set("qrCell", v)} />
            </div>
            <p className="hint">
              Label settings apply to TSPL printers, which size the QR to the label; QR cell and copies
              are what ESC/POS uses.
            </p>
          </div>
          </>}
          {note && <p className="note" role="status">{note}</p>}
          {value.engine === "paper" && note?.includes("PAPER print dialog closed") && <div className="badge-actions">
            <span>Did the badge print?</span><button className="btn" onClick={() => test(testTexts)} disabled={testing}>Reprint test badge</button>
          </div>}
        </div>

        <div className="sheet-foot">
          <button className="btn primary" onClick={onClose} disabled={testing}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function Num({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        className="field"
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
        }}
      />
    </label>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
