"use client";

import { useState, useLayoutEffect, useEffect } from "react";
import { SandboxPanel } from "./SandboxPanel";

export function SandboxDevTools() {
  const [show, setShow] = useState(false);

  // Show immediately on return visits (splash already played)
  useLayoutEffect(() => {
    if (process.env.NEXT_PUBLIC_APP_ENV !== "sandbox") return;
    if (sessionStorage.getItem("splash_shown") === "1") setShow(true);
  }, []);

  // Show after first-time splash animation completes
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_APP_ENV !== "sandbox" || show) return;
    const handler = () => setShow(true);
    window.addEventListener("splash:done", handler, { once: true });
    return () => window.removeEventListener("splash:done", handler);
  }, [show]);

  if (!show) return null;
  return <SandboxPanel />;
}
