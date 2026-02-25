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
  conveyor_id?: string | number | null;
  part_id?: string | number | null;
  source_pi?: string | null;
};

// ─── MES Knowledge Base ─────────────────────────────────────────────────────
// Each alert type maps to an MES module, explanation, and corrective steps.
// Edit these to match your actual system's terminology and SOPs.
const MES_ALERT_KNOWLEDGE: Record<
  string,
  {
    module: string;
    moduleColor: string;
    whatItMeans: string;
    steps: string[];
    escalate?: string;
  }
> = {
  conveyor_no_data: {
    module: "Production Monitoring",
    moduleColor: "#ef4444",
    whatItMeans:
      "The MES Production Monitoring module has detected that the raw_conveyor table contains zero records. This means the conveyor simulators have either not started, lost their database connection, or crashed entirely. In a real facility, this would trigger an immediate line-stop review.",
    steps: [
      "Verify all 4 simulator processes are running (check your terminal / process manager).",
      "Confirm the feeder simulator is publishing events to the database.",
      "Check PostgreSQL connection credentials in your .env file.",
      "Restart the conveyor simulator and wait one polling cycle (≤30 s) for data to appear.",
      "If the issue persists, escalate to the Controls Engineer on shift.",
    ],
    escalate: "Controls Engineer / Shift Supervisor",
  },
  conveyor_stale: {
    module: "Production Monitoring",
    moduleColor: "#f59e0b",
    whatItMeans:
      "The MES has not received a new conveyor event within the configured staleness window. Data was flowing previously but has now stopped. This typically indicates a mid-run crash, a network partition, or a queue backup that is preventing new events from being written.",
    steps: [
      "Check the timestamp shown on the alert — confirm how long ago the last event arrived.",
      "SSH or connect to the Raspberry Pi / simulator host and verify the process is alive.",
      "Inspect application logs for crash stack traces or connection refused errors.",
      "Manually trigger one test event from the simulator to confirm the pipeline is healthy.",
      "Resume normal operation once events begin appearing and staleness clears.",
    ],
    escalate: "Controls Engineer",
  },
  conveyor_slow: {
    module: "Performance Analysis",
    moduleColor: "#f59e0b",
    whatItMeans:
      "The MES Performance Analysis module has calculated that average conveyor part duration is exceeding the configured threshold over the monitoring window. In a Jackson network model, elevated service times at one node propagate upstream as queue buildup — this is an early-warning indicator of a bottleneck forming.",
    steps: [
      "Note which conveyor_id is flagged — focus investigation there first.",
      "Review recent raw_conveyor rows for that conveyor: look for unusually high duration_sec outliers.",
      "Check if speed is lower than nominal — a speed drop causes duration inflation.",
      "In the simulation, verify the stochastic parameters for that node haven't drifted.",
      "If this is a real system: inspect the physical belt for mechanical resistance or sensor drift.",
      "Monitor for 2–3 more polling cycles; if avg_duration drops below threshold, alert will self-clear.",
    ],
    escalate: "Process Engineer",
  },
  inspection_fail_rate: {
    module: "Quality Management",
    moduleColor: "#8b5cf6",
    whatItMeans:
      "The MES Quality Management module has detected an elevated part rejection rate from the inspection station. This may indicate sensor miscalibration, upstream process drift, or a batch of non-conforming raw material entering the line.",
    steps: [
      "Pull the last 50 inspection records from the Inspection tab and filter for failed parts.",
      "Group failures by source_pi to determine if rejections are concentrated at one input node.",
      "Cross-reference part_ids with the Queue tab to trace back to originating robot cycle.",
      "Recalibrate inspection thresholds if false-positive rate is suspected.",
      "Flag affected part_ids for quarantine or re-inspection.",
    ],
    escalate: "Quality Engineer",
  },
  robot_cycle_long: {
    module: "Equipment Monitoring",
    moduleColor: "#3b82f6",
    whatItMeans:
      "The MES Equipment Monitoring module is reporting that robot cycle times have exceeded the expected range. Long cycle times reduce throughput and, in a Jackson network, increase queue depth at downstream nodes.",
    steps: [
      "Open the Robot Cycles tab and sort by cycle duration descending.",
      "Identify whether slowdowns are concentrated in pick, transfer, or place phases.",
      "Check for collisions or path replanning events in the robot controller logs.",
      "Verify no upstream parts are being held waiting (check Queue tab, stage = in_transfer).",
      "If simulation: confirm the stochastic service time distribution parameters are correct.",
    ],
    escalate: "Robotics Technician",
  },
};

function getAlertKnowledge(type: string) {
  return (
    MES_ALERT_KNOWLEDGE[type] ?? {
      module: "General MES Monitoring",
      moduleColor: "#64748b",
      whatItMeans:
        "The MES has flagged an anomaly that does not match a pre-defined alert type. Review the raw data associated with this alert and compare against expected operating parameters.",
      steps: [
        "Review the alert details and identify which data source is affected.",
        "Navigate to the relevant data tab and apply filters using the identifiers shown.",
        "Compare current values against historical baselines.",
        "Determine if this is a one-time anomaly or a recurring pattern.",
        "Document findings and escalate if the issue cannot be resolved at operator level.",
      ],
      escalate: "Shift Supervisor",
    }
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function Home() {
  const [tab, setTab] = useState<TabKey>("queue");
  const [kpis, setKpis] = useState<Record<string, any> | null>(null);
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [acknowledgedAlerts, setAcknowledgedAlerts] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [stage, setStage] = useState<string>("queued");
  const [filterPartId, setFilterPartId] = useState<string>("");
  const [filterConveyorId, setFilterConveyorId] = useState<string>("");
  const [filterSourcePi, setFilterSourcePi] = useState<string>("");

  const [paused, setPaused] = useState<boolean>(false);
  const [refreshMs, setRefreshMs] = useState<number>(5000);
  const [tightMonitoring, setTightMonitoring] = useState<boolean>(false);

  const [selectedRow, setSelectedRow] = useState<Record<string, any> | null>(null);
  const [resolveAlert, setResolveAlert] = useState<AlertItem | null>(null);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

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

  function alertKey(a: AlertItem) {
    return `${a.type}__${a.conveyor_id ?? ""}__${a.part_id ?? ""}__${a.source_pi ?? ""}`;
  }

  function endpointForData(t: TabKey) {
    if (t === "queue") return `${API_BASE}/queue?stage=${encodeURIComponent(stage)}&limit=200`;
    if (t === "robot") return `${API_BASE}/robot-cycles?limit=200`;
    if (t === "inspection") return `${API_BASE}/inspection?limit=200`;
    if (t === "conveyor") return `${API_BASE}/conveyor?limit=200`;
    if (t === "bins") return `${API_BASE}/bin-events?limit=200`;
    return `${API_BASE}/shipments?limit=200`;
  }

  function endpointForAlerts() {
    const stale = tightMonitoring ? 5 : 30;
    const slow = tightMonitoring ? 2.0 : 3.0;
    const windowMin = tightMonitoring ? 1 : 2;
    return `${API_BASE}/alerts?conveyor_stale_seconds=${stale}&conveyor_slow_duration=${slow}&window_minutes=${windowMin}`;
  }

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

  useEffect(() => { load(); }, [tab, stage, tightMonitoring]);

  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => load(), refreshMs);
    return () => clearInterval(t);
  }, [paused, refreshMs, tab, stage, tightMonitoring]);

  const visibleAlerts = alerts.filter((a) => !acknowledgedAlerts.has(alertKey(a)));
  const criticalCount = visibleAlerts.filter((a) => a.severity === "critical").length;
  const warningCount = visibleAlerts.filter((a) => a.severity === "warning").length;
  const systemStatus = criticalCount > 0 ? "critical" : warningCount > 0 ? "warning" : "ok";

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

  function rowMatchesAlert(r: Record<string, any>) {
    if (!visibleAlerts.length) return false;
    const rowPart = r.part_id != null ? String(r.part_id) : "";
    const rowConv = r.conveyor_id != null ? String(r.conveyor_id) : "";
    const rowSrc = r.source_pi != null ? String(r.source_pi) : "";
    return visibleAlerts.some((a) => {
      const aPart = a.part_id != null ? String(a.part_id) : "";
      const aConv = a.conveyor_id != null ? String(a.conveyor_id) : "";
      const aSrc = a.source_pi != null ? String(a.source_pi) : "";
      return (aPart && rowPart === aPart) || (aConv && rowConv === aConv) || (aSrc && rowSrc === aSrc);
    });
  }

  function onClickAlert(a: AlertItem) {
    setResolveAlert(a);
    setCompletedSteps(new Set());
  }

  function onClickAlertFilter(a: AlertItem) {
    if (a.source === "raw_conveyor" || a.type.startsWith("conveyor")) setTab("conveyor");
    if (a.part_id != null) setFilterPartId(String(a.part_id));
    if (a.conveyor_id != null) setFilterConveyorId(String(a.conveyor_id));
    if (a.source_pi) setFilterSourcePi(String(a.source_pi));
    setTimeout(() => tableWrapRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
  }

  function acknowledgeAlert(a: AlertItem) {
    setAcknowledgedAlerts((prev) => new Set([...prev, alertKey(a)]));
    setResolveAlert(null);
    setCompletedSteps(new Set());
  }

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

  function toggleStep(i: number) {
    setCompletedSteps((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  const resolveKnowledge = resolveAlert ? getAlertKnowledge(resolveAlert.type) : null;
  const resolveSteps = resolveKnowledge?.steps ?? [];
  const allStepsComplete = resolveSteps.length > 0 && completedSteps.size === resolveSteps.length;

  return (
    <div className="min-h-screen text-slate-100" style={{ background: "#0d1117", fontFamily: "'DM Mono', 'Fira Code', 'Courier New', monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Space+Grotesk:wght@400;500;600;700&display=swap');
        .mes-header { font-family: 'Space Grotesk', sans-serif; }
        .alert-pulse-critical { animation: pulse-red 2s infinite; }
        .alert-pulse-warning { animation: pulse-amber 3s infinite; }
        @keyframes pulse-red {
          0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.4); }
          50% { box-shadow: 0 0 0 6px rgba(239,68,68,0); }
        }
        @keyframes pulse-amber {
          0%, 100% { box-shadow: 0 0 0 0 rgba(245,158,11,0.3); }
          50% { box-shadow: 0 0 0 6px rgba(245,158,11,0); }
        }
        .step-done { text-decoration: line-through; opacity: 0.5; }
        .drawer-slide { animation: slideIn 0.2s ease-out; }
        @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        .modal-fade { animation: fadeUp 0.2s ease-out; }
        @keyframes fadeUp { from { transform: translateY(16px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .tab-active { border-bottom: 2px solid #38bdf8; color: #38bdf8; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #161b22; }
        ::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
        .kpi-card:hover { border-color: #38bdf8; transition: border-color 0.2s; }
        .row-highlight { background: rgba(245,158,11,0.08) !important; border-left: 2px solid #f59e0b; }
        .row-hover:hover { background: rgba(255,255,255,0.03) !important; }
      `}</style>

      {/* ── Top Bar ──────────────────────────────────────────────────────── */}
      <div style={{ background: "#161b22", borderBottom: "1px solid #30363d" }} className="sticky top-0 z-50">
        <div className="mx-auto max-w-7xl px-6 py-3 flex flex-wrap items-center gap-3">
          {/* Brand */}
          <div className="mr-4">
            <div className="mes-header text-base font-bold tracking-wide" style={{ color: "#38bdf8", letterSpacing: "0.08em" }}>
              MES CONTROL
            </div>
            <div className="text-xs" style={{ color: "#6e7681", fontFamily: "'DM Mono', monospace" }}>
              {API_BASE}
            </div>
          </div>

          {/* System status pill */}
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-sm border ${
              systemStatus === "critical"
                ? "border-red-500 bg-red-950 text-red-300 alert-pulse-critical"
                : systemStatus === "warning"
                ? "border-amber-500 bg-amber-950 text-amber-300"
                : "border-emerald-700 bg-emerald-950 text-emerald-300"
            }`}
          >
            <div
              className={`h-2 w-2 rounded-full ${
                systemStatus === "critical" ? "bg-red-500" : systemStatus === "warning" ? "bg-amber-400" : "bg-emerald-400"
              }`}
            />
            <span className="mes-header text-xs font-semibold tracking-widest uppercase">
              {systemStatus === "ok" ? "Nominal" : systemStatus === "warning" ? "Warning" : "Attention Required"}
            </span>
          </div>

          {/* Alert count badge */}
          <div className="px-3 py-1.5 rounded-sm border text-xs mes-header"
            style={{ borderColor: "#30363d", background: "#21262d", color: "#8b949e" }}>
            Alerts{" "}
            <span
              className={`ml-1.5 inline-flex items-center justify-center rounded-sm px-1.5 py-0.5 text-xs font-bold ${
                visibleAlerts.length > 0 ? "bg-red-600 text-white" : "text-slate-500"
              }`}
              style={{ minWidth: "20px" }}
            >
              {visibleAlerts.length}
            </span>
          </div>

          {/* Controls */}
          <button
            onClick={() => setTightMonitoring((v) => !v)}
            className={`px-3 py-1.5 rounded-sm border text-xs mes-header font-medium transition-all ${
              tightMonitoring
                ? "border-sky-500 bg-sky-900 text-sky-200"
                : "border-slate-700 bg-transparent text-slate-400 hover:border-slate-500"
            }`}
          >
            TIGHT MON: {tightMonitoring ? "ON" : "OFF"}
          </button>

          <button
            onClick={focusOnConveyor}
            className="px-3 py-1.5 rounded-sm border text-xs mes-header font-medium text-slate-400 hover:text-sky-300 hover:border-sky-600 transition-all"
            style={{ borderColor: "#30363d" }}
          >
            FOCUS CONVEYOR
          </button>

          <button
            onClick={() => setPaused((v) => !v)}
            className={`px-3 py-1.5 rounded-sm border text-xs mes-header font-medium transition-all ${
              paused ? "border-amber-500 bg-amber-950 text-amber-300" : "border-slate-700 text-slate-400 hover:border-slate-500"
            }`}
          >
            {paused ? "⏸ PAUSED" : "▶ LIVE"}
          </button>

          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs" style={{ color: "#6e7681" }}>POLL</span>
            <select
              className="rounded-sm border px-2 py-1.5 text-xs"
              style={{ background: "#21262d", borderColor: "#30363d", color: "#c9d1d9" }}
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
              className="px-4 py-1.5 rounded-sm text-xs font-semibold mes-header transition-all"
              style={{ background: "#1f6feb", color: "white" }}
            >
              SYNC
            </button>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-6 py-6">

        {/* ── Active Alerts Panel ─────────────────────────────────────────── */}
        <div className="mb-6 rounded-sm border overflow-hidden" style={{ borderColor: "#30363d", background: "#161b22" }}>
          <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: "#30363d" }}>
            <div>
              <span className="mes-header font-semibold text-sm tracking-wider" style={{ color: "#c9d1d9" }}>
                ACTIVE ALERTS
              </span>
              <span className="ml-2 text-xs" style={{ color: "#6e7681" }}>
                — click any alert to open the MES resolution guide
              </span>
            </div>
            <div className="text-xs" style={{ color: "#6e7681" }}>
              {visibleAlerts.length} active · {acknowledgedAlerts.size} acknowledged
            </div>
          </div>

          {visibleAlerts.length === 0 && !loading && (
            <div className="px-5 py-6 flex items-center gap-3">
              <div className="h-2 w-2 rounded-full bg-emerald-400" />
              <span className="text-sm" style={{ color: "#8b949e" }}>All systems nominal. No active alerts.</span>
            </div>
          )}

          {visibleAlerts.length > 0 && (
            <div>
              {visibleAlerts.map((a, idx) => (
                <div
                  key={idx}
                  className="border-b flex gap-0"
                  style={{ borderColor: "#21262d" }}
                >
                  {/* Severity bar */}
                  <div
                    className="w-1 flex-shrink-0"
                    style={{
                      background:
                        a.severity === "critical" ? "#ef4444" : a.severity === "warning" ? "#f59e0b" : "#3b82f6",
                    }}
                  />

                  <div className="flex-1 px-5 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        {/* Module badge */}
                        <div className="mb-1.5">
                          <span
                            className="inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-semibold mes-header tracking-wider uppercase"
                            style={{
                              background: getAlertKnowledge(a.type).moduleColor + "22",
                              color: getAlertKnowledge(a.type).moduleColor,
                              border: `1px solid ${getAlertKnowledge(a.type).moduleColor}44`,
                            }}
                          >
                            {getAlertKnowledge(a.type).module}
                          </span>
                          <span
                            className="ml-2 text-xs uppercase tracking-widest font-semibold"
                            style={{
                              color:
                                a.severity === "critical" ? "#ef4444" : a.severity === "warning" ? "#f59e0b" : "#3b82f6",
                            }}
                          >
                            {a.severity}
                          </span>
                        </div>

                        <div className="mes-header font-semibold text-sm mb-1" style={{ color: "#e6edf3" }}>
                          {a.title}
                        </div>
                        <div className="text-xs mb-2" style={{ color: "#8b949e" }}>{a.message}</div>

                        <div className="flex flex-wrap gap-2">
                          {a.source_pi && <IdTag label={`pi: ${a.source_pi}`} />}
                          {a.conveyor_id != null && <IdTag label={`conveyor: ${a.conveyor_id}`} />}
                          {a.part_id != null && <IdTag label={`part: ${a.part_id}`} />}
                          {a.trigger_value != null && (
                            <IdTag label={`value: ${Number(a.trigger_value).toFixed(2)} / threshold: ${Number(a.threshold).toFixed(2)}`} dim />
                          )}
                          {a.event_time && <IdTag label={`last event: ${a.event_time}`} dim />}
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex flex-col gap-2 flex-shrink-0">
                        <button
                          onClick={() => onClickAlert(a)}
                          className="px-4 py-2 rounded-sm text-xs font-bold mes-header tracking-wider transition-all hover:opacity-90"
                          style={{ background: "#1f6feb", color: "white" }}
                        >
                          RESOLVE →
                        </button>
                        <button
                          onClick={() => onClickAlertFilter(a)}
                          className="px-4 py-2 rounded-sm text-xs font-medium mes-header transition-all"
                          style={{ background: "#21262d", color: "#8b949e", border: "1px solid #30363d" }}
                        >
                          FILTER DATA
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── KPI Cards ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          {[
            { label: "QUEUED", value: kpis?.queued_parts },
            { label: "TOTAL PARTS", value: kpis?.total_parts },
            { label: "ROBOT CYCLES", value: kpis?.robot_cycles },
            { label: "INSPECTIONS", value: kpis?.inspections },
            { label: "CONVEYOR EVT", value: kpis?.conveyor_events },
            { label: "BIN EVENTS", value: kpis?.bin_events },
          ].map((k) => (
            <div
              key={k.label}
              className="kpi-card rounded-sm border p-4"
              style={{ background: "#161b22", borderColor: "#30363d" }}
            >
              <div className="text-xs mes-header tracking-widest" style={{ color: "#6e7681" }}>{k.label}</div>
              <div className="mt-2 text-2xl font-semibold mes-header" style={{ color: "#e6edf3" }}>
                {k.value ?? "—"}
              </div>
            </div>
          ))}
        </div>

        {/* ── Tabs ────────────────────────────────────────────────────────── */}
        <div className="flex gap-0 border-b mb-4" style={{ borderColor: "#30363d" }}>
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-xs mes-header font-medium tracking-wider uppercase transition-all ${
                tab === t.key ? "tab-active" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Filters ─────────────────────────────────────────────────────── */}
        <div className="mb-4 flex flex-wrap gap-2 items-center">
          {tab === "queue" && (
            <select
              className="rounded-sm border px-3 py-2 text-xs"
              style={{ background: "#21262d", borderColor: "#30363d", color: "#c9d1d9", fontFamily: "'DM Mono', monospace" }}
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
          {[
            { placeholder: "part_id…", value: filterPartId, set: setFilterPartId },
            { placeholder: "conveyor_id…", value: filterConveyorId, set: setFilterConveyorId },
            { placeholder: "source_pi…", value: filterSourcePi, set: setFilterSourcePi },
          ].map((f) => (
            <input
              key={f.placeholder}
              className="rounded-sm border px-3 py-2 text-xs"
              style={{ background: "#21262d", borderColor: "#30363d", color: "#c9d1d9", fontFamily: "'DM Mono', monospace", width: "150px" }}
              placeholder={f.placeholder}
              value={f.value}
              onChange={(e) => f.set(e.target.value)}
            />
          ))}
          <button
            onClick={clearFilters}
            className="px-3 py-2 rounded-sm border text-xs mes-header transition-all"
            style={{ borderColor: "#30363d", color: "#6e7681", background: "transparent" }}
          >
            CLEAR
          </button>
          <span className="text-xs ml-2" style={{ color: "#484f58" }}>
            Click any part_id / conveyor_id / source_pi cell to filter instantly
          </span>
        </div>

        {error && (
          <div className="mb-4 rounded-sm border border-red-800 bg-red-950 p-4 text-xs">
            <div className="mes-header font-semibold text-red-400 mb-1">CONNECTION ERROR</div>
            <div style={{ color: "#fca5a5" }}>{error}</div>
          </div>
        )}

        {/* ── Data Table ──────────────────────────────────────────────────── */}
        <div ref={tableWrapRef} className="rounded-sm border overflow-hidden" style={{ borderColor: "#30363d", background: "#161b22" }}>
          <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: "#30363d" }}>
            <div className="mes-header font-semibold text-sm tracking-wider" style={{ color: "#c9d1d9" }}>
              {tabs.find((t) => t.key === tab)?.label.toUpperCase()}
              {tab === "queue" && (
                <StageBadge stage={stage || "all"} />
              )}
            </div>
            <div className="text-xs" style={{ color: "#6e7681" }}>
              {filteredRows.length} / {rows.length} rows
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-xs" style={{ fontFamily: "'DM Mono', monospace" }}>
              <thead style={{ background: "#0d1117", color: "#6e7681" }}>
                <tr style={{ borderBottom: "1px solid #30363d" }}>
                  {columns.map((c) => (
                    <th key={c} className="px-5 py-3 text-left font-medium whitespace-nowrap tracking-wider uppercase">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={Math.max(columns.length, 1)} className="px-5 py-8 text-center" style={{ color: "#484f58" }}>
                      syncing…
                    </td>
                  </tr>
                )}
                {!loading && filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={Math.max(columns.length, 1)} className="px-5 py-8 text-center" style={{ color: "#484f58" }}>
                      No rows (clear filters or check connection)
                    </td>
                  </tr>
                )}
                {!loading &&
                  filteredRows.map((r, idx) => {
                    const matched = rowMatchesAlert(r);
                    return (
                      <tr
                        key={idx}
                        className={`row-hover cursor-pointer ${matched ? "row-highlight" : ""}`}
                        style={{ borderBottom: "1px solid #21262d" }}
                        onClick={() => setSelectedRow(r)}
                        title={matched ? "⚠ This row matches an active alert" : "Click for details"}
                      >
                        {columns.map((c) => (
                          <td
                            key={c}
                            className="px-5 py-3 whitespace-nowrap"
                            style={{ color: matched ? "#fde68a" : "#c9d1d9" }}
                            onClick={(e) => {
                              if (c === "part_id") { e.stopPropagation(); setFilterPartId(String(r[c] ?? "")); }
                              if (c === "conveyor_id") { e.stopPropagation(); setFilterConveyorId(String(r[c] ?? "")); }
                              if (c === "source_pi") { e.stopPropagation(); setFilterSourcePi(String(r[c] ?? "")); }
                            }}
                          >
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
      </main>

      {/* ══════════════════════════════════════════════════════════════════════
          ALERT RESOLVE MODAL — the main new feature
      ══════════════════════════════════════════════════════════════════════ */}
      {resolveAlert && resolveKnowledge && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0"
            style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}
            onClick={() => { setResolveAlert(null); setCompletedSteps(new Set()); }}
          />

          {/* Modal */}
          <div
            className="modal-fade relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-sm border"
            style={{ background: "#161b22", borderColor: "#30363d", zIndex: 10 }}
          >
            {/* Modal header */}
            <div
              className="sticky top-0 px-6 pt-6 pb-4 border-b"
              style={{ background: "#161b22", borderColor: "#30363d", zIndex: 1 }}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  {/* MES Module badge */}
                  <div className="mb-2">
                    <span
                      className="inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-bold mes-header tracking-widest uppercase"
                      style={{
                        background: resolveKnowledge.moduleColor + "22",
                        color: resolveKnowledge.moduleColor,
                        border: `1px solid ${resolveKnowledge.moduleColor}55`,
                      }}
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                        <rect width="4" height="4" />
                        <rect x="6" width="4" height="4" />
                        <rect y="6" width="4" height="4" />
                        <rect x="6" y="6" width="4" height="4" />
                      </svg>
                      MES MODULE: {resolveKnowledge.module}
                    </span>
                    <span
                      className="ml-2 text-xs uppercase tracking-widest font-bold"
                      style={{
                        color: resolveAlert.severity === "critical" ? "#ef4444" : resolveAlert.severity === "warning" ? "#f59e0b" : "#3b82f6",
                      }}
                    >
                      {resolveAlert.severity}
                    </span>
                  </div>
                  <h2 className="mes-header text-lg font-bold" style={{ color: "#e6edf3" }}>
                    {resolveAlert.title}
                  </h2>
                  <p className="text-xs mt-1" style={{ color: "#8b949e" }}>{resolveAlert.message}</p>
                </div>
                <button
                  onClick={() => { setResolveAlert(null); setCompletedSteps(new Set()); }}
                  className="flex-shrink-0 px-3 py-1.5 rounded-sm border text-xs mes-header transition-all"
                  style={{ borderColor: "#30363d", color: "#6e7681" }}
                >
                  ESC
                </button>
              </div>

              {/* Alert identifiers */}
              <div className="mt-3 flex flex-wrap gap-2">
                {resolveAlert.source_pi && <IdTag label={`pi: ${resolveAlert.source_pi}`} />}
                {resolveAlert.conveyor_id != null && <IdTag label={`conveyor: ${resolveAlert.conveyor_id}`} />}
                {resolveAlert.part_id != null && <IdTag label={`part: ${resolveAlert.part_id}`} />}
                {resolveAlert.trigger_value != null && (
                  <IdTag
                    label={`measured: ${Number(resolveAlert.trigger_value).toFixed(2)} · threshold: ${Number(resolveAlert.threshold).toFixed(2)}`}
                    dim
                  />
                )}
              </div>
            </div>

            {/* What it means */}
            <div className="px-6 py-5 border-b" style={{ borderColor: "#21262d" }}>
              <div className="text-xs font-bold mes-header tracking-widest uppercase mb-2" style={{ color: "#6e7681" }}>
                What This Means (MES Context)
              </div>
              <p className="text-sm leading-relaxed" style={{ color: "#c9d1d9" }}>
                {resolveKnowledge.whatItMeans}
              </p>
            </div>

            {/* Corrective action steps */}
            <div className="px-6 py-5 border-b" style={{ borderColor: "#21262d" }}>
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs font-bold mes-header tracking-widest uppercase" style={{ color: "#6e7681" }}>
                  Corrective Action Procedure
                </div>
                <div className="text-xs mes-header" style={{ color: "#484f58" }}>
                  {completedSteps.size} / {resolveSteps.length} steps complete
                </div>
              </div>

              {/* Progress bar */}
              <div className="mb-4 h-1 rounded-full" style={{ background: "#21262d" }}>
                <div
                  className="h-1 rounded-full transition-all duration-300"
                  style={{
                    width: `${resolveSteps.length ? (completedSteps.size / resolveSteps.length) * 100 : 0}%`,
                    background: allStepsComplete ? "#22c55e" : "#1f6feb",
                  }}
                />
              </div>

              <div className="space-y-2">
                {resolveSteps.map((step, i) => {
                  const done = completedSteps.has(i);
                  return (
                    <button
                      key={i}
                      onClick={() => toggleStep(i)}
                      className="w-full text-left flex items-start gap-3 px-4 py-3 rounded-sm transition-all"
                      style={{
                        background: done ? "#0f2a1a" : "#0d1117",
                        border: `1px solid ${done ? "#166534" : "#30363d"}`,
                      }}
                    >
                      {/* Checkbox */}
                      <div
                        className="flex-shrink-0 mt-0.5 h-4 w-4 rounded-sm border flex items-center justify-center"
                        style={{
                          borderColor: done ? "#22c55e" : "#484f58",
                          background: done ? "#22c55e" : "transparent",
                        }}
                      >
                        {done && (
                          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                            <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                      <div className="flex gap-2 items-start">
                        <span className="text-xs mes-header flex-shrink-0" style={{ color: done ? "#22c55e" : "#6e7681" }}>
                          {String(i + 1).padStart(2, "0")}.
                        </span>
                        <span
                          className={`text-sm ${done ? "step-done" : ""}`}
                          style={{ color: done ? "#4b5563" : "#c9d1d9" }}
                        >
                          {step}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Escalation info */}
            {resolveKnowledge.escalate && (
              <div className="px-6 py-4 border-b" style={{ borderColor: "#21262d", background: "#0d1117" }}>
                <div className="flex items-center gap-2 text-xs" style={{ color: "#6e7681" }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M6 1L11 10H1L6 1Z" stroke="#f59e0b" strokeWidth="1.2" />
                    <path d="M6 5V7M6 8.5V9" stroke="#f59e0b" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                  <span>
                    If unresolved after completing all steps, escalate to:{" "}
                    <span className="mes-header font-semibold" style={{ color: "#f59e0b" }}>
                      {resolveKnowledge.escalate}
                    </span>
                  </span>
                </div>
              </div>
            )}

            {/* Footer actions */}
            <div className="px-6 py-4 flex items-center justify-between gap-3">
              <button
                onClick={() => onClickAlertFilter(resolveAlert)}
                className="px-4 py-2 rounded-sm border text-xs mes-header font-medium transition-all"
                style={{ borderColor: "#30363d", color: "#8b949e", background: "transparent" }}
              >
                VIEW IN DATA TABLE →
              </button>

              <button
                onClick={() => acknowledgeAlert(resolveAlert)}
                className={`px-6 py-2.5 rounded-sm text-xs font-bold mes-header tracking-wider transition-all ${
                  allStepsComplete
                    ? "bg-emerald-600 text-white hover:bg-emerald-500"
                    : "border text-slate-500"
                }`}
                style={!allStepsComplete ? { borderColor: "#30363d", background: "transparent" } : {}}
                title={!allStepsComplete ? "Complete all steps above to acknowledge" : "Mark alert as acknowledged"}
              >
                {allStepsComplete ? "✓ ACKNOWLEDGE & DISMISS" : `COMPLETE ${resolveSteps.length - completedSteps.size} REMAINING STEPS`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Row Details Drawer (unchanged from before, restyled) ─────────── */}
      {selectedRow && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => setSelectedRow(null)} />
          <div
            className="drawer-slide absolute right-0 top-0 h-full w-full sm:w-96 border-l overflow-y-auto"
            style={{ background: "#161b22", borderColor: "#30363d", zIndex: 10 }}
          >
            <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: "#30363d" }}>
              <div className="mes-header font-semibold text-sm tracking-wider" style={{ color: "#c9d1d9" }}>ROW DETAILS</div>
              <button
                onClick={() => setSelectedRow(null)}
                className="px-3 py-1 rounded-sm border text-xs mes-header"
                style={{ borderColor: "#30363d", color: "#6e7681" }}
              >
                CLOSE
              </button>
            </div>

            <div className="p-5 space-y-3">
              <div className="flex flex-wrap gap-2">
                {"part_id" in selectedRow && selectedRow.part_id != null && (
                  <button
                    onClick={() => { setFilterPartId(String(selectedRow.part_id)); setSelectedRow(null); }}
                    className="px-3 py-2 rounded-sm text-xs mes-header font-medium"
                    style={{ background: "#1f6feb", color: "white" }}
                  >
                    Filter part_id
                  </button>
                )}
                {"conveyor_id" in selectedRow && selectedRow.conveyor_id != null && (
                  <button
                    onClick={() => { setTab("conveyor"); setFilterConveyorId(String(selectedRow.conveyor_id)); setSelectedRow(null); }}
                    className="px-3 py-2 rounded-sm border text-xs mes-header font-medium"
                    style={{ borderColor: "#30363d", color: "#8b949e" }}
                  >
                    Focus conveyor_id
                  </button>
                )}
                {"source_pi" in selectedRow && selectedRow.source_pi != null && (
                  <button
                    onClick={() => { setFilterSourcePi(String(selectedRow.source_pi)); setSelectedRow(null); }}
                    className="px-3 py-2 rounded-sm border text-xs mes-header font-medium"
                    style={{ borderColor: "#30363d", color: "#8b949e" }}
                  >
                    Filter source_pi
                  </button>
                )}
                <button
                  onClick={() => { clearFilters(); setSelectedRow(null); }}
                  className="px-3 py-2 rounded-sm border text-xs mes-header font-medium"
                  style={{ borderColor: "#30363d", color: "#6e7681" }}
                >
                  Clear
                </button>
              </div>

              <div className="rounded-sm border overflow-hidden" style={{ borderColor: "#30363d" }}>
                <div className="px-4 py-2 text-xs mes-header tracking-wider uppercase" style={{ background: "#0d1117", color: "#6e7681" }}>
                  Fields
                </div>
                <div className="p-4 space-y-2">
                  {Object.entries(selectedRow).map(([k, v]) => (
                    <div key={k} className="flex gap-3 text-xs">
                      <div className="w-32 flex-shrink-0" style={{ color: "#6e7681" }}>{k}</div>
                      <div className="flex-1 break-all" style={{ color: "#c9d1d9" }}>{formatCell(v)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function IdTag({ label, dim }: { label: string; dim?: boolean }) {
  return (
    <span
      className="inline-flex items-center rounded-sm px-2 py-0.5 text-xs"
      style={{
        background: dim ? "transparent" : "#21262d",
        border: "1px solid #30363d",
        color: dim ? "#484f58" : "#8b949e",
        fontFamily: "'DM Mono', monospace",
      }}
    >
      {label}
    </span>
  );
}

function StageBadge({ stage }: { stage: string }) {
  const s = (stage || "").toLowerCase();
  const cfg: Record<string, { bg: string; color: string; border: string }> = {
    queued:      { bg: "#451a03", color: "#fbbf24", border: "#78350f" },
    in_transfer: { bg: "#172554", color: "#93c5fd", border: "#1e3a8a" },
    picked:      { bg: "#1e1b4b", color: "#a5b4fc", border: "#312e81" },
    completed:   { bg: "#052e16", color: "#86efac", border: "#166534" },
    at_ned:      { bg: "#0c1a2e", color: "#7dd3fc", border: "#0c4a6e" },
    all:         { bg: "#1c1c1c", color: "#9ca3af", border: "#374151" },
  };
  const c = cfg[s] || { bg: "#1c1c1c", color: "#9ca3af", border: "#374151" };
  return (
    <span
      className="inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-semibold mes-header tracking-wider ml-2"
      style={{ background: c.bg, color: c.color, border: `1px solid ${c.border}` }}
    >
      {stage || "—"}
    </span>
  );
}

function formatCell(v: any): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}