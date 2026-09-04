"use client";

import { useRouter } from "next/navigation";
import { CourseBrowser } from "@/components/courses/CourseBrowser";
import { PageHeader } from "@/components/ui/chrome";

/**
 * The Courses screen.
 *
 * This page used to be a near-verbatim fork of CoursePickerModal — the same
 * three-step worldwide wizard, the same list renderer, the same map modal, with
 * a different radius and "View" instead of "Select". Both are now the one
 * CourseBrowser; all this owns is the header and where a chosen course goes.
 */
export default function CoursesPage() {
  const router = useRouter();

  return (
    <div className="flex h-[calc(100dvh-var(--ciaga-nav-h))] flex-col px-4">
      <div className="mx-auto flex min-h-0 w-full max-w-sm flex-1 flex-col">
        <PageHeader
          title="Courses"
          subtitle="Search anywhere, star the ones you play"
          parent="More"
          parentHref="/more"
        />

        <CourseBrowser
          mode="navigate"
          onSelect={(courseId) => router.push(`/courses/${courseId}`)}
          className="pb-2"
        />
      </div>
    </div>
  );
}
