/**
 * Recorded lint debt, per file.
 *
 * These rules stay at "error" for the codebase as a whole — they catch real
 * defects, particularly the react-hooks ones — but the files below were already
 * violating them when lint was first wired into `npm run check` and CI. Blanket
 * -downgrading the rules would have meant they never fired again; listing the
 * offenders keeps the gate live for every new and modified file.
 *
 * Generated 2026-09-07 from `npx eslint . --format json`: 57 errors, 7 rules.
 *
 * To pay one down: fix the file, delete its line here, re-run `npm run lint`.
 * Do NOT add to this list to make a new violation pass.
 *
 * Known real-defect candidates worth triaging first:
 *   - react-hooks/set-state-in-effect (17 files) — setState during an effect
 *     causes an extra render pass and can loop.
 *   - react-hooks/purity (LeaderboardReveal.tsx) — impure render.
 *   - react-hooks/refs (3 files) — ref access during render.
 */
export const baseline = [
  {
    files: ["components/ui/textarea.tsx"],
    rules: { "@typescript-eslint/no-empty-object-type": "warn" },
  },
  {
    files: [
      "**/prize-pots/**/distribute/route.ts",
      "lib/feed/generators/achievements.ts",
      "lib/feed/helpers/formatSummary.ts",
      "lib/majors/queries.ts",
    ],
    rules: { "prefer-const": "warn" },
  },
  {
    files: ["components/majors/LeaderboardReveal.tsx"],
    rules: { "react-hooks/purity": "warn" },
  },
  {
    files: [
      "**/setup/SetupClient.tsx",
      "components/map-location-picker.tsx",
      "lib/calendar/useZoomGestures.ts",
    ],
    rules: { "react-hooks/refs": "warn" },
  },
  {
    files: [
      "app/majors/events/create/CreateEventClient.tsx",
      "components/CookieConsent.tsx",
      "components/fantasy/OddsValue.tsx",
      "components/legal/AcceptTermsGate.tsx",
      "components/majors/MajorsOverview.tsx",
      "components/nav/BottomNav.tsx",
      "components/notifications/NotificationCenter.tsx",
      "components/notifications/NotificationSettings.tsx",
      "components/round/HoleDetailPanel.tsx",
      "components/rounds/StablefordConfigEditor.tsx",
      "components/sandbox/SandboxDevTools.tsx",
      "components/social/MediaLightbox.tsx",
      "components/ui/SplashHost.tsx",
      "lib/fantasy/slipStore.ts",
      "lib/notifications/useNotificationPreferences.ts",
      "lib/notifications/useNotifications.ts",
      "lib/theme/useTheme.ts",
    ],
    rules: { "react-hooks/set-state-in-effect": "warn" },
  },
  {
    files: ["**/EventDetailClient.tsx"],
    rules: { "react-hooks/static-components": "warn" },
  },
  {
    files: [
      "app/majors/MajorsHubClient.tsx",
      "**/EventDetailClient.tsx",
      "**/setup/SetupClient.tsx",
      "components/calendar/views/LookingForRoundView.tsx",
      "components/courses/TeePickerSheet.tsx",
      "components/people/PeoplePicker.tsx",
      "components/rounds/CourseAndTeeSection.tsx",
      "components/rounds/SideGamesManager.tsx",
      "components/settings/ThemePicker.tsx",
    ],
    rules: { "react/no-unescaped-entities": "warn" },
  },
];
