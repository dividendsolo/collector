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

/** One listening socket as collect.py reads it, with the mark it worked out. */
interface Socket {
  proto: string;
  address: string;
  port: number;
  process: string | null;
  pid: string | null;
  mark?: "open" | "allowed" | "local";
}

const DEFAULT_ALLOW = [22, 80, 443];

describe("the three marks (collector#65)", () => {
  const mark = (port: number, address: string, allow?: number[]) => drive<string>({ fn: "mark", port, address, allow });

  it("flags a port bound beyond this machine that the allow list does not name: open to everyone", () => {
    expect(mark(5432, "0.0.0.0")).toBe("open");
    expect(mark(6379, "::")).toBe("open");
    expect(mark(3000, "*")).toBe("open");
    expect(mark(8080, "203.0.113.9")).toBe("open");
    // The card's own examples: a database, a dev server, Docker's API.
    expect(mark(27017, "0.0.0.0")).toBe("open");
    expect(mark(5173, "0.0.0.0")).toBe("open");
    expect(mark(2375, "0.0.0.0")).toBe("open");
  });

  it("leaves a port on the machine's allow list plain: expected public", () => {
    expect(mark(22, "0.0.0.0")).toBe("allowed");
    expect(mark(80, "::")).toBe("allowed");
    expect(mark(443, "203.0.113.9")).toBe("allowed");
    expect(mark(8080, "0.0.0.0", [8080])).toBe("allowed");
    // An allow list of the user's own decides; the default is only the default.
    expect(mark(8081, "0.0.0.0", [8080])).toBe("open");
    expect(mark(443, "0.0.0.0", [8080])).toBe("open");
  });

  it("leaves a socket only this machine (or its tailnet) can reach plain: local only", () => {
    expect(mark(5432, "127.0.0.1")).toBe("local");
    expect(mark(5432, "127.0.0.53")).toBe("local");
    expect(mark(6379, "::1")).toBe("local");
    expect(mark(11434, "100.64.0.5")).toBe("local");
    expect(mark(3000, "100.64.0.10")).toBe("local");
  });

  it("puts every address of the Tailscale range (100.64.0.0/10) on the local side, and no address past it", () => {
    expect(drive<boolean>({ fn: "local", address: "100.64.0.0" })).toBe(true);
    expect(drive<boolean>({ fn: "local", address: "100.127.255.255" })).toBe(true);
    expect(drive<boolean>({ fn: "local", address: "100.63.255.255" })).toBe(false);
    expect(drive<boolean>({ fn: "local", address: "100.128.0.0" })).toBe(false);
  });

  it("reads the shapes the two tools print for a local address", () => {
    expect(drive<boolean>({ fn: "local", address: "[::1]" })).toBe(true);
    expect(drive<boolean>({ fn: "local", address: "::ffff:127.0.0.1" })).toBe(true);
    expect(drive<boolean>({ fn: "local", address: "fe80::1" })).toBe(true);
    expect(drive<boolean>({ fn: "local", address: "localhost" })).toBe(true);
    expect(drive<boolean>({ fn: "local", address: "0.0.0.0" })).toBe(false);
    expect(drive<boolean>({ fn: "local", address: "::" })).toBe(false);
    expect(drive<boolean>({ fn: "local", address: "192.0.2.10" })).toBe(false);
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
    { proto: "tcp", address: "0.0.0.0", port: 3000, process: "bun", pid: "628125" },
    { proto: "tcp", address: "0.0.0.0", port: 22, process: "sshd", pid: "700" },
    { proto: "udp", address: "*", port: 5353, process: "avahi-daemon", pid: "650" },
  ];

  it("marks every socket with the machine's allow list, the ones open to everyone first", () => {
    const out = drive<{ allow: number[]; sockets: Socket[] }>({ fn: "section", sockets });
    expect(out.allow).toEqual(DEFAULT_ALLOW);
    expect(out.sockets).toEqual([
      { proto: "tcp", address: "0.0.0.0", port: 3000, process: "bun", pid: "628125", mark: "open" },
      { proto: "udp", address: "*", port: 5353, process: "avahi-daemon", pid: "650", mark: "open" },
      { proto: "tcp", address: "0.0.0.0", port: 22, process: "sshd", pid: "700", mark: "allowed" },
      { proto: "tcp", address: "127.0.0.1", port: 5432, process: "postgres", pid: "911", mark: "local" },
    ]);
  });

  it("takes the allow list the user set, and carries the sshd flags with where they were read", () => {
    const out = drive<{ allow: number[]; sockets: Socket[]; ssh: any }>({
      fn: "section",
      sockets,
      allow: [3000, 5353],
      ssh_text: "passwordauthentication yes\n",
      ssh_source: "/etc/ssh/sshd_config",
    });
    expect(out.allow).toEqual([3000, 5353]);
    expect(out.sockets.map((s) => [s.port, s.mark])).toEqual([
      [22, "open"],
      [3000, "allowed"],
      [5353, "allowed"],
      [5432, "local"],
    ]);
    expect(out.ssh).toEqual({
      source: "/etc/ssh/sshd_config",
      passwordauthentication: true,
      permitrootlogin: false,
    });
  });

  it("says ssh was not read at all on a machine with nothing to read there", () => {
    expect(drive<{ ssh: any }>({ fn: "section", sockets: [] }).ssh).toBeNull();
    expect(drive<{ sockets: Socket[]; ssh: any }>({ fn: "section", sockets: [] })).toMatchObject({
      sockets: [],
      ssh: null,
    });
  });

  it("carries the connections and the upload threshold (collector#66)", () => {
    const out = drive<{ connections: Connection[]; upload_warn_mb: number }>({
      fn: "section",
      sockets: [],
      connections: [{ proto: "tcp", address: "198.51.100.1", port: 443, process: "curl", pid: "1" }],
    });
    expect(out.upload_warn_mb).toBe(50);
    expect(out.connections).toEqual([{ proto: "tcp", address: "198.51.100.1", port: 443, process: "curl", pid: "1" }]);
    expect(drive<{ upload_warn_mb: number }>({ fn: "section", sockets: [], upload_mb: 200 }).upload_warn_mb).toBe(200);
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
      },
    ]);
  });

  it("reads nothing out of an empty read, and out of anything that is not a socket row", () => {
    expect(drive<Connection[]>({ fn: "lsof_est", text: "" })).toEqual([]);
    expect(drive<Connection[]>({ fn: "lsof_est", text: "COMMAND PID USER FD TYPE\n" })).toEqual([]);
  });
});

describe("reading `nettop` (the bytes a Mac counts per process)", () => {
  // `nettop -P -L 1 -n -J bytes_in,bytes_out`: CSV, a header whose second column is empty, then one row per
  // process with the clock time, its name and its two counters.
  const NETTOP = [
    "time,,bytes_in,bytes_out,",
    "14:26:12.442036,Safari,120000,40000,",
    "14:26:12.442036,com.apple.WebKit.Networking,9000,1000,",
    "14:26:12.442036,Safari,1000,500,",
  ].join("\n");

  it("reads each process's bytes in and out, summing a process nettop lists twice", () => {
    expect(drive<Record<string, [number, number]>>({ fn: "nettop", text: NETTOP })).toEqual({
      Safari: [121000, 40500],
      "com.apple.WebKit.Networking": [9000, 1000],
    });
  });

  it("reads nothing out of the header alone, a blank line or no output", () => {
    expect(drive({ fn: "nettop", text: "time,,bytes_in,bytes_out,\n" })).toEqual({});
    expect(drive({ fn: "nettop", text: "14:26:12.442036,,,\n" })).toEqual({});
    expect(drive({ fn: "nettop", text: "" })).toEqual({});
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
      row({ address: "203.0.113.9", port: 51235, local_port: 22, process: "sshd", pid: "700" }), // ssh in from outside
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
      ["sshd 203.0.113.9:51235", false],
    ]);
  });

  it("is empty for a machine with nothing established, and keeps each connection's own bytes", () => {
    expect(drive<Connection[]>({ fn: "connections", rows: [], sockets: [] })).toEqual([]);
    const out = drive<Connection[]>({ fn: "connections", rows: [row({ bytes_sent: 13456000 })], sockets: [] });
    expect(out[0].bytes_sent).toBe(13456000);
    expect(out[0].inbound).toBe(false);
  });
});

describe("the upload threshold (collector#66)", () => {
  const mb = (cfg?: any) => drive<number>({ fn: "upload_mb", cfg });

  it("reads config.json's network.uploadWarnMB, and 50 when it says nothing", () => {
    expect(mb()).toBe(50);
    expect(mb({})).toBe(50);
    expect(mb({ allow: [22] })).toBe(50);
    expect(mb({ uploadWarnMB: 200 })).toBe(200);
    expect(mb({ uploadWarnMB: 1.5 })).toBe(1.5);
  });

  it("leaves a value that is not a positive number out rather than obeying it: a typo cannot turn the mark off", () => {
    expect(mb({ uploadWarnMB: 0 })).toBe(50);
    expect(mb({ uploadWarnMB: -5 })).toBe(50);
    expect(mb({ uploadWarnMB: "500" })).toBe(50);
    expect(mb({ uploadWarnMB: true })).toBe(50);
    expect(mb({ uploadWarnMB: null })).toBe(50);
    expect(mb("nonsense")).toBe(50);
  });
});
