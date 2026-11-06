/**
 * A machine's Security checks (collector#65, James 2026-11-06: "a little rubric that we can just say, like, hey,
 * everything's good to go here"). One row per check, each with a dot: green is good, amber is a weak setting worth
 * fixing, red is a real exposure, grey is a check that could not be read (never green: an unread check proves
 * nothing). Each check carries a card for its tooltip: what it is, why it matters, and the fix.
 *
 * Red raises a toast that stays until the check is green; amber raises one the user may dismiss.
 *
 * Pure: it reads the Network section collect.py sent for the machine.
 */

export type Level = "green" | "amber" | "red" | "grey";

/** Why a known program's firewalled port is safe to leave open, by the program's name (James, 2026-11-06: "explain
 * why it's okay that that one port is open"). A firewalled port with no entry here gets no reason: opened on purpose
 * is not the same as safe, and the card says so. */
export const WHY_OPEN: Record<string, string> = {
  tailscaled:
    "Tailscale (WireGuard) uses this port to connect your devices to each other directly. It answers only packets " +
    "signed with one of your devices' keys and ignores everything else, so to a scanner it looks closed. Closing it " +
    "still works, but your devices then reach this machine through Tailscale's relays, which is slower, and no safer.",
};

export interface Check {
  /** Stable per machine and check: the toast's key. */
  id: string;
  label: string;
  /** What the toast says when the check is not green: the problem in one plain sentence. */
  problem?: string;
  value: string;
  level: Level;
  about: string;
  facts: [string, string][];
}

interface PortIn {
  proto: string;
  port: number;
  reach: string;
  process?: string | null;
  tailnet_from?: string[] | null;
}

interface FirewallIn {
  tool: string;
  active: boolean;
  incoming?: string;
  block_all?: boolean;
  stealth?: boolean;
  allow_builtin?: boolean;
  allow_signed?: boolean;
  apps?: { path: string; allow: boolean; interpreter: boolean }[];
}

export interface NetworkIn {
  sockets?: PortIn[];
  firewall?: FirewallIn | null;
  ssh?: { source: string | null; passwordauthentication: boolean; permitrootlogin: boolean } | null;
  tailnet_acl?: { ports: number[][]; protos: number[]; from: string[] }[] | null;
  tailnet_peers?: Record<string, string>;
}

const base = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;

/** A program macOS itself ships: under /System, /usr or /sbin (not /usr/local, where Homebrew and installers put
 * theirs). Everything else on the allow list is an app you installed and allowed. */
const isSystem = (p: string) => /^\/(System|usr|sbin|bin)\//.test(p) && !p.startsWith("/usr/local/");

/** A program's readable name: the app bundle's name without ".app" (Brave Browser, not "Brave Browser" the binary
 * inside it), a system extension by its bundle id's last word (tailscale, protonvpn), else the file's own name. */
function appName(p: string): string {
  const ext = p.match(/\/([^/]+)\.systemextension$/);
  if (ext) {
    const id = ext[1].split(".");
    return (
      id
        .find((w) => /tailscale|protonvpn|wireguard/i.test(w))
        ?.replace(/^protonvpn$/i, "Proton VPN")
        .replace(/^tailscale$/i, "Tailscale") ?? id[id.length - 1]
    );
  }
  const apps = [...p.matchAll(/([^/]+)\.app(?=\/|$)/g)].map((m) => m[1]);
  return apps.length ? apps[apps.length - 1] : base(p);
}

/** The names, once each, in alphabetical order, so the list is easy to scan. */
const names = (apps: { path: string }[]) =>
  [...new Set(apps.map((a) => appName(a.path)))]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .join(", ");
const unique = <T>(xs: T[]) => xs.filter((x, i) => xs.findIndex((y) => JSON.stringify(y) === JSON.stringify(x)) === i);

/** The checks for one machine, in reading order. `mac` is true for a Mac (the firewall reads apps, not ports). */
export function securityChecks(machine: string, net: NetworkIn | null | undefined, mac: boolean): Check[] {
  const out: Check[] = [];
  const fw = net?.firewall ?? null;
  const id = (k: string) => `check:${machine}:${k}`;

  // The firewall itself.
  if (!fw)
    out.push({
      id: id("firewall"),
      label: "Firewall",
      value: "not read",
      level: "grey",
      about: "Collector could not read this machine's firewall, so it cannot say what the firewall lets in.",
      facts: [
        ["Why", mac ? "socketfilterfw did not answer" : "no ufw, or sudo needs a password for `ufw status`"],
        [
          "Fix",
          mac ? "nothing to do here: report it as a bug" : "let this user run `sudo -n ufw status` without a password",
        ],
      ],
    });
  else
    out.push({
      id: id("firewall"),
      label: "Firewall",
      value: fw.active ? `${fw.tool} on` : `${fw.tool} off`,
      problem: `The ${fw.tool} is off`,
      level: fw.active ? "green" : "red",
      about: fw.active
        ? `The ${fw.tool} is on: it decides which connections from other machines get in.`
        : `The ${fw.tool} is off: nothing stops another machine from connecting to a program that listens.`,
      facts: fw.active
        ? [["What it does", mac ? "lets in only the apps on its allow list" : "drops what no rule allows"]]
        : [
            [
              "Fix",
              mac
                ? "System Settings > Network > Firewall > on"
                : "sudo ufw default deny incoming, allow what you need, then sudo ufw enable",
            ],
          ],
    });

  // What comes in when nothing says otherwise.
  if (fw?.active && !mac)
    out.push({
      id: id("incoming"),
      label: "Incoming by default",
      value: fw.incoming ?? "unknown",
      problem: "The firewall lets every connection in by default",
      level: fw.incoming === "allow" ? "red" : "green",
      about:
        fw.incoming === "allow"
          ? "Every connection gets in unless a rule blocks it: a new program is open the moment it starts."
          : "Every connection is dropped unless a rule lets it in: a new program stays closed until you open it.",
      facts: fw.incoming === "allow" ? [["Fix", "sudo ufw default deny incoming"]] : [],
    });
  if (fw?.active && mac) {
    out.push({
      id: id("block-all"),
      label: "Incoming by default",
      value: fw.block_all ? "block all" : "allowed apps only",
      level: "green",
      about: fw.block_all
        ? "Every incoming connection is blocked, except the basics macOS needs (DHCP, Bonjour)."
        : "Only the apps on the firewall's allow list may accept connections from other machines.",
      facts: [],
    });
    out.push({
      id: id("allow-signed"),
      label: "Downloaded signed apps allowed automatically",
      value: fw.allow_signed ? "yes" : "no",
      problem: "Any signed app may accept connections without asking",
      level: fw.allow_signed ? "amber" : "green",
      about: fw.allow_signed
        ? "Any downloaded app signed by a developer may accept connections from your network without asking you."
        : "A downloaded app that wants to accept connections asks you first.",
      facts: fw.allow_signed
        ? [
            ["Why it matters", "a signed app is not a safe app: a signature only says who made it"],
            ["Fix", "sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setallowsignedapp off"],
            ["After", "apps you already allowed keep working; a new one asks once"],
          ]
        : [],
    });
    out.push({
      id: id("stealth"),
      label: "Stealth mode",
      value: fw.stealth ? "on" : "off",
      problem: "Stealth mode is off",
      level: fw.stealth ? "green" : "amber",
      about: fw.stealth
        ? "This Mac does not answer pings or probes from other machines, so it is harder to find."
        : "This Mac answers pings and probes on closed ports, which tells a scanner it is there.",
      facts: fw.stealth ? [] : [["Fix", "sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setstealthmode on"]],
    });
    const allowed = (fw.apps || []).filter((a) => a.allow);
    const runners = unique(allowed.filter((a) => a.interpreter).map((a) => base(a.path)));
    out.push({
      id: id("apps"),
      label: "Apps allowed to accept connections",
      value: runners.length ? `${allowed.length}, including ${runners.join(", ")}` : String(allowed.length),
      problem: `${runners.join(", ")} may accept connections from your network`,
      level: runners.length ? "amber" : "green",
      about: runners.length
        ? `${runners.join(", ")} ${runners.length > 1 ? "are" : "is"} allowed in: every dev server ${runners.length > 1 ? "they run" : "it runs"} on all addresses is open to your network.`
        : "Every app on the allow list is a single program, not a runner for any script.",
      facts: [
        ["macOS system", names(allowed.filter((a) => isSystem(a.path))) || "none"],
        ["Allowed by you", names(allowed.filter((a) => !isSystem(a.path))) || "none"],
        ...(runners.length
          ? ([
              [
                "Fix",
                "sudo /usr/libexec/ApplicationFirewall/socketfilterfw --blockapp <path> for each; localhost still works",
              ],
            ] as [string, string][])
          : []),
      ],
    });
  }

  // SSH.
  if (net?.ssh?.source) {
    const real = net.ssh.source === "sshd -T";
    const on: string[] = [];
    if (net.ssh.passwordauthentication) on.push("password logins");
    if (net.ssh.permitrootlogin) on.push("root login");
    out.push({
      id: id("ssh"),
      label: "SSH password / root login",
      value: !real ? "not read" : on.length ? `${on.join(" and ")} on` : "off / off",
      problem: `SSH allows ${on.join(" and ")}`,
      level: !real ? "grey" : on.length ? "red" : "green",
      about: !real
        ? "Collector could not read sshd's own settings (sudo sshd -T); the config file alone can be overridden."
        : on.length
          ? `sshd lets ${on.join(" and ")} in: a guessed or leaked password is enough to get a shell.`
          : "sshd takes keys only, and root cannot log in.",
      facts: on.length && real ? [["Fix", "PasswordAuthentication no and PermitRootLogin no, then reload sshd"]] : [],
    });
  }

  // The tailnet.
  if (net?.tailnet_acl !== undefined) {
    const acl = net.tailnet_acl;
    const from = acl ? unique(acl.flatMap((r) => r.from).map((ip) => ip.split("/")[0])) : null;
    const names = from?.map((ip) => net.tailnet_peers?.[ip] ?? ip);
    out.push({
      id: id("tailnet"),
      label: "Tailnet devices that can connect",
      value: !names ? "not read" : names.length ? names.join(", ") : "none",
      level: names ? "green" : "grey",
      about: !names
        ? "Tailscale's access rules could not be read."
        : names.length
          ? "Tailscale's access rules let these devices reach this machine, and no other."
          : "Tailscale's access rules let no tailnet device reach this machine.",
      facts: [],
    });
  }

  // The internet.
  const ports = net?.sockets || [];
  const open = unique(ports.filter((s) => s.reach === "internet").map((s) => `${s.proto} ${s.port}`));
  const walledRows = ports.filter((s) => s.reach === "firewalled");
  const walled = unique(walledRows.map((s) => `${s.proto} ${s.port}`));
  const why = unique(
    walledRows
      .filter((s) => s.process && WHY_OPEN[s.process])
      .map((s) => [`Why ${s.proto} ${s.port} is open`, WHY_OPEN[s.process as string]] as [string, string]),
  );
  out.push({
    id: id("internet"),
    label: "Ports open to the internet",
    problem: `${open.length === 1 ? "1 port is" : `${open.length} ports are`} open to the internet`,
    value: open.length
      ? `${open.length}: ${open.slice(0, 4).join(", ")}${open.length > 4 ? ", …" : ""}`
      : walled.length
        ? `0, and ${walled.length} firewalled: ${walled.join(", ")}`
        : "0",
    level: open.length ? "red" : "green",
    about: open.length
      ? "Anyone on the internet can try to connect to these ports, and nothing stops them."
      : walled.length
        ? "No port is open to the internet by accident. The firewalled ones are opened on purpose by a firewall rule."
        : "No port on this machine can be reached from the internet.",
    facts: open.length ? [["Fix", "close each, or bind it to 127.0.0.1 or the tailnet address"]] : why,
  });

  return out;
}

/** The worst level among a machine's checks, for its summary dot: red over amber over grey over green. */
export function worst(checks: Check[]): Level {
  for (const l of ["red", "amber", "grey"] as const) if (checks.some((c) => c.level === l)) return l;
  return "green";
}
