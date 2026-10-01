import { json, readJson, requireAdmin, route } from "@/lib/server/http";
import { handover } from "@/lib/server/team";

/** Transmet le rôle admin : { app, userId }. Le compte connecté devient staff, sauf s'il est super admin. */
export const POST = route(async (req) => {
  const ctx = await requireAdmin(req);
  await handover(ctx, await readJson(req));
  return json({ ok: true });
});
