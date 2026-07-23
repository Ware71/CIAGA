"use client";

/**
 * Last-resort boundary: catches throws in the root layout itself, which means
 * it replaces the layout entirely and must render its own <html>/<body>.
 *
 * Deliberately self-contained — no shared components, no Tailwind classes from
 * globals.css, no fonts. Anything imported here is something that can break the
 * screen that exists to show breakage.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          backgroundColor: "#042713",
          color: "#e2e8f0",
          fontFamily: "system-ui, -apple-system, sans-serif",
          padding: "1rem",
        }}
      >
        <div style={{ maxWidth: "24rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.125rem", fontWeight: 600, color: "#f5e6b0", margin: 0 }}>
            CIAGA hit a problem
          </h1>
          <p style={{ fontSize: "0.875rem", opacity: 0.7, marginTop: "0.75rem" }}>
            The app failed to start. Reloading usually clears it.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.25rem",
              padding: "0.5rem 1.25rem",
              borderRadius: "9999px",
              border: "1px solid rgba(167, 243, 208, 0.4)",
              background: "rgba(6, 78, 59, 0.5)",
              color: "#ecfdf5",
              fontSize: "0.875rem",
              fontWeight: 600,
            }}
          >
            Try again
          </button>
          {error.digest ? (
            <div
              style={{
                marginTop: "1.25rem",
                fontSize: "0.625rem",
                fontFamily: "monospace",
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                opacity: 0.35,
              }}
            >
              {error.digest}
            </div>
          ) : null}
        </div>
      </body>
    </html>
  );
}
