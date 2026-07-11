import type { Metadata } from "next";
import ProfilesClient from "./ProfilesClient";

export const metadata: Metadata = { title: "Performance Profiles" };

export default function FantasyProfilesPage() {
  return <ProfilesClient />;
}
