import { api, isAuthError } from "./api";
import type { Me } from "@/lib/shared/types";

/** Compte connecté, ou null s'il faut se connecter. Les jetons restent dans des cookies HttpOnly. */
export async function currentAccount(): Promise<Me | null> {
  try {
    return await api<Me>("/api/auth/me");
  } catch (err) {
    if (isAuthError(err)) return null;
    throw err;
  }
}

export async function signOut(): Promise<void> {
  await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
}
