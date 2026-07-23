// The landing splash's grow overlay: the CIAGA logo scaling 0.35 → 1 over the
// initial paint. Extracted from app/loading.tsx so both the root loading
// fallback and the /home-specific fallback render the identical markup.
//
// LoadingScreen (components/ui/loading-screen.tsx) syncs to this via
// performance.now() and takes over for the pulse/spin/exit, so the timing here
// (GROW_MS = 450) must stay in step with it.
export function SplashGrow() {
  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @keyframes ciaga-grow {
              from { transform: scale(0.35); }
              to   { transform: scale(1); }
            }
            #ciaga-splash-logo {
              animation: ciaga-grow 0.45s ease-out forwards;
            }
          `,
        }}
      />
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 10000,
          backgroundColor: "#042713",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          id="ciaga-splash-logo"
          src="/ciaga-logo.png"
          alt="CIAGA"
          width={176}
          height={176}
          style={{ borderRadius: "50%" }}
        />
      </div>
    </>
  );
}
