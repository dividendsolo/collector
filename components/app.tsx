"use client";

import { useEffect, useSyncExternalStore } from "react";
import { status } from "@/lib/format";
import { AgentPage, AgentsPage } from "./agents";
import { CardTip } from "./card-tip";
import { CronPage, JobPage } from "./cron";
import { Dashboard, useWaiting } from "./dashboard";
import { LiveProvider, useLive } from "./data";
import { ApisPage, DomainsPage, ProposalsPage, SubscriptionsPage, useVendors, WorkPage } from "./pages";
import { KeysPage, ProjectPage, ProjectsPage } from "./projects";
import { useRunning } from "./running";
import { ServicesPage, ServicesWatcher } from "./services";
import { Icon, type IconName, Sprite } from "./ui";

const NAV: { page: string; href: string; icon: IconName; label: string; tag?: string; sep?: boolean }[] = [
  { page: "dashboard", href: "#/", icon: "dash", label: "Dashboard", tag: "attention" },
  { page: "agents", href: "#/agents", icon: "bot", label: "Agents", tag: "running" },
  { page: "work", href: "#/work", icon: "list", label: "Work", tag: "work" },
  { page: "cron", href: "#/cron", icon: "clock", label: "Cron Jobs", tag: "cron" },
  { page: "projects", href: "#/projects", icon: "layers", label: "Projects", sep: true },
  { page: "domains", href: "#/domains", icon: "globe", label: "Domains" },
  { page: "services", href: "#/services", icon: "server", label: "Services" },
  { page: "apis", href: "#/apis", icon: "activity", label: "APIs", tag: "apis" },
  { page: "subscriptions", href: "#/subscriptions", icon: "receipt", label: "Subscriptions" },
  { page: "proposals", href: "#/proposals", icon: "brief", label: "Proposals" },
];
const PAGES = new Set([
  "dashboard",
  "agents",
  "work",
  "cron",
  "projects",
  "domains",
  "services",
  "apis",
  "subscriptions",
  "proposals",
  "keys",
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

/** Pages: the hash picks one (#/cron); the sidebar and the top bar follow it. */
export function route(hash: string) {
  let name = hash.replace(/^#\/?/, "") || "dashboard";
  if (name === "running") name = "agents"; // the old address of the Agents page
  const repo = name.match(/^projects\/([\w.-]+\/[\w.-]+)$/);
  const agent = name.match(/^agents\/([\w.-]+)\/([\w.-]+)$/);
  const job = name.match(/^cron\/([^/]+)\/([^/]+)$/);
  const page = repo ? "project" : agent ? "agent" : job ? "job" : PAGES.has(name) ? name : "dashboard";
  const lit = repo || page === "keys" ? "projects" : agent ? "agents" : job ? "cron" : page;
  return {
    page,
    lit,
    repo: repo?.[1] ?? null,
    agent: agent ? ([agent[1], agent[2]] as const) : null,
    job: job ? ([decodeURIComponent(job[1]), decodeURIComponent(job[2])] as const) : null,
  };
}

/** The sidebar's counts: Needs attention, running agents, P0s waiting (red), failing jobs (red), vendor incidents. */
function useTags(): Record<string, { text: string; hot: boolean }> {
  const { state } = useLive();
  const running = useRunning();
  const waiting = useWaiting();
  const vendors = useVendors();
  const w: any[] = state?.warnings || [];
  const failing = state
    ? state.machines.flatMap((m: any) => m.jobs || []).filter((j: any) => ["Failed", "Warning"].includes(status(j)))
        .length
    : 0;
  const hit = (vendors || []).filter((v) => v.incidents.length);
  return {
    attention: { text: w.length ? String(w.length) : "", hot: w.length > 0 && w.some((x) => x.level === "error") },
    running: { text: running?.length ? String(running.length) : "", hot: false },
    work: { text: waiting?.p0 ? String(waiting.p0) : "", hot: Boolean(waiting?.p0) },
    cron: { text: failing ? String(failing) : "", hot: failing > 0 },
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
              {n.tag ? <span className={`tag${tags[n.tag]?.hot ? " hot" : ""}`}>{tags[n.tag]?.text}</span> : null}
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
      <div className={liveClass} id="live">
        <span className="pulse" />
        <span id="updated">{updated}</span>
      </div>
    </header>
  );
}

function Page({ r }: { r: ReturnType<typeof route> }) {
  switch (r.page) {
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
    case "apis":
      return <ApisPage />;
    case "subscriptions":
      return <SubscriptionsPage />;
    case "proposals":
      return <ProposalsPage />;
    default:
      return <Dashboard />;
  }
}

function Shell() {
  const hash = useHash();
  const r = route(hash);
  // Scroll to the top on every page change. Braces matter: scrollTo returns a promise in current Chrome, and React
  // would call it as the cleanup.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the hash is the trigger
  useEffect(() => {
    scrollTo(0, 0);
  }, [hash]);
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
    </LiveProvider>
  );
}
