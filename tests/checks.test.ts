import { describe, expect, it } from "vitest";
import { type NetworkIn, securityChecks, worst } from "@/lib/checks";
import { checkToasts, forgetFixed, visibleToasts } from "@/lib/toasts";

/**
 * A machine's Security checks (James, 2026-11-06): one row per check, a dot each. Red is a real exposure and its toast
 * stays until fixed; amber is a weak setting and its toast can be dismissed; grey is a check that could not be read,
 * never green.
 */
const levels = (machine: string, net: NetworkIn | null, mac: boolean) =>
  Object.fromEntries(securityChecks(machine, net, mac).map((c) => [c.label, [c.level, c.value]]));

const MAC_FW = {
  tool: "macOS firewall",
  active: true,
  block_all: false,
  stealth: false,
  allow_builtin: true,
  allow_signed: true,
  apps: [
    { path: "/Applications/LocalSend.app", allow: true, interpreter: false },
    { path: "/Users/me/.nvm/versions/node/v22.16.0/bin/node", allow: true, interpreter: true },
    { path: "/usr/bin/python3", allow: true, interpreter: true },
    { path: "/usr/bin/ruby", allow: false, interpreter: true },
  ],
};

describe("the Mac's checks", () => {
  it("flags the weak firewall settings amber, and passes the rest", () => {
    expect(levels("mac", { firewall: MAC_FW, sockets: [], tailnet_acl: [] }, true)).toEqual({
      Firewall: ["green", "macOS firewall on"],
      "Incoming by default": ["green", "allowed apps only"],
      "Downloaded signed apps allowed automatically": ["amber", "yes"],
      "Stealth mode": ["amber", "off"],
      "Apps allowed to accept connections": ["amber", "3, including node, python3"],
      "Tailnet devices that can connect": ["green", "none"],
      "Ports open to the internet": ["green", "0"],
    });
  });

  it("is all green once the three settings are fixed", () => {
    const fixed = {
      ...MAC_FW,
      stealth: true,
      allow_signed: false,
      apps: MAC_FW.apps.map((a) => ({ ...a, allow: !a.interpreter })),
    };
    expect(worst(securityChecks("mac", { firewall: fixed, sockets: [], tailnet_acl: [] }, true))).toBe("green");
  });

  it("is red with the firewall off, and grey (never green) when it could not be read", () => {
    expect(levels("mac", { firewall: { ...MAC_FW, active: false } }, true).Firewall).toEqual([
      "red",
      "macOS firewall off",
    ]);
    expect(levels("mac", { firewall: null }, true).Firewall).toEqual(["grey", "not read"]);
  });
});

describe("the VPS's checks", () => {
  const net: NetworkIn = {
    firewall: { tool: "ufw", active: true, incoming: "deny" },
    ssh: { source: "sshd -T", passwordauthentication: false, permitrootlogin: false },
    tailnet_acl: [{ ports: [[0, 65535]], protos: [6, 17], from: ["100.64.0.9/32"] }],
    tailnet_peers: { "100.64.0.9": "laptop" },
    sockets: [
      { proto: "udp", port: 41641, reach: "firewalled" },
      { proto: "tcp", port: 22, reach: "tailnet" },
    ],
  };

  it("passes a locked-down VPS, naming the tailnet devices and the firewalled port", () => {
    expect(levels("vps", net, false)).toEqual({
      Firewall: ["green", "ufw on"],
      "Incoming by default": ["green", "deny"],
      "SSH password / root login": ["green", "off / off"],
      "Tailnet devices that can connect": ["green", "laptop"],
      "Ports open to the internet": ["green", "0, and 1 firewalled: udp 41641"],
    });
  });

  it("is red for an open port, password login, or a firewall that lets everything in", () => {
    const bad: NetworkIn = {
      ...net,
      firewall: { tool: "ufw", active: true, incoming: "allow" },
      ssh: { source: "sshd -T", passwordauthentication: true, permitrootlogin: false },
      sockets: [{ proto: "tcp", port: 5432, reach: "internet" }],
    };
    const l = levels("vps", bad, false);
    expect(l["Incoming by default"][0]).toBe("red");
    expect(l["SSH password / root login"]).toEqual(["red", "password logins on"]);
    expect(l["Ports open to the internet"]).toEqual(["red", "1: tcp 5432"]);
  });

  it("does not judge SSH from the config file alone: grey, not red", () => {
    const fromFile = {
      ...net,
      ssh: { source: "/etc/ssh/sshd_config", passwordauthentication: true, permitrootlogin: true },
    };
    expect(levels("vps", fromFile, false)["SSH password / root login"]).toEqual(["grey", "not read"]);
  });
});

describe("the check toasts", () => {
  const checks = securityChecks(
    "mac",
    { firewall: MAC_FW, sockets: [{ proto: "tcp", port: 3000, reach: "internet" }], tailnet_acl: [] },
    true,
  );
  const toasts = checkToasts([{ name: "mac", checks }]);

  it("raises one per red or amber check: red stays, amber can be dismissed, grey and green make none", () => {
    expect(toasts.map((t) => [t.level, t.dismissible, t.title])).toEqual([
      ["warn", true, "mac: Any signed app may accept connections without asking"],
      ["warn", true, "mac: Stealth mode is off"],
      ["warn", true, "mac: node, python3 may accept connections from your network"],
      ["error", false, "mac: 1 port is open to the internet"],
    ]);
    expect(toasts[1].text).toBe("Stealth mode: off");
  });

  it("hides a dismissed amber toast while its value is the same, and shows it again when it changes", () => {
    const stealth = toasts[1];
    const gone = { [stealth.key]: stealth.state };
    expect(visibleToasts(toasts, gone)).not.toContainEqual(stealth);
    const changed = { ...stealth, state: "amber:something else" };
    expect(visibleToasts([changed], gone)).toEqual([changed]);
  });

  it("never hides a red toast, whatever was dismissed", () => {
    const red = toasts[3];
    expect(visibleToasts([red], { [red.key]: red.state })).toEqual([red]);
  });
});

describe("a dismissed amber toast after its check was fixed (bug, 2026-11-06)", () => {
  // Dismiss "Stealth mode is off", turn stealth on (the check goes green), turn it off again: the same value as the
  // dismissal, so the toast stayed hidden for good. A fix must clear the dismissal, so the next break shows.
  const fw = (stealth: boolean) => ({ ...MAC_FW, stealth });
  const at = (stealth: boolean) => [
    { name: "mac", checks: securityChecks("mac", { firewall: fw(stealth), sockets: [], tailnet_acl: [] }, true) },
  ];
  const stealthToast = (stealth: boolean) => checkToasts(at(stealth)).find((t) => t.key.endsWith(":stealth"));

  it("shows the toast again when the same setting breaks again after it was fixed", () => {
    const off = stealthToast(false);
    if (!off) throw new Error("no stealth toast");
    let gone: Record<string, string> = { [off.key]: off.state };
    gone = forgetFixed(gone, at(true));
    expect(visibleToasts(checkToasts(at(false)), gone).map((t) => t.key)).toContain(off.key);
  });

  it("keeps a dismissal while the check is still amber, and for a check it did not read", () => {
    const off = stealthToast(false);
    if (!off) throw new Error("no stealth toast");
    const gone = { [off.key]: off.state };
    expect(forgetFixed(gone, at(false))).toEqual(gone);
    expect(forgetFixed(gone, [])).toEqual(gone);
  });
});
