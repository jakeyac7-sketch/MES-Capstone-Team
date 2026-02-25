"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

type TabKey = "queue" | "robot" | "inspection" | "conveyor" | "bins" | "shipments";

type AlertItem = {
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  source?: string | null;
  trigger_value?: number | null;
  threshold?: number | null;
  event_time?: string | null;

  // identifiers for cross-component interaction + highlighting
  conveyor_id?: string | number | null;
  part_id?: string | number | null;
  source_pi?: string | null;
};

export default function Home() {
  // --- core UI state
  const [tab, setTab] = useState<TabKey>("queue");
  const [kpis, setKpis] = useState<Record<string, any> | null>(null);
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // --- filters (cross-component)
  const [stage, setStage] = useState<string>("queued");
  const [filterPartId, setFilterPartId] = useState<string>("");
  const [filterConveyorId, setFilterConveyorId] = useState<string>("");
  const [filterSourcePi, setFilterSourcePi] = useState<string>("");

  // --- sticky control bar options
  const [paused, setPaused] = useState<boolean>(false);
  const [refreshMs, setRefreshMs] = useState<number>(5000);
  const [tightMonitoring, setTightMonitoring] = useState<boolean>(false);

  // --- details drawer
  const [selectedRow, setSelectedRow] = useState<Record<string, any> | null>(null);

  // --- scrolling to matches
  const tableWrapRef = useRef<HTMLDivElement | null>(null);

  const tabs = useMemo(
    () => [
      { key: "queue" as const, label: "Queue" },
      { key: "robot" as const, label: "Robot Cycles" },
      { key: "inspection" as const, label: "Inspection" },
      { key: "conveyor" as const, label: "Conveyor" },
      { key: "bins" as const, label: "Bin Events" },
      { key: "shipments" as const, label: "Shipments" },
    ],
    []
  );

  // --- endpoints you already have (from prior steps)
  function endpointForData(t: TabKey) {
    if (t === "queue") return `${API_BASE}/queue?stage=${encodeURIComponent(stage)}&limit=200`;
    if (t === "robot") return `${API_BASE}/robot-cycles?limit=200`;
    if (t === "inspection") return `${API_BASE}/inspection?limit=200`;
    if (t === "conveyor") return `${API_BASE}/conveyor?limit=200`;
    if (t === "bins") return `${API_BASE}/bin-events?limit=200`;
    return `${API_BASE}/shipments?limit=200`;
  }

  function endpointForAlerts() {
    // Tighten monitoring button simply changes thresholds (no DB changes needed)
    const stale = tightMonitoring ? 5 : 30;
    const slow = tightMonitoring ? 2.0 : 3.0;
    const windowMin = tightMonitoring ? 1 : 2;
    return `${API_BASE}/alerts?conveyor_stale_seconds=${stale}&conveyor_slow_duration=${slow}&window_minutes=${windowMin}`;
  }

  // --- Load data + alerts + kpis
  async function load() {
    try {
      setLoading(true);
      setError(null);

      const [kRes, aRes, dRes] = await Promise.all([
        fetch(`${API_BASE}/kpis`),
        fetch(endpointForAlerts()),
        fetch(endpointForData(tab)),
      ]);

      if (!kRes.ok) throw new Error(`kpis failed: ${kRes.status}`);
      if (!aRes.ok) throw new Error(`alerts failed: ${aRes.status}`);
      if (!dRes.ok) throw new Error(`data failed: ${dRes.status}`);

      const kData = await kRes.json();
      const aData = await aRes.json();
      const dData = await dRes.json();

      setKpis(kData);
      setAlerts(aData.alerts || []);
      setRows(dData.rows || []);
    } catch (e: any) {
      setError(String(e?.message || e));
      setRows([]);
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, stage, tightMonitoring]);

  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => load(), refreshMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, refreshMs, tab, stage, tightMonitoring]);

  // --- derived: system status
  const criticalCount = alerts.filter((a) => a.severity === "critical").length;
  const warningCount = alerts.filter((a) => a.severity === "warning").length;
  const systemStatus = criticalCount > 0 ? "critical" : warningCount > 0 ? "warning" : "ok";

  // --- filtered rows in UI (no backend changes)
  const filteredRows = useMemo(() => {
    const p = filterPartId.trim();
    const c = filterConveyorId.trim();
    const s = filterSourcePi.trim().toLowerCase();

    return rows.filter((r) => {
      const partOk = !p || String(r.part_id ?? "").includes(p);
      const convOk = !c || String(r.conveyor_id ?? "").includes(c);
      const srcOk = !s || String(r.source_pi ?? "").toLowerCase().includes(s);
      return partOk && convOk && srcOk;
    });
  }, [rows, filterPartId, filterConveyorId, filterSourcePi]);

  const columns = useMemo(() => {
    const base = filteredRows.length ? filteredRows : rows;
    if (!base.length) return [];
    return Object.keys(base[0]);
  }, [filteredRows, rows]);

  // --- highlight: does a row match any active alert?
  function rowMatchesAlert(r: Record<string, any>) {
    if (!alerts.length) return false;
    const rowPart = r.part_id != null ? String(r.part_id) : "";
    const rowConv = r.conveyor_id != null ? String(r.conveyor_id) : "";
    const rowSrc = r.source_pi != null ? String(r.source_pi) : "";

    return alerts.some((a) => {
      const aPart = a.part_id != null ? String(a.part_id) : "";
      const aConv = a.conveyor_id != null ? String(a.conveyor_id) : "";
      const aSrc = a.source_pi != null ? String(a.source_pi) : "";
      // match any identifier present
      const partMatch = aPart && rowPart && rowPart === aPart;
      const convMatch = aConv && rowConv && rowConv === aConv;
      const srcMatch = aSrc && rowSrc && rowSrc === aSrc;
      return partMatch || convMatch || srcMatch;
    });
  }

  // --- cross-component: click alert -> switch tab & apply filters
  function onClickAlert(a: AlertItem) {
    // Heuristic: conveyor alerts -> conveyor tab
    if (a.source === "raw_conveyor" || a.type.startsWith("conveyor")) {
      setTab("conveyor");
    }

    if (a.part_id != null) setFilterPartId(String(a.part_id));
    if (a.conveyor_id != null) setFilterConveyorId(String(a.conveyor_id));
    if (a.source_pi) setFilterSourcePi(String(a.source_pi));

    // scroll table into view
    setTimeout(() => {
      tableWrapRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 150);
  }

  // --- buttons: Focus on Conveyor (jump + use "best guess" conveyor id from alerts)
  function focusOnConveyor() {
    setTab("conveyor");
    const best = alerts.find((a) => a.conveyor_id != null) || null;
    if (best?.conveyor_id != null) setFilterConveyorId(String(best.conveyor_id));
    if (best?.source_pi) setFilterSourcePi(String(best.source_pi));
    setTimeout(() => tableWrapRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
  }

  function clearFilters() {
    setFilterPartId("");
    setFilterConveyorId("");
    setFilterSourcePi("");
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Sticky Top Control Bar */}
      <div className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-6xl px-6 py-4 flex flex-wrap items-center gap-3">
          <div className="min-w-[220px]">
            <div className="text-lg font-semibold tracking-tight">MES Execution UI</div>
            <div className="text-xs text-slate-500">API: {API_BASE}</div>
          </div>

          {/* System status */}
          <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
            <StatusDot status={systemStatus} />
            <span className="text-sm font-medium">
              {systemStatus === "ok"
                ? "SYSTEM NOMINAL"
                : systemStatus === "warning"
                ? "WARNING"
                : "ATTENTION REQUIRED"}
            </span>
          </div>

          {/* Alerts count */}
          <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm">
            Alerts{" "}
            <span
              className={`ml-1 inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                alerts.length > 0 ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-800"
              }`}
            >
              {alerts.length}
            </span>
          </div>

          {/* Buttons A-C (section 3) */}
          <button
            onClick={() => setTightMonitoring((v) => !v)}
            className={`rounded-lg px-3 py-2 text-sm font-medium border ${
              tightMonitoring
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
            }`}
            title="Tighten Monitoring Mode changes alert thresholds for quick testing"
          >
            Tighten Monitoring: {tightMonitoring ? "ON" : "OFF"}
          </button>

          <button
            onClick={focusOnConveyor}
            className="rounded-lg bg-white text-slate-700 border border-slate-200 px-3 py-2 text-sm font-medium hover:bg-slate-50"
          >
            Focus on Conveyor
          </button>

          <button
            onClick={() => setPaused((v) => !v)}
            className={`rounded-lg px-3 py-2 text-sm font-medium border ${
              paused ? "bg-amber-100 border-amber-200 text-amber-900" : "bg-white border-slate-200 text-slate-700"
            }`}
          >
            Auto Refresh: {paused ? "Paused" : "On"}
          </button>

          {/* Refresh interval */}
          <div className="ml-auto flex items-center gap-2">
            <label className="text-xs text-slate-500">Refresh</label>
            <select
              className="rounded-lg bg-white border border-slate-200 px-2 py-2 text-sm text-slate-700"
              value={refreshMs}
              onChange={(e) => setRefreshMs(Number(e.target.value))}
              disabled={paused}
            >
              <option value={2000}>2s</option>
              <option value={5000}>5s</option>
              <option value={10000}>10s</option>
              <option value={30000}>30s</option>
            </select>

            <button
              onClick={load}
              className="rounded-lg bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700"
            >
              Refresh Now
            </button>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {/* Alerts Panel */}
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <div className="font-semibold">Active Alerts</div>
              <div className="text-xs text-slate-500">
                Click an alert to focus the relevant table
              </div>
            </div>
            <div className="text-xs text-slate-500">{alerts.length} active</div>
          </div>

          {alerts.length === 0 && !loading && (
            <div className="px-5 py-5 text-sm text-slate-600">
              No active alerts right now.
            </div>
          )}

          {alerts.length > 0 && (
            <div className="divide-y divide-slate-200">
              {alerts.map((a, idx) => (
                <button
                  key={idx}
                  onClick={() => onClickAlert(a)}
                  className="w-full text-left px-5 py-4 flex gap-4 hover:bg-slate-50"
                >
                  <SeverityDot severity={a.severity} />
                  <div className="flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-semibold">{a.title}</div>
                      <span className="text-xs text-slate-500">{a.source || ""}</span>
                    </div>
                    <div className="text-sm text-slate-700 mt-1">{a.message}</div>

                    {/* show identifiers for clarity */}
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                      {a.source_pi && <Tag label={`pi: ${a.source_pi}`} />}
                      {a.conveyor_id != null && <Tag label={`conveyor: ${a.conveyor_id}`} />}
                      {a.part_id != null && <Tag label={`part: ${a.part_id}`} />}
                    </div>

                    {a.event_time && (
                      <div className="text-xs text-slate-500 mt-1">Last event: {a.event_time}</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
          <Kpi title="Queued" value={kpis?.queued_parts} />
          <Kpi title="Total Parts" value={kpis?.total_parts} />
          <Kpi title="Robot Cycles" value={kpis?.robot_cycles} />
          <Kpi title="Inspections" value={kpis?.inspections} />
          <Kpi title="Conveyor Events" value={kpis?.conveyor_events} />
          <Kpi title="Bin Events" value={kpis?.bin_events} />
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-2 mb-4">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-lg px-3 py-2 text-sm border ${
                tab === t.key
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Filters (cross-component) */}
        <div className="mb-4 grid grid-cols-1 sm:grid-cols-4 gap-3">
          {tab === "queue" && (
            <select
              className="rounded-lg bg-white border border-slate-200 px-3 py-2 text-sm text-slate-700"
              value={stage}
              onChange={(e) => setStage(e.target.value)}
            >
              <option value="queued">queued</option>
              <option value="">All stages</option>
              <option value="picked">picked</option>
              <option value="in_transfer">in_transfer</option>
              <option value="at_ned">at_ned</option>
              <option value="completed">completed</option>
            </select>
          )}

          <input
            className="rounded-lg bg-white border border-slate-200 px-3 py-2 text-sm"
            placeholder="Filter part_id…"
            value={filterPartId}
            onChange={(e) => setFilterPartId(e.target.value)}
          />
          <input
            className="rounded-lg bg-white border border-slate-200 px-3 py-2 text-sm"
            placeholder="Filter conveyor_id…"
            value={filterConveyorId}
            onChange={(e) => setFilterConveyorId(e.target.value)}
          />
          <input
            className="rounded-lg bg-white border border-slate-200 px-3 py-2 text-sm"
            placeholder="Filter source_pi…"
            value={filterSourcePi}
            onChange={(e) => setFilterSourcePi(e.target.value)}
          />

          <div className="sm:col-span-4 flex gap-2">
            <button
              onClick={clearFilters}
              className="rounded-lg bg-white text-slate-700 border border-slate-200 px-3 py-2 text-sm font-medium hover:bg-slate-50"
            >
              Clear Filters
            </button>
            <div className="text-xs text-slate-500 self-center">
              Tip: click a table cell (part_id / conveyor_id / source_pi) to filter instantly.
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm">
            <div className="font-semibold text-red-700">Error</div>
            <div className="text-red-700">{error}</div>
          </div>
        )}

        {/* Data Table */}
        <div ref={tableWrapRef} className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div className="font-semibold">
              {tabs.find((t) => t.key === tab)?.label}
              {tab === "queue" && <span className="ml-2 text-xs text-slate-500">stage: <StageBadge stage={stage || "all"} /></span>}
            </div>
            <div className="text-xs text-slate-500">
              {filteredRows.length} rows (filtered) / {rows.length} total
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-slate-600 bg-slate-50">
                <tr className="border-b border-slate-200">
                  {columns.map((c) => (
                    <th key={c} className="px-5 py-3 text-left font-medium whitespace-nowrap">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={Math.max(columns.length, 1)} className="px-5 py-6 text-center text-slate-500">
                      Loading…
                    </td>
                  </tr>
                )}

                {!loading && filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={Math.max(columns.length, 1)} className="px-5 py-6 text-center text-slate-500">
                      No rows returned (try clearing filters).
                    </td>
                  </tr>
                )}

                {!loading &&
                  filteredRows.map((r, idx) => {
                    const matched = rowMatchesAlert(r);
                    return (
                      <tr
                        key={idx}
                        className={`border-b border-slate-100 hover:bg-slate-50 cursor-pointer ${
                          matched ? "bg-amber-50" : ""
                        }`}
                        onClick={() => setSelectedRow(r)}
                        title={matched ? "This row matches an active alert" : "Click for details"}
                      >
                        {columns.map((c) => (
                          <td
                            key={c}
                            className="px-5 py-3 text-slate-800 whitespace-nowrap"
                            onClick={(e) => {
                              // Cross-component: click cell -> filter
                              if (c === "part_id") {
                                e.stopPropagation();
                                setFilterPartId(String(r[c] ?? ""));
                              }
                              if (c === "conveyor_id") {
                                e.stopPropagation();
                                setFilterConveyorId(String(r[c] ?? ""));
                              }
                              if (c === "source_pi") {
                                e.stopPropagation();
                                setFilterSourcePi(String(r[c] ?? ""));
                              }
                            }}
                          >
                            {/* Stage column badge if present */}
                            {c === "stage" ? <StageBadge stage={String(r[c] ?? "")} /> : formatCell(r[c])}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Details Drawer */}
        {selectedRow && (
          <div className="fixed inset-0 z-50">
            <div className="absolute inset-0 bg-black/20" onClick={() => setSelectedRow(null)} />
            <div className="absolute right-0 top-0 h-full w-full sm:w-[480px] bg-white border-l border-slate-200 shadow-xl">
              <div className="p-5 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <div className="font-semibold">Row Details</div>
                  <div className="text-xs text-slate-500">Click quick actions to filter</div>
                </div>
                <button
                  onClick={() => setSelectedRow(null)}
                  className="rounded-lg border border-slate-200 px-3 py-1 text-sm hover:bg-slate-50"
                >
                  Close
                </button>
              </div>

              <div className="p-5 space-y-3">
                <div className="flex flex-wrap gap-2">
                  {"part_id" in selectedRow && selectedRow.part_id != null && (
                    <button
                      onClick={() => {
                        setFilterPartId(String(selectedRow.part_id));
                        setSelectedRow(null);
                      }}
                      className="rounded-lg bg-blue-600 text-white px-3 py-2 text-sm font-medium hover:bg-blue-700"
                    >
                      Filter by part_id
                    </button>
                  )}
                  {"conveyor_id" in selectedRow && selectedRow.conveyor_id != null && (
                    <button
                      onClick={() => {
                        setTab("conveyor");
                        setFilterConveyorId(String(selectedRow.conveyor_id));
                        setSelectedRow(null);
                      }}
                      className="rounded-lg bg-white border border-slate-200 px-3 py-2 text-sm font-medium hover:bg-slate-50"
                    >
                      Focus conveyor_id
                    </button>
                  )}
                  {"source_pi" in selectedRow && selectedRow.source_pi != null && (
                    <button
                      onClick={() => {
                        setFilterSourcePi(String(selectedRow.source_pi));
                        setSelectedRow(null);
                      }}
                      className="rounded-lg bg-white border border-slate-200 px-3 py-2 text-sm font-medium hover:bg-slate-50"
                    >
                      Filter source_pi
                    </button>
                  )}
                  <button
                    onClick={() => {
                      clearFilters();
                      setSelectedRow(null);
                    }}
                    className="rounded-lg bg-white border border-slate-200 px-3 py-2 text-sm font-medium hover:bg-slate-50"
                  >
                    Clear filters
                  </button>
                </div>

                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="bg-slate-50 px-4 py-2 text-xs font-medium text-slate-600">Fields</div>
                  <div className="p-4 space-y-2 text-sm">
                    {Object.entries(selectedRow).map(([k, v]) => (
                      <div key={k} className="flex gap-3">
                        <div className="w-36 text-slate-500">{k}</div>
                        <div className="flex-1 text-slate-900 break-all">{formatCell(v)}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="text-xs text-slate-500">
                  Highlighting rule: any row whose <span className="font-medium">part_id / conveyor_id / source_pi</span> matches an active alert is shaded.
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function Kpi({ title, value }: { title: string; value: any }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="text-xs text-slate-500">{title}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
        {value ?? "—"}
      </div>
    </div>
  );
}

function SeverityDot({ severity }: { severity: AlertItem["severity"] }) {
  const cls =
    severity === "critical"
      ? "bg-red-500"
      : severity === "warning"
      ? "bg-amber-500"
      : "bg-blue-500";
  return <div className={`mt-1 h-3 w-3 rounded-full ${cls}`} />;
}

function StatusDot({ status }: { status: "ok" | "warning" | "critical" }) {
  const cls =
    status === "critical"
      ? "bg-red-500"
      : status === "warning"
      ? "bg-amber-500"
      : "bg-emerald-500";
  return <div className={`h-3 w-3 rounded-full ${cls}`} />;
}

function Tag({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5">
      {label}
    </span>
  );
}

function StageBadge({ stage }: { stage: string }) {
  const s = (stage || "").toLowerCase();

  const style =
    s === "queued"
      ? "bg-amber-100 text-amber-900 border-amber-200"
      : s === "in_transfer"
      ? "bg-blue-100 text-blue-900 border-blue-200"
      : s === "picked"
      ? "bg-indigo-100 text-indigo-900 border-indigo-200"
      : s === "completed"
      ? "bg-emerald-100 text-emerald-900 border-emerald-200"
      : s === "at_ned"
      ? "bg-sky-100 text-sky-900 border-sky-200"
      : "bg-slate-100 text-slate-800 border-slate-200";

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${style}`}>
      {stage || "—"}
    </span>
  );
}

function formatCell(v: any) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}