import Link from "next/link";
import { APP_URL, MINIMUM_AGE, OPERATOR_NAME } from "@/lib/legal";
import { SiteHeader } from "@/components/site/SiteHeader";
import { Eyebrow, Section } from "@/components/site/Section";
import { FeatureCard, NoteCard } from "@/components/site/FeatureCard";
import { PillRow } from "@/components/site/PillRow";
import { PhoneFrame } from "@/components/site/PhoneFrame";
import {
  MockFantasy,
  MockHome,
  MockLeaderboard,
  MockScoring,
} from "@/components/site/mocks";
import {
  IconCalendar,
  IconChart,
  IconChat,
  IconBell,
  IconPin,
  IconTarget,
} from "@/components/site/icons";

const formats = [
  "Stroke Play",
  "Stableford",
  "Match Play",
  "Skins",
  "Wolf",
  "Pairs Stableford",
  "Team Stroke Play",
  "Team Stableford",
  "Best Ball",
  "Scramble",
  "Greensomes",
  "Foursomes",
] as const;

const sideGames = ["Skins", "Wolf", "Nassau"] as const;

const features = [
  {
    title: "Social feed",
    icon: <IconChat className="h-5 w-5" />,
    body: "Posts with photos, @mentions, reactions and threaded comments. Rounds post themselves when you finish. A live match strip shows who's out on a course right now.",
  },
  {
    title: "Notifications",
    icon: <IconBell className="h-5 w-5" />,
    body: "Nineteen kinds of notification across six categories, in the app and via web push. Keep the ones that matter, mute the rest.",
  },
  {
    title: "Calendar & availability",
    icon: <IconCalendar className="h-5 w-5" />,
    body: "Say when you're free, set it to repeat, sort people into circles, and put up a “Looking for a round” when you're short a fourth.",
  },
  {
    title: "Stats",
    icon: <IconChart className="h-5 w-5" />,
    body: "Scoring trajectory, goal ETA and projected index. Course records and personal bests, hole-by-hole scoring, a scoring breakdown, and milestones.",
  },
  {
    title: "Shot tracking",
    tag: "Optional",
    icon: <IconTarget className="h-5 w-5" />,
    body: "If you want the detail: putts, greens in regulation, fairways hit, scrambling and sand saves. Opt in per round — leave it off and everything else works exactly the same.",
  },
  {
    title: "Courses & tees",
    icon: <IconPin className="h-5 w-5" />,
    body: "Find courses near you or search worldwide, drop a pin on the map, and check or correct the tee boxes, par, yardage and stroke index. A scorecard is only as good as the course data behind it.",
  },
];

const a2hs = [
  {
    title: "iPhone / iPad (Safari)",
    steps: [
      "Open the app in Safari.",
      "Tap Share (square with arrow).",
      "Tap “Add to Home Screen”.",
      "Launch CIAGA from your Home Screen.",
    ],
  },
  {
    title: "Android (Chrome)",
    steps: [
      "Open the app in Chrome.",
      "Tap the menu (⋮) in the top right.",
      "Tap “Install app” / “Add to Home screen”.",
      "Launch CIAGA like a normal app.",
    ],
  },
];

const unglamorous = [
  {
    title: `${MINIMUM_AGE}+`,
    body: "Accounts are for adults. You confirm you're eighteen or over when you sign up.",
  },
  {
    title: "Run from the UK",
    body: `Operated by ${OPERATOR_NAME}, a sole trader in the United Kingdom, under the law of England and Wales.`,
  },
  {
    title: "No ad tech",
    body: "No advertising cookies, no tracking pixels, no third-party analytics. Only what's needed to keep you signed in.",
  },
  {
    title: "Your data, your call",
    body: "Export your data or close your account yourself, from inside the app. The Privacy Policy sets out exactly what closing an account does.",
  },
];

export default function Home() {
  return (
    <main id="main" className="bg-[#042713] text-emerald-50">
      <SiteHeader variant="marketing" />

      {/* ------------------------------------------------------------ hero */}
      <section className="mx-auto max-w-6xl px-5 pb-16 pt-12 sm:pt-16">
        <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-emerald-900/60 bg-[#0b3b21]/60 px-3 py-1.5 text-xs text-emerald-100/80 backdrop-blur-sm">
              <span className="h-2 w-2 rounded-full bg-[#f5e6b0]" />
              Free · Web app · Add it to your Home Screen
            </p>

            <h1 className="mt-5 text-balance text-4xl font-extrabold tracking-tight text-[#f5e6b0] sm:text-5xl">
              Run the society. Not the spreadsheet.
            </h1>

            <p className="mt-5 max-w-xl text-pretty text-lg text-emerald-100/80">
              CIAGA holds the rounds, the handicaps, the season and the arguing
              in one place. Twelve formats scored live, standings that move
              while you&rsquo;re still on the fifteenth, and a feed for the
              post-mortem.
            </p>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <a href={APP_URL} className="ciaga-cta">
                Open CIAGA
              </a>
              <a href="#install" className="ciaga-cta-secondary">
                How to install
              </a>
            </div>

            <p className="mt-4 text-xs text-emerald-200/80">
              No app store, no download, no subscription. {MINIMUM_AGE}+.
            </p>
          </div>

          <PhoneFrame label="The CIAGA home screen, showing a handicap index, recent round and social highlights.">
            <MockHome />
          </PhoneFrame>
        </div>
      </section>

      {/* ---------------------------------------------------------- rounds */}
      <section
        id="rounds"
        className="mx-auto max-w-6xl px-5 py-16 sm:py-24"
      >
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <Eyebrow>Rounds</Eyebrow>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-[#f5e6b0] sm:text-3xl">
              Live scoring that keeps up with the fourball
            </h2>
            <p className="mt-4 text-pretty text-base text-emerald-100/80">
              Set it up once — course, tee, players, format, teams, handicap
              policy, starting hole — then score it hole by hole. Everyone&rsquo;s
              looking at the same card. Portrait while you&rsquo;re playing,
              landscape for the full sheet, and a hole detail view for when
              somebody insists it was a five.
            </p>
            <div className="mt-6">
              <PillRow
                items={["12 formats", "3 side games", "Countback built in"]}
                tone="muted"
              />
            </div>
          </div>

          <PhoneFrame
            className="lg:order-last"
            label="A live Stableford scorecard on hole 14, showing four players, their strokes received and running points."
          >
            <MockScoring />
          </PhoneFrame>
        </div>

        <div className="mt-14 rounded-2xl border border-emerald-900/60 bg-gradient-to-br from-[#0b3b21]/90 to-[#07301a]/90 p-6 sm:p-8">
          <PillRow label="Every format your lot actually plays" items={formats} />
          <div className="mt-6">
            <PillRow label="Side games" items={sideGames} tone="muted" />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- handicaps */}
      <Section
        eyebrow="Handicaps"
        title="Strokes where they're supposed to be"
        lead="Handicap index history, allowances per format — 95%, 85%, whatever your society plays off — plus-handicap stroke allocation and nine-hole allowances. The index is snapshotted at the first tee, so a card that lands mid-round can't quietly rewrite the result. Acceptable and non-acceptable rounds are kept apart."
      >
        <div className="mt-8 max-w-3xl">
          <NoteCard>
            CIAGA is not a handicapping authority. Indexes, allowances and
            statistics are worked out for your group&rsquo;s convenience and
            aren&rsquo;t guaranteed to be error-free. Your official record stays
            with your club.
          </NoteCard>
        </div>
      </Section>

      {/* ---------------------------------------------------------- majors */}
      <section className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <PhoneFrame label="A live event leaderboard for a society spring meeting, with positions, holes played and points.">
            <MockLeaderboard />
          </PhoneFrame>

          <div>
            <Eyebrow>Majors</Eyebrow>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-[#f5e6b0] sm:text-3xl">
              Seasons that survive contact with reality
            </h2>
            <p className="mt-4 text-pretty text-base text-emerald-100/80">
              Groups and societies, multi-event competitions and series, entries
              and waitlists, tee times, fixtures, brackets, playoffs and live
              leaderboards. Season standings update as cards come in, the
              cross-group leaderboard settles the wider argument, and a career
              profile remembers exactly who won the thing in 2026.
            </p>
            <div className="mt-6">
              <NoteCard>
                Entry fees and prize money are recorded as a shared ledger,
                purely as bookkeeping for the society. CIAGA never takes, holds
                or moves money — members settle up between themselves, off the
                app.
              </NoteCard>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- feature */}
      <Section eyebrow="Also in the bag" title="The rest of it">
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <FeatureCard
              key={f.title}
              title={f.title}
              body={f.body}
              icon={f.icon}
              tag={f.tag}
            />
          ))}
        </div>
      </Section>

      {/* --------------------------------------------------------- fantasy */}
      <section
        id="fantasy"
        className="border-y border-emerald-900/60 bg-[#071c10]"
      >
        <div className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <Eyebrow>Fantasy picks</Eyebrow>
              <h2 className="mt-3 text-2xl font-bold tracking-tight text-[#f5e6b0] sm:text-3xl">
                A free prediction game, played for virtual points
              </h2>
              <p className="mt-4 text-pretty text-base text-emerald-100/80">
                Before an event, call it. Twelve-plus market types, accumulators
                from two to eight legs priced with the correlation actually
                accounted for, season-long markets, cash-out, and a group
                leaderboard — all run off a seeded simulation of your own
                group&rsquo;s form. You can&rsquo;t back yourself, which spares
                everyone that conversation.
              </p>

              <div className="mt-6">
                <NoteCard title="Points only. No money.">
                  Fantasy Picks uses virtual points. Points are not money, have
                  no monetary value, and cannot be bought, sold, transferred for
                  value, withdrawn or exchanged for money, goods or prizes.
                  &ldquo;Stakes&rdquo;, &ldquo;cash-out&rdquo; and
                  &ldquo;winnings&rdquo; refer solely to virtual points inside
                  the app. It is a free social feature and{" "}
                  <strong className="font-semibold text-[#f5e6b0]">
                    is not a betting, gaming or gambling service
                  </strong>
                  . {MINIMUM_AGE}+, like the rest of CIAGA.
                </NoteCard>
              </div>

              <Link
                href="/terms"
                className="mt-4 inline-block text-sm font-semibold text-[#f5e6b0] underline underline-offset-4 transition-colors hover:text-[#e9d79c]"
              >
                Read the full terms →
              </Link>
            </div>

            <PhoneFrame
              className="lg:order-last"
              label="A fantasy picks market board showing players, prediction prices, and a slip totalling virtual points."
            >
              <MockFantasy />
            </PhoneFrame>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- install */}
      <Section
        id="install"
        eyebrow="Install"
        title="Put it on your Home Screen"
        lead="CIAGA is a web app. No App Store, no download, no waiting for a review. Add it to your Home Screen and it runs full-screen like anything else on your phone — and keeps working when the clubhouse signal doesn't."
      >
        <div className="mt-6">
          <a href={APP_URL} className="ciaga-cta">
            Open CIAGA
          </a>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {a2hs.map((b) => (
            <div
              key={b.title}
              className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-6"
            >
              <p className="text-sm font-extrabold text-[#f5e6b0]">{b.title}</p>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-emerald-100/75 marker:text-[#f5e6b0]/60">
                {b.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </div>
          ))}
        </div>

        <p className="mt-6 max-w-2xl text-xs text-emerald-200/80">
          No install option showing? Make sure you&rsquo;re in Safari on iOS or
          Chrome on Android, and that you&rsquo;re on{" "}
          <strong className="font-semibold text-emerald-100">
            app.ciagagolf.com
          </strong>{" "}
          — not this page.
        </p>
      </Section>

      {/* ----------------------------------------------------- small print */}
      <Section title="The unglamorous bits">
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {unglamorous.map((u) => (
            <div
              key={u.title}
              className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-5"
            >
              <p className="text-sm font-extrabold text-[#f5e6b0]">{u.title}</p>
              <p className="mt-2 text-sm text-emerald-100/75">{u.body}</p>
            </div>
          ))}
        </div>
      </Section>
    </main>
  );
}
