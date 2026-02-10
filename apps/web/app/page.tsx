import Image from "next/image";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.ciagagolf.com";

const features = [
  {
    title: "Rounds & scorecards",
    desc: "Track rounds, stats and personal bests. Keep everything in one place.",
  },
  {
    title: "Social feed",
    desc: "A feed for your group: rounds, highlights, reactions, milestones and banter.",
  },
  {
    title: "Leagues & majors",
    desc: "Run seasons, majors, leaderboards and formats for your society or mate group.",
  },
  {
    title: "Stats & progress",
    desc: "See trends, scoring, handicaps, and what’s improving (or falling apart).",
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

export default function Home() {
  return (
    <main className="min-h-screen bg-white text-zinc-900">
      {/* Top bar */}
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <div className="flex items-center gap-3">
            <Image
              src="/ciaga-logo.png"
              alt="CIAGA"
              width={34}
              height={34}
              priority
              className="rounded"
            />
            <span className="text-sm font-semibold tracking-wide">CIAGA</span>
          </div>

          <div className="flex items-center gap-3">
            <a
              href="#install"
              className="hidden text-sm text-zinc-700 hover:text-zinc-950 sm:inline"
            >
              Install
            </a>
            <a
              href={appUrl}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800"
            >
              Open the app
            </a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-5 pb-10 pt-12 sm:pb-16 sm:pt-16">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs text-zinc-700">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              PWA — install to your Home Screen
            </p>

            <h1 className="text-balance text-4xl font-extrabold tracking-tight sm:text-5xl">
              Golf with your mates — leagues, rounds, stats, and a proper social feed.
            </h1>

            <p className="mt-4 max-w-xl text-pretty text-lg text-zinc-700">
              CIAGA is built for friend groups and societies. Track rounds, keep your season
              running, post highlights, and watch everyone’s handicap journey unfold.
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <a
                href={appUrl}
                className="inline-flex items-center justify-center rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800"
              >
                Open CIAGA
              </a>
              <a
                href="#install"
                className="inline-flex items-center justify-center rounded-xl border border-zinc-300 bg-white px-5 py-3 text-sm font-semibold text-zinc-900 hover:bg-zinc-50"
              >
                How to install
              </a>
            </div>

            <p className="mt-4 text-xs text-zinc-500">
              Tip: installing gives you a full-screen app experience and faster load times.
            </p>
          </div>

          {/* Mock / screenshot area (placeholder) */}
          <div className="rounded-3xl border border-zinc-200 bg-gradient-to-b from-zinc-50 to-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl bg-zinc-900 p-2">
                <Image
                  src="/ciaga-logo.png"
                  alt="CIAGA"
                  width={32}
                  height={32}
                  className="h-full w-full object-contain"
                />
              </div>
              <div>
                <p className="text-sm font-semibold">CIAGA</p>
                <p className="text-xs text-zinc-600">Rounds • Feed • Stats • Leagues</p>
              </div>
            </div>

            <div className="mt-6 grid gap-3">
              <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                <p className="text-xs font-semibold text-zinc-500">Social feed</p>
                <p className="mt-1 text-sm">
                  Post rounds, reacts, and big moments — keep the group looped in.
                </p>
              </div>
              <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                <p className="text-xs font-semibold text-zinc-500">Round tracking</p>
                <p className="mt-1 text-sm">
                  Capture scores and stats so your season leaderboard isn’t based on vibes.
                </p>
              </div>
              <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                <p className="text-xs font-semibold text-zinc-500">Stats & progress</p>
                <p className="mt-1 text-sm">
                  See what’s improving, what’s leaking shots, and who’s on a heater.
                </p>
              </div>
            </div>

            <div className="mt-6 rounded-2xl bg-zinc-900 px-4 py-3 text-white">
              <p className="text-xs text-zinc-300">Quick start</p>
              <p className="mt-1 text-sm font-semibold">
                Install → Create group → Log rounds → Enjoy the chaos
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-5 pb-12">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">What CIAGA does</h2>
        <p className="mt-2 max-w-2xl text-zinc-700">
          Built for the stuff real groups actually do: regular rounds, season formats, majors,
          leaderboards, and a feed to keep everyone invested.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"
            >
              <p className="text-sm font-semibold">{f.title}</p>
              <p className="mt-2 text-sm text-zinc-700">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Install */}
      <section id="install" className="border-t border-zinc-200 bg-zinc-50">
        <div className="mx-auto max-w-6xl px-5 py-12">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                Install CIAGA to your Home Screen
              </h2>
              <p className="mt-2 max-w-2xl text-zinc-700">
                CIAGA is a PWA — install it for a full-screen app experience and easy access.
              </p>
            </div>

            <a
              href={appUrl}
              className="inline-flex items-center justify-center rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800"
            >
              Open the app
            </a>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {a2hs.map((b) => (
              <div key={b.title} className="rounded-2xl border border-zinc-200 bg-white p-6">
                <p className="text-sm font-semibold">{b.title}</p>
                <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-zinc-700">
                  {b.steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
              </div>
            ))}
          </div>

          <p className="mt-6 text-xs text-zinc-500">
            If you don’t see an install option, make sure you’re using Safari (iOS) or Chrome
            (Android), and that you’re on the app domain.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-200">
        <div className="mx-auto max-w-6xl px-5 py-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-zinc-600">© {new Date().getFullYear()} CIAGA</p>
            <div className="flex gap-4 text-sm">
              <a className="text-zinc-700 hover:text-zinc-950" href={appUrl}>
                Open app
              </a>
              <a className="text-zinc-700 hover:text-zinc-950" href="#install">
                Install
              </a>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}