import type { Metadata } from "next";
import NotificationSettingsClient from "./NotificationSettingsClient";

export const metadata: Metadata = { title: "Notifications" };

export default function NotificationSettingsPage() {
  return <NotificationSettingsClient />;
}
