import "server-only";

import { randomBytes } from "node:crypto";
import { MAX_EMAIL_LENGTH, type AddMemberResult, type Member, type ResetPasswordResult, type Role, type Team } from "@/lib/shared/types";
import { HttpError } from "./errors";
import { parseNewPassword, passwordRefused, rateLimit, str, type AdminContext } from "./http";
import { eq, supabaseConfig } from "./supabase";

/*
 * Équipe d'une appli : lecture et changements de rôles dans app_roles.
 * Tout passe par ctx.db (jeton du compte connecté) : la base vérifie elle-même que le compte est admin
 * de l'appli (fonctions suite_*, RLS de app_roles, trigger du dernier admin).
 * Seules exceptions : la création d'un compte et le changement du mot de passe d'un membre, que l'API
 * d'administration de Supabase Auth n'accepte qu'avec la clé service_role. Elle n'est utilisée qu'après
 * avoir vérifié, avec le jeton du compte, qu'il en a le droit.
 */

interface TeamRow {
  user_id: string;
  email: string;
  role: Role | "super";
  created_at: string;
}

const SUPER_ADMIN = "Les super admins se gèrent en SQL.";
const NOT_FOUND = "Membre introuvable.";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// --- Validation des entrées ------------------------------------------------

/** Appli demandée, parmi celles que le compte administre (relues dans la base à chaque requête). */
function parseApp(ctx: AdminContext, value: unknown): { app: string; name: string } {
  const app = str(value);
  const found = ctx.apps.find((a) => a.app === app);
  if (!found) throw new HttpError(403, "Tu n'es pas admin de cette appli.");
  return found;
}

function parseRole(value: unknown): Role {
  if (value === "admin" || value === "staff") return value;
  throw new HttpError(400, "Rôle invalide : admin ou staff.");
}

function parseEmail(value: unknown): string {
  const email = str(value).toLowerCase();
  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email)) throw new HttpError(400, "Adresse e-mail invalide.");
  return email;
}

function parseUserId(value: unknown): string {
  const id = str(value).toLowerCase();
  if (!UUID_RE.test(id)) throw new HttpError(400, "Identifiant de membre invalide.");
  return id;
}

// --- Lecture -----------------------------------------------------------------

function teamRows(ctx: AdminContext, app: string): Promise<TeamRow[]> {
  return ctx.db.rpc<TeamRow[]>("suite_team", { p_app: app });
}

export async function getTeam(ctx: AdminContext, appParam: unknown): Promise<Team> {
  const { app, name } = parseApp(ctx, appParam);
  const rows = await teamRows(ctx, app);
  const members: Member[] = rows.map((r) => ({
    userId: r.user_id,
    email: r.email,
    role: r.role,
    since: Date.parse(r.created_at),
    me: r.user_id === ctx.userId,
  }));
  return { app, name, members };
}

/** Membre de l'appli (lu avec le jeton du compte) ; 404 s'il n'en fait pas partie, 409 si super admin. */
async function findMember(ctx: AdminContext, app: string, userId: string): Promise<TeamRow> {
  const member = (await teamRows(ctx, app)).find((r) => r.user_id === userId);
  if (!member) throw new HttpError(404, NOT_FOUND);
  if (member.role === "super") throw new HttpError(409, SUPER_ADMIN);
  return member;
}

// --- Écriture ----------------------------------------------------------------

/**
 * Donne un rôle (ajout ou changement) ; la RLS de app_roles refuse si le compte n'est pas admin de l'appli.
 * Pas d'upsert : la base n'accorde la mise à jour que sur la colonne role, alors qu'un upsert PostgREST
 * réécrit aussi user_id et app. Changement du rôle d'abord, ajout de la ligne seulement si elle n'existe pas.
 */
async function upsertRole(ctx: AdminContext, userId: string, app: string, role: Role): Promise<void> {
  const updated = await ctx.db.update("app_roles", `user_id=${eq(userId)}&app=${eq(app)}`, { role });
  if (!updated.length) await ctx.db.insert("app_roles", { user_id: userId, app, role });
}

/** Appel à l'API d'administration de Supabase Auth (clé service_role : elle n'accepte aucun jeton de compte). */
function authAdmin(path: string, init: { method: string; body?: object }): Promise<Response> {
  const cfg = supabaseConfig();
  return fetch(`${cfg.url}/auth/v1/admin/${path}`, {
    method: init.method,
    headers: { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}`, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(8000),
  });
}

const temporaryPassword = (): string => randomBytes(12).toString("base64url");

/** Crée un compte confirmé avec un mot de passe provisoire. */
async function createAccount(email: string): Promise<{ id: string; password: string }> {
  const password = temporaryPassword();
  const res = await authAdmin("users", { method: "POST", body: { email, password, email_confirm: true } });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error_code?: string; code?: string };
    if (res.status === 422 && (err.error_code ?? err.code) === "email_exists") throw new HttpError(409, "Ce compte vient d'être créé, réessaie.");
    throw new Error(`Création de compte refusée par Supabase Auth (${res.status})`);
  }
  const user = (await res.json()) as { id: string };
  return { id: user.id, password };
}

/** POST /api/team : ajoute un membre par e-mail (compte créé s'il n'existe pas) ou change son rôle. */
export async function addMember(req: Request, ctx: AdminContext, body: Record<string, unknown>): Promise<AddMemberResult> {
  const { app } = parseApp(ctx, body.app);
  const email = parseEmail(body.email);
  const role = parseRole(body.role);

  const userId = await ctx.db.rpc<string | null>("suite_user_id_by_email", { p_email: email });
  if (userId) {
    const member = (await teamRows(ctx, app)).find((r) => r.user_id === userId);
    if (member?.role === "super") throw new HttpError(409, SUPER_ADMIN);
    await upsertRole(ctx, userId, app, role);
    return { created: false };
  }

  // Nouveau compte : la base confirme d'abord, avec le jeton du compte, qu'il est admin de l'appli
  await rateLimit(req, "create", 20);
  if ((await ctx.db.rpc<string | null>("suite_app_role", { p_app: app })) !== "admin") {
    throw new HttpError(403, "Tu n'es pas admin de cette appli.");
  }
  const account = await createAccount(email);
  try {
    await upsertRole(ctx, account.id, app, role);
  } catch (err) {
    // Pas de compte orphelin dont personne ne connaît le mot de passe
    await authAdmin(`users/${account.id}`, { method: "DELETE" }).catch(() => undefined);
    throw err;
  }
  return { created: true, temporaryPassword: account.password };
}

/** POST /api/team/role : promouvoir, rétrograder ou retirer (role null) un membre. */
export async function setRole(ctx: AdminContext, body: Record<string, unknown>): Promise<void> {
  const { app } = parseApp(ctx, body.app);
  const userId = parseUserId(body.userId);
  const role = body.role === null ? null : parseRole(body.role);
  await findMember(ctx, app, userId);

  const filters = `user_id=${eq(userId)}&app=${eq(app)}`;
  if (role === null) {
    await ctx.db.remove("app_roles", filters);
    return;
  }
  // La RLS filtre sans erreur : aucune ligne modifiée = membre hors de portée
  const rows = await ctx.db.update("app_roles", filters, { role });
  if (!rows.length) throw new HttpError(404, NOT_FOUND);
}

/** POST /api/team/handover : userId devient admin, le compte connecté devient staff (sauf super admin). */
export async function handover(ctx: AdminContext, body: Record<string, unknown>): Promise<void> {
  const { app } = parseApp(ctx, body.app);
  const userId = parseUserId(body.userId);
  if (userId === ctx.userId) throw new HttpError(400, "Choisis un autre membre que toi.");

  const [, superAdmin] = await Promise.all([findMember(ctx, app, userId), ctx.db.rpc<boolean>("suite_is_super_admin")]);
  // D'abord promouvoir : l'appli n'est jamais sans admin
  const promoted = await ctx.db.update("app_roles", `user_id=${eq(userId)}&app=${eq(app)}`, { role: "admin" });
  if (!promoted.length) throw new HttpError(404, NOT_FOUND);
  if (!superAdmin) await ctx.db.update("app_roles", `user_id=${eq(ctx.userId)}&app=${eq(app)}`, { role: "staff" });
}

/**
 * POST /api/team/password : change le mot de passe d'un membre, saisi par l'admin ou généré (password vide).
 * La base vérifie d'abord, avec le jeton du compte, que chaque rôle du membre est dans une appli qu'il administre
 * (suite_password_reset_target) ; seulement ensuite la clé service_role change le mot de passe.
 */
export async function resetPassword(req: Request, ctx: AdminContext, body: Record<string, unknown>): Promise<ResetPasswordResult> {
  const userId = parseUserId(body.userId);
  const typed = body.password === undefined || body.password === "" ? null : parseNewPassword(body.password);
  await rateLimit(req, "password", 20);
  const email = await ctx.db.rpc<string>("suite_password_reset_target", { p_user: userId });

  const password = typed ?? temporaryPassword();
  const res = await authAdmin(`users/${userId}`, { method: "PUT", body: { password } });
  if (!res.ok) throw (await passwordRefused(res)) ?? new Error(`Changement de mot de passe refusé par Supabase Auth (${res.status})`);
  return typed ? { email } : { email, temporaryPassword: password };
}
