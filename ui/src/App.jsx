import { useMemo, useState } from "react";
import "./App.css";

function TabButton({ active, children, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "10px 12px",
        borderRadius: 10,
        border: "1px solid #e5e7eb",
        background: active ? "#111827" : "white",
        color: active ? "white" : "#111827",
        fontWeight: 700,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function Card({ title, children }) {
  return (
    <div
      style={{
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: 16,
        padding: 16,
      }}
    >
      <div style={{ fontWeight: 800, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div
      style={{
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: 16,
        padding: 14,
      }}
    >
      <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 900, marginTop: 6 }}>
        {value}
      </div>
    </div>
  );
}

function AlertsList({ alerts, onAck }) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {alerts.length === 0 ? (
        <div style={{ color: "#6b7280" }}>No alerts right now.</div>
      ) : (
        alerts.map((a) => (
          <div
            key={a.id}
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 14,
              padding: 12,
              background: a.ack ? "#f9fafb" : "white",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <div>
                <div style={{ fontWeight: 900 }}>
                  {a.severity} — {a.title}
                </div>
                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                  {a.time} {a.source ? `• ${a.source}` : ""}
                </div>
                {a.details ? (
                  <div style={{ marginTop: 8, color: "#111827" }}>{a.details}</div>
                ) : null}
              </div>

              {!a.ack ? (
                <button
                  onClick={() => onAck(a.id)}
                  style={{
                    height: 34,
                    padding: "0 12px",
                    borderRadius: 10,
                    border: "1px solid #111827",
                    background: "#111827",
                    color: "white",
                    fontWeight: 800,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  Acknowledge
                </button>
              ) : (
                <div style={{ fontSize: 12, fontWeight: 800, color: "#6b7280" }}>
                  Acknowledged
                </div>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("operator");

  // Fake data for now (later we’ll replace with your API + websocket)
  const stats = useMemo(
    () => [
      { label: "Throughput (hr)", value: "—" },
      { label: "WIP", value: "—" },
      { label: "Scrap Rate", value: "—" },
      { label: "Bottleneck", value: "—" },
    ],
    []
  );

  const [alerts, setAlerts] = useState([
    {
      id: "1",
      severity: "WARN",
      title: "Bottleneck detected",
      details: "Station NED2-A queue length is high.",
      time: new Date().toLocaleString(),
      source: "Simulator",
      ack: false,
    },
    {
      id: "2",
      severity: "INFO",
      title: "Order arrived",
      details: "New work order WO-1042 released to floor.",
      time: new Date().toLocaleString(),
      source: "ERP/MES",
      ack: false,
    },
  ]);

  const acknowledge = (id) => {
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, ack: true } : a)));
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc" }}>
      {/* Top bar */}
      <div
        style={{
          background: "white",
          borderBottom: "1px solid #e5e7eb",
          padding: 16,
        }}
      >
        <div
          style={{
            maxWidth: 1100,
            margin: "0 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                background: "#111827",
                color: "white",
                padding: "8px 12px",
                borderRadius: 14,
                fontWeight: 900,
              }}
            >
              MES UI
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <TabButton active={tab === "operator"} onClick={() => setTab("operator")}>
                Operator
              </TabButton>
              <TabButton active={tab === "supervisor"} onClick={() => setTab("supervisor")}>
                Supervisor
              </TabButton>
              <TabButton active={tab === "engineering"} onClick={() => setTab("engineering")}>
                Engineering
              </TabButton>
            </div>
          </div>

          <div
            style={{
              padding: "6px 10px",
              borderRadius: 999,
              background: "#fee2e2",
              color: "#991b1b",
              fontWeight: 900,
              fontSize: 12,
            }}
            title="This will become Live/Offline once we connect websockets."
          >
            Offline
          </div>
        </div>
      </div>

      {/* Page */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: 16 }}>
        {tab === "operator" ? (
          <>
            <h1 style={{ fontSize: 22, fontWeight: 900, marginBottom: 6 }}>
              Operator View
            </h1>
            <div style={{ color: "#6b7280", marginBottom: 14 }}>
              Live alerts + quick KPIs for the shop floor.
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
              {stats.map((s) => (
                <Stat key={s.label} label={s.label} value={s.value} />
              ))}
            </div>

            <div style={{ marginTop: 14 }}>
              <Card title="Alerts">
                <AlertsList alerts={alerts.filter((a) => !a.ack)} onAck={acknowledge} />
              </Card>
            </div>
          </>
        ) : tab === "supervisor" ? (
          <>
            <h1 style={{ fontSize: 22, fontWeight: 900, marginBottom: 6 }}>
              Supervisor View
            </h1>
            <div style={{ color: "#6b7280", marginBottom: 14 }}>
              Inventory oversight + alert acknowledgements.
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Card title="Inventory (placeholder)">
                <div style={{ color: "#6b7280" }}>
                  Next we’ll add a real inventory table from your database.
                </div>
              </Card>

              <Card title="All Alerts">
                <AlertsList alerts={alerts} onAck={acknowledge} />
              </Card>
            </div>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 22, fontWeight: 900, marginBottom: 6 }}>
              Engineering View
            </h1>
            <div style={{ color: "#6b7280", marginBottom: 14 }}>
              Debug visibility (event log, station status, etc.).
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Card title="Event Log (placeholder)">
                <div style={{ color: "#6b7280" }}>
                  Next we’ll stream events from the simulator (WebSocket) and show filters.
                </div>
              </Card>

              <Card title="Station Status (placeholder)">
                <div style={{ color: "#6b7280" }}>
                  Next we’ll show robot state, queue lengths, faults, and uptime.
                </div>
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

