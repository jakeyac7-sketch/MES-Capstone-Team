"use client";

import { useEffect, useMemo, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

type TabKey = "queue" | "robot" | "inspection" | "conveyor" | "bins" | "shipments";

type AlertItem = {
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  source?: string;
  trigger_value?: number | null;
  threshold?: number | null;
  event_time?: string | null;
};

export default function Home() {
  const [tab, setTab] = useState<TabKey>("queue");
  const [kpis, setKpis] = useState<Record<string, any> | null>(null);
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [stage, setStage] = useState<string>("queued");

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

  function endpointFor(t: TabKey) {
    if (t === "queue") return `${API_BASE}/queue?stage=${encodeURIComponent(stage)}&limit=200`;
    if (t === "robot") return `${API_BASE}/robot-cycles?limit=200`;
    if (t === "inspection") return `${API_BASE}/inspection?limit=200`;
    if (t === "conveyor") return `${API_BASE}/conveyor?limit=200`;
    if (t === "bins") return `${API_BASE}/bin-events?limit=200`;
    return `${API_BASE}/shipments?limit=200`;
  }

  async function load() {
    try {
      setLoading(true);
      setError(null);

      const [kRes, aRes, dRes] = await Promise.all([
        fetch(`${API_BASE}/kpis`),
        fetch(`${API_BASE}/alerts?conveyor_stale_seconds=30&conveyor_slow_duration=3&window_minutes=2`),
        fetch(endpointFor(tab)),
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
  }, [tab, stage]);

  useEffect(() => {
    const t = setInterval(() => load(), 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, stage]);

  const columns = useMemo(() => {
    if (!rows.length) return [];
    return Object.keys(rows[0]);
  }, [rows]);

  const alertCount = alerts.length;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">MES Execution UI</h1>
            <p className="text-sm text-slate-500">API: {API_BASE}</p>
          </div>

          <div className="flex items-center gap-3">
            <div className="rounded-full bg-slate-100 border border-slate-200 px-3 py-1 text-sm">
              Alerts{" "}
              <span
                className={`ml-1 inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                  alertCount > 0 ? "bg-blue-600 text-white" : "bg-slate-300 text-slate-800"
                }`}
              >
                {alertCount}
              </span>
            </div>

            <button
              onClick={load}
              className="rounded-lg bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700"
            >
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {/* Alerts Panel */}
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <div className="font-semibold">Active Alerts</div>
              <div className="text-xs text-slate-500">Auto-refresh every 5 seconds</div>
            </div>
            <div className="text-xs text-slate-500">{alertCount} active</div>
          </div>

          {alertCount === 0 && !loading && (
            <div className="px-5 py-5 text-sm text-slate-600">
              No active alerts right now.
            </div>
          )}

          {alertCount > 0 && (
            <div className="divide-y divide-slate-200">
              {alerts.map((a, idx) => (
                <div key={idx} className="px-5 py-4 flex gap-4">
                  <SeverityDot severity={a.severity} />
                  <div className="flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-semibold">{a.title}</div>
                      <span className="text-xs text-slate-500">{a.source || ""}</span>
                    </div>
                    <div className="text-sm text-slate-700 mt-1">{a.message}</div>
                    {a.event_time && (
                      <div className="text-xs text-slate-500 mt-1">Last event: {a.event_time}</div>
                    )}
                  </div>
                </div>
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

          {tab === "queue" && (
            <select
              className="ml-auto rounded-lg bg-white border border-slate-200 px-3 py-2 text-sm text-slate-700"
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
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm">
            <div className="font-semibold text-red-700">Error</div>
            <div className="text-red-700">{error}</div>
          </div>
        )}

        {/* Data Table */}
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div className="font-semibold">{tabs.find((t) => t.key === tab)?.label}</div>
            <div className="text-xs text-slate-500">{rows.length} rows</div>
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

                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={Math.max(columns.length, 1)} className="px-5 py-6 text-center text-slate-500">
                      No rows returned.
                    </td>
                  </tr>
                )}

                {!loading &&
                  rows.map((r, idx) => (
                    <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                      {columns.map((c) => (
                        <td key={c} className="px-5 py-3 text-slate-800 whitespace-nowrap">
                          {formatCell(r[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
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

function formatCell(v: any) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}