import type { Metadata } from "next";
import MajorsProfileClient from "./MajorsProfileClient";

export const metadata: Metadata = { title: "Majors Profile" };

export default function MajorsProfilePage() {
  return <MajorsProfileClient />;
}
