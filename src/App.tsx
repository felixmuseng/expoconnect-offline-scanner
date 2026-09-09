import { useEffect, useState } from "react";
import { Scanner } from "./Scanner";
import { SettingsDialog } from "./Settings";
import { parseCsv, serializeCsv, type Csv, type Row } from "./csv";
import * as fs from "./file";
import * as printer from "./print";
import { loadSettings, saveSettings, type Settings } from "./settings";
import { COL, REQUIRED, findById, now, search } from "./store";

type Result =
  | { kind: "ok"; row: Row }
  | { kind: "dup"; row: Row }
  | { kind: "miss"; id: string }
  | { kind: "error"; message: string };

type Doc = Csv & { handle: FileSystemFileHandle; name: string };

export function App() {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [locked, setLocked] = useState<FileSystemFileHandle | null>(null); // saved file awaiting permission click
  const [result, setResult] = useState<Result | null>(null);
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [printerName, setPrinterName] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  useEffect(() => {
    if (!fs.supported) return;
    fs.savedHandle().then(async (h) => {
      if (!h) return;
      if (await fs.hasPermission(h, false)) await openHandle(h);
      else setLocked(h);
    });
  }, []);

  // Reclaim a printer the browser already has permission for, and notice unplugs.
  useEffect(() => {
    printer.setOnChange(() => setPrinterName(printer.printerName()));
    printer.restorePrinter().then(() => setPrinterName(printer.printerName()));
    return () => printer.setOnChange(null);
  }, []);

  useEffect(() => saveSettings(settings), [settings]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (result && result.kind !== "error") setResult(null);
      else if (showSearch) setShowSearch(false);
      else if (showSettings) setShowSettings(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [result, showSearch, showSettings]);

  // A USB scanner is a keyboard: it types the ID then presses Enter. Catch that
  // anywhere on the page, so a scan still lands when no field has focus.
  useEffect(() => {
    if (!doc) return;
    let buffer = "";
    let lastAt = 0;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      const at = Date.now();
      if (at - lastAt > 200) buffer = ""; // a human pausing, not a scanner burst
      lastAt = at;
      if (e.key === "Enter") {
        const code = buffer.trim();
        buffer = "";
        if (code.length >= 4) handleScan(code);
        return;
      }
      if (e.key.length === 1) buffer += e.key;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc, busy, settings]);

  async function openHandle(h: FileSystemFileHandle) {
    try {
      const csv = parseCsv(await fs.readText(h));
      const missing = REQUIRED.filter((c) => !csv.headers.includes(c));
      if (missing.length) throw new Error(`Missing columns: ${missing.join(", ")}`);
      setDoc({ ...csv, handle: h, name: h.name });
      setLocked(null);
      setResult(null);
    } catch (e) {
      setResult({ kind: "error", message: (e as Error).message });
    }
  }

  async function pick() {
    try {
      const h = await fs.pickCsv();
      if (!(await fs.hasPermission(h, true))) throw new Error("Write access to the CSV was denied");
      await openHandle(h);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setResult({ kind: "error", message: (e as Error).message });
    }
  }

  async function unlock() {
    if (locked && (await fs.hasPermission(locked, true))) await openHandle(locked);
  }

  async function close() {
    await fs.forgetHandle();
    setDoc(null);
    setResult(null);
  }

  // Marks the row (unless already marked and not forced), writes the CSV in place, prints.
  async function checkIn(row: Row, force = false) {
    if (!doc || busy) return;
    if (row[COL.time] && !force) return setResult({ kind: "dup", row });
    setBusy(true);
    try {
      if (!row[COL.time]) {
        row[COL.time] = now();
        const next = { ...doc, rows: [...doc.rows] };
        setDoc(next);
        await fs.writeText(doc.handle, serializeCsv(next));
      }
      setResult({ kind: "ok", row });
      const line = await printer.printBadge(row, settings);
      setLog((l) => [line, ...l].slice(0, 100));
    } catch (e) {
      setResult({ kind: "error", message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  function handleScan(text: string) {
    if (!doc) return;
    const row = findById(doc.rows, text);
    row ? checkIn(row) : setResult({ kind: "miss", id: text.trim() });
  }

  async function togglePrinter() {
    try {
      if (printerName) await printer.disconnectPrinter();
      else await printer.connectPrinter();
      setPrinterName(printer.printerName());
    } catch (e) {
      if ((e as Error).name !== "NotFoundError") setResult({ kind: "error", message: (e as Error).message });
    }
  }

  if (!fs.supported)
    return (
      <div className="shell">
        <main className="empty">
          <div className="empty-inner">
            <h2>Wrong browser</h2>
            <p>This app needs Chrome or Edge. It writes check-ins straight into your CSV, which other browsers cannot do.</p>
          </div>
        </main>
      </div>
    );

  const checked = doc?.rows.filter((r) => r[COL.time]).length ?? 0;
  const hits = doc ? search(doc.rows, query) : [];
  // Anything covering the stage. The error banner is not one: it sits above the
  // stage and only a scan clears it, so pausing on it would strand the scanner.
  const covered = showSearch || showSettings || (result !== null && result.kind !== "error");

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <h1>Offline Check-in</h1>
          {doc && <span className="file">{doc.name}</span>}
        </div>
        <div className="spacer" />

        {doc && (
          <div className="count">
            <b>{checked}</b>
            <span>/ {doc.rows.length} checked in</span>
          </div>
        )}

        <span className={printerName ? "chip live" : "chip"} title={printerName ?? "No printer connected"}>
          <span className="dot" />
          {printerName ?? "No printer"}
        </span>

        {doc && (
          <button className="icon-btn" onClick={() => setShowSearch(true)} title="Search and attendee list" aria-label="Search and attendee list">
            <SearchIcon />
          </button>
        )}
        <button className="icon-btn" onClick={() => setShowSettings(true)} title="Settings" aria-label="Settings">
          <GearIcon />
        </button>
        {doc && (
          <button className="btn quiet sm" onClick={close}>
            Close file
          </button>
        )}
      </header>

      {locked && !doc && (
        <div className="bar">
          <p className="banner info">
            Last file: <b>{locked.name}</b>
            <button className="btn sm primary" onClick={unlock}>
              Reopen
            </button>
          </p>
        </div>
      )}
      {result?.kind === "error" && (
        <div className="bar">
          <p className="banner err">{result.message}</p>
        </div>
      )}

      {doc ? (
        <main className="stage">
          <Scanner onScan={handleScan} paused={busy || covered} />
          <form
            className="entry"
            onSubmit={(e) => {
              e.preventDefault();
              handleScan(manual);
              setManual("");
            }}
          >
            <input
              className="field"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="Type or USB-scan an Attendee ID"
            />
            <button className="btn primary lg" type="submit" disabled={busy}>
              Check in
            </button>
          </form>
        </main>
      ) : (
        <main className="empty">
          <div className="empty-inner">
            <h2>Open the attendee list</h2>
            <p>Pick the CSV exported from ExpoConnect. Check-in times are written straight back into that same file, so keep it where it is.</p>
            <button className="btn primary lg" onClick={pick}>
              Open CSV
            </button>
          </div>
        </main>
      )}

      {doc && (
        <footer>
          <div className="activity">
            <span className="last">{log[0] ?? "No badges printed yet"}</span>
            <button className="btn quiet sm" onClick={() => setShowLog((v) => !v)} disabled={log.length === 0}>
              {showLog ? "Hide log" : `Print log (${log.length})`}
            </button>
          </div>
          {showLog && log.length > 0 && <pre className="log">{log.join("\n")}</pre>}
        </footer>
      )}

      {showSearch && doc && (
        <SearchDialog
          rows={doc.rows}
          headers={doc.headers}
          hits={hits}
          query={query}
          onQuery={setQuery}
          busy={busy}
          onPrint={checkIn}
          onClose={() => setShowSearch(false)}
        />
      )}

      {result && result.kind !== "error" && <ResultDialog r={result} onClose={() => setResult(null)} />}

      {showSettings && (
        <SettingsDialog
          value={settings}
          onChange={setSettings}
          onClose={() => setShowSettings(false)}
          printerName={printerName}
          onTogglePrinter={togglePrinter}
        />
      )}
    </div>
  );
}

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

function SearchDialog({
  rows,
  headers,
  hits,
  query,
  onQuery,
  busy,
  onPrint,
  onClose,
}: {
  rows: Row[];
  headers: string[];
  hits: Row[];
  query: string;
  onQuery: (q: string) => void;
  busy: boolean;
  onPrint: (r: Row, force: boolean) => void;
  onClose: () => void;
}) {
  const searching = query.length >= 2;
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet xl" onClick={(e) => e.stopPropagation()}>
        <div className="search-head">
          <input
            className="field"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search by full name or email"
            /* biome-ignore lint/a11y/noAutofocus: the operator opened this to type. */
            autoFocus
          />
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>

        <div className="sheet-body flush">
          {searching ? (
            <ul className="rows">
              {hits.length === 0 && <li className="none">Nobody matches “{query}”</li>}
              {hits.map((r) => (
                <li key={r[COL.id]}>
                  <span className="avatar">{initials(r[COL.name])}</span>
                  <span className="who">
                    <b>{r[COL.name]}</b>
                    <span>
                      {r[COL.email]} · {r[COL.company] || "—"}
                    </span>
                  </span>
                  <PrintButton row={r} busy={busy} onPrint={onPrint} />
                </li>
              ))}
            </ul>
          ) : (
            <table>
              <thead>
                <tr>
                  {headers.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r[COL.id]} className={r[COL.time] ? "done" : ""}>
                    {headers.map((h) => (
                      <td key={h}>{r[h]}</td>
                    ))}
                    <td>
                      <PrintButton row={r} busy={busy} onPrint={onPrint} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function PrintButton({ row, busy, onPrint }: { row: Row; busy: boolean; onPrint: (r: Row, force: boolean) => void }) {
  const done = Boolean(row[COL.time]);
  return (
    <button className={done ? "btn sm" : "btn sm primary"} disabled={busy} onClick={() => onPrint(row, done)}>
      {done ? "Reprint" : "Print"}
    </button>
  );
}

function ResultDialog({ r, onClose }: { r: Exclude<Result, { kind: "error" }>; onClose: () => void }) {
  const title = r.kind === "ok" ? "Checked in" : r.kind === "dup" ? "Already checked in" : "Not on the list";
  return (
    <div className="scrim" onClick={onClose}>
      <div className={`sheet md ${r.kind}`} onClick={(e) => e.stopPropagation()}>
        <div className="result-head">
          <div className="mark">{r.kind === "ok" ? <CheckIcon /> : <AlertIcon />}</div>
          <h2>{title}</h2>
          {r.kind !== "miss" && r.row[COL.time] && <p>{r.row[COL.time]}</p>}
        </div>

        <div className="sheet-body">
          {r.kind === "miss" ? (
            <dl className="facts" style={{ marginTop: 0, paddingTop: 0, borderTop: "none" }}>
              <div className="wide">
                <dt>Scanned code</dt>
                <dd>
                  <code>{r.id}</code>
                </dd>
              </div>
            </dl>
          ) : (
            <>
              <div className="identity">
                <span className="avatar lg">{initials(r.row[COL.name])}</span>
                <div>
                  <p className="name">{r.row[COL.name]}</p>
                  <p>{[r.row[COL.title], r.row[COL.company]].filter(Boolean).join(" · ") || "—"}</p>
                </div>
              </div>
              <dl className="facts">
                <div>
                  <dt>Email</dt>
                  <dd>{r.row[COL.email] || "—"}</dd>
                </div>
                <div>
                  <dt>Checked in</dt>
                  <dd>{r.row[COL.time] || "—"}</dd>
                </div>
                <div className="wide">
                  <dt>Attendee ID</dt>
                  <dd>
                    <code>{r.row[COL.id]}</code>
                  </dd>
                </div>
              </dl>
            </>
          )}
        </div>

        <div className="sheet-foot">
          <button className="btn primary" onClick={onClose}>
            Next scan
          </button>
        </div>
      </div>
    </div>
  );
}

const svg = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const CheckIcon = () => (
  <svg {...svg} strokeWidth={2}>
    <path d="m20 6-11 11-5-5" />
  </svg>
);
const AlertIcon = () => (
  <svg {...svg} strokeWidth={2}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5M12 16.2v.01" />
  </svg>
);
const XIcon = () => (
  <svg {...svg}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);
const SearchIcon = () => (
  <svg {...svg}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.6-3.6" />
  </svg>
);
const GearIcon = () => (
  <svg {...svg}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.2 13.6a1.5 1.5 0 0 0 .3 1.65l.05.06a1.8 1.8 0 1 1-2.55 2.55l-.06-.05a1.5 1.5 0 0 0-1.65-.3 1.5 1.5 0 0 0-.9 1.37V19a1.8 1.8 0 1 1-3.6 0v-.1a1.5 1.5 0 0 0-.98-1.37 1.5 1.5 0 0 0-1.65.3l-.06.05a1.8 1.8 0 1 1-2.55-2.55l.05-.06a1.5 1.5 0 0 0 .3-1.65 1.5 1.5 0 0 0-1.37-.9H5a1.8 1.8 0 1 1 0-3.6h.1a1.5 1.5 0 0 0 1.37-.98 1.5 1.5 0 0 0-.3-1.65l-.05-.06a1.8 1.8 0 1 1 2.55-2.55l.06.05a1.5 1.5 0 0 0 1.65.3h.07a1.5 1.5 0 0 0 .9-1.37V5a1.8 1.8 0 1 1 3.6 0v.1a1.5 1.5 0 0 0 .9 1.37 1.5 1.5 0 0 0 1.65-.3l.06-.05a1.8 1.8 0 1 1 2.55 2.55l-.05.06a1.5 1.5 0 0 0-.3 1.65v.07a1.5 1.5 0 0 0 1.37.9H19a1.8 1.8 0 1 1 0 3.6h-.1a1.5 1.5 0 0 0-1.37.9z" />
  </svg>
);
