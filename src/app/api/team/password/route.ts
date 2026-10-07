import { json, readJson, requireAdmin, route } from "@/lib/server/http";
import { resetPassword } from "@/lib/server/team";

/** Change le mot de passe d'un membre : { userId, password? } -> ResetPasswordResult (password vide : généré). */
export const POST = route(async (req) => {
  const ctx = await requireAdmin(req);
  return json(await resetPassword(req, ctx, await readJson(req)));
});
