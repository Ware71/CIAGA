"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const METHOD_DESCRIPTIONS: Record<string, string> = {
  GET: "Retrieve data from GolfCourseAPI. Safe and read-only. Use this for searching and fetching course details.",
  POST: "Create or submit data to GolfCourseAPI. Used for advanced searches or endpoints that require a request body.",
  PUT: "Update existing data on GolfCourseAPI. Rarely used; only for endpoints that explicitly support updates.",
  DELETE: "Remove data from GolfCourseAPI. Use with caution — most public endpoints do not support deletes.",
};

function tryPrettyJson(text: string): { pretty: string; isJson: boolean } {
  try {
    const obj = JSON.parse(text);
    return { pretty: JSON.stringify(obj, null, 2), isJson: true };
  } catch {
    return { pretty: text, isJson: false };
  }
}

export default function StatsExplorerPage() {
  const router = useRouter();

  // --- Mode ---
  const [mode, setMode] = useState<"LIVE_SEARCH" | "MANUAL">("LIVE_SEARCH");

  // --- Live search state ---
  const [searchTerm, setSearchTerm] = useState("st andrews");
  const [livePath, setLivePath] = useState("/v1/search"); // editable
  const [liveExtraQuery, setLiveExtraQuery] = useState(""); // optional
  const [liveStatus, setLiveStatus] = useState<number | null>(null);
  const [liveResponse, setLiveResponse] = useState<string | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  // --- Manual state (kept for debugging) ---
  const [method, setMethod] = useState("GET");
  const [path, setPath] = useState("/v1/search");
  const [query, setQuery] = useState("search_query=st%20andrews");
  const [body, setBody] = useState("");
  const [response, setResponse] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const methodDescription = useMemo(
    () => METHOD_DESCRIPTIONS[method] ?? "",
    [method]
  );

  async function runManualRequest() {
    setLoading(true);
    setResponse(null);
    setStatus(null);

    const qs = query ? `&${query}` : "";
    const url = `/api/golfcourseapi?path=${encodeURIComponent(path)}${qs}`;

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body:
        method === "GET" || method === "HEAD" ? undefined : body || undefined,
    });

    const text = await res.text();
    setStatus(res.status);
    setResponse(text);
    setLoading(false);
  }

  // Live search fetcher
  async function runLiveSearch(term: string) {
    const trimmed = term.trim();

    // Clear quickly when empty
    if (!trimmed) {
      setLiveStatus(null);
      setLiveResponse(null);
      setLiveLoading(false);
      return;
    }

    // Abort previous in-flight request
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLiveLoading(true);
    setLiveResponse(null);
    setLiveStatus(null);

    // Build query params for proxy:
    // /api/golfcourseapi?path=/v1/search&search_query=...
    const params = new URLSearchParams();
    params.set("path", livePath);
    params.set("search_query", trimmed);

    // Optional extra query (for experimenting)
    // ex: "limit=5&country=US"
    if (liveExtraQuery.trim()) {
      const extra = new URLSearchParams(liveExtraQuery.trim());
      extra.forEach((v, k) => {
        if (k === "path") return;
        params.append(k, v);
      });
    }

    const url = `/api/golfcourseapi?${params.toString()}`;

    try {
      const res = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
      });

      const text = await res.text();
      setLiveStatus(res.status);
      setLiveResponse(text);
    } catch (err: any) {
      // Ignore abort errors; user kept typing
      if (err?.name !== "AbortError") {
        setLiveStatus(0);
        setLiveResponse(
          JSON.stringify({ error: err?.message ?? "Live search failed" }, null, 2)
        );
      }
    } finally {
      setLiveLoading(false);
    }
  }

  // Debounce typing
  useEffect(() => {
    if (mode !== "LIVE_SEARCH") return;

    const t = setTimeout(() => {
      runLiveSearch(searchTerm);
    }, 350);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm, mode, livePath, liveExtraQuery]);

  const liveDisplay = liveResponse ? tryPrettyJson(liveResponse) : null;
  const manualDisplay = response ? tryPrettyJson(response) : null;

  return (
    <div
      style={{
        padding: 32,
        maxWidth: 1100,
        margin: "0 auto",
        fontSize: 16,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          marginBottom: 16,
          gap: 16,
        }}
      >
        <button
          onClick={() => router.back()}
          style={{
            padding: "8px 14px",
            fontWeight: 700,
            border: "1px solid #444",
            borderRadius: 8,
            background: "#222",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          ← Back
        </button>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>
            GolfCourseAPI Explorer
          </h1>
          <div style={{ opacity: 0.75, fontWeight: 600, marginTop: 4 }}>
            Live search like the app + raw JSON response viewer
          </div>
        </div>
      </div>

      {/* Mode toggle */}
      <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
        <button
          onClick={() => setMode("LIVE_SEARCH")}
          style={{
            padding: "10px 14px",
            fontWeight: 800,
            borderRadius: 10,
            border: "1px solid #333",
            background: mode === "LIVE_SEARCH" ? "#2563eb" : "#111",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          Live Search
        </button>
        <button
          onClick={() => setMode("MANUAL")}
          style={{
            padding: "10px 14px",
            fontWeight: 800,
            borderRadius: 10,
            border: "1px solid #333",
            background: mode === "MANUAL" ? "#2563eb" : "#111",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          Manual Request Builder
        </button>
      </div>

      {/* LIVE SEARCH */}
      {mode === "LIVE_SEARCH" && (
        <>
          <section
            style={{
              border: "1px solid #333",
              borderRadius: 12,
              padding: 20,
              marginBottom: 18,
              background: "#0f0f0f",
            }}
          >
            <h2 style={{ fontSize: 20, fontWeight: 900, marginBottom: 12 }}>
              Live Search (GET)
            </h2>

            <div
              style={{
                borderLeft: "6px solid #22c55e",
                background: "#06130b",
                padding: "12px 16px",
                borderRadius: 10,
                fontWeight: 700,
                lineHeight: 1.5,
                marginBottom: 14,
              }}
            >
              Type like you would in the app. We call{" "}
              <span style={{ fontFamily: "monospace" }}>{livePath}</span> with{" "}
              <span style={{ fontFamily: "monospace" }}>search_query</span> and
              show the raw JSON response.
            </div>

            <label style={{ fontWeight: 800, display: "block", marginBottom: 8 }}>
              Search
            </label>

            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="e.g. st andrews, pebble beach, pinehurst..."
              style={{
                width: "100%",
                padding: "14px 14px",
                fontSize: 18,
                fontWeight: 800,
                borderRadius: 12,
                border: "1px solid #2a2a2a",
                background: "#0b0b0b",
                color: "#fff",
                outline: "none",
              }}
            />

            <div style={{ display: "flex", gap: 12, marginTop: 14 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>Path</div>
                <input
                  value={livePath}
                  onChange={(e) => setLivePath(e.target.value)}
                  style={{
                    width: "100%",
                    padding: 10,
                    fontWeight: 700,
                    borderRadius: 10,
                    border: "1px solid #2a2a2a",
                    background: "#0b0b0b",
                    color: "#fff",
                    fontFamily: "monospace",
                  }}
                />
              </div>

              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>
                  Extra query (optional)
                </div>
                <input
                  value={liveExtraQuery}
                  onChange={(e) => setLiveExtraQuery(e.target.value)}
                  placeholder="limit=5"
                  style={{
                    width: "100%",
                    padding: 10,
                    fontWeight: 700,
                    borderRadius: 10,
                    border: "1px solid #2a2a2a",
                    background: "#0b0b0b",
                    color: "#fff",
                    fontFamily: "monospace",
                  }}
                />
              </div>

              <button
                onClick={() => runLiveSearch(searchTerm)}
                style={{
                  alignSelf: "flex-end",
                  padding: "10px 14px",
                  fontWeight: 900,
                  borderRadius: 10,
                  background: "#2563eb",
                  color: "#fff",
                  border: "none",
                  cursor: "pointer",
                  height: 42,
                }}
              >
                Refresh
              </button>
            </div>

            <div style={{ marginTop: 12, fontWeight: 800, opacity: 0.85 }}>
              Request:
              <div
                style={{
                  marginTop: 6,
                  padding: 10,
                  background: "#070707",
                  border: "1px solid #222",
                  borderRadius: 10,
                  fontFamily: "monospace",
                  fontSize: 13,
                  overflowX: "auto",
                }}
              >
                {`GET /api/golfcourseapi?path=${livePath}&search_query=${searchTerm.trim() || "<empty>"}${
                  liveExtraQuery.trim() ? `&${liveExtraQuery.trim()}` : ""
                }`}
              </div>
            </div>
          </section>

          <section
            style={{
              border: "1px solid #333",
              borderRadius: 12,
              padding: 20,
              background: "#0b0b0b",
            }}
          >
            <h2 style={{ fontSize: 20, fontWeight: 900, marginBottom: 12 }}>
              Live Search Response
            </h2>

            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  fontWeight: 900,
                  color:
                    liveStatus === null
                      ? "#9ca3af"
                      : liveStatus >= 400 || liveStatus === 0
                      ? "#ef4444"
                      : "#22c55e",
                }}
              >
                {liveStatus === null ? "No request yet" : `HTTP ${liveStatus}`}
              </div>
              {liveLoading && (
                <div style={{ fontWeight: 800, opacity: 0.8 }}>Loading…</div>
              )}
            </div>

            {liveResponse ? (
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  fontFamily: "monospace",
                  fontSize: 14,
                  padding: 16,
                  marginTop: 12,
                  background: "#020617",
                  color: "#e5e7eb",
                  borderRadius: 10,
                  maxHeight: 560,
                  overflow: "auto",
                  border: "1px solid #111827",
                }}
              >
                {liveDisplay?.pretty}
              </pre>
            ) : (
              <div style={{ marginTop: 12, opacity: 0.7, fontWeight: 700 }}>
                Type in the search bar to see the JSON response.
              </div>
            )}
          </section>
        </>
      )}

      {/* MANUAL */}
      {mode === "MANUAL" && (
        <>
          {/* Method Description */}
          <div
            style={{
              borderLeft: "6px solid #2563eb",
              background: "#0b1220",
              padding: "14px 18px",
              marginBottom: 18,
              borderRadius: 10,
              fontWeight: 700,
              lineHeight: 1.5,
            }}
          >
            <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 4 }}>
              {method} request
            </div>
            {methodDescription}
          </div>

          {/* Request Builder */}
          <section
            style={{
              border: "1px solid #333",
              borderRadius: 12,
              padding: 20,
              marginBottom: 18,
              background: "#0f0f0f",
            }}
          >
            <h2 style={{ fontSize: 20, fontWeight: 900, marginBottom: 12 }}>
              Manual Request
            </h2>

            <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                style={{
                  padding: 10,
                  fontWeight: 900,
                  borderRadius: 10,
                }}
              >
                <option>GET</option>
                <option>POST</option>
                <option>PUT</option>
                <option>DELETE</option>
              </select>

              <input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/v1/search"
                style={{
                  flex: 1,
                  padding: 10,
                  fontWeight: 800,
                  borderRadius: 10,
                }}
              />
            </div>

            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="search_query=st%20andrews"
              style={{
                width: "100%",
                padding: 10,
                fontWeight: 700,
                borderRadius: 10,
                marginBottom: 12,
                fontFamily: "monospace",
              }}
            />

            {method !== "GET" && (
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder='{"name":"golf"}'
                style={{
                  width: "100%",
                  height: 140,
                  padding: 10,
                  fontFamily: "monospace",
                  borderRadius: 10,
                  marginBottom: 12,
                }}
              />
            )}

            <div style={{ display: "flex", gap: 12 }}>
              <button
                onClick={runManualRequest}
                disabled={loading}
                style={{
                  padding: "10px 18px",
                  fontWeight: 900,
                  borderRadius: 10,
                  background: "#2563eb",
                  color: "#fff",
                  cursor: "pointer",
                  border: "none",
                }}
              >
                {loading ? "Sending…" : "Send request"}
              </button>

              <button
                onClick={() => {
                  setPath("/v1/search");
                  setQuery("search_query=st%20andrews");
                  setMethod("GET");
                  setBody("");
                }}
                style={{ fontWeight: 800 }}
              >
                St Andrews
              </button>

              <button
                onClick={() => {
                  setPath("/v1/courses/search");
                  setQuery("name=golf");
                  setMethod("GET");
                  setBody("");
                }}
                style={{ fontWeight: 800 }}
              >
                Courses
              </button>
            </div>
          </section>

          {/* Response */}
          <section
            style={{
              border: "1px solid #333",
              borderRadius: 12,
              padding: 20,
              background: "#0b0b0b",
            }}
          >
            <h2 style={{ fontSize: 20, fontWeight: 900, marginBottom: 12 }}>
              Manual Response
            </h2>

            {status !== null && (
              <div
                style={{
                  marginBottom: 12,
                  fontWeight: 900,
                  color: status >= 400 ? "#ef4444" : "#22c55e",
                }}
              >
                HTTP {status}
              </div>
            )}

            {response ? (
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  fontFamily: "monospace",
                  fontSize: 14,
                  padding: 16,
                  background: "#020617",
                  color: "#e5e7eb",
                  borderRadius: 10,
                  maxHeight: 560,
                  overflow: "auto",
                  border: "1px solid #111827",
                }}
              >
                {manualDisplay?.pretty}
              </pre>
            ) : (
              <div style={{ opacity: 0.7, fontWeight: 700 }}>
                No response yet
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
