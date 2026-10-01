/**
 * Test de bout en bout de l'appli Flexstaff (routes HTTP), contre la base LOCALE et l'appli lancée en local.
 * Crée puis supprime un compte de test ; remet les rôles des comptes de test comme au départ.
 *
 *   node --env-file=.env scripts/app-e2e.mjs [adresse, défaut http://localhost:8786]
 */
const APP = process.argv[2] ?? "http://localhost:8786";
const { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: SERVICE } = process.env;
if (!SB?.includes("127.0.0.1") && !SB?.includes("localhost")) {
  console.error("Refusé : SUPABASE_URL ne pointe pas vers une base locale.");
  process.exit(1);
}
const env = process.env;
const NEW_EMAIL = "e2e-nouveau@test.local";

let failures = 0;
function check(label, ok, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${!ok && detail ? ` -> ${detail}` : ""}`);
}

/** Client HTTP avec ses propres cookies, comme un navigateur. */
function browser() {
  const jar = new Map();
  return async (path, { method = "GET", body } = {}) => {
    const res = await fetch(APP + path, {
      method,
      headers: { "Content-Type": "application/json", cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const [k, ...v] = pair.split("=");
      if (/Max-Age=0/.test(c)) jar.delete(k);
      else jar.set(k, v.join("="));
    }
    const data = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
    return { status: res.status, data, cookies: jar.size };
  };
}

const admin = (path, init) => fetch(`${SB}${path}`, { ...init, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...init?.headers } });

async function deleteUser(email) {
  const { users } = await (await admin("/auth/v1/admin/users?per_page=200")).json();
  const u = users.find((x) => x.email === email);
  if (u) await admin(`/auth/v1/admin/users/${u.id}`, { method: "DELETE" });
}

const login = async (who, email, password) => who("/api/auth/login", { method: "POST", body: { email, password } });
const roleIn = (team, email) => team.data.members?.find((m) => m.email === email)?.role;

await deleteUser(NEW_EMAIL);

console.log("\n# Connexion");
const staff = browser();
const formAdmin = browser();
const folioAdmin = browser();
const superAdmin = browser();
const r0 = await login(staff, env.TEST_STAFF_EMAIL, env.TEST_STAFF_PASSWORD);
check("un staff (admin d'aucune appli) est refusé, sans cookie", r0.status === 403 && r0.cookies === 0, `${r0.status}`);
check("mauvais mot de passe refusé", (await login(browser(), env.TEST_ADMIN_EMAIL, "nope")).status === 401);
check("sans connexion : 401", (await browser()("/api/team?app=flexform")).status === 401);
const r1 = await login(formAdmin, env.TEST_ADMIN_EMAIL, env.TEST_ADMIN_PASSWORD);
check("admin Flexform connecté, appli flexform seulement", r1.status === 200 && r1.data.apps?.map((a) => a.app).join() === "flexform" && r1.data.superAdmin === false, JSON.stringify(r1.data));
await login(folioAdmin, env.TEST_FOLIO_EMAIL, env.TEST_FOLIO_PASSWORD);
const r2 = await login(superAdmin, env.TEST_SUPER_EMAIL, env.TEST_SUPER_PASSWORD);
check("super admin : toutes les applis", r2.data.superAdmin === true && r2.data.apps?.length >= 2, JSON.stringify(r2.data));
check("/api/auth/me", (await formAdmin("/api/auth/me")).data.email === env.TEST_ADMIN_EMAIL);

console.log("\n# Équipe");
const team = await formAdmin("/api/team?app=flexform");
check("équipe Flexform : admin, staff et super admin", roleIn(team, env.TEST_ADMIN_EMAIL) === "admin" && roleIn(team, env.TEST_STAFF_EMAIL) === "staff" && roleIn(team, env.TEST_SUPER_EMAIL) === "super", JSON.stringify(team.data));
check("« toi » sur son propre compte", team.data.members?.find((m) => m.email === env.TEST_ADMIN_EMAIL)?.me === true);
check("admin Flexform refusé sur l'équipe Flexfolio", (await formAdmin("/api/team?app=flexfolio")).status === 403);
check("admin Flexfolio refusé sur l'équipe Flexform", (await folioAdmin("/api/team?app=flexform")).status === 403);
const staffId = team.data.members?.find((m) => m.email === env.TEST_STAFF_EMAIL)?.userId;
const superId = team.data.members?.find((m) => m.role === "super")?.userId;
const formAdminId = team.data.members?.find((m) => m.me)?.userId;

console.log("\n# Ajouter, promouvoir, rétrograder, retirer");
const added = await formAdmin("/api/team", { method: "POST", body: { app: "flexform", email: NEW_EMAIL, role: "staff" } });
check("nouveau compte créé avec mot de passe provisoire", added.status === 200 && added.data.created === true && typeof added.data.temporaryPassword === "string", JSON.stringify(added));
const newcomer = browser();
const r3 = await login(newcomer, NEW_EMAIL, added.data.temporaryPassword);
check("le nouveau staff se connecte bien à Supabase mais Flexstaff le refuse (pas admin)", r3.status === 403);
const newId = (await formAdmin("/api/team?app=flexform")).data.members?.find((m) => m.email === NEW_EMAIL)?.userId;
check("compte existant ajouté sans nouveau mot de passe", (await formAdmin("/api/team", { method: "POST", body: { app: "flexform", email: NEW_EMAIL, role: "staff" } })).data.created === false);
check("e-mail invalide refusé", (await formAdmin("/api/team", { method: "POST", body: { app: "flexform", email: "pas-un-email", role: "staff" } })).status === 400);
check("rôle invalide refusé", (await formAdmin("/api/team", { method: "POST", body: { app: "flexform", email: NEW_EMAIL, role: "super" } })).status === 400);
check("admin Flexform ne peut pas ajouter dans Flexfolio", (await formAdmin("/api/team", { method: "POST", body: { app: "flexfolio", email: NEW_EMAIL, role: "admin" } })).status === 403);
check("promouvoir admin", (await formAdmin("/api/team/role", { method: "POST", body: { app: "flexform", userId: newId, role: "admin" } })).status === 200 &&
  roleIn(await formAdmin("/api/team?app=flexform"), NEW_EMAIL) === "admin");
check("le nouvel admin entre dans Flexstaff", (await login(newcomer, NEW_EMAIL, added.data.temporaryPassword)).status === 200);
check("rétrograder en staff", (await formAdmin("/api/team/role", { method: "POST", body: { app: "flexform", userId: newId, role: "staff" } })).status === 200);
check("la session du rétrogradé est coupée aussitôt", (await newcomer("/api/team?app=flexform")).status === 403);
check("impossible de modifier un super admin", (await formAdmin("/api/team/role", { method: "POST", body: { app: "flexform", userId: superId, role: "staff" } })).status === 409);
check("admin Flexfolio ne peut pas toucher l'équipe Flexform", (await folioAdmin("/api/team/role", { method: "POST", body: { app: "flexform", userId: newId, role: null } })).status === 403);

console.log("\n# Transmettre le rôle admin");
check("impossible de se transmettre à soi-même", (await formAdmin("/api/team/handover", { method: "POST", body: { app: "flexform", userId: formAdminId } })).status === 400);
const handover = await formAdmin("/api/team/handover", { method: "POST", body: { app: "flexform", userId: staffId } });
check("transmission : le staff devient admin", handover.status === 200, JSON.stringify(handover));
const afterHandover = await superAdmin("/api/team?app=flexform");
check("et l'ancien admin devient staff", roleIn(afterHandover, env.TEST_STAFF_EMAIL) === "admin" && roleIn(afterHandover, env.TEST_ADMIN_EMAIL) === "staff", JSON.stringify(afterHandover.data));
check("l'ancien admin n'a plus accès à Flexstaff", (await formAdmin("/api/team?app=flexform")).status === 403);
// Retour à l'état de départ
await superAdmin("/api/team/role", { method: "POST", body: { app: "flexform", userId: formAdminId, role: "admin" } });
await superAdmin("/api/team/role", { method: "POST", body: { app: "flexform", userId: staffId, role: "staff" } });
check("retirer l'accès", (await superAdmin("/api/team/role", { method: "POST", body: { app: "flexform", userId: newId, role: null } })).status === 200 &&
  roleIn(await superAdmin("/api/team?app=flexform"), NEW_EMAIL) === undefined);
check("déconnexion", (await superAdmin("/api/auth/logout", { method: "POST" })).status === 200 && (await superAdmin("/api/team?app=flexform")).status === 401);

await deleteUser(NEW_EMAIL);
console.log(`\n${failures ? `${failures} échec(s)` : "Tout est passé."}`);
process.exitCode = failures ? 1 : 0;
