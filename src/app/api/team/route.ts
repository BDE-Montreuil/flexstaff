import { json, readJson, requireAdmin, route } from "@/lib/server/http";
import { addMember, getTeam } from "@/lib/server/team";

/** Équipe d'une appli : GET /api/team?app=<app> -> Team. */
export const GET = route(async (req) => {
  const ctx = await requireAdmin(req);
  return json(await getTeam(ctx, new URL(req.url).searchParams.get("app")));
});

/** Ajoute un membre ou change son rôle : { app, email, role } -> AddMemberResult. */
export const POST = route(async (req) => {
  const ctx = await requireAdmin(req);
  return json(await addMember(req, ctx, await readJson(req)));
});
