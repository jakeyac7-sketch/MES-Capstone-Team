"use client";
import { useEffect, useState } from "react";

export default function Home() {
  const apiBase = process.env.NEXT_PUBLIC_API_URL; // should show in UI
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!apiBase) {
      setError("NEXT_PUBLIC_API_URL is undefined. Check frontend/.env.local and restart npm run dev.");
      return;
    }

    fetch(`${apiBase}/test-db`)
      .then(async (res) => {
        const ct = res.headers.get("content-type") || "";
        if (!ct.includes("application/json")) {
          const text = await res.text();
          throw new Error(`Expected JSON but got: ${ct}. First 60 chars: ${text.slice(0, 60)}`);
        }
        return res.json();
      })
      .then((data) => setCount(data.raw_parts_count))
      .catch((e) => setError(String(e)));
  }, [apiBase]);

  return (
    <main style={{ padding: 40, fontFamily: "Arial" }}>
      <h1>MES Execution UI</h1>
      <p><b>API base:</b> {apiBase || "(undefined)"} </p>

      {error ? (
        <p style={{ color: "red" }}>Error: {error}</p>
      ) : count === null ? (
        <p>Loading...</p>
      ) : (
        <p><b>Raw Parts Count:</b> {count}</p>
      )}
    </main>
  );
}
