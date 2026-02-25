from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
import os
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

# Force load backend/.env
ENV_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
load_dotenv(ENV_PATH)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_conn():
    return psycopg2.connect(
        host=os.getenv("DB_HOST"),
        port=int(os.getenv("DB_PORT", "5432")),
        dbname=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        connect_timeout=5,
    )

@app.get("/test-db")
def test_db():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM public.raw_parts;")
    count = cur.fetchone()[0]
    cur.close()
    conn.close()
    return {"raw_parts_count": count}

@app.get("/kpis")
def kpis():
    """
    Edit these queries to match your schemas/tables if not in public.
    """
    try:
        conn = get_conn()
        cur = conn.cursor()

        # Example KPI 1: queued parts
        cur.execute("SELECT COUNT(*) FROM public.raw_parts WHERE stage = 'queued';")
        queued = cur.fetchone()[0]

        # Example KPI 2: total parts
        cur.execute("SELECT COUNT(*) FROM public.raw_parts;")
        total_parts = cur.fetchone()[0]

        # Example KPI 3: newest part timestamp (if created_at exists)
        newest_ts = None
        try:
            cur.execute("SELECT MAX(created_at) FROM public.raw_parts;")
            newest_ts = cur.fetchone()[0]
        except Exception:
            newest_ts = None

        cur.close()
        conn.close()

        return {
            "queued_parts": int(queued),
            "total_parts": int(total_parts),
            "newest_created_at": str(newest_ts) if newest_ts else None,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/queue")
def queue(
    stage: str = Query(default="queued"),
    limit: int = Query(default=200, ge=1, le=500),
):
    """
    Returns a clean table for the UI.
    Adjust selected columns to match your raw_parts schema.
    """
    try:
        conn = get_conn()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # If your table uses different column names, edit here.
        sql = """
        SELECT
          part_id,
          stage,
          created_at,
          source_robot,
          source_pi,
          target_ned
        FROM public.raw_parts
        WHERE (%s = '' OR stage = %s)
        ORDER BY created_at DESC
        LIMIT %s;
        """
        cur.execute(sql, (stage, stage, limit))
        rows = cur.fetchall()

        cur.close()
        conn.close()
        return {"rows": rows}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/table-sample")
def table_sample(
    table: str = Query(..., description="Table name, e.g. raw_parts"),
    schema: str = Query(default="public"),
    limit: int = Query(default=50, ge=1, le=200),
):
    """
    Generic 'peek' endpoint. Safer than raw SQL input:
    - restricts schema/table chars
    - uses LIMIT
    """
    import re
    if not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", table):
        raise HTTPException(status_code=400, detail="Invalid table name")
    if not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", schema):
        raise HTTPException(status_code=400, detail="Invalid schema name")

    try:
        conn = get_conn()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(f'SELECT * FROM "{schema}"."{table}" LIMIT %s;', (limit,))
        rows = cur.fetchall()
        cur.close()
        conn.close()
        return {"rows": rows}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    from fastapi import FastAPI, HTTPException, Query

DB_SCHEMA_DEFAULT = os.getenv("DB_SCHEMA", "public")  # change to mes_dashboards if needed

def get_conn():
    return psycopg2.connect(
        host=os.getenv("DB_HOST"),
        port=int(os.getenv("DB_PORT", "5432")),
        dbname=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        connect_timeout=5,
    )

def fetch_dict_rows(sql: str, params=()):
    conn = get_conn()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(sql, params)
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return rows

@app.get("/kpis")
def kpis(schema: str = Query(default=DB_SCHEMA_DEFAULT)):
    try:
        rows = fetch_dict_rows(
            f"""
            SELECT
              (SELECT COUNT(*) FROM "{schema}".raw_parts WHERE stage='queued') AS queued_parts,
              (SELECT COUNT(*) FROM "{schema}".raw_parts) AS total_parts,
              (SELECT COUNT(*) FROM "{schema}".raw_robot_cycles) AS robot_cycles,
              (SELECT COUNT(*) FROM "{schema}".raw_inspection) AS inspections,
              (SELECT COUNT(*) FROM "{schema}".raw_conveyor) AS conveyor_events,
              (SELECT COUNT(*) FROM "{schema}".raw_bin_events) AS bin_events
              (SELECT COUNT(*) FROM "{schema}".raw_shipments) AS shipments
            """
        )
        return rows[0] if rows else {}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/queue")
def queue(
    schema: str = Query(default=DB_SCHEMA_DEFAULT),
    stage: str = Query(default="queued"),
    limit: int = Query(default=200, ge=1, le=500),
):
    """
    NOTE: Adjust selected columns to match your raw_parts schema.
    If some columns don't exist, remove them.
    """
    try:
        sql = f"""
        SELECT
          part_id,
          stage,
          created_at,
          source_robot,
          source_pi,
          target_ned
        FROM "{schema}".raw_parts
        WHERE (%s = '' OR stage = %s)
        ORDER BY created_at DESC
        LIMIT %s
        """
        rows = fetch_dict_rows(sql, (stage, stage, limit))
        return {"rows": rows}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/robot-cycles")
def robot_cycles(
    schema: str = Query(default=DB_SCHEMA_DEFAULT),
    limit: int = Query(default=200, ge=1, le=1000),
):
    try:
        rows = fetch_dict_rows(
            f'SELECT * FROM "{schema}".raw_robot_cycles ORDER BY 1 DESC LIMIT %s',
            (limit,),
        )
        return {"rows": rows}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/inspection")
def inspection(
    schema: str = Query(default=DB_SCHEMA_DEFAULT),
    limit: int = Query(default=200, ge=1, le=1000),
):
    try:
        rows = fetch_dict_rows(
            f'SELECT * FROM "{schema}".raw_inspection ORDER BY 1 DESC LIMIT %s',
            (limit,),
        )
        return {"rows": rows}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/conveyor")
def conveyor(
    schema: str = Query(default=DB_SCHEMA_DEFAULT),
    limit: int = Query(default=200, ge=1, le=1000),
):
    try:
        rows = fetch_dict_rows(
            f'SELECT * FROM "{schema}".raw_conveyor ORDER BY 1 DESC LIMIT %s',
            (limit,),
        )
        return {"rows": rows}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/bin-events")
def bin_events(
    schema: str = Query(default=DB_SCHEMA_DEFAULT),
    limit: int = Query(default=200, ge=1, le=1000),
):
    try:
        rows = fetch_dict_rows(
            f'SELECT * FROM "{schema}".raw_bin_events ORDER BY 1 DESC LIMIT %s',
            (limit,),
        )
        return {"rows": rows}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/shipments")
def shipments(
    schema: str = Query(default=DB_SCHEMA_DEFAULT),
    limit: int = Query(default=200, ge=1, le=1000),
):
    try:
        rows = fetch_dict_rows(
            f'SELECT * FROM "{schema}".raw_shipments ORDER BY 1 DESC LIMIT %s',
            (limit,),
        )
        return {"rows": rows}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

from fastapi import Query
import psycopg2.extras

@app.get("/alerts")
def alerts(
    schema: str = Query(default=DB_SCHEMA_DEFAULT),
    conveyor_stale_seconds: int = Query(default=30),
    conveyor_slow_duration: float = Query(default=3.0),
    window_minutes: int = Query(default=2),
):
    """
    Computed 'active alerts' (no DB writes required).
    Includes identifiers (conveyor_id/part_id/source_pi) so UI can highlight & focus.
    """
    try:
        conn = get_conn()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        active_alerts = []

        # Latest conveyor row (for identifiers)
        cur.execute(
            f"""
            SELECT id, conveyor_id, part_id, source_pi, duration_sec, speed, event_time
            FROM "{schema}".raw_conveyor
            ORDER BY event_time DESC
            LIMIT 1
            """
        )
        latest = cur.fetchone()

        # 1) Conveyor stale (no recent events)
        cur.execute(
            f"""
            SELECT EXTRACT(EPOCH FROM (NOW() - MAX(event_time))) AS seconds_stale
            FROM "{schema}".raw_conveyor
            """
        )
        seconds_stale = cur.fetchone()["seconds_stale"]

        if seconds_stale is None:
            # no rows at all
            active_alerts.append({
                "type": "conveyor_no_data",
                "severity": "critical",
                "title": "No conveyor data",
                "message": "raw_conveyor has no rows yet.",
                "source": "raw_conveyor",
                "event_time": None,
                "conveyor_id": None,
                "part_id": None,
                "source_pi": None,
                "trigger_value": None,
                "threshold": None,
            })
        else:
            if float(seconds_stale) > float(conveyor_stale_seconds):
                active_alerts.append({
                    "type": "conveyor_stale",
                    "severity": "warning",
                    "title": "Conveyor events stopped",
                    "message": f"No conveyor events in the last {int(seconds_stale)} seconds.",
                    "source": "raw_conveyor",
                    "event_time": str(latest["event_time"]) if latest else None,
                    "conveyor_id": latest["conveyor_id"] if latest else None,
                    "part_id": latest["part_id"] if latest else None,
                    "source_pi": latest["source_pi"] if latest else None,
                    "trigger_value": float(seconds_stale),
                    "threshold": float(conveyor_stale_seconds),
                })

        # 2) Conveyor slow: find "worst" conveyor in the lookback window
        cur.execute(
            f"""
            SELECT
              conveyor_id,
              source_pi,
              AVG(duration_sec) AS avg_duration,
              COUNT(*) AS n
            FROM "{schema}".raw_conveyor
            WHERE event_time >= NOW() - (%s || ' minutes')::interval
            GROUP BY conveyor_id, source_pi
            HAVING COUNT(*) >= 5
            ORDER BY AVG(duration_sec) DESC
            LIMIT 1
            """,
            (window_minutes,)
        )
        worst = cur.fetchone()
        if worst and worst["avg_duration"] is not None:
            avg_d = float(worst["avg_duration"])
            if avg_d > float(conveyor_slow_duration):
                active_alerts.append({
                    "type": "conveyor_slow",
                    "severity": "warning",
                    "title": "Conveyor running slow",
                    "message": f'Conveyor {worst["conveyor_id"]} avg duration {avg_d:.2f}s in last {window_minutes} min (n={worst["n"]}).',
                    "source": "raw_conveyor",
                    "event_time": None,
                    "conveyor_id": worst["conveyor_id"],
                    "part_id": None,
                    "source_pi": worst["source_pi"],
                    "trigger_value": avg_d,
                    "threshold": float(conveyor_slow_duration),
                })

        cur.close()
        conn.close()
        return {"alerts": active_alerts, "count": len(active_alerts)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))