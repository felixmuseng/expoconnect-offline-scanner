import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { BADGE_FONTS, PAPER_PRESETS, PX_PER_MM, boxHeight, clamp, defaultPaperLayout, fitText,
  loadBadgeFonts, normalizeLayout, printFontCss, resizeLayout, snapBox, type BadgeField, type PaperLayout, type TextBox } from "./paper-layout";
import { changeLayouts, cleanGuides, exportLayout, importLayout, readGuide, readLayouts, saveGuide, type SavedLayout } from "./badge-storage";

type Gesture = { field: BadgeField; mode: "move" | "left" | "right"; clientX: number; clientY: number; box: TextBox; scale: number };
const SAMPLE = { name: "Zoë Ñúñez-Gonçalves", country: "Côte d’Ivoire" };
const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
};

export function BadgeEditor({ value, onChange, onTest, disabled }: {
  value: PaperLayout; onChange: (layout: PaperLayout) => boolean; onTest: (texts: typeof SAMPLE) => void; disabled: boolean;
}) {
  const [field, setField] = useState<BadgeField>("name");
  const [scale, setScale] = useState(1);
  const [texts, setTexts] = useState(SAMPLE);
  const [fits, setFits] = useState<Record<BadgeField, ReturnType<typeof fitText>> | null>(null);
  const [guideUrl, setGuideUrl] = useState<string>();
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  const [templates, setTemplates] = useState<SavedLayout[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [layoutName, setLayoutName] = useState("");
  const [note, setNote] = useState("");
  const [working, setWorking] = useState(false);
  const canvasHost = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const box = value[field];
  const preset = PAPER_PRESETS.find((p) => p.widthMm === Math.min(value.widthMm, value.heightMm)
    && p.heightMm === Math.max(value.widthMm, value.heightMm));
  const overlap = Math.abs(value.name.y - value.country.y) < 1 ||
    boxHeight(value, "name") < value.name.fontSize * 25.4 / 72 * 1.15 ||
    boxHeight(value, "country") < value.country.fontSize * 25.4 / 72 * 1.15;

  useEffect(() => {
    try { setTemplates(readLayouts()); } catch (e) { setNote((e as Error).message); }
  }, []);

  useEffect(() => {
    if (!canvasHost.current) return;
    const observer = new ResizeObserver(([entry]) => setScale(Math.min(1, entry.contentRect.width / (value.widthMm * PX_PER_MM))));
    observer.observe(canvasHost.current);
    return () => observer.disconnect();
  }, [value.widthMm]);

  useEffect(() => {
    let cancelled = false;
    loadBadgeFonts(document, value, texts).then(() => {
      if (!cancelled) setFits({ name: fitText(document, texts.name, value.name, boxHeight(value, "name")),
        country: fitText(document, texts.country, value.country, boxHeight(value, "country")) });
    }).catch((e) => { if (!cancelled) setNote((e as Error).message); });
    return () => { cancelled = true; };
  }, [value, texts]);

  useEffect(() => {
    let cancelled = false;
    let url: string | undefined;
    setGuideUrl(undefined);
    if (value.guideId) readGuide(value.guideId).then((blob) => {
      if (cancelled) return;
      if (blob) { url = URL.createObjectURL(blob); setGuideUrl(url); }
      else setNote("The guide photo is not on this browser. Choose the photo again.");
    }).catch((e) => { if (!cancelled) setNote((e as Error).message); });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [value.guideId]);

  const updateBox = (changes: Partial<TextBox>) => onChange(normalizeLayout({ ...value, [field]: { ...box, ...changes } }));
  const start = (e: ReactPointerEvent<HTMLElement>, item: BadgeField, mode: Gesture["mode"]) => {
    if (disabled || working || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus({ preventScroll: true });
    setField(item);
    gesture.current = { field: item, mode, clientX: e.clientX, clientY: e.clientY, box: { ...value[item] }, scale };
  };
  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const drag = gesture.current;
    if (!drag || disabled || working) return;
    const dx = (e.clientX - drag.clientX) / (PX_PER_MM * drag.scale);
    const dy = (e.clientY - drag.clientY) / (PX_PER_MM * drag.scale);
    let next = { ...drag.box };
    let lines: { x?: number; y?: number } = {};
    if (drag.mode === "move") {
      next.x += dx;
      next.y += dy;
      if (!e.altKey) {
        const snapped = snapBox(value, drag.field, next);
        next = snapped.box;
        lines = snapped;
      }
    } else if (drag.mode === "right") {
      next.width = clamp(drag.box.width + dx, 10, value.widthMm - drag.box.x);
    } else {
      next.x = clamp(drag.box.x + dx, 0, drag.box.x + drag.box.width - 10);
      next.width = drag.box.width + drag.box.x - next.x;
    }
    setGuides(lines);
    onChange(normalizeLayout({ ...value, [drag.field]: next }));
  };
  const stop = () => { gesture.current = null; setGuides({}); };

  async function task(action: () => Promise<void>) {
    setWorking(true);
    setNote("");
    try { await action(); } catch (e) { setNote((e as Error).message); }
    finally { setWorking(false); }
  }

  return (
    <div className="badge-editor">
      <style>{printFontCss()}</style>
      <fieldset disabled={disabled || working} className="badge-controls">
        <legend>Paper badge</legend>
        <div className="grid2">
          <label><span>Paper size</span><select className="field" value={preset?.label ?? "custom"} onChange={(e) => {
            const p = PAPER_PRESETS.find((item) => item.label === e.target.value);
            if (p) onChange(resizeLayout(value, value.widthMm > value.heightMm ? p.heightMm : p.widthMm,
              value.widthMm > value.heightMm ? p.widthMm : p.heightMm));
          }}><option value="custom">Custom</option>{PAPER_PRESETS.map((p) => <option key={p.label}>{p.label}</option>)}</select></label>
          <label><span>Orientation</span><select className="field" value={value.widthMm > value.heightMm ? "landscape" : "portrait"}
            onChange={(e) => {
              const landscape = e.target.value === "landscape";
              const small = Math.min(value.widthMm, value.heightMm);
              const large = Math.max(value.widthMm, value.heightMm);
              onChange(resizeLayout(value, landscape ? large : small, landscape ? small : large));
            }}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label>
          <NumberField label="Width (mm)" value={value.widthMm} min={50} max={297} onChange={(n) => onChange(resizeLayout(value, n, value.heightMm))} />
          <NumberField label="Height (mm)" value={value.heightMm} min={50} max={297} onChange={(n) => onChange(resizeLayout(value, value.widthMm, n))} />
        </div>
        <p className="hint">Use Chrome or Edge. Set the printer paper to this size. Set margins to None and scale to 100%. Turn off headers and footers.</p>
        <div className="badge-workspace">
          <div className="badge-preview-panel">
            <div className="badge-canvas-host" ref={canvasHost}>
              <div style={{ width: value.widthMm * PX_PER_MM * scale, height: value.heightMm * PX_PER_MM * scale }}>
                <div className="badge-page" style={{ width: value.widthMm * PX_PER_MM, height: value.heightMm * PX_PER_MM,
                  transform: `scale(${scale})` }}>
                  {guideUrl && <img className="badge-guide" src={guideUrl} alt="Badge alignment guide" draggable={false} style={{ opacity: value.guideOpacity }} />}
                  {(["country", "name"] as const).map((item) => {
                    const b = value[item];
                    const fit = fits?.[item];
                    return <div key={item} role="button" tabIndex={disabled || working ? -1 : 0}
                      aria-label={`Move ${item} text box`} aria-pressed={field === item}
                      className={`badge-box ${field === item ? "selected" : ""}`}
                      style={{ left: b.x * PX_PER_MM, top: b.y * PX_PER_MM, width: b.width * PX_PER_MM,
                        height: boxHeight(value, item) * PX_PER_MM, fontFamily: `"${b.font}"`, fontSize: `${fit?.size ?? b.fontSize}pt`,
                        fontWeight: b.bold ? 700 : 400, textAlign: b.align, color: b.color }}
                      onFocus={() => setField(item)} onPointerDown={(e) => start(e, item, "move")}
                      onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (disabled || working) return;
                        const step = e.shiftKey ? 5 : 0.5;
                        const delta = ARROWS[e.key];
                        if (!delta) return;
                        e.preventDefault();
                        onChange(normalizeLayout({ ...value, [item]: { ...b, x: b.x + delta[0] * step, y: b.y + delta[1] * step } }));
                      }}>
                      <span className="badge-box-text">{fit?.text ?? texts[item]}</span>
                      {field === item && <>
                        <span className="badge-handle left" onPointerDown={(e) => start(e, item, "left")} />
                        <span className="badge-handle right" onPointerDown={(e) => start(e, item, "right")} />
                      </>}
                    </div>;
                  })}
                  {guides.x !== undefined && <div className="badge-snap vertical" style={{ left: guides.x * PX_PER_MM }} />}
                  {guides.y !== undefined && <div className="badge-snap horizontal" style={{ top: guides.y * PX_PER_MM }} />}
                </div>
              </div>
            </div>
            <p className="hint">Shown at {Math.round(scale * 100)}% of actual size ({value.widthMm.toFixed(1)} × {value.heightMm.toFixed(1)} mm).</p>
            <p className="hint">Drag a box to move it. Drag a side handle to change its width. Use arrow keys for 0.5 mm, or Shift + arrow for 5 mm. Hold Alt to turn off snapping.</p>
            {overlap && <p className="banner info">The text boxes are close. Text will shrink to fit the free space. Boxes are kept apart.</p>}
            {(fits?.name.truncated || fits?.country.truncated) && <p className="banner info">Some preview text is too long. Increase the box width or reduce the smallest font size.</p>}
          </div>
          <div className="badge-side">
            <div className="grid2">
              <label><span>Text box</span><select className="field" value={field} onChange={(e) => setField(e.target.value as BadgeField)}>
                <option value="name">Name</option><option value="country">Country</option></select></label>
              <label><span>Font</span><select className="field" value={box.font} onChange={(e) => updateBox({ font: e.target.value as TextBox["font"] })}>
                {BADGE_FONTS.map((font) => <option key={font}>{font}</option>)}</select></label>
              <NumberField label="Font size (pt)" value={box.fontSize} min={box.minFontSize} max={120} onChange={(fontSize) => updateBox({ fontSize })} />
              <NumberField label="Smallest size (pt)" value={box.minFontSize} min={6} max={48} onChange={(minFontSize) => updateBox({ minFontSize, fontSize: Math.max(box.fontSize, minFontSize) })} />
              <label><span>Alignment</span><select className="field" value={box.align} onChange={(e) => updateBox({ align: e.target.value as TextBox["align"] })}>
                <option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option></select></label>
              <label><span>Colour</span><input className="field badge-color" type="color" value={box.color} onChange={(e) => updateBox({ color: e.target.value })} /></label>
              <NumberField label="X (mm)" value={box.x} min={0} max={value.widthMm - box.width} onChange={(x) => updateBox({ x })} />
              <NumberField label="Y (mm)" value={box.y} min={0} max={value.heightMm - box.minFontSize * 25.4 / 72 * 1.15} onChange={(y) => updateBox({ y })} />
              <NumberField label="Box width (mm)" value={box.width} min={10} max={value.widthMm - box.x} onChange={(width) => updateBox({ width })} />
              <label className="badge-check"><input type="checkbox" checked={box.bold} onChange={(e) => updateBox({ bold: e.target.checked })} /> Bold</label>
              <label><span>Preview name</span><input className="field" value={texts.name} onChange={(e) => setTexts({ ...texts, name: e.target.value })} /></label>
              <label><span>Preview country</span><input className="field" value={texts.country} onChange={(e) => setTexts({ ...texts, country: e.target.value })} /></label>
            </div>
            <div className="badge-actions">
              <button className="btn" type="button" onClick={() => void task(async () => {
                if (onChange(defaultPaperLayout())) await cleanGuides([value.guideId]);
              })}>Reset to default layout</button>
              <button className="btn primary" type="button" onClick={() => onTest(texts)}>Print test badge</button>
            </div>
            <div className="group">
              <h3>Guide photo</h3>
              <input className="field" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose guide photo" onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void task(async () => {
                  const guideId = await saveGuide(file);
                  if (onChange({ ...value, guideId })) await cleanGuides([value.guideId]);
                  else await cleanGuides([guideId]);
                });
              }} />
              <p className="hint">JPEG, PNG, or WebP. Maximum 5 MB and 20 megapixels. The photo is stored on this browser. It is never printed or exported.</p>
              <label><span>Photo visibility ({Math.round(value.guideOpacity * 100)}%)</span><input type="range" min={0} max={1} step={0.05} value={value.guideOpacity}
                onChange={(e) => onChange({ ...value, guideOpacity: Number(e.target.value) })} /></label>
              <button className="btn sm" type="button" disabled={!value.guideId} onClick={() => void task(async () => {
                const next = { ...value }; delete next.guideId;
                if (onChange(next)) await cleanGuides([value.guideId]);
              })}>Remove guide photo</button>
            </div>
          </div>
        </div>
        <div className="group">
          <h3>Saved layouts</h3>
          <p className="hint">Layouts belong to this browser. Export a layout to use the same setup at another desk. The current setup is saved after each change.</p>
          <div className="grid2">
            <label><span>Saved layout</span><select className="field" value={templateId} onChange={(e) => {
              setTemplateId(e.target.value); setLayoutName(templates.find((t) => t.id === e.target.value)?.name ?? "");
            }}><option value="">Choose a layout</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
            <label><span>Layout name</span><input className="field" maxLength={100} value={layoutName} onChange={(e) => setLayoutName(e.target.value)} /></label>
          </div>
          <div className="badge-actions">
            <button className="btn" type="button" disabled={!templateId} onClick={() => void task(async () => {
              const item = templates.find((t) => t.id === templateId);
              if (item && onChange(normalizeLayout(item.layout))) {
                await cleanGuides([value.guideId]); setNote(`Applied layout: ${item.name}`);
              }
            })}>Apply</button>
            <button className="btn" type="button" disabled={!layoutName.trim()} onClick={() => void task(async () => {
              const id = crypto.randomUUID();
              const items = await changeLayouts((current) => [...current, { id, name: layoutName.trim(), layout: normalizeLayout(value) }]);
              setTemplates(items); setTemplateId(id); setNote("Layout saved.");
            })}>Save new layout</button>
            <button className="btn" type="button" disabled={!templateId || !layoutName.trim()} onClick={() => void task(async () => {
              setTemplates(await changeLayouts((current) => current.map((t) => t.id === templateId ? { ...t, name: layoutName.trim() } : t)));
              setNote("Layout renamed.");
            })}>Rename</button>
            <button className="btn" type="button" disabled={!templateId} onClick={() => void task(async () => {
              const oldGuide = templates.find((t) => t.id === templateId)?.layout.guideId;
              setTemplates(await changeLayouts((current) => current.filter((t) => t.id !== templateId)));
              setTemplateId(""); setLayoutName(""); await cleanGuides([oldGuide]); setNote("Layout deleted.");
            })}>Delete</button>
            <button className="btn" type="button" onClick={() => exportLayout(value)}>Export layout</button>
            <label className="btn badge-import">Import layout<input type="file" accept=".json,application/json" onChange={(e) => {
              const file = e.target.files?.[0]; e.target.value = "";
              if (file) void task(async () => {
                if (file.size > 100000) throw new Error("The layout file is too large.");
                if (onChange(importLayout(await file.text()))) {
                  await cleanGuides([value.guideId]); setNote("Layout imported.");
                }
              });
            }} /></label>
          </div>
        </div>
      </fieldset>
      {note && <p className="note" role="status">{note}</p>}
    </div>
  );
}

function NumberField({ label, value, min, max, onChange }: {
  label: string; value: number; min: number; max: number; onChange: (value: number) => void;
}) {
  // Keep partial input while the operator types; commit on blur or Enter.
  const [text, setText] = useState(String(Math.round(value * 100) / 100));
  useEffect(() => setText(String(Math.round(value * 100) / 100)), [value]);
  const commit = () => {
    const parsed = Number(text);
    if (text.trim() && Number.isFinite(parsed)) {
      const next = clamp(parsed, min, max);
      setText(String(Math.round(next * 100) / 100));
      onChange(next);
    } else setText(String(Math.round(value * 100) / 100));
  };
  return <label><span>{label}</span><input className="field" type="number" step={0.1} min={min} max={max} value={text}
    onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }} /></label>;
}
