"use client";

import { useEffect } from "react";
import { useApi, useLive } from "./data";
import { PanelHead, SkelItems } from "./ui";

export interface Svc {
  name: string;
  url: string;
  status: "online" | "slow" | "down";
  ms: number;
  error: string | null;
  hosting: string | null;
}

export const SVC_LABEL: Record<string, [string, string]> = {
  online: ["ok", "Online"],
  slow: ["warning", "Slow"],
  down: ["failed", "Down"],
};

/** Service health: checked when the page loads, then once a minute. A new check refreshes Needs attention. */
export function useServices(): Svc[] | null {
  const { data } = useApi<Svc[]>("/api/services");
  return data ?? null;
}

export function ServicesWatcher() {
  const { data } = useApi<Svc[]>("/api/services");
  const { tick } = useLive();
  useEffect(() => {
    if (data) tick();
  }, [data, tick]);
  return null;
}

/** Down first, then slow, then online; slowest first inside each. */
export const sortServices = (svc: Svc[]) => {
  const order: Record<string, number> = { down: 0, slow: 1, online: 2 };
  return [...svc].sort((a, b) => order[a.status] - order[b.status] || b.ms - a.ms);
};

export function ServiceRows({ list }: { list: Svc[] }) {
  if (!list.length)
    return (
      <li>
        <div className="sub">No services in config.json yet.</div>
      </li>
    );
  return (
    <>
      {list.map((x) => (
        <li key={x.url + x.name} id={`service:${x.url}`}>
          <div>
            <div className="name">{x.name}</div>
            <div className="sub">
              <a href={x.url} target="_blank" rel="noopener">
                {x.url.replace(/^https?:\/\//, "")}
              </a>
              {x.error ? (
                <>
                  {" · "}
                  <span className="err">{x.error}</span>
                </>
              ) : null}
            </div>
          </div>
          <div className="right">
            <span className="ms">{x.ms} ms</span>
            <span className={`pill ${SVC_LABEL[x.status][0]}`}>
              <span className="dot" />
              {SVC_LABEL[x.status][1]}
            </span>
          </div>
        </li>
      ))}
    </>
  );
}

/** The Dashboard's Service health panel: the summary line and the five worst services. */
export function ServiceHealthPanel({ svc }: { svc: Svc[] | null }) {
  const sorted = svc ? sortServices(svc) : null;
  const up = svc ? svc.filter((x) => x.status !== "down").length : 0;
  const avg = svc?.length ? Math.round(svc.reduce((n, x) => n + x.ms, 0) / svc.length) : 0;
  const slowest = svc?.length ? [...svc].sort((a, b) => b.ms - a.ms)[0] : null;
  return (
    <section className="panel">
      <PanelHead icon="server" title="Service health">
        <span className="count">{svc?.length ?? 0}</span>
        <a className="more" href="#/services">
          All services &rarr;
        </a>
      </PanelHead>
      <div className="spend-total" id="health-total">
        {/* With no services the list below says so; the summary stays empty rather than say it twice. */}
        {svc?.length && slowest ? (
          <>
            <span className="value">
              {up} of {svc.length}
              <small>online</small>
            </span>
            <span className="sub">
              average {avg} ms · slowest {slowest.name} at {slowest.ms} ms
            </span>
          </>
        ) : null}
      </div>
      <ul className="health">{sorted ? <ServiceRows list={sorted.slice(0, 5)} /> : <SkelItems n={5} />}</ul>
    </section>
  );
}

export function ServicesPage() {
  const svc = useServices();
  return (
    <div className="page">
      <section className="panel">
        <PanelHead icon="server">
          <span className="count">{svc?.length ?? 0}</span>
        </PanelHead>
        <ul className="health">{svc ? <ServiceRows list={sortServices(svc)} /> : <SkelItems n={5} />}</ul>
      </section>
    </div>
  );
}
