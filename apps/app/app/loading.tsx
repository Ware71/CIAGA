export default function Loading() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        backgroundColor: "#040d06",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/ciaga-logo.png"
        alt="CIAGA"
        width={176}
        height={176}
        style={{ transform: "scale(0.35)", borderRadius: "50%" }}
      />
    </div>
  );
}
