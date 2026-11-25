import { headers } from "next/headers";
import { App } from "@/components/app";
import { sideOfHeaders } from "@/lib/server/guard";

export const dynamic = "force-dynamic";

export default async function Home() {
  return <App side={sideOfHeaders(await headers())} />;
}
