"use client";

import { useEffect, useSyncExternalStore } from "react";
import { failingJobs } from "@/lib/format";
import type { Side } from "@/lib/phone";
import { briefsRow, p0Rows, triageRow } from "@/lib/priority";
import { internetPortCount } from "@/lib/toasts";
import { vendorHit } from "@/lib/vendors";
import { acked, useAcks } from "./acks";
import { AgentPage, AgentsPage } from "./agents";
import { BriefPage, BriefsPage, useBriefs } from "./briefs";
import { CardTip } from "./card-tip";
import { CronPage, JobPage } from "./cron";
import { Dashboard, useWaiting } from "./dashboard";
import { LiveProvider, useLive } from "./data";
import { FlowPage } from "./flow";
import { InboxPage, useInbox } from "./inbox";
import { JourneyPage } from "./journey";
import { useJump } from "./jump";
import { NetworkPage } from "./network";
import { ApisPage, ClosedPage, DomainsPage, ProposalsPage, SubscriptionsPage, useVendors, WorkPage } from "./pages";
import { KeysPage, ProjectPage, ProjectsPage } from "./projects";
import { runningTipProps, useRunning } from "./running";
import { ServicesPage, ServicesWatcher } from "./services";
import { SideProvider, useSide } from "./side";
import { Toasts } from "./toasts";
import { Icon, type IconName, Sprite } from "./ui";

export const NAV: { page: string; href: string; icon: IconName; label: string; tag?: string; sep?: boolean }[] = [
  { page: "dashboard", href: "#/", icon: "dash", label: "Dashboard", tag: "attention" },
  { page: "briefs", href: "#/briefs", icon: "doc", label: "Briefs", tag: "briefs" },
  { page: "inbox", href: "#/inbox", icon: "inbox", label: "Inbox", tag: "inbox" },
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
  "inbox",
  "agents",
  "work",
  "closed",
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

export const pageOf = (hash: string) => hash.replace(/^#\/?/, "").split("?", 1)[0];

export function route(hash: string) {
  let name = hash.replace(/^#\/?/, "").split("?", 1)[0] || "dashboard";
  if (name === "running") name = "agents";
  const repo = name.match(/^projects\/([\w.-]+\/[\w.-]+)$/);
  const agent = name.match(/^agents\/([\w.-]+)\/([\w.-]+)$/);
  const job = name.match(/^cron\/([^/]+)\/([^/]+)$/);
  const brief = name.match(/^briefs\/([^/]+)\/([^/]+)$/);
  const card = name.match(/^card\/([\w.-]+)\/(\d+)$/);
  const page = card
    ? "card"
    : repo
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
  const lit = card
    ? "work"
    : repo || page === "keys"
      ? "projects"
      : agent
        ? "agents"
        : job
          ? "cron"
          : brief
            ? "briefs"
            : page === "closed"
              ? "work"
              : page;
  return {
    page,
    lit,
    repo: repo?.[1] ?? null,
    agent: agent ? ([agent[1], agent[2]] as const) : null,
    job: job ? ([decodeURIComponent(job[1]), decodeURIComponent(job[2])] as const) : null,
    brief: brief ? ([decodeURIComponent(brief[1]), decodeURIComponent(brief[2])] as const) : null,
    card: card ? ([card[1], Number(card[2])] as const) : null,
  };
}

type Tag = { text: string; hot: boolean; dot?: boolean; wait?: boolean; tip?: Record<string, string> };

export const briefsTag = (n: number): Tag => ({ text: n ? String(n) : "", hot: false, dot: n > 0 });

export function attentionTag(
  warnings: any[],
  tickets: { lane?: string | null; priority?: string | null }[],
  acks: string[],
  inbox: { read?: boolean }[] = [],
): Tag {
  const extra = [triageRow(tickets), ...p0Rows(tickets), briefsRow(inbox)].filter((x) => x !== null);
  const open = [...warnings.filter((x) => !acked(x, acks)), ...extra];
  return { text: open.length ? String(open.length) : "", hot: open.some((x) => x.level === "error") };
}

export const tagClass = (t?: Tag) => `tag${t?.hot ? " hot" : ""}${t?.dot ? " inbox-dot" : ""}${t?.wait ? " wait" : ""}`;

function useTags(): Record<string, Tag> {
  const { state } = useLive();
  const running = useRunning();
  const waiting = useWaiting();
  const vendors = useVendors();
  const acks = useAcks();
  const { data: briefs } = useBriefs();
  const { data: inbox } = useInbox();
  const failing = state
    ? failingJobs(
        state.machines.flatMap((m: any) => m.jobs || []),
        acks,
      ).length
    : 0;
  const hit = (vendors || []).filter(vendorHit);
  const open = internetPortCount(state?.machines);
  return {
    attention: attentionTag(state?.warnings || [], waiting?.list || [], acks, briefs?.inbox || []),
    briefs: briefsTag(briefs?.inbox?.length ?? 0),
    inbox: briefsTag(inbox?.unhandled ?? 0),
    running: {
      text: running?.length ? String(running.length) : "",
      hot: false,
      wait: Boolean(running?.some((r) => r.wait)),
      tip: runningTipProps(running),
    },
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
              {n.tag ? (
                <span className={tagClass(tags[n.tag])} {...tags[n.tag]?.tip}>
                  {tags[n.tag]?.text}
                </span>
              ) : null}
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
  if (r.card)
    return (
      <>
        Work / Card journey / {r.card[0]}#{r.card[1]}
      </>
    );
  if (r.page === "keys") return <>Projects / Payment keys</>;
  if (r.page === "closed") return <>Work / Closed today</>;
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
    case "card":
      return r.card ? <JourneyPage key={r.card.join("/")} repo={r.card[0]} number={r.card[1]} /> : null;
    case "briefs":
      return <BriefsPage />;
    case "inbox":
      return <InboxPage />;
    case "brief":
      return r.brief ? <BriefPage key={r.brief.join("/")} machine={r.brief[0]} file={r.brief[1]} /> : null;
    case "agents":
      return <AgentsPage />;
    case "agent":
      return r.agent ? <AgentPage machine={r.agent[0]} name={r.agent[1]} /> : null;
    case "work":
      return <WorkPage />;
    case "closed":
      return <ClosedPage />;
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

function TopOfPage() {
  useEffect(() => {
    scrollTo({ top: 0, behavior: "instant" });
  }, []);
  return null;
}

function Shell() {
  const hash = useHash();
  const side = useSide();
  useJump();
  const r = route(hash);
  const at = pageOf(hash);
  return (
    <div className="app" data-side={side}>
      <TopOfPage key={at} />
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

export function App({ side = "mac" }: { side?: Side } = {}) {
  return (
    <LiveProvider>
      <SideProvider side={side}>
        <Sprite />
        <ServicesWatcher />
        <Shell />
        <CardTip />
        <Toasts />
      </SideProvider>
    </LiveProvider>
  );
}
