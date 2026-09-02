import type { Metadata } from "next";
import HandicapCalculatorClient from "./HandicapCalculatorClient";

export const metadata: Metadata = { title: "Handicap Calculator" };

export default function HandicapCalculatorPage() {
  return <HandicapCalculatorClient />;
}
