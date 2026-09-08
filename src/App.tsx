import { useEffect, useState } from "react";
import { Scanner } from "./Scanner";
import { exportExcel, importExcel } from "./excel";
import { printBadge } from "./print";
import { findById, load, save, type Dataset, type Row } from "./store";

type Result =
  | { kind: "ok"; id: string; row: Row }
  | { kind: "dup"; id: string; row: Row; at: string }
  | { kind: "miss"; id: string };

export function App() {
  const [ds, setDs] = useState<Dataset | null>(() => load());
  const [result, setResult] = useState<Result | null>(null);
  const [manual, setManual] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => save(ds), [ds]);

  const count = ds ? Object.keys(ds.checkins).length : 0;

  async function onImport(file: File) {
    try {
      setDs(await importExcel(file));
      setResult(null);
    } catch (e) {
      alert(`Import failed: ${(e as Error).message}`);
    }
  }

  async function handleScan(text: string) {
    if (!ds || busy) return;
    const id = text.trim();
    const row = findById(ds, id);
    if (!row) return setResult({ kind: "miss", id });
    const key = String(row[ds.idColumn]);
    const at = ds.checkins[key];
    if (at) return setResult({ kind: "dup", id: key, row, at });

    setBusy(true);
    setDs({ ...ds, checkins: { ...ds.checkins, [key]: new Date().toISOString() } });
    setResult({ kind: "ok", id: key, row });
    const line = await printBadge(row, key);
    setLog((l) => [line, ...l].slice(0, 50));
    setBusy(false);
  }

  function reset() {
    if (confirm("Clear imported data and all check-ins on this laptop?")) {
      setDs(null);
      setResult(null);
      setLog([]);
    }
  }

  return (
    <main>
      <header>
        <h1>Offline Check-in</h1>
        <div className="actions">
          <label className="btn">
            Import Excel
            <input type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
          </label>
          <button disabled={!ds} onClick={() => ds && exportExcel(ds)}>Export Check-in Data</button>
          <button disabled={!ds} onClick={reset} className="danger">Reset</button>
        </div>
      </header>

      {!ds ? (
        <p className="hint">Import an attendee list to start. First sheet is used. Each row needs an ID column that matches the QR content.</p>
      ) : (
        <div className="grid">
          <section>
            <p className="meta">
              <b>{ds.fileName}</b> · {ds.rows.length} rows · {count} checked in · ID column{" "}
              <select value={ds.idColumn} onChange={(e) => setDs({ ...ds, idColumn: e.target.value })}>
                {ds.headers.map((h) => <option key={h}>{h}</option>)}
              </select>
            </p>
            <Scanner onScan={handleScan} paused={busy} />
            <form className="manual" onSubmit={(e) => { e.preventDefault(); handleScan(manual); setManual(""); }}>
              <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Or type / USB-scan ID here" autoFocus />
              <button type="submit">Check in</button>
            </form>
          </section>

          <section>
            {result && <ResultCard r={result} headers={ds.headers} />}
            <h3>Print log (mock)</h3>
            <pre className="log">{log.join("\n") || "—"}</pre>
          </section>
        </div>
      )}
    </main>
  );
}

function ResultCard({ r, headers }: { r: Result; headers: string[] }) {
  if (r.kind === "miss")
    return <div className="card miss"><h2>Not found</h2><p>QR: <code>{r.id}</code></p></div>;
  const title = r.kind === "ok" ? "Check-in Success" : "Already checked in";
  return (
    <div className={`card ${r.kind}`}>
      <h2>{title}</h2>
      {r.kind === "dup" && <p>at {new Date(r.at).toLocaleString()}</p>}
      <dl>
        {headers.map((h) => (
          <div key={h}><dt>{h}</dt><dd>{String(r.row[h] ?? "")}</dd></div>
        ))}
      </dl>
    </div>
  );
}
