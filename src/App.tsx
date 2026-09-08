import { useEffect, useState } from "react";
import { Scanner } from "./Scanner";
import { parseCsv, serializeCsv, type Csv, type Row } from "./csv";
import * as fs from "./file";
import * as printer from "./print";
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

  useEffect(() => {
    if (!fs.supported) return;
    fs.savedHandle().then(async (h) => {
      if (!h) return;
      if (await fs.hasPermission(h, false)) await openHandle(h);
      else setLocked(h);
    });
  }, []);

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
      const line = await printer.printBadge(row);
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
    return <main><p className="err">This app needs Chrome or Edge (File System Access API).</p></main>;

  const checked = doc?.rows.filter((r) => r[COL.time]).length ?? 0;
  const hits = doc ? search(doc.rows, query) : [];

  return (
    <main>
      <header>
        <h1>Offline Check-in</h1>
        <div className="actions">
          {doc ? (
            <>
              <span className="meta"><b>{doc.name}</b> · {checked}/{doc.rows.length} checked in</span>
              <button onClick={close}>Close file</button>
            </>
          ) : (
            <button className="primary" onClick={pick}>Open CSV</button>
          )}
          <button onClick={togglePrinter} disabled={!printer.supported} title={printer.supported ? "" : "WebUSB not available"}>
            {printerName ? `Printer: ${printerName} ✕` : "Connect printer (mock until connected)"}
          </button>
        </div>
      </header>

      {locked && !doc && (
        <p className="hint">
          Last file: <b>{locked.name}</b>. <button onClick={unlock}>Reopen</button>
        </p>
      )}

      {result?.kind === "error" && <p className="err">{result.message}</p>}

      {!doc ? (
        <p className="hint">Open the attendee CSV. Check-ins are written back into that same file.</p>
      ) : (
        <>
          <div className="grid">
            <section>
              <Scanner onScan={handleScan} paused={busy} />
              <form className="manual" onSubmit={(e) => { e.preventDefault(); handleScan(manual); setManual(""); }}>
                <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Or type / USB-scan Attendee ID" />
                <button type="submit" disabled={busy}>Check in</button>
              </form>
              <input className="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by full name or email" />
              {query.length >= 2 && (
                <ul className="hits">
                  {hits.length === 0 && <li className="hint">No match</li>}
                  {hits.map((r) => (
                    <li key={r[COL.id]}>
                      <span><b>{r[COL.name]}</b> · {r[COL.email]} · {r[COL.company]}</span>
                      <PrintButton row={r} busy={busy} onPrint={checkIn} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              {result && result.kind !== "error" && <ResultCard r={result} />}
              <h3>Print log</h3>
              <pre className="log">{log.join("\n") || "—"}</pre>
            </section>
          </div>

          <table>
            <thead>
              <tr>{doc.headers.map((h) => <th key={h}>{h}</th>)}<th /></tr>
            </thead>
            <tbody>
              {doc.rows.map((r) => (
                <tr key={r[COL.id]} className={r[COL.time] ? "done" : ""}>
                  {doc.headers.map((h) => <td key={h}>{r[h]}</td>)}
                  <td><PrintButton row={r} busy={busy} onPrint={checkIn} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}

function PrintButton({ row, busy, onPrint }: { row: Row; busy: boolean; onPrint: (r: Row, force: boolean) => void }) {
  const done = Boolean(row[COL.time]);
  return (
    <button className={done ? "" : "primary"} disabled={busy} onClick={() => onPrint(row, done)}>
      {done ? "Reprint" : "Print"}
    </button>
  );
}

function ResultCard({ r }: { r: Exclude<Result, { kind: "error" }> }) {
  if (r.kind === "miss")
    return <div className="card miss"><h2>Not found</h2><p>QR: <code>{r.id}</code></p></div>;
  return (
    <div className={`card ${r.kind}`}>
      <h2>{r.kind === "ok" ? "Check-in Success" : "Already checked in"}</h2>
      <dl>
        {Object.values(COL).map((h) => (
          <div key={h}><dt>{h}</dt><dd>{r.row[h]}</dd></div>
        ))}
      </dl>
    </div>
  );
}
