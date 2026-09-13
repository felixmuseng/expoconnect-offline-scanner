import { useEffect, useRef, useState } from "react";
import { Scanner } from "./Scanner";
import { SettingsDialog } from "./Settings";
import { parseCsv, serializeCsv, type Csv, type Row } from "./csv";
import * as fs from "./file";
import * as printer from "./print";
import { loadSettings, saveSettings, type Settings } from "./settings";
import { COL, REQUIRED, findById, hasSearchQuery, now, search, type SearchQueries } from "./store";

type Result =
  | { kind: "ok"; row: Row }
  | { kind: "dup"; row: Row }
  | { kind: "miss"; id: string }
  | { kind: "error"; message: string };

type Doc = Csv & { handle: FileSystemFileHandle; name: string };

const normId = (id: string) => id.trim().toLowerCase();
const rowKey = (rows: Row[], row: Row) => {
  const at = rows.indexOf(row);
  return `row:${at}`;
};

export function App() {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [locked, setLocked] = useState<FileSystemFileHandle | null>(null); // saved file awaiting permission click
  const [result, setResult] = useState<Result | null>(null);
  const [queries, setQueries] = useState<SearchQueries>({ name: "", email: "", company: "" });
  const [manual, setManual] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [printerName, setPrinterName] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [printedKeys, setPrintedKeys] = useState<Set<string>>(() => new Set());
  const printingId = useRef<string | null>(null);

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
      setPrintedKeys(new Set());
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

  async function printRows(rowsToPrint: Row[]) {
    if (!doc || busy || printingId.current) return;
    if (rowsToPrint.length === 0) return;
    printingId.current = rowsToPrint.length === 1 ? rowsToPrint[0][COL.id] : "batch";
    setBusy(true);
    const lines: string[] = [];
    let last: Row | null = null;
    const checkedById = new Map<string, string>();
    const checkedByRow = new Map<number, string>();
    const printed = new Set<string>();
    try {
      for (const row of rowsToPrint) {
        const line = await printer.printBadge(row, settings);
        lines.push(line);
        printed.add(rowKey(doc.rows, row));
        if (!row[COL.time]) {
          const id = normId(row[COL.id]);
          const checkedAt = now();
          if (id) checkedById.set(id, checkedAt);
          else checkedByRow.set(doc.rows.indexOf(row), checkedAt);
        }
        last = row;
      }
      const hasNewCheckIns = checkedById.size > 0 || checkedByRow.size > 0;
      const latest = hasNewCheckIns ? parseCsv(await fs.readText(doc.handle)) : doc;
      const missing = hasNewCheckIns ? REQUIRED.filter((c) => !latest.headers.includes(c)) : [];
      if (missing.length) throw new Error(`Missing columns: ${missing.join(", ")}`);
      const sourceRows = hasNewCheckIns ? latest.rows : doc.rows;
      const nextRows =
        hasNewCheckIns
          ? sourceRows.map((row, index) => {
              const checkedAt = checkedById.get(normId(row[COL.id]));
              const checkedByPosition = checkedByRow.get(index);
              const nextTime = checkedAt ?? checkedByPosition;
              return nextTime && !row[COL.time] ? { ...row, [COL.time]: nextTime } : row;
            })
          : sourceRows;
      if (hasNewCheckIns) {
        const next = { ...latest, handle: doc.handle, name: doc.name, rows: nextRows };
        await fs.writeText(doc.handle, serializeCsv(next));
        setDoc(next);
      }
      let shown: Row | null = null;
      if (last) {
        const lastKey = rowKey(doc.rows, last);
        shown = nextRows.find((row) => rowKey(nextRows, row) === lastKey) ?? last;
      }
      if (shown) setResult({ kind: "ok", row: shown });
      setPrintedKeys((prev) => new Set([...prev, ...printed]));
      setLog((l) => [...lines.reverse(), ...l].slice(0, 100));
    } catch (e) {
      if (printed.size > 0) setPrintedKeys((prev) => new Set([...prev, ...printed]));
      setResult({ kind: "error", message: (e as Error).message });
    } finally {
      printingId.current = null;
      setBusy(false);
    }
  }

  // Prints first, then marks the row and writes the CSV in place.
  async function checkIn(row: Row, force = false) {
    if (row[COL.time] && !force) return setResult({ kind: "dup", row });
    await printRows([row]);
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
  const hits = doc ? search(doc.rows, queries) : [];
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
          queries={queries}
          onQueries={setQueries}
          printedKeys={printedKeys}
          busy={busy}
          onPrint={printRows}
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
  queries,
  onQueries,
  printedKeys,
  busy,
  onPrint,
  onClose,
}: {
  rows: Row[];
  headers: string[];
  hits: Row[];
  queries: SearchQueries;
  onQueries: (q: SearchQueries) => void;
  printedKeys: Set<string>;
  busy: boolean;
  onPrint: (rows: Row[]) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const searching = hasSearchQuery(queries);
  const ordered = [...rows].sort((a, b) => Number(Boolean(a[COL.time])) - Number(Boolean(b[COL.time])));
  const visible = searching ? hits : ordered;
  const visibleKeys = visible.map((r) => rowKey(rows, r));
  const selectedRows = visible.filter((r) => selected.has(rowKey(rows, r)));
  const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every((key) => selected.has(key));
  const isPrinted = (row: Row) => Boolean(row[COL.time]) || printedKeys.has(rowKey(rows, row));
  const visibleNotPrinted = visible.filter((row) => !isPrinted(row));
  const setRowSelected = (key: string, checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  const setVisibleSelected = (checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const key of visibleKeys) {
        if (checked) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  const setNotPrintedSelected = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const key of visibleKeys) next.delete(key);
      for (const row of visibleNotPrinted) next.add(rowKey(rows, row));
      return next;
    });
  const printSelected = () => {
    if (!busy && selectedRows.length > 0) onPrint(selectedRows);
  };
  const querySummary = [
    queries.name.trim().length >= 2 && `name "${queries.name}"`,
    queries.email.trim().length >= 2 && `email "${queries.email}"`,
    queries.company.trim().length >= 2 && `company "${queries.company}"`,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <div className="scrim" onClick={onClose}>
      <form
        className="sheet xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.ctrlKey) {
            e.preventDefault();
            printSelected();
          }
        }}
        onSubmit={(e) => {
          e.preventDefault();
          printSelected();
        }}
      >
        <div className="search-head">
          <div className="search-fields">
            <label>
              <span>Name</span>
              <input
                className="field"
                value={queries.name}
                onChange={(e) => onQueries({ ...queries, name: e.target.value })}
                placeholder="Full name"
                /* biome-ignore lint/a11y/noAutofocus: the operator opened this to type. */
                autoFocus
              />
            </label>
            <label>
              <span>Email</span>
              <input
                className="field"
                value={queries.email}
                onChange={(e) => onQueries({ ...queries, email: e.target.value })}
                placeholder="Email address"
              />
            </label>
            <label>
              <span>Company</span>
              <input
                className="field"
                value={queries.company}
                onChange={(e) => onQueries({ ...queries, company: e.target.value })}
                placeholder="Company name"
              />
            </label>
          </div>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>

        <div className="sheet-body flush">
          {searching ? (
            <ul className="rows">
              {hits.length === 0 && <li className="none">No attendee matches {querySummary}</li>}
              {hits.map((r, i) => (
                <li key={`${r[COL.id]}-${i}`}>
                  <label className="select-row">
                    <input
                      type="checkbox"
                      checked={selected.has(rowKey(rows, r))}
                      onChange={(e) => setRowSelected(rowKey(rows, r), e.target.checked)}
                      aria-label={`Select ${r[COL.name]}`}
                    />
                    <span className="avatar">{initials(r[COL.name])}</span>
                    <span className="who">
                      <b>{r[COL.name]}</b>
                      <span>
                        {r[COL.email]} · {r[COL.company] || "—"}
                      </span>
                    </span>
                    {isPrinted(r) && <span className="status-pill">Printed</span>}
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={(e) => setVisibleSelected(e.target.checked)}
                      aria-label="Select all visible attendees"
                    />
                  </th>
                  <th>Status</th>
                  {headers.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ordered.map((r, i) => (
                  <tr
                    key={`${r[COL.id]}-${i}`}
                    className={r[COL.time] ? "done" : ""}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).tagName === "INPUT") return;
                      const key = rowKey(rows, r);
                      setRowSelected(key, !selected.has(key));
                    }}
                  >
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(rowKey(rows, r))}
                        onChange={(e) => setRowSelected(rowKey(rows, r), e.target.checked)}
                        aria-label={`Select ${r[COL.name]}`}
                      />
                    </td>
                    <td>{isPrinted(r) ? <span className="status-pill">Printed</span> : ""}</td>
                    {headers.map((h) => (
                      <td key={h}>{r[h]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="sheet-foot search-foot">
          <label>
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={(e) => setVisibleSelected(e.target.checked)}
            />
            <span>Select visible</span>
          </label>
          <button className="btn" type="button" disabled={busy || visibleNotPrinted.length === 0} onClick={setNotPrintedSelected}>
            Select not printed ({visibleNotPrinted.length})
          </button>
          <button className="btn primary" type="submit" disabled={busy || selectedRows.length === 0}>
            Print selected ({selectedRows.length})
          </button>
        </div>
      </form>
    </div>
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
