export default function Loading() {
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
          backgroundColor: "#040d06",
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
