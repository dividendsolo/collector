import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Network section's reader, driven on fixtures (collector#65): `tests/network.driver.py` runs the real
 * collect.py, so the parsing under test is the parsing a machine runs. The fixtures are the lines `ss` and `lsof`
 * really print — no host name, user or port of ours is in here, and nothing is read from a live machine.
 */
const ROOT = process.cwd();

function drive<T>(probe: unknown): T {
  const out = execFileSync("python3", [path.join(ROOT, "tests", "network.driver.py")], {
    cwd: ROOT,
    input: JSON.stringify(probe),
    encoding: "utf8",
  });
  return JSON.parse(out) as T;
}

/** One listening socket as collect.py reads it. */
interface Socket {
  proto: string;
  address: string;
  port: number;
  process: string | null;
  pid: string | null;
}

/** One listening port with who can connect to it. */
interface Port {
  proto: string;
  port: number;
  addresses: string[];
  process: string | null;
  pid: string | null;
  reach: "internet" | "firewalled" | "lan" | "tailnet" | "machine";
  tailnet: boolean;
  info?: unknown;
  firewall?: string | null;
  tailnet_from?: string[] | null;
}

// A machine on a home network (private addresses only) with a tailnet, and a VPS with a public address.
const HOME = { lan: ["192.168.1.0/24"], internet: [], tailnet: "100.64.0.9" };
const VPS = { lan: [], internet: ["203.0.113.5"], tailnet: "100.64.0.10" };
const BARE = { lan: [], internet: [], tailnet: null };

describe("who can connect to a socket (collector#65)", () => {
  const reach = (address: string, networks: object) => drive<[string, boolean]>({ fn: "reach", address, networks });

  it("says a port on every address of a home machine is open to its local network and its tailnet, not the internet", () => {
    expect(reach("*", HOME)).toEqual(["lan", true]);
    expect(reach("0.0.0.0", HOME)).toEqual(["lan", true]);
    expect(reach("::", HOME)).toEqual(["lan", true]);
  });

  it("says a port on every address of a machine with a public address is open to the internet", () => {
    expect(reach("0.0.0.0", VPS)).toEqual(["internet", true]);
    expect(reach("::", VPS)).toEqual(["internet", true]);
    // A machine whose networks were not read reads as the internet: the safe direction.
    expect(reach("*", BARE)).toEqual(["internet", false]);
  });

  it("reads a bound address by its own range, whatever the machine's networks", () => {
    expect(reach("203.0.113.9", HOME)).toEqual(["internet", false]);
    expect(reach("192.168.1.20", VPS)).toEqual(["lan", false]);
    expect(reach("10.0.0.4", VPS)).toEqual(["lan", false]);
    expect(reach("fe80::1", VPS)).toEqual(["lan", false]);
    expect(reach("not-an-address", HOME)).toEqual(["internet", false]);
  });

  it("says a loopback address is this machine alone, and a Tailscale address the tailnet", () => {
    for (const a of ["127.0.0.1", "127.0.0.53", "::1", "[::1]", "::ffff:127.0.0.1", "localhost"])
      expect(reach(a, VPS)).toEqual(["machine", false]);
    for (const a of ["100.64.0.0", "100.127.255.255", "100.64.0.5", "fd7a:115c:a1e0::1"])
      expect(reach(a, VPS)).toEqual(["tailnet", false]);
    // Just past the Tailscale range: the shared address space a carrier uses, a private one.
    expect(reach("100.63.255.255", VPS)[0]).not.toBe("tailnet");
    expect(reach("100.128.0.0", VPS)[0]).not.toBe("tailnet");
  });
});

describe("the networks a machine is on", () => {
  it("reads `ip -o addr show` (Linux)", () => {
    const text = [
      "1: lo    inet 127.0.0.1/8 scope host lo\\       valid_lft forever preferred_lft forever",
      "2: eth0    inet 203.0.113.5/20 metric 100 brd 203.0.127.255 scope global dynamic eth0",
      "2: eth0    inet6 2001:db8::5/64 scope global",
      "3: tailscale0    inet 100.64.0.10/32 scope global tailscale0",
      "4: docker0    inet 172.17.0.1/16 brd 172.17.255.255 scope global docker0",
    ].join("\n");
    expect(drive({ fn: "ip", text })).toEqual([
      ["lo", "127.0.0.1/8"],
      ["eth0", "203.0.113.5/20"],
      ["eth0", "2001:db8::5/64"],
      ["tailscale0", "100.64.0.10/32"],
      ["docker0", "172.17.0.1/16"],
    ]);
  });

  it("reads `ifconfig` (macOS), with a hex netmask and a zone on a link-local address", () => {
    const text = [
      "lo0: flags=8049<UP,LOOPBACK,RUNNING,MULTICAST> mtu 16384",
      "\tinet 127.0.0.1 netmask 0xff000000",
      "en0: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500",
      "\tinet6 fe80::1%en0 prefixlen 64 secured scopeid 0xe",
      "\tinet 192.168.1.20 netmask 0xffffff00 broadcast 192.168.1.255",
      "utun5: flags=8051<UP,POINTOPOINT,RUNNING,MULTICAST> mtu 1280",
      "\tinet 100.64.0.9 --> 100.64.0.9 netmask 0xffffffff",
    ].join("\n");
    expect(drive({ fn: "ifconfig", text })).toEqual([
      ["lo0", "127.0.0.1/8"],
      ["en0", "fe80::1/64"],
      ["en0", "192.168.1.20/24"],
      ["utun5", "100.64.0.9/32"],
    ]);
  });

  it("sorts a machine's addresses into its local networks, its public addresses and its tailnet address", () => {
    expect(
      drive({
        fn: "networks",
        addresses: [
          ["lo0", "127.0.0.1/8"],
          ["en0", "fe80::1/64"],
          ["en0", "192.168.1.20/24"],
          ["utun5", "100.64.0.9/32"],
          ["bridge100", "192.168.64.1/24"],
        ],
      }),
    ).toEqual(HOME);
    expect(
      drive({
        fn: "networks",
        addresses: [
          ["eth0", "203.0.113.5/20"],
          ["tailscale0", "100.64.0.10/32"],
          ["docker0", "172.17.0.1/16"],
        ],
      }),
    ).toEqual(VPS);
  });
});

describe("reading `ss`", () => {
  // `ss -tulnp` on a Linux machine, the header included: the same socket twice (IPv4 and IPv6), a UDP wildcard,
  // two tailnet binds with the zone ss appends — an IPv6 one carrying its brackets as well — and sockets owned by
  // another user, which carry no process without sudo: the row keeps the address, the port and no name.
  const SS = [
    "Netid State  Recv-Q Send-Q Local Address:Port Peer Address:Port Process",
    'tcp   LISTEN 0      4096         127.0.0.1:5432      0.0.0.0:*    users:(("postgres",pid=911,fd=6))',
    'tcp   LISTEN 0      511            0.0.0.0:22          0.0.0.0:*    users:(("sshd",pid=700,fd=3))',
    "tcp   LISTEN 0      128               [::]:2375           [::]:*",
    "udp   UNCONN 0      0              0.0.0.0:68          0.0.0.0:*",
    'udp   UNCONN 0      0                 *:5353             *:*      users:(("avahi-daemon",pid=650,fd=12))',
    "tcp   LISTEN 0      4096  100.64.0.10%tailscale0:49375 0.0.0.0:*",
    "tcp   LISTEN 0      4096  [fd7a:115c:a1e0::1]%tailscale0:40724  [::]:*",
  ].join("\n");

  it("reads every listening socket with its protocol, address, port, process and pid", () => {
    expect(drive<Socket[]>({ fn: "ss", text: SS })).toEqual([
      { proto: "tcp", address: "127.0.0.1", port: 5432, process: "postgres", pid: "911" },
      { proto: "tcp", address: "0.0.0.0", port: 22, process: "sshd", pid: "700" },
      { proto: "tcp", address: "::", port: 2375, process: null, pid: null },
      { proto: "udp", address: "0.0.0.0", port: 68, process: null, pid: null },
      { proto: "udp", address: "*", port: 5353, process: "avahi-daemon", pid: "650" },
      { proto: "tcp", address: "100.64.0.10", port: 49375, process: null, pid: null },
      { proto: "tcp", address: "fd7a:115c:a1e0::1", port: 40724, process: null, pid: null },
    ]);
  });

  it("is empty for no output at all, and reads one socket's two listeners as two rows", () => {
    expect(drive<Socket[]>({ fn: "ss", text: "" })).toEqual([]);
    const twice = ["tcp LISTEN 0 128 0.0.0.0:3000 0.0.0.0:*", "tcp LISTEN 0 128    [::]:3000    [::]:*"].join("\n");
    expect(drive<Socket[]>({ fn: "ss", text: twice }).map((s) => s.address)).toEqual(["0.0.0.0", "::"]);
  });
});

describe("reading `lsof` (macOS, which has no ss)", () => {
  // `lsof -nP -iTCP -sTCP:LISTEN` and `lsof -nP -iUDP` on a Mac: the same columns, `*` for a wildcard, `[::]`
  // for IPv6, and `(LISTEN)` on the TCP rows.
  const TCP = [
    "COMMAND    PID USER   FD   TYPE    DEVICE SIZE/OFF NODE NAME",
    "bun     628125  me    8u  IPv4 81015182      0t0  TCP *:3000 (LISTEN)",
    "postgres   911  me    6u  IPv4    25960      0t0  TCP 127.0.0.1:5432 (LISTEN)",
    "node      1350  me   66u  IPv6    25960      0t0  TCP [::1]:5173 (LISTEN)",
  ].join("\n");
  const UDP = [
    "COMMAND    PID USER   FD   TYPE    DEVICE SIZE/OFF NODE NAME",
    "mDNSRespo  650  me    6u  IPv4    13500      0t0  UDP *:5353",
    // Connected sockets (a browser's QUIC, a DNS lookup): lsof -iUDP lists them too, local->remote. Not listening.
    "Google    4321  me   30u  IPv4      0x1      0t0  UDP 192.0.2.5:60000->198.51.100.1:443",
    "Google    4321  me   31u  IPv6      0x2      0t0  UDP [2001:db8::5]:60001->[2001:db8::9]:443",
  ].join("\n");

  it("reads a listening TCP socket with its process and pid", () => {
    expect(drive<Socket[]>({ fn: "lsof", text: TCP })).toEqual([
      { proto: "tcp", address: "*", port: 3000, process: "bun", pid: "628125" },
      { proto: "tcp", address: "127.0.0.1", port: 5432, process: "postgres", pid: "911" },
      { proto: "tcp", address: "::1", port: 5173, process: "node", pid: "1350" },
    ]);
  });

  it("reads a listening UDP socket, skips a connected one, and reads nothing out of an empty read", () => {
    expect(drive<Socket[]>({ fn: "lsof", text: UDP })).toEqual([
      { proto: "udp", address: "*", port: 5353, process: "mDNSRespo", pid: "650" },
    ]);
    expect(drive<Socket[]>({ fn: "lsof", text: "" })).toEqual([]);
  });
});

describe("the process behind a port (its tooltip)", () => {
  it("reads `ps -axo pid=,ppid=,user=,etime=,comm=`, a path with spaces kept whole", () => {
    const text = [
      " 1272     1 me   03-15:01:06 /System/Library/CoreServices/ControlCenter.app/Contents/MacOS/ControlCenter",
      " 1787  1253 me   03-15:00:59 /Applications/Brave Browser.app/Contents/Frameworks/Brave Browser Helper",
      "not a line",
    ].join("\n");
    expect(drive({ fn: "ps", text })).toEqual({
      "1272": {
        ppid: "1",
        user: "me",
        seconds: 313266,
        path: "/System/Library/CoreServices/ControlCenter.app/Contents/MacOS/ControlCenter",
      },
      "1787": {
        ppid: "1253",
        user: "me",
        seconds: 313259,
        path: "/Applications/Brave Browser.app/Contents/Frameworks/Brave Browser Helper",
      },
    });
  });

  it("reads the full name of a Linux process out of `args` when `comm` cut it, never an interpreter's script", () => {
    const ps = [
      "1000842  700 me    01:00 next-server (v1",
      " 599186  700 me    01:00 hermes",
      "    700    1 root  02:00 systemd",
    ].join("\n");
    const args = ["1000842 next-server (v16.4.2)", " 599186 /home/me/.hermes/python3 -I -c import os"].join("\n");
    const out = drive<Record<string, { path: string; command: string }>>({ fn: "ps", text: ps, args });
    expect(out["1000842"].path).toBe("next-server (v16.4.2)");
    expect(out["599186"].path).toBe("hermes");
    expect(out["599186"].command).toBe("/home/me/.hermes/python3 -I -c import os");
    const info = drive<{ name: string; about: string; path: string }>({ fn: "info", pid: "1000842", ps, args });
    expect(info.name).toBe("next-server (v16.4.2)");
    expect(info.about).toContain("Next.js");
    expect(info.path).toBe("next-server (v16.4.2)");
  });

  it("names a program we know in plain words, and says nothing it does not know", () => {
    const ps = [
      " 1253     1 me   02:00 /Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      " 1272     1 me   01:00 /System/Library/CoreServices/ControlCenter.app/Contents/MacOS/ControlCenter",
      " 4242  1253 me   00:30 /opt/thing/unknownd",
    ].join("\n");
    const cc = drive<{ name: string; about: string }>({ fn: "info", pid: "1272", ps });
    expect(cc.name).toBe("ControlCenter");
    expect(cc.about).toContain("AirPlay Receiver");
    expect(drive({ fn: "info", pid: "4242", ps })).toEqual({
      name: "unknownd",
      about: null,
      seconds: 30,
      started_by: "Brave Browser",
      user: "me",
      path: "/opt/thing/unknownd",
    });
    expect(drive({ fn: "info", pid: "999", ps })).toBeNull();
    expect(drive({ fn: "info", pid: null, ps })).toBeNull();
  });
});

describe("the firewall (ufw)", () => {
  // `sudo ufw status verbose` on a VPS that denies incoming and opens the tailnet's interface and Tailscale's port.
  const UFW = [
    "Status: active",
    "Logging: on (low)",
    "Default: deny (incoming), allow (outgoing), deny (routed)",
    "New profiles: skip",
    "",
    "To                         Action      From",
    "--                         ------      ----",
    "Anywhere on tailscale0     ALLOW IN    Anywhere",
    "41641/udp                  ALLOW IN    Anywhere",
    "80,443/tcp                 ALLOW IN    Anywhere",
    "6000:6010/tcp              ALLOW IN    Anywhere",
    "5432/tcp                   ALLOW IN    198.51.100.7",
    "25/tcp                     DENY IN     Anywhere",
    "Anywhere (v6) on tailscale0 ALLOW IN    Anywhere (v6)",
    "41641/udp (v6)             ALLOW IN    Anywhere (v6)",
  ].join("\n");

  it("reads the default and the rules that let anyone in, and leaves out a rule for one address and a deny", () => {
    const fw = drive<{ active: boolean; incoming: string; rules: unknown[] }>({ fn: "ufw", text: UFW });
    expect(fw.active).toBe(true);
    expect(fw.incoming).toBe("deny");
    expect(fw.rules).toEqual([
      { action: "allow", proto: null, ports: [], iface: "tailscale0", any: true },
      { action: "allow", proto: "udp", ports: [[41641, 41641]], iface: null, any: false },
      {
        action: "allow",
        proto: "tcp",
        ports: [
          [80, 80],
          [443, 443],
        ],
        iface: null,
        any: false,
      },
      { action: "allow", proto: "tcp", ports: [[6000, 6010]], iface: null, any: false },
      { action: "allow", proto: null, ports: [], iface: "tailscale0", any: true },
      { action: "allow", proto: "udp", ports: [[41641, 41641]], iface: null, any: false },
    ]);
    expect(drive({ fn: "ufw", text: "" })).toBeNull();
    expect(drive({ fn: "ufw", text: "Status: inactive\n" })).toMatchObject({ active: false });
  });

  it("lets in what a rule names, on its interface only, and everything when it is off or allows by default", () => {
    const fw = drive({ fn: "ufw", text: UFW });
    const lets = (proto: string, port: number, iface?: string) =>
      drive<boolean>({ fn: "lets_in", fw, proto, port, iface });
    expect(lets("udp", 41641)).toBe(true);
    expect(lets("tcp", 443)).toBe(true);
    expect(lets("tcp", 6005)).toBe(true);
    expect(lets("udp", 443)).toBe(false);
    expect(lets("tcp", 22)).toBe(false);
    expect(lets("tcp", 5432)).toBe(false);
    expect(lets("tcp", 22, "tailscale0")).toBe(true);
    expect(drive({ fn: "lets_in", fw: { active: false, incoming: "deny", rules: [] }, proto: "tcp", port: 22 })).toBe(
      true,
    );
    expect(drive({ fn: "lets_in", fw: { active: true, incoming: "allow", rules: [] }, proto: "tcp", port: 22 })).toBe(
      true,
    );
  });

  it("marks a port the firewall blocks with what it lets through: the tailnet, or the machine alone", () => {
    const out = drive<{ firewall: unknown; sockets: Port[] }>({
      fn: "section",
      networks: VPS,
      ufw: UFW,
      sockets: [
        { proto: "tcp", address: "0.0.0.0", port: 22, process: "sshd", pid: "7" },
        { proto: "tcp", address: "0.0.0.0", port: 443, process: "proxy", pid: "8" },
        { proto: "udp", address: "0.0.0.0", port: 41641, process: "tailscaled", pid: "9" },
        { proto: "udp", address: "203.0.113.5", port: 68, process: null, pid: null },
        { proto: "tcp", address: "127.0.0.1", port: 5432, process: "postgres", pid: "10" },
      ],
    });
    expect(out.sockets.map((s) => [s.proto, s.port, s.reach, s.tailnet, s.firewall])).toEqual([
      ["tcp", 443, "firewalled", true, "allows"],
      ["udp", 41641, "firewalled", true, "allows"],
      ["tcp", 22, "tailnet", false, "blocks"],
      ["udp", 68, "machine", false, "blocks"],
      ["tcp", 5432, "machine", false, null],
    ]);
  });

  it("leaves a port open to the internet when the firewall is off or lets everything in: nothing chose it", () => {
    const port = [{ proto: "tcp", address: "0.0.0.0", port: 3000, process: "bun", pid: "7" }];
    for (const ufw of ["Status: inactive\n", UFW.replace("deny (incoming)", "allow (incoming)")]) {
      const out = drive<{ sockets: Port[] }>({ fn: "section", networks: VPS, ufw, sockets: port });
      expect(out.sockets.map((s) => [s.reach, s.firewall])).toEqual([["internet", "allows"]]);
    }
  });

  it("leaves every port as its address says when no firewall was read", () => {
    const out = drive<{ firewall: unknown; sockets: Port[] }>({
      fn: "section",
      networks: VPS,
      sockets: [{ proto: "tcp", address: "0.0.0.0", port: 22, process: "sshd", pid: "7" }],
    });
    expect(out.firewall).toBeNull();
    expect(out.sockets.map((s) => [s.reach, s.firewall])).toEqual([["internet", null]]);
  });
});

describe("the Mac's firewall (socketfilterfw)", () => {
  const STATE = [
    "Firewall is enabled. (State = 1)",
    "Firewall has block all state set to disabled.",
    "Firewall stealth mode is off",
    "Automatically allow built-in signed software ENABLED.",
    "Automatically allow downloaded signed software ENABLED.",
  ].join("\n");
  const APPS = [
    "Total number of apps = 3 ",
    "1 : /Applications/LocalSend.app ",
    "             (Allow incoming connections)",
    "2 : /Users/me/.nvm/versions/node/v22.16.0/bin/node ",
    "             (Allow incoming connections)",
    "3 : /usr/bin/ruby ",
    "             (Block incoming connections)",
  ].join("\n");

  it("reads its state and its allow list, and marks the programs that run any script", () => {
    expect(drive({ fn: "macfw", state: STATE, apps: APPS })).toEqual({
      active: true,
      block_all: false,
      stealth: false,
      allow_builtin: true,
      allow_signed: true,
      apps: [
        { path: "/Applications/LocalSend.app", allow: true, interpreter: false },
        { path: "/Users/me/.nvm/versions/node/v22.16.0/bin/node", allow: true, interpreter: true },
        { path: "/usr/bin/ruby", allow: false, interpreter: true },
      ],
    });
    expect(drive({ fn: "macfw", state: "" })).toBeNull();
  });
});

describe("the tailnet's access rules (Tailscale ACL)", () => {
  // `tailscale debug netmap`'s packet filter: who may reach this machine. A VPS that lets two devices in, and a
  // laptop the rules let nobody in (2026-11-06: altair's ports read "Tailnet", and no tailnet device could connect).
  const vpsNetmap = {
    PacketFilter: [
      {
        Srcs: ["100.64.0.9/32", "100.64.0.20/32"],
        Dsts: [{ Net: "100.64.0.10/32", Ports: { First: 0, Last: 65535 } }],
        IPProto: [6, 17, 1, 58],
      },
    ],
  };
  const sockets: Socket[] = [
    { proto: "tcp", address: "0.0.0.0", port: 22, process: "sshd", pid: "7" },
    { proto: "tcp", address: "100.64.0.10", port: 49375, process: "tailscaled", pid: "8" },
  ];

  it("reads the devices each rule lets in, and an empty filter as no device at all", () => {
    expect(drive({ fn: "acl", netmap: vpsNetmap })).toEqual([
      { ports: [[0, 65535]], protos: [6, 17, 1, 58], from: ["100.64.0.9/32", "100.64.0.20/32"] },
    ]);
    expect(drive({ fn: "acl", netmap: { PacketFilter: [] } })).toEqual([]);
    expect(drive({ fn: "acl", netmap: {} })).toBeNull();
  });

  it("keeps the tailnet on a port the rules open, naming who, and takes it off where they let nobody in", () => {
    const acl = drive({ fn: "acl", netmap: vpsNetmap });
    const open = drive<{ sockets: Port[] }>({ fn: "section", networks: HOME, sockets, acl });
    expect(open.sockets.map((s) => [s.port, s.reach, s.tailnet, s.tailnet_from])).toEqual([
      [22, "lan", true, ["100.64.0.9/32", "100.64.0.20/32"]],
      [49375, "tailnet", false, ["100.64.0.9/32", "100.64.0.20/32"]],
    ]);
    const shut = drive<{ sockets: Port[] }>({ fn: "section", networks: HOME, sockets, acl: [] });
    expect(shut.sockets.map((s) => [s.port, s.reach, s.tailnet])).toEqual([
      [22, "lan", false],
      [49375, "machine", false],
    ]);
  });

  it("leaves the tailnet as the address says when the rules could not be read", () => {
    const out = drive<{ sockets: Port[] }>({ fn: "section", networks: HOME, sockets });
    expect(out.sockets.map((s) => [s.port, s.reach, s.tailnet, s.tailnet_from])).toEqual([
      [22, "lan", true, null],
      [49375, "tailnet", false, null],
    ]);
  });
});

describe("the sshd settings that should not be on", () => {
  it("reads `sshd -T`, whose keys are lower case, and flags only what is really on", () => {
    const out = drive<{ passwordauthentication: boolean; permitrootlogin: boolean }>({
      fn: "ssh",
      text: "port 22\npasswordauthentication yes\npermitrootlogin prohibit-password\n",
    });
    expect(out).toEqual({ passwordauthentication: true, permitrootlogin: false });
  });

  it("reads the config file the same way, ignoring a commented-out line and a trailing comment", () => {
    expect(
      drive({
        fn: "ssh",
        text: [
          "#PasswordAuthentication yes",
          "PasswordAuthentication no",
          "PermitRootLogin yes # for ansible",
          "",
        ].join("\n"),
      }),
    ).toEqual({ passwordauthentication: false, permitrootlogin: true });
    expect(drive({ fn: "ssh", text: "" })).toEqual({ passwordauthentication: false, permitrootlogin: false });
    expect(drive({ fn: "ssh", text: "PermitRootLogin no\n  PasswordAuthentication   yes  \n" })).toEqual({
      passwordauthentication: true,
      permitrootlogin: false,
    });
  });
});

describe("the section one machine reads", () => {
  const sockets: Socket[] = [
    { proto: "tcp", address: "127.0.0.1", port: 5432, process: "postgres", pid: "911" },
    { proto: "tcp", address: "::1", port: 5432, process: "postgres", pid: "911" },
    { proto: "tcp", address: "0.0.0.0", port: 3000, process: "bun", pid: "628125" },
    { proto: "tcp", address: "::", port: 3000, process: "bun", pid: "628125" },
    { proto: "tcp", address: "100.64.0.10", port: 49375, process: null, pid: null },
    { proto: "udp", address: "*", port: 5353, process: null, pid: null },
    { proto: "udp", address: "*", port: 5353, process: "avahi-daemon", pid: "650" },
  ];

  it("reads one row per port, with every address it is bound on and who can connect to it, the most exposed first", () => {
    const out = drive<{ networks: object; sockets: Port[] }>({ fn: "section", sockets, networks: VPS });
    expect(out.networks).toEqual(VPS);
    expect(out.sockets).toEqual([
      {
        proto: "tcp",
        port: 3000,
        addresses: ["0.0.0.0", "::"],
        process: "bun",
        pid: "628125",
        reach: "internet",
        tailnet: true,
        info: null,
        firewall: null,
        tailnet_from: null,
      },
      {
        proto: "udp",
        port: 5353,
        addresses: ["*"],
        process: "avahi-daemon",
        pid: "650",
        reach: "internet",
        tailnet: true,
        info: null,
        firewall: null,
        tailnet_from: null,
      },
      {
        proto: "tcp",
        port: 49375,
        addresses: ["100.64.0.10"],
        process: null,
        pid: null,
        reach: "tailnet",
        tailnet: false,
        info: null,
        firewall: null,
        tailnet_from: null,
      },
      {
        proto: "tcp",
        port: 5432,
        addresses: ["127.0.0.1", "::1"],
        process: "postgres",
        pid: "911",
        reach: "machine",
        tailnet: false,
        info: null,
        firewall: null,
        tailnet_from: null,
      },
    ]);
  });

  it("reads the same ports on a home machine as open to its local network, not the internet", () => {
    const out = drive<{ sockets: Port[] }>({ fn: "section", sockets, networks: HOME });
    expect(out.sockets.map((s) => [s.port, s.reach])).toEqual([
      [3000, "lan"],
      [5353, "lan"],
      [49375, "tailnet"],
      [5432, "machine"],
    ]);
  });

  it("gives each port's process its full name and the facts for its tooltip, from ps", () => {
    const ps = [
      "    1     0 root      7-05:56:33 /sbin/launchd",
      "  700     1 root      2-01:00:00 /usr/sbin/sshd",
      "  911     1 me        01:02:03 /opt/homebrew/opt/postgresql@17/bin/postgres",
      "628125   700 me           04:05 /home/me/.bun/bin/bun",
    ].join("\n");
    const out = drive<{ sockets: Port[] }>({ fn: "section", sockets, networks: VPS, ps });
    const pg = out.sockets.find((s) => s.port === 5432);
    expect(pg?.process).toBe("postgres");
    expect(pg?.info).toMatchObject({
      name: "postgres",
      about: "PostgreSQL database server.",
      seconds: 3723,
      user: "me",
      path: "/opt/homebrew/opt/postgresql@17/bin/postgres",
    });
    // Started by its parent, by the parent's own name; pid 1 is the machine's own service manager.
    expect(out.sockets.find((s) => s.port === 3000)?.info).toMatchObject({ started_by: "sshd", seconds: 245 });
    expect(["launchd", "systemd"]).toContain((pg?.info as { started_by?: string } | undefined)?.started_by);
    // A socket with no pid has nothing to say.
    expect(out.sockets.find((s) => s.port === 49375)?.info).toBeNull();
  });

  it("carries the sshd flags with where they were read", () => {
    const out = drive<{ ssh: any }>({
      fn: "section",
      sockets,
      networks: VPS,
      ssh_text: "passwordauthentication yes\n",
      ssh_source: "/etc/ssh/sshd_config",
    });
    expect(out.ssh).toEqual({
      source: "/etc/ssh/sshd_config",
      passwordauthentication: true,
      permitrootlogin: false,
    });
  });

  it("says ssh was not read at all on a machine with nothing to read there", () => {
    expect(drive<{ sockets: Port[]; ssh: any }>({ fn: "section", sockets: [], networks: BARE })).toMatchObject({
      sockets: [],
      ssh: null,
    });
  });

  it("carries the connections a machine has going out (collector#66)", () => {
    const out = drive<{ connections: Connection[] }>({
      fn: "section",
      sockets: [],
      networks: BARE,
      connections: [{ proto: "tcp", address: "198.51.100.1", port: 443, process: "curl", pid: "1" }],
    });
    expect(out.connections).toEqual([{ proto: "tcp", address: "198.51.100.1", port: 443, process: "curl", pid: "1" }]);
  });
});

/** One established connection as collect.py reads it (collector#66). */
interface Connection {
  proto: string;
  address: string;
  port: number | null;
  local_address?: string;
  local_port?: number | null;
  process: string | null;
  pid: string | null;
  bytes_sent: number | null;
  bytes_received: number | null;
  bytes_scope?: "socket" | "process" | null;
  inbound?: boolean;
}

describe("reading `ss -tnpi` (the connections going out, with their bytes)", () => {
  // `ss -tnpi` on a Linux machine: the header, an established socket and the indented info line that carries its
  // counters, a connection of another user's (no process without sudo), a socket in another state, and the loopback
  // pair two processes on one machine share.
  const SS = [
    "State      Recv-Q Send-Q Local Address:Port   Peer Address:Port Process",
    'ESTAB      0      0      192.0.2.5:51234      198.51.100.1:443   users:(("curl",pid=1234,fd=5))',
    "\t cubic wscale:7,7 rto:204 rtt:1.5/0.7 ato:40 mss:1448 pmtu:1500 cwnd:10 bytes_sent:13456000 bytes_acked:13456001 bytes_received:2048 segs_out:10 segs_in:12",
    'ESTAB      0      0      192.0.2.5:51235      203.0.113.7:22     users:(("ssh",pid=4321,fd=3))',
    "\t cubic wscale:10,10 rto:201 rtt:0.757/0.86 ato:40 mss:32768 cwnd:10 bytes_sent:6862 bytes_received:2239",
    "TIME-WAIT  0      0      192.0.2.5:51236      198.51.100.9:80",
    "ESTAB      0      0      192.0.2.5:51237      198.51.100.9:993",
    "ESTAB      0      0      127.0.0.1:42228      127.0.0.1:3107",
    "\t cubic wscale:10,10 rto:201 rtt:0.757/0.86 mss:32768 cwnd:10 bytes_sent:6862 bytes_received:2239",
  ].join("\n");

  it("reads each established connection's remote end, process and bytes, and skips every other state", () => {
    expect(drive<Connection[]>({ fn: "ss_est", text: SS })).toEqual([
      {
        proto: "tcp",
        address: "198.51.100.1",
        port: 443,
        local_address: "192.0.2.5",
        local_port: 51234,
        process: "curl",
        pid: "1234",
        bytes_sent: 13456000,
        bytes_received: 2048,
        bytes_scope: "socket",
      },
      {
        proto: "tcp",
        address: "203.0.113.7",
        port: 22,
        local_address: "192.0.2.5",
        local_port: 51235,
        process: "ssh",
        pid: "4321",
        bytes_sent: 6862,
        bytes_received: 2239,
        bytes_scope: "socket",
      },
      // No info line under it: the OS gave no counters for this one, which is not an error.
      {
        proto: "tcp",
        address: "198.51.100.9",
        port: 993,
        local_address: "192.0.2.5",
        local_port: 51237,
        process: null,
        pid: null,
        bytes_sent: null,
        bytes_received: null,
        bytes_scope: "socket",
      },
      {
        proto: "tcp",
        address: "127.0.0.1",
        port: 3107,
        local_address: "127.0.0.1",
        local_port: 42228,
        process: null,
        pid: null,
        bytes_sent: 6862,
        bytes_received: 2239,
        bytes_scope: "socket",
      },
    ]);
  });

  it("is empty for a machine whose ss says nothing, and for no output at all", () => {
    expect(
      drive<Connection[]>({ fn: "ss_est", text: "State Recv-Q Send-Q Local Address:Port Peer Address:Port\n" }),
    ).toEqual([]);
    expect(drive<Connection[]>({ fn: "ss_est", text: "" })).toEqual([]);
  });
});

describe("reading `lsof -nP -iTCP -sTCP:ESTABLISHED` (macOS, which has no ss)", () => {
  // A Mac's established connections: both ends in one `local->remote` token, IPv6 in brackets, and the state lsof
  // appends to the row.
  const LSOF = [
    "COMMAND    PID USER   FD   TYPE    DEVICE SIZE/OFF NODE NAME",
    "Google    4321  me   30u  IPv4      0x1      0t0  TCP 192.0.2.5:51234->198.51.100.1:443 (ESTABLISHED)",
    "sshd       700  me    3u  IPv4      0x2      0t0  TCP 192.0.2.5:22->192.168.1.20:49152 (ESTABLISHED)",
    "Google    4321  me   31u  IPv6      0x3      0t0  TCP [2001:db8::5]:51235->[2001:db8::9]:443 (ESTABLISHED)",
  ].join("\n");

  it("reads lsof's escaped space as a space (`Brave\\x20` is the cut `Brave Browser Helper`)", () => {
    const line = "Brave\\x20  1787 me   31u  IPv4  0x4  0t0  TCP 192.0.2.5:51328->198.51.100.3:443 (ESTABLISHED)";
    expect(drive<Connection[]>({ fn: "lsof_est", text: line })[0].process).toBe("Brave");
  });

  it("reads both ends of each connection with its process, and counts no bytes (lsof counts none)", () => {
    expect(drive<Connection[]>({ fn: "lsof_est", text: LSOF })).toEqual([
      {
        proto: "tcp",
        address: "198.51.100.1",
        port: 443,
        local_address: "192.0.2.5",
        local_port: 51234,
        process: "Google",
        pid: "4321",
        bytes_sent: null,
        bytes_received: null,
        bytes_scope: null,
      },
      {
        proto: "tcp",
        address: "192.168.1.20",
        port: 49152,
        local_address: "192.0.2.5",
        local_port: 22,
        process: "sshd",
        pid: "700",
        bytes_sent: null,
        bytes_received: null,
        bytes_scope: null,
      },
      {
        proto: "tcp",
        address: "2001:db8::9",
        port: 443,
        local_address: "2001:db8::5",
        local_port: 51235,
        process: "Google",
        pid: "4321",
        bytes_sent: null,
        bytes_received: null,
        bytes_scope: null,
      },
    ]);
  });

  it("keeps one row per socket when a process holds it on two file descriptors (ssh on fd 4 and fd 5)", () => {
    const twoFds = [
      "COMMAND    PID USER   FD   TYPE    DEVICE SIZE/OFF NODE NAME",
      "ssh       3327  me    4u  IPv4      0x5      0t0  TCP 192.0.2.5:55185->198.51.100.7:22 (ESTABLISHED)",
      "ssh       3327  me    5u  IPv4      0x5      0t0  TCP 192.0.2.5:55185->198.51.100.7:22 (ESTABLISHED)",
      "ssh       3327  me    6u  IPv4      0x6      0t0  TCP 192.0.2.5:55186->198.51.100.7:22 (ESTABLISHED)",
    ].join("\n");
    const rows = drive<Connection[]>({ fn: "lsof_est", text: twoFds });
    expect(rows.map((r) => `${r.local_port}->${r.address}:${r.port} ${r.pid}`)).toEqual([
      "55185->198.51.100.7:22 3327",
      "55186->198.51.100.7:22 3327",
    ]);
  });

  it("reads nothing out of an empty read, and out of anything that is not a socket row", () => {
    expect(drive<Connection[]>({ fn: "lsof_est", text: "" })).toEqual([]);
    expect(drive<Connection[]>({ fn: "lsof_est", text: "COMMAND PID USER FD TYPE\n" })).toEqual([]);
  });
});

describe("reading `nettop` (the bytes a Mac counts per process)", () => {
  // `nettop -P -L 1 -n -J bytes_in,bytes_out` as it really prints, captured on a Mac (macOS 27) on 2026-11-06 with
  // the app names swapped for placeholders: a header whose first column is empty, then one `name.pid,in,out,` row
  // per process, with no clock column. nettop cuts the name to 15 letters, and a name may hold a dot of its own.
  const NETTOP = [
    ",bytes_in,bytes_out,",
    "launchd.1,0,0,",
    "syslogd.573,0,31915,",
    "Example Browser.1787,146016766,585017,",
    "python3.14.5696,5015962,9408,",
    "Code Helper (Pl.73632,0,0,",
    "com.example.bac.19389,0,0,",
    "ssh.414,241855718,164411062,",
    "",
  ].join("\n");

  it("reads each process's name, pid and bytes in and out, the pid split off the name's last dot", () => {
    expect(drive<Record<string, [string, number, number]>>({ fn: "nettop", text: NETTOP })).toEqual({
      "1": ["launchd", 0, 0],
      "573": ["syslogd", 0, 31915],
      "1787": ["Example Browser", 146016766, 585017],
      "5696": ["python3.14", 5015962, 9408],
      "73632": ["Code Helper (Pl", 0, 0],
      "19389": ["com.example.bac", 0, 0],
      "414": ["ssh", 241855718, 164411062],
    });
  });

  it("reads nothing out of the header alone, a blank line, a row with no pid or no output", () => {
    expect(drive({ fn: "nettop", text: ",bytes_in,bytes_out,\n" })).toEqual({});
    expect(drive({ fn: "nettop", text: "launchd,0,0,\n" })).toEqual({});
    expect(drive({ fn: "nettop", text: "ssh.414,,,\n" })).toEqual({});
    expect(drive({ fn: "nettop", text: "" })).toEqual({});
  });

  it("joins the bytes to lsof's rows on the pid, as the process's total, not on lsof's cut name", () => {
    const rows = [
      { proto: "tcp", address: "198.51.100.1", port: 443, process: "Example\\x20", pid: "1787" },
      { proto: "tcp", address: "198.51.100.2", port: 443, process: "Example\\x20", pid: "1787" },
      { proto: "tcp", address: "203.0.113.7", port: 22, process: "ssh", pid: "414" },
      { proto: "tcp", address: "203.0.113.8", port: 22, process: "ssh", pid: "9999" },
    ].map((r) => ({ ...r, bytes_sent: null, bytes_received: null, bytes_scope: null }));
    const out = drive<Connection[]>({ fn: "join_nettop", rows, text: NETTOP });
    expect(out.map((c) => [c.pid, c.bytes_sent, c.bytes_received, c.bytes_scope])).toEqual([
      ["1787", 585017, 146016766, "process"],
      ["1787", 585017, 146016766, "process"],
      ["414", 164411062, 241855718, "process"],
      // A pid nettop did not list keeps no bytes rather than another process's.
      ["9999", null, null, null],
    ]);
  });
});

describe("another device on the local network (collector#66)", () => {
  const lan = (address: string) => drive<boolean>({ fn: "lan", address });

  it("reads the private, link-local and unique-local ranges as the local network", () => {
    expect(lan("192.168.1.20")).toBe(true);
    expect(lan("10.0.0.5")).toBe(true);
    expect(lan("172.16.0.1")).toBe(true);
    expect(lan("172.31.255.255")).toBe(true);
    expect(lan("169.254.5.5")).toBe(true);
    expect(lan("fe80::1")).toBe(true);
    expect(lan("fd00:1234::5")).toBe(true);
    expect(lan("::ffff:192.168.1.5")).toBe(true);
  });

  it("leaves this machine, the tailnet, and everything public out of it", () => {
    expect(lan("127.0.0.1")).toBe(false);
    expect(lan("::1")).toBe(false);
    expect(lan("172.15.0.1")).toBe(false);
    expect(lan("172.32.0.1")).toBe(false);
    expect(lan("203.0.113.9")).toBe(false);
    // A tailnet address is another machine, but not one on this network — even the unique-local one Tailscale uses.
    expect(lan("100.64.0.5")).toBe(false);
    expect(lan("fd7a:115c:a1e0::1")).toBe(false);
    expect(lan("")).toBe(false);
  });
});

describe("the connections one machine reads", () => {
  const listening: Socket[] = [
    { proto: "tcp", address: "0.0.0.0", port: 22, process: "sshd", pid: "700" },
    { proto: "tcp", address: "0.0.0.0", port: 7000, process: "AirPlay", pid: "900" },
    { proto: "tcp", address: "0.0.0.0", port: 3000, process: "bun", pid: "628125" },
  ];
  const row = (over: Partial<Connection>): Connection => ({
    proto: "tcp",
    address: "198.51.100.1",
    port: 443,
    local_address: "192.0.2.5",
    local_port: 51234,
    process: "curl",
    pid: "1234",
    bytes_sent: 100,
    bytes_received: 200,
    ...over,
  });

  it("flags a connection to a listening port from another device on the local network, and only that", () => {
    const rows: Connection[] = [
      row({ address: "198.51.100.1", port: 443, local_port: 51234 }), // curl out to the internet
      row({ address: "192.168.1.20", port: 49152, local_port: 22, process: "sshd", pid: "700" }), // a phone's ssh
      row({ address: "192.168.1.21", port: 51234, local_port: 7000, process: "AirPlay", pid: "900" }), // an AirPlay probe
      row({ address: "203.0.113.7", port: 22, local_port: 51240, process: "ssh", pid: "4321" }), // ssh out
      row({ address: "192.168.1.22", port: 51236, local_port: 9999 }), // LAN, but nothing listens on 9999
    ];
    // `local_port`/`remote` and the flag: the read sorts the local knocks first, then by process, address and port,
    // so two reads of one machine list the same connections in the same order.
    expect(
      drive<Connection[]>({ fn: "connections", rows, sockets: listening }).map((c) => [
        `${c.process} ${c.address}:${c.port}`,
        c.inbound,
      ]),
    ).toEqual([
      ["AirPlay 192.168.1.21:51234", true],
      ["sshd 192.168.1.20:49152", true],
      ["curl 192.168.1.22:51236", false],
      ["curl 198.51.100.1:443", false],
      ["ssh 203.0.113.7:22", false],
    ]);
  });

  it("leaves out what is not going anywhere: a connection a server accepted, and this machine talking to itself", () => {
    const rows: Connection[] = [
      row({ address: "198.51.100.1", port: 443, local_port: 51234 }), // curl out: the one that stays
      row({ address: "203.0.113.9", port: 51235, local_port: 22, process: "sshd", pid: "700" }), // ssh in from outside
      row({ address: "203.0.113.10", port: 61000, local_port: 3000, process: "bun", pid: "628125" }), // a site visitor
      row({ address: "127.0.0.1", port: 4319, local_address: "127.0.0.1", local_port: 40030, process: "next-server" }),
      row({ address: "::1", port: 4319, local_address: "::1", local_port: 50952, process: "chrome" }),
      row({ address: "::ffff:127.0.0.1", port: 5432, local_port: 50000, process: "node" }),
    ];
    expect(
      drive<Connection[]>({ fn: "connections", rows, sockets: listening }).map((c) => `${c.process} ${c.address}`),
    ).toEqual(["curl 198.51.100.1"]);
  });

  it("names each connection's process by its full name from ps, where it has the pid", () => {
    const ps = "1787     1 me 01:00 /Applications/Example Browser.app/Contents/MacOS/Example Browser Helper\n";
    const out = drive<Connection[]>({
      fn: "connections",
      rows: [row({ process: "Example ", pid: "1787" }), row({ process: "curl", pid: "1234", port: 80 })],
      sockets: [],
      ps,
    });
    expect(out.map((c) => c.process)).toEqual(["Example Browser Helper", "curl"]);
  });

  it("is empty for a machine with nothing established, and keeps each connection's own bytes", () => {
    expect(drive<Connection[]>({ fn: "connections", rows: [], sockets: [] })).toEqual([]);
    const out = drive<Connection[]>({ fn: "connections", rows: [row({ bytes_sent: 13456000 })], sockets: [] });
    expect(out[0].bytes_sent).toBe(13456000);
    expect(out[0].inbound).toBe(false);
  });
});

describe("the operating system", () => {
  it("reads macOS from sw_vers and Linux from /etc/os-release, and nothing from nothing", () => {
    expect(
      drive({ fn: "os", sw_vers: "ProductName:\t\tmacOS\nProductVersion:\t\t27.2\nBuildVersion:\t\t26B123\n" }),
    ).toBe("macOS 27.2");
    expect(
      drive({ fn: "os", os_release: 'NAME="Ubuntu"\nPRETTY_NAME="Ubuntu 26.04.1 LTS"\nVERSION_ID="26.04"\n' }),
    ).toBe("Ubuntu 26.04.1 LTS");
    expect(drive({ fn: "os" })).toBeNull();
  });
});
