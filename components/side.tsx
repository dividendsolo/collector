"use client";

import { createContext, type PropsWithChildren, useContext } from "react";
import type { Side } from "@/lib/phone";

const SideContext = createContext<Side>("mac");

export const useSide = () => useContext(SideContext);

export function SideProvider({ side, children }: PropsWithChildren<{ side: Side }>) {
  return <SideContext.Provider value={side}>{children}</SideContext.Provider>;
}
