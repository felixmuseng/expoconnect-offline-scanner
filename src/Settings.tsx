import { useMemo, useState } from "react";
import * as printer from "./print";
import { PRESETS, type Settings } from "./settings";

type Props = {
  value: Settings;
  onChange: (s: Settings) => void;
  onClose: () => void;
  printerName: string | null;
  onTogglePrinter: () => void;
};

export function SettingsDialog({ value, onChange, onClose, printerName, onTogglePrinter }: Props) {
  const [note, setNote] = useState<string | null>(null);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...value, [k]: v });
  const preset = PRESETS.find((p) => p.widthMm === value.widthMm && p.heightMm === value.heightMm);
  const preview = useMemo(
    () => (value.engine === "tspl" ? printer.renderLabel(printer.SAMPLE, value).toDataURL() : null),
    [value],
  );

  async function test() {
    try {
      setNote(await printer.testPrint(value));
    } catch (e) {
      setNote((e as Error).message);
    }
  }

  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet lg" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>Settings</h2>
          <div className="spacer" />
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>

        <div className="sheet-body">
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
              <button className="btn" onClick={test}>
                Test print
              </button>
            </div>
            {note && <p className="note">{note}</p>}
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
                    if (p) onChange({ ...value, widthMm: p.widthMm, heightMm: p.heightMm });
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
            {preview && (
              <img
                className="label-preview"
                src={preview}
                alt="Label preview"
                style={{ aspectRatio: `${value.widthMm} / ${value.heightMm}` }}
              />
            )}
            <p className="hint">
              The preview is exactly what a TSPL printer puts on the label; QR cell and copies are what
              ESC/POS uses.
            </p>
          </div>
        </div>

        <div className="sheet-foot">
          <button className="btn primary" onClick={onClose}>
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
