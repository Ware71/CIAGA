import type { Metadata } from "next";
import CreateGroupClient from "./CreateGroupClient";

export const metadata: Metadata = { title: "Create Group" };

export default function CreateGroupPage() {
  return <CreateGroupClient />;
}
