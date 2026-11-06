import { describe, expect, it } from "vitest";
import {
  githubToasts,
  internetPortCount,
  networkToasts,
  newAlarms,
  serviceToasts,
  sortToasts,
  sshToasts,
} from "@/lib/toasts";

/**
 * The toasts (collector#67). James, 2026-11-06: "a little toast notification that will pop up if one of our services
 * is yellow or red. And then we can just acknowledge it, like dismiss that way, somebody doesn't have to scroll down
 * while they're working on things to see those stats." The same day he added the red Network rows (a machine with
 * ports open to the internet gets a toast too) and dropped Dismiss: "we want that toast to be there until
 * everything's resolved."
 */
const svc = (status: string, error: string | null = null) => ({
  name: "Situation",
  url: "https://situation.example.com",
  status,
  error,
});
const vps = (ports: [string, number, string][]) => ({
  name: "vps",
  network: { sockets: ports.map(([proto, port, reach]) => ({ proto, port, reach })) },
});

describe("a service toast", () => {
  it("shows for a service that turns Slow or Down, with the error, and none for one Online", () => {
    expect(serviceToasts([svc("online")])).toEqual([]);
    const [down] = serviceToasts([svc("down", "502")]);
    expect(down).toMatchObject({
      level: "error",
      title: "Situation is Down",
      text: "502",
      href: "#/services?to=service%3Ahttps%3A%2F%2Fsituation.example.com",
    });
    const [slow] = serviceToasts([svc("slow")]);
    expect(slow).toMatchObject({ level: "warn", title: "Situation is Slow", text: "situation.example.com" });
  });

  it("stays while the service is bad, and is gone once it is Online again: no toast for a recovery", () => {
    expect(serviceToasts([svc("down", "502")])).toHaveLength(1);
    expect(serviceToasts([svc("slow")])).toHaveLength(1);
    expect(serviceToasts([svc("online")])).toEqual([]);
  });
});

describe("a network toast", () => {
  it("names a machine's ports open to the internet, once each, and none for the local network or the tailnet", () => {
    const [t] = networkToasts([
      vps([
        ["tcp", 22, "internet"],
        ["tcp", 22, "internet"],
        ["udp", 5353, "internet"],
        ["tcp", 5000, "lan"],
        ["tcp", 11434, "tailnet"],
        ["tcp", 5432, "machine"],
        ["udp", 41641, "firewalled"],
      ]),
    ]);
    expect(t).toMatchObject({
      key: "network:vps",
      level: "error",
      title: "2 ports on vps open to the internet",
      text: "tcp 22, udp 5353",
      href: "#/network?to=ports%3Avps%3Ainternet",
    });
    expect(networkToasts([vps([["tcp", 5000, "lan"]])])).toEqual([]);
    expect(networkToasts([{ name: "laptop" }])).toEqual([]);
  });

  it("names the first six ports and counts the rest", () => {
    const ports = Array.from({ length: 9 }, (_, i) => ["udp", 40000 + i, "internet"] as [string, number, string]);
    expect(networkToasts([vps(ports)])[0].text).toBe(
      "udp 40000, udp 40001, udp 40002, udp 40003, udp 40004, udp 40005, and 3 more",
    );
  });

  it("is gone once no port on the machine is open to the internet", () => {
    expect(networkToasts([vps([["tcp", 22, "internet"]])])).toHaveLength(1);
    expect(networkToasts([vps([["tcp", 22, "machine"]])])).toEqual([]);
  });
});

describe("an SSH toast", () => {
  const ssh = (source: string, pw: boolean, root: boolean) => ({
    name: "vps",
    network: { sockets: [], ssh: { source, passwordauthentication: pw, permitrootlogin: root } },
  });
  it("shows when sshd really allows passwords or root, and never from the config file alone", () => {
    expect(sshToasts([ssh("sshd -T", true, true)])).toMatchObject([
      { key: "ssh:vps", level: "error", title: "SSH on vps allows password logins and root login" },
    ]);
    expect(sshToasts([ssh("sshd -T", false, false)])).toEqual([]);
    expect(sshToasts([ssh("/etc/ssh/sshd_config", true, true)])).toEqual([]);
  });
});

describe("the Network count in the sidebar", () => {
  it("counts the ports open to the internet across every machine, once each, and nothing else", () => {
    expect(
      internetPortCount([
        vps([
          ["tcp", 22, "internet"],
          ["tcp", 22, "internet"],
          ["udp", 5353, "internet"],
          ["tcp", 5000, "lan"],
        ]),
        { name: "laptop", network: { sockets: [{ proto: "tcp", port: 22, reach: "internet" }] } },
        { name: "mac" },
      ]),
    ).toBe(3);
    expect(internetPortCount(null)).toBe(0);
  });
});

describe("the alarm sound", () => {
  it("sounds for a new red toast only: never for Slow, never twice for the same problem", () => {
    const down = serviceToasts([svc("down", "502")]);
    expect(newAlarms(down, new Set())).toHaveLength(1);
    expect(newAlarms(down, new Set([`${down[0].key}|${down[0].state}`]))).toEqual([]);
    expect(newAlarms(serviceToasts([svc("slow")]), new Set())).toEqual([]);
    // The same service with a new error is a new problem.
    const heard = new Set([`${down[0].key}|${down[0].state}`]);
    expect(newAlarms(serviceToasts([svc("down", "503")]), heard)).toHaveLength(1);
  });
});

describe("the stack", () => {
  it("puts errors first", () => {
    const all = [...serviceToasts([svc("slow")]), ...networkToasts([vps([["tcp", 22, "internet"]])])];
    expect(sortToasts(all).map((t) => t.level)).toEqual(["error", "warn"]);
  });
});

describe("the page change that scrolls to the top (collector#67 bug)", () => {
  // James, 2026-11-06: the toast's link opened the Network page but did not scroll to the port. Repro (headless
  // Chrome, scrollY per frame): the page reached the row, then glided back to 0. The Shell scrolled to the top on
  // every change of the hash, and the Network page taking `?to=<id>` off the address is a change of the hash.
  it("is the same page with or without a query, so taking the query off scrolls nothing", async () => {
    const { pageOf } = await import("@/components/app");
    expect(pageOf("#/network?to=ports%3Avps%3Ainternet")).toBe(pageOf("#/network"));
    expect(pageOf("#/network")).not.toBe(pageOf("#/"));
    expect(pageOf("#/cron/ezio/abc")).toBe("cron/ezio/abc");
  });
});

describe("githubToasts", () => {
  // James, 2026-11-06, after the REST limit hit 0 and only the APIs page said so: "that should be a notification in
  // the toast."
  const at = (s: number) => `t${s}`;
  const limit = (core: number, graphql = 0) => ({
    core: { used: core, limit: 5000, reset: 100 },
    graphql: { used: graphql, limit: 5000, reset: 200 },
  });
  it("raises an amber toast with Dismiss when the REST limit is used up, linked to its panel on the APIs page", () => {
    expect(githubToasts(limit(5000), at)).toEqual([
      {
        key: "github:core",
        state: "out",
        level: "warn",
        title: "GitHub REST limit used up",
        text: "0 of 5,000 left. Resets t100.",
        href: "#/apis?to=github-limit",
        dismissible: true,
      },
    ]);
  });
  it("raises it when under 500 are left, for REST and GraphQL alike", () => {
    const t = githubToasts(limit(4600, 4700), at);
    expect(t.map((x) => [x.key, x.state, x.title])).toEqual([
      ["github:core", "low", "GitHub REST limit nearly gone"],
      ["github:graphql", "low", "GitHub GraphQL limit nearly gone"],
    ]);
    expect(t[0].text).toBe("400 of 5,000 left. Resets t100.");
  });
  it("raises nothing with 500 or more left, or with no reading", () => {
    expect(githubToasts(limit(4500, 0), at)).toEqual([]);
    expect(githubToasts({ error: "gh failed" }, at)).toEqual([]);
    expect(githubToasts(undefined, at)).toEqual([]);
  });
});
