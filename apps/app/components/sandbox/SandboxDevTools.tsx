import { SandboxPanel } from "./SandboxPanel";

export function SandboxDevTools() {
  if (process.env.NEXT_PUBLIC_APP_ENV !== "sandbox") return null;
  return <SandboxPanel />;
}
