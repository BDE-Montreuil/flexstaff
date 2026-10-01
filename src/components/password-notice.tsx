"use client";

import { useState } from "react";

/** Compte créé par l'ajout d'un membre, avec son mot de passe provisoire */
export interface CreatedAccount {
  email: string;
  appName: string;
  password: string;
}

/** Mot de passe provisoire d'un compte créé : affiché une seule fois, jusqu'à ce que l'admin ferme la carte. */
export function PasswordNotice({ account, onClose }: { account: CreatedAccount; onClose: () => void }) {
  const [copy, setCopy] = useState<"" | "done" | "failed">("");

  async function copyPassword(): Promise<void> {
    try {
      await navigator.clipboard.writeText(account.password);
      setCopy("done");
    } catch {
      setCopy("failed");
    }
  }

  return (
    <section className="card notice" aria-labelledby="notice-title">
      <div className="table-head">
        <h2 id="notice-title">Compte créé</h2>
        <button type="button" className="btn ghost small" onClick={onClose}>
          Fermer
        </button>
      </div>
      <p>
        {"Compte créé pour "}
        <strong>{account.email}</strong>
        {` (${account.appName}). Mot de passe provisoire :`}
      </p>
      <div className="password-row">
        <code className="password">{account.password}</code>
        <button type="button" className="btn primary small" onClick={copyPassword}>
          {copy === "done" ? "Copié" : "Copier"}
        </button>
      </div>
      {copy === "failed" && (
        <p className="error" role="alert">
          Copie impossible : sélectionne le mot de passe à la main.
        </p>
      )}
      <p className="muted small">
        {"Ce mot de passe n'est affiché qu'une seule fois. Transmets-le à la personne, qui devra le changer après sa première connexion."}
      </p>
    </section>
  );
}
