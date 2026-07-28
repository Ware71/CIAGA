import { ImageResponse } from "next/og";

export const alt = "CIAGA — the golf society app";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Social share card. Everything is drawn with plain divs — no custom font, no
 * fs reads, no network fetch — so the route builds deterministically anywhere.
 * (Satori supports only a subset of CSS: flexbox, inline styles, no classes.)
 */
export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          backgroundColor: "#042713",
          fontFamily: "sans-serif",
        }}
      >
        {/* soft brand glow */}
        <div
          style={{
            position: "absolute",
            top: -180,
            right: -140,
            width: 640,
            height: 640,
            borderRadius: 320,
            background: "#0b3b21",
            opacity: 0.75,
            display: "flex",
          }}
        />
        {/* gold accent bar */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 12,
            backgroundColor: "#f5e6b0",
            display: "flex",
          }}
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "0 90px",
            height: "100%",
          }}
        >
          {/* drawn mark */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 120,
              height: 120,
              borderRadius: 60,
              border: "7px solid #f5e6b0",
              color: "#f5e6b0",
              fontSize: 62,
              fontWeight: 800,
            }}
          >
            C
          </div>

          <div
            style={{
              display: "flex",
              fontSize: 96,
              fontWeight: 800,
              color: "#f5e6b0",
              letterSpacing: -1,
              marginTop: 38,
            }}
          >
            CIAGA
          </div>

          <div
            style={{
              display: "flex",
              fontSize: 24,
              fontWeight: 600,
              color: "rgba(167,243,208,0.8)",
              letterSpacing: 6,
              marginTop: 10,
            }}
          >
            EST. 2025
          </div>

          <div
            style={{
              display: "flex",
              fontSize: 40,
              color: "rgba(236,253,245,0.9)",
              marginTop: 34,
            }}
          >
            Rounds · Handicaps · Majors · Stats
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
