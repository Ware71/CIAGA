import type { Metadata } from "next";
import { Bell, Globe, Ruler, Thermometer } from "lucide-react";
import { Group, PageHeader, Row } from "@/components/ui/chrome";
import { ThemePicker } from "@/components/settings/ThemePicker";

export const metadata: Metadata = { title: "Settings" };

/**
 * Settings.
 *
 * Appearance is inline because choosing a theme repaints the screen you are
 * looking at, and that is the preview. Notifications gets its own page — ten
 * switches would bury everything else here.
 *
 * The greyed rows are deliberate: units, temperature and language are next, and
 * showing where they will land is more useful than a shorter screen that gives
 * no hint the app is going to grow one.
 */
function Soon({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-[color:var(--hair)] px-[6px] py-[1px] text-[length:var(--t-label)] font-medium uppercase tracking-[0.1em] text-[color:var(--sec-muted)]">
      {label}
    </span>
  );
}

function Icon({ as: As }: { as: typeof Bell }) {
  return <As className="h-[15px] w-[15px]" strokeWidth={1.9} />;
}

export default function SettingsPage() {
  return (
    <div className="min-h-screen px-4 pb-4">
      <div className="mx-auto w-full max-w-sm">
        <PageHeader title="Settings" parent="More" parentHref="/more" />

        <Group label="Appearance">
          <ThemePicker />
        </Group>

        <p className="-mt-3 mb-[var(--sp-grp)] text-[length:var(--t-sec)] leading-relaxed text-[color:var(--sec-muted)]">
          Themes reach every screen built on the shared chrome. A few older screens — the
          scorecard, and the Majors group and event pages — still carry their own colours and
          will look out of place until they are converted, which is most obvious on Linen.
        </p>

        <Group label="Alerts">
          <Row
            href="/more/settings/notifications"
            lead={
              <span className="grid h-[26px] w-[26px] place-items-center rounded-[8px] bg-[color:var(--sec-surface)] text-[color:var(--sec-accent)]">
                <Icon as={Bell} />
              </span>
            }
            title="Notifications"
            subtitle="What buzzes this device, and what stays silent"
            trailing={
              <span className="text-[length:var(--t-fig)] leading-none text-[color:var(--sec-muted)]">
                ›
              </span>
            }
          />
        </Group>

        <Group label="Units &amp; language">
          <Row
            lead={
              <span className="grid h-[26px] w-[26px] place-items-center rounded-[8px] bg-[color:var(--sec-surface)] text-[color:var(--sec-muted)]">
                <Icon as={Ruler} />
              </span>
            }
            title="Distance"
            subtitle="Yards or metres"
            trailing={<Soon label="Soon" />}
            className="opacity-55"
          />
          <Row
            lead={
              <span className="grid h-[26px] w-[26px] place-items-center rounded-[8px] bg-[color:var(--sec-surface)] text-[color:var(--sec-muted)]">
                <Icon as={Thermometer} />
              </span>
            }
            title="Temperature"
            subtitle="Celsius or Fahrenheit"
            trailing={<Soon label="Soon" />}
            className="opacity-55"
          />
          <Row
            lead={
              <span className="grid h-[26px] w-[26px] place-items-center rounded-[8px] bg-[color:var(--sec-surface)] text-[color:var(--sec-muted)]">
                <Icon as={Globe} />
              </span>
            }
            title="Language"
            subtitle="English (United Kingdom)"
            trailing={<Soon label="Soon" />}
            className="opacity-55"
          />
        </Group>
      </div>
    </div>
  );
}
