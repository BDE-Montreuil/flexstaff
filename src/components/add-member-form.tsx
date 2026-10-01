"use client";

import { useState, type FormEvent } from "react";
import type { CreatedAccount } from "@/components/password-notice";
import { ROLE_LABEL } from "@/components/team-card";
import type { Run } from "@/components/team-panel";
import { post } from "@/lib/client/api";
import { MAX_EMAIL_LENGTH, type AddMemberResult, type Me, type Member, type Role, type SuiteApp } from "@/lib/shared/types";

/** Ajout d'un membre par e-mail (compte créé s'il n'existe pas), ou changement de rôle d'un membre existant. */
export function AddMemberForm({
  app,
  me,
  members,
  busy,
  run,
  onCreated,
  flash,
}: {
  app: SuiteApp;
  me: Me;
  members: Member[];
  busy: boolean;
  run: Run;
  onCreated: (account: CreatedAccount) => void;
  flash: (message: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("staff");
  const target = email.trim().toLowerCase();
  const existing = members.find((m) => m.email.toLowerCase() === target);

  function submit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    void run(
      async () => {
        const result = await post<AddMemberResult>("/api/team", { app: app.app, email: target, role });
        setEmail("");
        if (result.created && result.temporaryPassword) onCreated({ email: target, appName: app.name, password: result.temporaryPassword });
        else flash(`${target} est maintenant ${ROLE_LABEL[role].toLowerCase()} de ${app.name}.`);
      },
      // Son propre e-mail : les droits du compte connecté changent
      { selfChanged: target === me.email.toLowerCase() },
    );
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>{`Ajouter à ${app.name}`}</h2>
      <label className="field">
        <span>E-mail</span>
        <input
          type="email"
          placeholder="prenom.nom@exemple.fr"
          maxLength={MAX_EMAIL_LENGTH}
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Rôle</span>
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          <option value="staff">Staff</option>
          <option value="admin">Admin</option>
        </select>
      </label>
      {existing && (
        <p className="muted small">
          {existing.role === "super"
            ? "Super admin : se gère en SQL."
            : `Déjà dans l'équipe (${ROLE_LABEL[existing.role].toLowerCase()}) : son rôle sera changé.`}
        </p>
      )}
      <button type="submit" className="btn primary" disabled={busy || existing?.role === "super"}>
        {existing ? "Changer le rôle" : "Ajouter"}
      </button>
      <p className="muted small">{"Un compte qui n'existe pas encore est créé, avec un mot de passe provisoire affiché une seule fois."}</p>
    </form>
  );
}
