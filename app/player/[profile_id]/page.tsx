"use client";

import { useParams } from "next/navigation";
import ProfileScreen from "@/components/profile/ProfileScreen";

export default function PlayerProfileRoute() {
  const params = useParams<{ profile_id: string }>();
  const profileId = params?.profile_id;

  if (!profileId) return null;

  return <ProfileScreen mode="public" profileId={profileId} />;
}
