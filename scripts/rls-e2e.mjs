/**
 * Vérifie les droits de la suite directement dans la base, avec le jeton de chaque rôle :
 * visiteur, staff Flexform, admin Flexform, admin Flexfolio, super admin.
 * Base LOCALE uniquement (npm run db:start) : le test crée et supprime des données.
 *
 *   npm run test:rls
 */
const { SUPABASE_URL: SB, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE } = process.env;
if (!SB?.includes("127.0.0.1") && !SB?.includes("localhost")) {
  console.error("Refusé : SUPABASE_URL ne pointe pas vers une base locale.");
  process.exit(1);
}

let failures = 0;
function check(label, ok, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${!ok && detail ? ` -> ${detail}` : ""}`);
}

async function rest(bearer, path, { method = "GET", body, prefer } = {}) {
  const res = await fetch(`${SB}/rest/v1/${path}`, {
    method,
    headers: { apikey: ANON, Authorization: `Bearer ${bearer}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

async function token(email, password) {
  const res = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Connexion impossible pour ${email} (lancer npm run role pour créer les comptes de test)`);
  return { jwt: data.access_token, id: data.user.id };
}

/** Écriture refusée : erreur HTTP, ou aucune ligne touchée (RLS filtre silencieusement). */
const refused = (r) => r.status >= 400 || (Array.isArray(r.data) && r.data.length === 0);
const rpc = (bearer, fn, args = {}) => rest(bearer, `rpc/${fn}`, { method: "POST", body: args });

async function upload(bearer, name) {
  const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
  const res = await fetch(`${SB}/storage/v1/object/project-images/${name}`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${bearer}`, "Content-Type": "image/png" },
    body: png,
  });
  return res.status;
}

const env = process.env;
const staff = await token(env.TEST_STAFF_EMAIL, env.TEST_STAFF_PASSWORD);
const formAdmin = await token(env.TEST_ADMIN_EMAIL, env.TEST_ADMIN_PASSWORD);
const folioAdmin = await token(env.TEST_FOLIO_EMAIL, env.TEST_FOLIO_PASSWORD);
const superAdmin = await token(env.TEST_SUPER_EMAIL, env.TEST_SUPER_PASSWORD);

// Données de test : un projet visible et un masqué
await rest(SERVICE, "projects?slug=like.rls-*", { method: "DELETE" });
await rest(SERVICE, "projects", { method: "POST", body: [
  { title: "Visible", slug: "rls-visible", is_visible: true },
  { title: "Masqué", slug: "rls-hidden", is_visible: false },
] });

console.log("\n# Rôles calculés par la base");
const roleOf = async (who, app) => (await rpc(who.jwt, "suite_app_role", { p_app: app })).data;
check("staff Flexform : staff dans flexform, rien dans flexfolio", (await roleOf(staff, "flexform")) === "staff" && (await roleOf(staff, "flexfolio")) === null);
check("admin Flexform : admin dans flexform, rien dans flexfolio", (await roleOf(formAdmin, "flexform")) === "admin" && (await roleOf(formAdmin, "flexfolio")) === null);
check("admin Flexfolio : admin dans flexfolio, rien dans flexform", (await roleOf(folioAdmin, "flexfolio")) === "admin" && (await roleOf(folioAdmin, "flexform")) === null);
check("super admin : admin partout", (await roleOf(superAdmin, "flexfolio")) === "admin" && (await roleOf(superAdmin, "flexform")) === "admin");
check("super admin reconnu, les autres non", (await rpc(superAdmin.jwt, "suite_is_super_admin")).data === true && (await rpc(formAdmin.jwt, "suite_is_super_admin")).data === false);
check("Flexform voit toujours son rôle par sondage_role()", (await rpc(staff.jwt, "sondage_role")).data === "staff");

console.log("\n# Tables de droits");
for (const table of ["suite_apps", "suite_super_admins", "app_roles"]) {
  const r = await rest(ANON, `${table}?select=*`);
  check(`visiteur ne lit rien dans ${table}`, r.status >= 400 || r.data.length === 0, `${r.status}`);
}
const staffRoles = await rest(staff.jwt, "app_roles?select=user_id,app,role");
check("staff ne lit que sa propre ligne", staffRoles.data.length === 1 && staffRoles.data[0].user_id === staff.id, JSON.stringify(staffRoles.data));
const formAdminRoles = await rest(formAdmin.jwt, "app_roles?select=app");
check("admin Flexform lit les droits de flexform, pas ceux de flexfolio", formAdminRoles.data.length >= 2 && formAdminRoles.data.every((r) => r.app === "flexform"), JSON.stringify(formAdminRoles.data));
check("super admin lit tous les droits", (await rest(superAdmin.jwt, "app_roles?select=app")).data.some((r) => r.app === "flexfolio"));

check("staff ne peut pas se donner le rôle admin", refused(await rest(staff.jwt, `app_roles?user_id=eq.${staff.id}&app=eq.flexform`, { method: "PATCH", body: { role: "admin" }, prefer: "return=representation" })));
check("staff ne peut pas se donner un rôle Flexfolio", refused(await rest(staff.jwt, "app_roles", { method: "POST", body: { user_id: staff.id, app: "flexfolio", role: "admin" } })));
check("admin Flexform ne peut pas se donner un rôle Flexfolio", refused(await rest(formAdmin.jwt, "app_roles", { method: "POST", body: { user_id: formAdmin.id, app: "flexfolio", role: "admin" } })));
check("admin Flexfolio ne peut pas toucher aux droits de Flexform", refused(await rest(folioAdmin.jwt, `app_roles?user_id=eq.${staff.id}&app=eq.flexform`, { method: "DELETE", prefer: "return=representation" })));
check("admin Flexform ne peut pas déplacer un droit vers un autre compte", (await rest(formAdmin.jwt, `app_roles?user_id=eq.${staff.id}&app=eq.flexform`, { method: "PATCH", body: { user_id: folioAdmin.id } })).status >= 400);
for (const [who, label] of [[staff, "staff"], [formAdmin, "admin Flexform"], [superAdmin, "super admin"]]) {
  const r = await rest(who.jwt, "suite_super_admins", { method: "POST", body: { user_id: who.id } });
  check(`${label} ne peut pas créer de super admin depuis une appli`, r.status >= 400, `${r.status}`);
}
check("personne ne peut ajouter une appli depuis une appli", (await rest(superAdmin.jwt, "suite_apps", { method: "POST", body: { app: "pirate", name: "x" } })).status >= 400);

const promote = await rest(formAdmin.jwt, `app_roles?user_id=eq.${staff.id}&app=eq.flexform`, { method: "PATCH", body: { role: "admin" }, prefer: "return=representation" });
check("admin Flexform promeut un staff en admin", promote.status === 200 && promote.data[0]?.role === "admin", JSON.stringify(promote));
const demote = await rest(formAdmin.jwt, `app_roles?user_id=eq.${staff.id}&app=eq.flexform`, { method: "PATCH", body: { role: "staff" }, prefer: "return=representation" });
check("admin Flexform rétrograde un admin en staff", demote.data?.[0]?.role === "staff");
check("super admin gère aussi les droits de Flexfolio", !refused(await rest(superAdmin.jwt, `app_roles?user_id=eq.${folioAdmin.id}&app=eq.flexfolio`, { method: "PATCH", body: { role: "admin" }, prefer: "return=representation" })));

console.log("\n# Flexfolio");
const visibleTo = async (bearer) => (await rest(bearer, "projects?select=slug&slug=like.rls-*")).data.map((p) => p.slug).sort().join(",");
check("visiteur voit seulement le projet visible", (await visibleTo(ANON)) === "rls-visible");
check("staff et admin Flexform ne voient pas le projet masqué", (await visibleTo(staff.jwt)) === "rls-visible" && (await visibleTo(formAdmin.jwt)) === "rls-visible");
check("admin Flexfolio et super admin voient le projet masqué", (await visibleTo(folioAdmin.jwt)) === "rls-hidden,rls-visible" && (await visibleTo(superAdmin.jwt)) === "rls-hidden,rls-visible");
for (const [who, label] of [[{ jwt: ANON }, "visiteur"], [staff, "staff Flexform"], [formAdmin, "admin Flexform"]]) {
  check(`${label} ne crée pas de projet`, refused(await rest(who.jwt, "projects", { method: "POST", body: { title: "x", slug: "rls-pirate" }, prefer: "return=representation" })));
  check(`${label} ne modifie pas les réglages du site`, refused(await rest(who.jwt, "site_settings?id=eq.1", { method: "PATCH", body: { site_name: "piraté" }, prefer: "return=representation" })));
  check(`${label} ne supprime pas de projet`, refused(await rest(who.jwt, "projects?slug=eq.rls-visible", { method: "DELETE", prefer: "return=representation" })));
}
const created = await rest(folioAdmin.jwt, "projects", { method: "POST", body: { title: "Nouveau", slug: "rls-new" }, prefer: "return=representation" });
check("admin Flexfolio crée un projet", created.status === 201, JSON.stringify(created));
const settings = await rest(superAdmin.jwt, "site_settings?id=eq.1", { method: "PATCH", body: { site_name: "Prénom Nom" }, prefer: "return=representation" });
check("super admin modifie les réglages du site", settings.data?.length === 1);
check("staff Flexform n'envoie pas d'image dans le stockage du portfolio", (await upload(staff.jwt, "rls-staff.png")) >= 400);
const up = await upload(folioAdmin.jwt, "rls-folio.png");
check("admin Flexfolio envoie une image", up === 200, `${up}`);

console.log("\n# Flexform");
check("super admin lit les votes de Flexform", (await rest(superAdmin.jwt, "sondage_votes?select=poll_id")).status === 200);
check("admin Flexfolio ne lit pas les participants de Flexform", (await rest(folioAdmin.jwt, "sondage_participants?select=id")).data.length === 0);

// Nettoyage
await rest(SERVICE, "projects?slug=like.rls-*", { method: "DELETE" });
await fetch(`${SB}/storage/v1/object/project-images`, {
  method: "DELETE",
  headers: { apikey: ANON, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
  body: JSON.stringify({ prefixes: ["rls-folio.png", "rls-staff.png"] }),
});

console.log(`\n${failures ? `${failures} échec(s)` : "Tout est passé."}`);
process.exit(failures ? 1 : 0);
