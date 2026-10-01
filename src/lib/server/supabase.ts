import "server-only";

import { HttpError } from "./errors";

/**
 * Accès à Supabase par son API REST (PostgREST), sans dépendance.
 *
 * Deux façons de parler à la base :
 *   serviceDb()     clé service_role, ignore la RLS. Réservée aux actions des votants, que le
 *                   serveur vérifie lui-même (session par cookie).
 *   userDb(jeton)   jeton du compte admin ou staff connecté : la RLS de la base décide de ce
 *                   qu'il peut lire ou modifier (voir supabase/migrations).
 */

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  serviceKey: string;
}

/** Accepte aussi les noms de variables de Flexfolio (NEXT_PUBLIC_*), puisque c'est le même projet. */
export function supabaseConfig(): SupabaseConfig {
  const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL)?.replace(/\/+$/, "");
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) {
    throw new HttpError(503, "Supabase n'est pas configuré : définis SUPABASE_URL, SUPABASE_ANON_KEY et SUPABASE_SERVICE_ROLE_KEY.");
  }
  return { url, anonKey, serviceKey };
}

/** Erreur renvoyée par PostgREST, avec le code Postgres (ex. 23505 = doublon). */
export class DbError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Valeur de filtre PostgREST encodée pour l'URL : eq.<valeur> */
export const eq = (value: string | number | boolean): string => `eq.${encodeURIComponent(String(value))}`;
/** Liste pour un filtre in.(a,b) : chaque valeur entre guillemets */
export const inList = (values: string[]): string => `in.(${values.map((v) => `"${encodeURIComponent(v.replace(/"/g, '\\"'))}"`).join(",")})`;

/** PostgREST de Supabase plafonne chaque réponse à 1000 lignes : on lit par pages. */
const PAGE = 1000;

export class Db {
  constructor(
    private readonly base: string,
    private readonly apikey: string,
    private readonly bearer: string,
  ) {}

  private async request(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<Response> {
    const res = await fetch(`${this.base}/rest/v1/${path}`, {
      method: init.method ?? "GET",
      headers: {
        apikey: this.apikey,
        Authorization: `Bearer ${this.bearer}`,
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
      throw new DbError(res.status, err.code ?? "", err.message ?? `Erreur Supabase ${res.status}`);
    }
    return res;
  }

  /** Toutes les lignes (plusieurs pages si besoin). query : filtres PostgREST, ex. "select=*&order=position.asc" */
  async select<T>(table: string, query = "select=*"): Promise<T[]> {
    const rows: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const res = await this.request(`${table}?${query}`, { headers: { "Range-Unit": "items", Range: `${from}-${from + PAGE - 1}` } });
      const page = (await res.json()) as T[];
      rows.push(...page);
      if (page.length < PAGE) return rows;
    }
  }

  async one<T>(table: string, query: string): Promise<T | null> {
    const res = await this.request(`${table}?${query}&limit=1`);
    const [row] = (await res.json()) as T[];
    return row ?? null;
  }

  async count(table: string, filters = ""): Promise<number> {
    const res = await this.request(`${table}?select=*${filters ? `&${filters}` : ""}`, {
      method: "HEAD",
      headers: { Prefer: "count=exact", "Range-Unit": "items", Range: "0-0" },
    });
    return Number(res.headers.get("content-range")?.split("/")[1] ?? 0);
  }

  /**
   * Insère des lignes et les renvoie. onConflict + merge : met à jour la ligne existante (upsert) ;
   * onConflict + ignore : laisse la ligne existante telle quelle.
   */
  async insert<T>(table: string, rows: object | object[], opts: { onConflict?: string; resolution?: "merge" | "ignore" } = {}): Promise<T[]> {
    const prefer = ["return=representation"];
    if (opts.resolution) prefer.push(`resolution=${opts.resolution === "merge" ? "merge" : "ignore"}-duplicates`);
    const res = await this.request(`${table}${opts.onConflict ? `?on_conflict=${opts.onConflict}` : ""}`, {
      method: "POST",
      body: rows,
      headers: { Prefer: prefer.join(",") },
    });
    return (await res.json()) as T[];
  }

  /** Met à jour les lignes filtrées et renvoie celles réellement modifiées (vide si aucune ne correspond). */
  async update<T>(table: string, filters: string, patch: object): Promise<T[]> {
    const res = await this.request(`${table}?${filters}`, { method: "PATCH", body: patch, headers: { Prefer: "return=representation" } });
    return (await res.json()) as T[];
  }

  async remove(table: string, filters: string): Promise<void> {
    await this.request(`${table}?${filters}`, { method: "DELETE" });
  }

  async rpc<T>(fn: string, args: object = {}): Promise<T> {
    const res = await this.request(`rpc/${fn}`, { method: "POST", body: args });
    return (await res.json()) as T;
  }
}

export function serviceDb(): Db {
  const cfg = supabaseConfig();
  return new Db(cfg.url, cfg.serviceKey, cfg.serviceKey);
}

export function userDb(accessToken: string): Db {
  const cfg = supabaseConfig();
  return new Db(cfg.url, cfg.anonKey, accessToken);
}

/** Traduit une erreur de base en message pour l'utilisateur. */
export function dbErrorToHttp(err: unknown): unknown {
  if (!(err instanceof DbError)) return err;
  // Erreur levée exprès par une fonction de la base (raise sqlstate 'PT409' ...) : code HTTP et message choisis
  if (/^PT\d{3}$/.test(err.code)) return new HttpError(Number(err.code.slice(2)), err.message);
  if (err.status === 401 || err.code === "PGRST301" || err.code === "PGRST303") return new HttpError(401, "Session expirée, reconnecte-toi.");
  if (err.status === 403 || err.code === "42501") return new HttpError(403, "Ce compte n'a pas les droits pour cette action.");
  return err;
}
