export type Side = "mac" | "phone";

export const MAC_ONLY = ["close", "debug", "hermes", "tailscale", "release", "login", "projects", "proposals"] as const;

export type MacOnly = (typeof MAC_ONLY)[number];

export const showsOnPhone = (side: Side, _action: MacOnly) => side === "mac";
