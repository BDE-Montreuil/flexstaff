/**
 * Donne un rôle à un compte dans une appli de la suite, ou le lui retire.
 *
 *   npm run role -- <email> <appli> <admin|staff|remove> [mot-de-passe]
 *   ex. : npm run role -- prenom.nom@exemple.fr flexform staff
 *
 * Utilise la clé service_role (SUPABASE_SERVICE_ROLE_KEY dans .env) : à lancer sur ton poste, jamais ailleurs.
 * Sans compte existant, il est créé avec un mot de passe aléatoire, affiché une seule fois.
 * Les super admins ne se gèrent pas ici : uniquement en SQL (voir README).
 */
import { randomBytes } from "node:crypto";

const [email, app, role, givenPassword] = process.argv.slice(2);
const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL)?.replace(/\/+$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!email || !app || !["admin", "staff", "remove"].includes(role ?? "")) {
  console.error("Usage : npm run role -- <email> <appli> <admin|staff|remove> [mot-de-passe]");
  process.exit(1);
}
if (!url || !key) {
  console.error("Définis SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY (dans .env).");
  process.exit(1);
}

const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

async function call(path, init = {}) {
  const res = await fetch(`${url}${path}`, { ...init, headers: { ...headers, ...init.headers } });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${res.status} ${body?.msg ?? body?.message ?? text}`);
  return body;
}

/** Cherche le compte par e-mail (l'API admin pagine les utilisateurs). */
async function findUser() {
  for (let page = 1; ; page++) {
    const { users } = await call(`/auth/v1/admin/users?page=${page}&per_page=200`);
    const found = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (found || users.length < 200) return found ?? null;
  }
}

// Pas de process.exit() juste après une requête : sous Windows, Node peut planter en fermant la connexion.
// On sort de main() et on laisse le processus se terminer avec process.exitCode.
async function main() {
  const apps = await call("/rest/v1/suite_apps?select=app");
  if (!apps.some((a) => a.app === app)) {
    console.error(`Appli inconnue : ${app}. Applis : ${apps.map((a) => a.app).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  let user = await findUser();
  if (role === "remove") {
    if (user) await call(`/rest/v1/app_roles?user_id=eq.${user.id}&app=eq.${app}`, { method: "DELETE" });
    console.log(`${email} n'a plus de rôle dans ${app} (le compte Supabase est conservé).`);
    return;
  }

  let password = null;
  if (!user) {
    password = givenPassword ?? randomBytes(12).toString("base64url");
    user = await call("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true }) });
  }
  await call("/rest/v1/app_roles?on_conflict=user_id,app", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: user.id, app, role }),
  });

  console.log(`${email} : ${role} dans ${app}.`);
  if (password && !givenPassword) console.log(`Mot de passe généré (à transmettre puis à changer) : ${password}`);
}

await main();
