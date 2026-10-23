import Link from "next/link";
import { Activity, BarChart3, Trophy, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

const features = [
  {
    icon: BarChart3,
    title: "Unified dashboard",
    description:
      "Codeforces, LeetCode, CodeChef, GeeksforGeeks and HackerRank statistics in one place.",
  },
  {
    icon: Activity,
    title: "Streaks & activity",
    description:
      "Combined coding streaks and activity history across every connected platform.",
  },
  {
    icon: Trophy,
    title: "CodePulse Rating",
    description:
      "A single unified rating summarising contest performance everywhere you compete.",
  },
  {
    icon: Users,
    title: "Rooms & leaderboards",
    description:
      "Create private rooms, invite friends, and follow live global and room leaderboards.",
  },
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-10 sm:px-10">
      <header className="flex items-center justify-between border-b border-border pb-6">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-md bg-cyan-400/10 font-mono text-lg font-bold text-cyan-300"
          >
            {"</>"}
          </span>
          <span className="text-lg font-semibold tracking-tight">
            CodePulse
          </span>
        </div>
        <nav aria-label="Primary" className="flex items-center gap-2 text-sm">
          <Link
            href="#features"
            className="rounded-md px-3 py-2 text-slate-300 hover:bg-white/5 hover:text-white"
          >
            Features
          </Link>
          <Link
            href="#get-started"
            className="rounded-md px-3 py-2 text-slate-300 hover:bg-white/5 hover:text-white"
          >
            Get started
          </Link>
          <Link
            href="/recommendations"
            className="rounded-md px-3 py-2 text-slate-300 hover:bg-white/5 hover:text-white"
          >
            Recommendations
          </Link>
          <Link
            href="/login"
            className="rounded-md px-3 py-2 text-slate-300 hover:bg-white/5 hover:text-white"
          >
            Log in
          </Link>
        </nav>
      </header>

      <section className="flex flex-1 flex-col items-start justify-center py-16 sm:py-24">
        <h1 className="max-w-2xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
          CodePulse
        </h1>
        <p className="mt-3 text-xl text-slate-200 sm:text-2xl">
          Your Coding Life, Unified.
        </p>
        <p className="mt-4 max-w-2xl leading-relaxed text-muted">
          CodePulse brings your competitive programming profiles together.
          Connect your accounts once, then follow statistics, streaks, contest
          ratings and leaderboards from a single developer-focused dashboard.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link href="#get-started">Get Started</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="#features">Explore Features</Link>
          </Button>
        </div>

        <dl className="mt-10 grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            ["5", "Supported platforms"],
            ["1", "Unified rating (CPR)"],
            ["Live", "Room leaderboards"],
          ].map(([value, label]) => (
            <div
              key={label}
              className="rounded-lg border border-border bg-surface px-4 py-3"
            >
              <dt className="order-2 mt-1 text-sm text-muted">{label}</dt>
              <dd className="font-mono text-2xl text-white">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section id="features" className="scroll-mt-10 border-t border-border py-14">
        <h2 className="text-2xl font-semibold tracking-tight">
          Explore Features
        </h2>
        <p className="mt-2 max-w-2xl text-muted">
          CodePulse is live: connect your profiles, track streaks and ratings,
          open private rooms, and climb the leaderboards.
        </p>
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {features.map((feature) => (
            <article
              key={feature.title}
              className="rounded-lg border border-border bg-surface p-5"
            >
              <feature.icon
                className="h-5 w-5 text-cyan-300"
                aria-hidden="true"
              />
              <h3 className="mt-3 font-semibold">{feature.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                {feature.description}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section
        id="get-started"
        className="scroll-mt-10 border-t border-border py-14"
      >
        <h2 className="text-2xl font-semibold tracking-tight">Get Started</h2>
        <p className="mt-2 max-w-2xl text-muted">
          The foundation is ready. In upcoming modules you will be able to
          create an account, connect your coding profiles, and join rooms with
          friends.
        </p>
        <ol className="mt-6 space-y-3">
          {[
            "Create your CodePulse account.",
            "Connect Codeforces, LeetCode, CodeChef, GeeksforGeeks and HackerRank.",
            "Invite friends to a room and climb the leaderboard.",
          ].map((step, index) => (
            <li
              key={step}
              className="flex items-start gap-3 rounded-lg border border-border bg-surface px-4 py-3"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border font-mono text-xs text-cyan-300">
                {index + 1}
              </span>
              <span className="text-sm text-slate-200">{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <footer className="border-t border-border pt-6 text-sm text-muted">
        <p>CodePulse — Your Coding Life, Unified.</p>
      </footer>
    </main>
  );
}
