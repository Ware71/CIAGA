'use client';

import CIAGAStarter from "./CiagaStarter";
import AuthGate from "@/components/ui/auth-gate";

export default function Page() {
  return (
    <AuthGate>
      <CIAGAStarter />
    </AuthGate>
  );
}
