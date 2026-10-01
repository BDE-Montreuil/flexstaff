import { json, route, signOut } from "@/lib/server/http";

export const POST = route(async (req) => {
  signOut(req);
  return json({ ok: true });
});
