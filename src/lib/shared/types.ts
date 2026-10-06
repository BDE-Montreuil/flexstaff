/**
 * Contrat entre l'API de Flexstaff (src/app/api) et l'interface (src/components).
 * Les droits sont ceux de la base (tables suite_super_admins, suite_apps, app_roles) : voir supabase/init.sql.
 */

/** Rôle dans une appli de la suite */
export type Role = "admin" | "staff";

export interface SuiteApp {
  app: string;
  name: string;
}

/** GET /api/auth/me et réponse de POST /api/auth/login */
export interface Me {
  email: string;
  superAdmin: boolean;
  /** Applis dont le compte est admin (toutes pour un super admin), triées par nom */
  apps: SuiteApp[];
}

/** Membre de l'équipe d'une appli. role "super" : super admin de la suite, défini en SQL, non modifiable ici. */
export interface Member {
  userId: string;
  email: string;
  role: Role | "super";
  /** Date d'ajout (ms) */
  since: number;
  /** Le compte connecté */
  me: boolean;
}

/** GET /api/team?app=<app> */
export interface Team {
  app: string;
  name: string;
  members: Member[];
}

/** POST /api/team { app, email, role } : ajoute un membre (compte créé s'il n'existe pas) ou change son rôle. */
export interface AddMemberResult {
  created: boolean;
  /** Mot de passe provisoire du compte créé, affiché une seule fois */
  temporaryPassword?: string;
}

/**
 * Autres routes (réponse { ok: true }) :
 *   POST /api/team/role     { app, userId, role: Role | null }   promouvoir, rétrograder, retirer (null)
 *   POST /api/team/handover { app, userId }                      transmettre le rôle admin : userId devient
 *                                                                admin, le compte connecté devient staff
 *                                                                (sauf super admin, qui le reste)
 *   POST /api/auth/logout
 * Erreurs : { error: string } avec le code HTTP (401 non connecté, 403 droits, 404, 409 conflit, 429).
 */
export const MAX_EMAIL_LENGTH = 254;
