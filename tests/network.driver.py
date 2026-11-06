#!/usr/bin/env python3
"""Print, as JSON, what collect.py's network reader says about one case on stdin (collector#65, collector#66).

`tests/network.test.ts` drives this: a case holds the text `ss`, `lsof` or `nettop` prints, or the socket and
connection rows themselves, so who can connect to each port and what each machine sends out, as a machine's reader
works them out, are tested on the exact lines those tools write, without a socket of our own and without a host name
or port of ours in the repo. By hand:

    echo '{"fn": "ss", "text": "tcp LISTEN 0 128 0.0.0.0:5432 0.0.0.0:*"}' | python3 tests/network.driver.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import collect  # noqa: E402  (the app's own reader, imported once the repo root is on the path)


def main():
    case = json.load(sys.stdin)
    fn = case["fn"]
    if fn == "ss":
        out = collect.parse_ss(case["text"])
    elif fn == "ss_est":
        out = collect.parse_ss_established(case["text"])
    elif fn == "lsof":
        out = collect.parse_lsof(case["text"])
    elif fn == "lsof_est":
        out = collect.parse_lsof_established(case["text"])
    elif fn == "nettop":
        out = collect.parse_nettop(case["text"])
    elif fn == "join_nettop":
        out = collect.join_nettop(case["rows"], collect.parse_nettop(case["text"]))
    elif fn == "lan":
        out = collect.is_lan_address(case["address"])
    elif fn == "upload_mb":
        out = collect.network_upload_mb(case.get("cfg"))
    elif fn == "connections":
        out = collect.connections_read(rows=case.get("rows"), sockets=case.get("sockets"),
                                       details=collect.ps_details(case["ps"]) if case.get("ps") else None)
    elif fn == "reach":
        out = collect.reach_of(case["address"], case["networks"])
    elif fn == "ip":
        out = [[iface, str(ifc)] for iface, ifc in collect.parse_ip_addr(case["text"])]
    elif fn == "ifconfig":
        out = [[iface, str(ifc)] for iface, ifc in collect.parse_ifconfig(case["text"])]
    elif fn == "networks":
        out = collect.machine_networks(
            [(iface, collect.ipaddress.ip_interface(addr)) for iface, addr in case["addresses"]]
        )
    elif fn == "ssh":
        out = collect.sshd_flags(case["text"])
    elif fn == "ps":
        out = collect.ps_details(case["text"], case.get("args"))
    elif fn == "info":
        out = collect.process_info(case["pid"], collect.ps_details(case["ps"], case.get("args")))
    elif fn == "ufw":
        out = collect.parse_ufw(case["text"])
    elif fn == "lets_in":
        out = collect.firewall_lets_in(case["fw"], case["proto"], case["port"], case.get("iface"))
    elif fn == "macfw":
        out = collect.parse_socketfilterfw(case["state"], case.get("apps", ""))
    elif fn == "acl":
        out = collect.parse_tailnet_acl(case["netmap"])
    elif fn == "section":
        out = collect.network_section(
            case["sockets"], case["networks"], ssh_text=case.get("ssh_text"), ssh_source=case.get("ssh_source"),
            details=collect.ps_details(case["ps"]) if case.get("ps") else None,
            fw={"tool": "ufw", **collect.parse_ufw(case["ufw"])} if case.get("ufw") else None,
            acl=case.get("acl"),
            connections=case.get("connections"), upload_mb=case.get("upload_mb"),
        )
    else:
        raise SystemExit(f"unknown fn: {fn}")
    json.dump(out, sys.stdout)
    print()


if __name__ == "__main__":
    main()
