import { json, readJson, requireAdmin, route } from "@/lib/server/http";
import { setRole } from "@/lib/server/team";

/** Promouvoir, rétrograder ou retirer un membre : { app, userId, role: "admin" | "staff" | null }. */
export const POST = route(async (req) => {
  const ctx = await requireAdmin(req);
  await setRole(ctx, await readJson(req));
  return json({ ok: true });
});
