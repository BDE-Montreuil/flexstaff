import { json, requireAdmin, route } from "@/lib/server/http";
import type { Me } from "@/lib/shared/types";

/** Compte connecté et applis qu'il administre (401 si personne n'est connecté, 403 s'il n'administre plus rien). */
export const GET = route(async (req) => {
  const ctx = await requireAdmin(req);
  const me: Me = { email: ctx.email, superAdmin: await ctx.db.rpc<boolean>("suite_is_super_admin"), apps: ctx.apps };
  return json(me);
});
