import { removalRefusal } from "@/lib/providers";
import {
  addFallback,
  answerWritten,
  fallbackMachines,
  type MachineWrite,
  modelCatalog,
  planFor,
  removeFallbacks,
} from "@/lib/server/fallbacks";
import { guard, refusePhone } from "@/lib/server/guard";
import { json } from "@/lib/server/respond";

export const dynamic = "force-dynamic";

const PROVIDER = /^[a-z0-9][a-z0-9._-]*$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export async function GET(req: Request) {
  const refusal = guard(req);
  if (refusal) return refusal;
  return json({ providers: await modelCatalog(), machines: fallbackMachines() });
}

const answer = (action: string, provider: string, machines: MachineWrite[]) => {
  const failed = machines.filter((m) => !m.ok);
  if (failed.length)
    return json(
      { ok: false, action, provider, why: failed.map((m) => `${m.machine}: ${m.why}`).join("; "), machines },
      502,
    );
  return json({ ok: true, action, provider, machines });
};

export async function POST(req: Request) {
  const refusal = guard(req) ?? refusePhone(req);
  if (refusal) return refusal;
  const body = await req.json().catch(() => ({}));
  const provider = typeof body?.provider === "string" ? body.provider.trim() : "";
  const model = typeof body?.model === "string" ? body.model.trim() : "";
  if (!PROVIDER.test(provider)) return json({ ok: false, why: "Name a provider from the list." }, 400);

  if (body?.action === "remove") {
    const plan = await planFor(provider);
    const why = removalRefusal(plan, provider);
    if (why) return json({ ok: false, why }, 400);
    const machines = await removeFallbacks(plan.providers);
    await answerWritten();
    return answer("remove", provider, machines);
  }

  if (body?.action === "add") {
    if (!MODEL.test(model)) return json({ ok: false, why: "Name a model from the list." }, 400);
    const machines = await addFallback(provider, model);
    await answerWritten();
    return answer("add", provider, machines);
  }

  return json({ ok: false, why: "Say whether to add or remove a provider." }, 400);
}
