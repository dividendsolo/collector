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

/** Down first, then slow, then online; fastest first inside each. */
export const sortServices = (svc: Svc[]) => {
  const order: Record<string, number> = { down: 0, slow: 1, online: 2 };
  return [...svc].sort((a, b) => order[a.status] - order[b.status] || a.ms - b.ms);
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
        <li key={x.url + x.name}>
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

export function ServicesPage() {
  const svc = useServices();
  return (
    <div className="page">
      <div className="page-head">
        <h1>Services</h1>
        <p>Your own services and whether they are up.</p>
      </div>
      <section className="panel">
        <PanelHead icon="server" title="Service health">
          <span className="count">{svc?.length ?? 0}</span>
        </PanelHead>
        <ul className="health">{svc ? <ServiceRows list={sortServices(svc)} /> : <SkelItems n={5} />}</ul>
      </section>
    </div>
  );
}
