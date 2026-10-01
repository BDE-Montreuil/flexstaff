"use client";

import { useEffect, useState } from "react";
import { LoginForm } from "@/components/login-form";
import { TeamPanel } from "@/components/team-panel";
import { currentAccount } from "@/lib/client/account";
import type { Me } from "@/lib/shared/types";

/**
 * loading : en attente de /api/auth/me ; login : connexion, avec un message éventuel ; panel : tableau de bord.
 * id change à chaque retour à la connexion : le formulaire est recréé (message affiché, bouton réactivé).
 */
type View = { name: "loading" } | { name: "login"; message: string; id: number } | { name: "panel"; me: Me };

function toLogin(message: string): (view: View) => View {
  return (view) => ({ name: "login", message, id: view.name === "login" ? view.id + 1 : 0 });
}

/** Flexstaff : connexion d'un admin de la suite, puis gestion des équipes de ses applis. */
export function StaffApp() {
  const [view, setView] = useState<View>({ name: "loading" });

  useEffect(() => {
    let ignore = false;
    currentAccount()
      .then((me) => {
        if (!ignore) setView(me ? { name: "panel", me } : toLogin(""));
      })
      .catch((err: unknown) => {
        if (!ignore) setView(toLogin((err as Error).message));
      });
    return () => {
      ignore = true;
    };
  }, []);

  if (view.name === "loading") return null;
  if (view.name === "panel") return <TeamPanel account={view.me} onSignedOut={(message) => setView(toLogin(message))} />;
  return (
    <div className="narrow">
      <LoginForm key={view.id} message={view.message} onSignedIn={(me) => setView({ name: "panel", me })} />
    </div>
  );
}
