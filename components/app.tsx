"use client";

import { useEffect, useSyncExternalStore } from "react";
import { failingJobs } from "@/lib/format";
import { internetPortCount } from "@/lib/toasts";
import { acked, useAcks } from "./acks";
import { AgentPage, AgentsPage } from "./agents";
import { BriefPage, BriefsPage, useBriefs } from "./briefs";
import { CardTip } from "./card-tip";
import { CronPage, JobPage } from "./cron";
import { Dashboard, useWaiting } from "./dashboard";
import { LiveProvider, useLive } from "./data";
import { FlowPage } from "./flow";
import { useJump } from "./jump";
import { NetworkPage } from "./network";
import { ApisPage, DomainsPage, ProposalsPage, SubscriptionsPage, useVendors, vendorHit, WorkPage } from "./pages";
import { KeysPage, ProjectPage, ProjectsPage } from "./projects";
import { useRunning } from "./running";
import { ServicesPage, ServicesWatcher } from "./services";
import { Toasts } from "./toasts";
import { Icon, type IconName, Sprite } from "./ui";
import { UpdateButton } from "./update";

const NAV: { page: string; href: string; icon: IconName; label: string; tag?: string; sep?: boolean }[] = [
  { page: "dashboard", href: "#/", icon: "dash", label: "Dashboard", tag: "attention" },
  { page: "briefs", href: "#/briefs", icon: "inbox", label: "Briefs", tag: "briefs" },
  { page: "agents", href: "#/agents", icon: "bot", label: "Agents", tag: "running" },
  { page: "work", href: "#/work", icon: "list", label: "Work", tag: "work" },
  { page: "cron", href: "#/cron", icon: "clock", label: "Cron Jobs", tag: "cron" },
  { page: "projects", href: "#/projects", icon: "layers", label: "Projects", sep: true },
  { page: "domains", href: "#/domains", icon: "globe", label: "Domains" },
  { page: "services", href: "#/services", icon: "server", label: "Services" },
  { page: "network", href: "#/network", icon: "shield", label: "Network", tag: "network" },
  { page: "apis", href: "#/apis", icon: "activity", label: "APIs", tag: "apis" },
  { page: "subscriptions", href: "#/subscriptions", icon: "receipt", label: "Subscriptions" },
  { page: "proposals", href: "#/proposals", icon: "brief", label: "Proposals" },
  { page: "flow", href: "#/flow", icon: "gauge", label: "Card flow", sep: true },
];
const PAGES = new Set([
  "dashboard",
  "briefs",
  "agents",
  "work",
  "cron",
  "projects",
  "domains",
  "services",
  "network",
  "apis",
  "subscriptions",
  "proposals",
  "keys",
  "flow",
]);

const subHash = (f: () => void) => {
  addEventListener("hashchange", f);
  return () => removeEventListener("hashchange", f);
};
const useHash = () =>
  useSyncExternalStore(
    subHash,
    () => location.hash,
    () => "",
  );

/** The page a hash opens, without its query: `#/network?to=check:vps:internet` and `#/network` are one page. The Shell
 * scrolls to the top when this changes, so a page that takes a query off its own address is not sent back up
 * (collector#67: the toast's link scrolled to the port, then back to the top). */
export const pageOf = (hash: string) => hash.replace(/^#\/?/, "").split("?", 1)[0];

/** Pages: the hash picks one (#/cron); the sidebar and the top bar follow it. */
export function route(hash: string) {
  // A page may carry a query after its name (`#/network?to=check:vps:internet`): the page reads it, the route ignores it.
  let name = hash.replace(/^#\/?/, "").split("?", 1)[0] || "dashboard";
  if (name === "running") name = "agents"; // the old address of the Agents page
  const repo = name.match(/^projects\/([\w.-]+\/[\w.-]+)$/);
  const agent = name.match(/^agents\/([\w.-]+)\/([\w.-]+)$/);
  const job = name.match(/^cron\/([^/]+)\/([^/]+)$/);
  // One brief open: `#/briefs/<machine>/<file>` (collector#64), the way a job's own page is addressed.
  const brief = name.match(/^briefs\/([^/]+)\/([^/]+)$/);
  const page = repo
    ? "project"
    : agent
      ? "agent"
      : job
        ? "job"
        : brief
          ? "brief"
          : PAGES.has(name)
            ? name
            : "dashboard";
  const lit = repo || page === "keys" ? "projects" : agent ? "agents" : job ? "cron" : brief ? "briefs" : page;
  return {
    page,
    lit,
    repo: repo?.[1] ?? null,
    agent: agent ? ([agent[1], agent[2]] as const) : null,
    job: job ? ([decodeURIComponent(job[1]), decodeURIComponent(job[2])] as const) : null,
    brief: brief ? ([decodeURIComponent(brief[1]), decodeURIComponent(brief[2])] as const) : null,
  };
}

/** The sidebar's counts: Needs attention, briefs in the inbox, running agents, P0s waiting (red), failing jobs
 * (red), ports open to the internet (red), vendor incidents. */
type Tag = { text: string; hot: boolean; dot?: boolean };

/** Briefs: the inbox count, and a dot on the closed sidebar's icon while the inbox holds a brief (James, 2026-11-10). */
export const briefsTag = (n: number): Tag => ({ text: n ? String(n) : "", hot: false, dot: n > 0 });

export const tagClass = (t?: Tag) => `tag${t?.hot ? " hot" : ""}${t?.dot ? " inbox-dot" : ""}`;

function useTags(): Record<string, Tag> {
  const { state } = useLive();
  const running = useRunning();
  const waiting = useWaiting();
  const vendors = useVendors();
  const acks = useAcks();
  const { data: briefs } = useBriefs();
  const w: any[] = (state?.warnings || []).filter((x: any) => !acked(x, acks));
  // An acknowledged failed run leaves the count until the job runs again (James, 2026-11-06).
  const failing = state
    ? failingJobs(
        state.machines.flatMap((m: any) => m.jobs || []),
        acks,
      ).length
    : 0;
  const hit = (vendors || []).filter(vendorHit);
  const open = internetPortCount(state?.machines);
  return {
    attention: { text: w.length ? String(w.length) : "", hot: w.length > 0 && w.some((x) => x.level === "error") },
    briefs: briefsTag(briefs?.inbox?.length ?? 0),
    running: { text: running?.length ? String(running.length) : "", hot: false },
    work: { text: waiting?.p0 ? String(waiting.p0) : "", hot: Boolean(waiting?.p0) },
    cron: { text: failing ? String(failing) : "", hot: failing > 0 },
    network: { text: open ? String(open) : "", hot: open > 0 },
    apis: {
      text: hit.length ? String(hit.length) : "",
      hot: hit.some((v) => v.state === "major" || v.state === "critical"),
    },
  };
}

function Sidebar({ lit }: { lit: string }) {
  const tags = useTags();
  return (
    <aside className="sidebar">
      <nav className="rail" aria-label="Pages">
        <a className="home" href="#/">
          <Icon name="logo" />
          <span className="label">Collector</span>
        </a>
        {NAV.map((n) => (
          <span key={n.page} style={{ display: "contents" }}>
            {n.sep ? <div className="sep" role="separator" /> : null}
            <a className="item" href={n.href} aria-current={lit === n.page ? "page" : undefined}>
              <Icon name={n.icon} />
              <span className="label">{n.label}</span>
              {n.tag ? <span className={tagClass(tags[n.tag])}>{tags[n.tag]?.text}</span> : null}
            </a>
          </span>
        ))}
      </nav>
    </aside>
  );
}

function Crumb({ r }: { r: ReturnType<typeof route> }) {
  const { state } = useLive();
  const label = NAV.find((n) => n.page === r.lit)?.label ?? "Dashboard";
  if (r.page === "keys") return <>Projects / Payment keys</>;
  if (r.agent) return <>Agents / {r.agent[1]}</>;
  if (r.job) {
    const j = state?.machines.find((m: any) => m.name === r.job?.[0])?.jobs?.find((x: any) => x.id === r.job?.[1]);
    return <>Cron Jobs / {j ? j.name : r.job[1]}</>;
  }
  if (r.repo) return <ProjectCrumb repo={r.repo} />;
  return <>{label}</>;
}

import { useProjects } from "./projects";

function ProjectCrumb({ repo }: { repo: string }) {
  const { data } = useProjects();
  const p = (data?.projects || []).find((x: any) => x.repo === repo);
  return <>Projects / {p ? p.title || p.name : repo}</>;
}

function Topbar({ r }: { r: ReturnType<typeof route> }) {
  const { updated, liveClass } = useLive();
  return (
    <header className="topbar">
      <div className="brand">
        <span id="crumb">
          <Crumb r={r} />
        </span>
      </div>
      <div className="tools">
        <UpdateButton />
        <div className={liveClass} id="live">
          <span className="pulse" />
          <span id="updated">{updated}</span>
        </div>
      </div>
    </header>
  );
}

function Page({ r }: { r: ReturnType<typeof route> }) {
  switch (r.page) {
    case "briefs":
      return <BriefsPage />;
    case "brief":
      // Keyed by the brief, so one brief's Archived button state never carries to the next one opened.
      return r.brief ? <BriefPage key={r.brief.join("/")} machine={r.brief[0]} file={r.brief[1]} /> : null;
    case "agents":
      return <AgentsPage />;
    case "agent":
      return r.agent ? <AgentPage machine={r.agent[0]} name={r.agent[1]} /> : null;
    case "work":
      return <WorkPage />;
    case "cron":
      return <CronPage />;
    case "job":
      return r.job ? <JobPage machine={r.job[0]} id={r.job[1]} /> : null;
    case "projects":
      return <ProjectsPage />;
    case "project":
      return r.repo ? <ProjectPage repo={r.repo} /> : null;
    case "keys":
      return <KeysPage />;
    case "domains":
      return <DomainsPage />;
    case "services":
      return <ServicesPage />;
    case "network":
      return <NetworkPage />;
    case "apis":
      return <ApisPage />;
    case "subscriptions":
      return <SubscriptionsPage />;
    case "proposals":
      return <ProposalsPage />;
    case "flow":
      return <FlowPage />;
    default:
      return <Dashboard />;
  }
}

function Shell() {
  const hash = useHash();
  useJump();
  const r = route(hash);
  // Scroll to the top on every page change. Braces matter: scrollTo returns a promise in current Chrome, and React
  // would call it as the cleanup.
  // A query on the same page (`?to=<id>`) is no page change: the top is only for a new page.
  const at = pageOf(hash);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the page is the trigger
  useEffect(() => {
    // Instant: a new page starts at its top, and a page that then glides somewhere (the toast's link) glides from there.
    scrollTo({ top: 0, behavior: "instant" });
  }, [at]);
  return (
    <div className="app">
      <Sidebar lit={r.lit} />
      <div className="shell">
        <Topbar r={r} />
        <main className="content">
          <Page r={r} />
        </main>
      </div>
    </div>
  );
}

export function App() {
  return (
    <LiveProvider>
      <Sprite />
      <ServicesWatcher />
      <Shell />
      <CardTip />
      <Toasts />
    </LiveProvider>
  );
}
