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
  const [busy, setBusy] = useState(false);
  const [printerName, setPrinterName] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);

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
      <div className="page">
        <p className="banner err">This app needs Chrome or Edge (File System Access API).</p>
      </div>
    );

  const checked = doc?.rows.filter((r) => r[COL.time]).length ?? 0;
  const hits = doc ? search(doc.rows, query) : [];

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Offline Check-in</h1>
          <p className="sub">
            {doc
              ? `${doc.name} · ${checked}/${doc.rows.length} checked in`
              : "Open the attendee CSV. Check-ins are written back into that same file."}
          </p>
        </div>
        <div className="actions">
          {doc ? (
            <button className="btn outline" onClick={close}>
              Close file
            </button>
          ) : (
            <button className="btn primary" onClick={pick}>
              Open CSV
            </button>
          )}
          <button className="btn outline" onClick={() => setShowSettings(true)}>
            <GearIcon />
            Settings
          </button>
        </div>
      </header>

      <hr className="rule" />

      {locked && !doc && (
        <p className="banner info">
          Last file: <b>{locked.name}</b>
          <button className="btn sm primary" onClick={unlock}>
            Reopen
          </button>
        </p>
      )}

      {result?.kind === "error" && <p className="banner err">{result.message}</p>}

      {doc && (
        <>
          <div className="cols">
            <div className="col-main">
              <section className="card">
                <div className="card-head">
                  <h2>Scan or enter ID</h2>
                  <span className="status">
                    <span className={printerName ? "dot on" : "dot"} />
                    {printerName ?? "No printer"}
                  </span>
                </div>
                <form
                  className="row"
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
                    placeholder="Or type / USB-scan Attendee ID"
                  />
                  <button className="btn primary" type="submit" disabled={busy}>
                    Check in
                  </button>
                </form>
                <input
                  className="field search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by full name or email"
                />
                {query.length >= 2 && (
                  <ul className="hits">
                    {hits.length === 0 && <li className="empty">No match</li>}
                    {hits.map((r) => (
                      <li key={r[COL.id]}>
                        <span className="avatar sm">{initials(r[COL.name])}</span>
                        <span className="who">
                          <b>{r[COL.name]}</b>
                          <span>
                            {r[COL.email]} · {r[COL.company]}
                          </span>
                        </span>
                        <PrintButton row={r} busy={busy} onPrint={checkIn} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="card">
                <div className="card-head">
                  <h2>Camera scanner</h2>
                </div>
                <Scanner onScan={handleScan} paused={busy} />
              </section>
            </div>

            <aside className="card">
              <div className="card-head">
                <h2>Print log</h2>
              </div>
              <pre className="log">{log.join("\n") || "—"}</pre>
            </aside>
          </div>

          <section className="card table-card">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {doc.headers.map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {doc.rows.map((r) => (
                    <tr key={r[COL.id]} className={r[COL.time] ? "done" : ""}>
                      {doc.headers.map((h) => (
                        <td key={h}>{r[h]}</td>
                      ))}
                      <td>
                        <PrintButton row={r} busy={busy} onPrint={checkIn} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
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

function PrintButton({ row, busy, onPrint }: { row: Row; busy: boolean; onPrint: (r: Row, force: boolean) => void }) {
  const done = Boolean(row[COL.time]);
  return (
    <button className={done ? "btn sm" : "btn sm primary"} disabled={busy} onClick={() => onPrint(row, done)}>
      {done ? "Reprint" : "Print"}
    </button>
  );
}

function ResultDialog({ r, onClose }: { r: Exclude<Result, { kind: "error" }>; onClose: () => void }) {
  const title = r.kind === "ok" ? "Check-in Success" : r.kind === "dup" ? "Already checked in" : "Not found";
  return (
    <div className="scrim" onClick={onClose}>
      <div className={`dialog ${r.kind}`} onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <button type="button" className="close" aria-label="Close" onClick={onClose}>
            <XIcon />
          </button>
          <div className="icon">{r.kind === "ok" ? <CheckIcon /> : <AlertIcon />}</div>
          <h2>{title}</h2>
          {r.kind !== "miss" && r.row[COL.time] && (
            <p className="stamp">
              <ClockIcon />
              {r.row[COL.time]}
            </p>
          )}
        </div>

        <div className="dialog-body">
          {r.kind === "miss" ? (
            <dl className="fields">
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
                <span className="avatar">{initials(r.row[COL.name])}</span>
                <div>
                  <p className="name">{r.row[COL.name]}</p>
                  <p>{r.row[COL.title]}</p>
                  <p>{r.row[COL.company]}</p>
                </div>
              </div>
              <hr />
              <dl className="fields">
                <div>
                  <dt>{COL.email}</dt>
                  <dd>{r.row[COL.email]}</dd>
                </div>
                <div>
                  <dt>{COL.time}</dt>
                  <dd>{r.row[COL.time] || "—"}</dd>
                </div>
                <div className="wide">
                  <dt>{COL.id}</dt>
                  <dd>
                    <code>{r.row[COL.id]}</code>
                  </dd>
                </div>
              </dl>
            </>
          )}
        </div>

        <div className="dialog-foot">
          <button className="btn primary" onClick={onClose}>
            Close and continue
          </button>
        </div>
      </div>
    </div>
  );
}

const svg = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

const CheckIcon = () => (
  <svg {...svg}>
    <path d="m20 6-11 11-5-5" />
  </svg>
);
const AlertIcon = () => (
  <svg {...svg}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5M12 16.5v.01" />
  </svg>
);
const ClockIcon = () => (
  <svg {...svg} width="14" height="14">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
const XIcon = () => (
  <svg {...svg}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);
const GearIcon = () => (
  <svg {...svg}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);
