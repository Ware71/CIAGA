import { ErrorScreen } from "@/components/ui/error-screen";

export default function NotFound() {
  return (
    <ErrorScreen
      title="Page not found"
      message="That link doesn't go anywhere. It may have moved, or the round or event behind it was removed."
    />
  );
}
