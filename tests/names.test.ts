import { beforeEach, describe, expect, it } from "vitest";
import { resetNames, resolveNames, withHostNames } from "@/lib/server/names";

/**
 * The host names the Going out table shows (collector#66): reverse DNS for the addresses a machine is connected to,
 * asked once per address and never allowed to hold a read up. The JSON file that used to keep them beside
 * `config.json` is gone with the marks (collector#75); this is the cache in memory that replaced it, and a test hands
 * in its own resolver, so no DNS query leaves the machine.
 */
const conn = (address: string, over: Record<string, unknown> = {}) => ({
  proto: "tcp",
  address,
  port: 443,
  local_address: "192.0.2.5",
  local_port: 51234,
  process: "curl",
  pid: "1234",
  bytes_sent: 0,
  bytes_received: 0,
  host: null,
  ...over,
});

beforeEach(() => resetNames());

describe("reverse DNS (collector#66)", () => {
  it("asks each address once ever, and keeps the empty answer so it is not asked again", async () => {
    const asked: string[] = [];
    const lookup = async (ip: string) => {
      asked.push(ip);
      return ip === "198.51.100.1" ? "downloads.example.com." : "";
    };
    const first = await resolveNames(["198.51.100.1", "203.0.113.9"], {}, lookup);
    expect(first).toEqual({ "198.51.100.1": "downloads.example.com", "203.0.113.9": "" });
    const again = await resolveNames(["198.51.100.1", "203.0.113.9"], first, lookup);
    expect(again).toEqual(first);
    expect(asked).toEqual(["198.51.100.1", "203.0.113.9"]);
    // This machine's own loopback is never asked about.
    expect(await resolveNames(["127.0.0.1", "::1"], {}, lookup)).toEqual({});
    expect(asked).toEqual(["198.51.100.1", "203.0.113.9"]);
  });

  it("gives up on an answer that takes too long rather than holding a read up", async () => {
    const never = () => new Promise<string>(() => {});
    expect(await resolveNames(["203.0.113.9"], {}, never)).toEqual({ "203.0.113.9": "" });
  });
});

describe("the host names on a machine's connections", () => {
  it("fills each connection's host, leaves the address as collect.py read it, and keeps the names for the next read", async () => {
    const asked: string[] = [];
    const lookup = async (ip: string) => {
      asked.push(ip);
      return "downloads.example.com";
    };
    const machines = [{ name: "ezio", network: { connections: [conn("198.51.100.1")] } }];
    const out = await withHostNames(machines, lookup);
    expect(out[0].network.connections[0]).toMatchObject({
      address: "198.51.100.1",
      host: "downloads.example.com",
    });
    // The read it was handed is untouched, and the address is not asked about twice.
    expect(machines[0].network.connections[0].host).toBeNull();
    await withHostNames(machines);
    expect(asked).toEqual(["198.51.100.1"]);
  });

  it("leaves a machine whose read failed, and a connection with no address, alone", async () => {
    const failed = { name: "altair", error: "no ssh" };
    const bare = { name: "ezio", network: { connections: [conn("198.51.100.1", { address: null })] } };
    const out = await withHostNames([failed, bare], async () => "somewhere.example.com");
    expect(out[0]).toBe(failed);
    expect(out[1].network.connections[0].host).toBeNull();
  });
});
