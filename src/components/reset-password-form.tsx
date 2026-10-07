"use client";

import { useState, type FormEvent } from "react";
import type { CreatedAccount } from "@/components/password-notice";
import type { Run } from "@/components/team-panel";
import { post } from "@/lib/client/api";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, type Member, type ResetPasswordResult, type SuiteApp } from "@/lib/shared/types";

/** Nouveau mot de passe d'un membre : saisi par l'admin, ou généré et affiché une seule fois si le champ reste vide. */
export function ResetPasswordForm({
  app,
  member,
  busy,
  run,
  onGenerated,
  onClose,
  flash,
}: {
  app: SuiteApp;
  member: Member;
  busy: boolean;
  run: Run;
  onGenerated: (account: CreatedAccount) => void;
  onClose: () => void;
  flash: (message: string) => void;
}) {
  const [password, setPassword] = useState("");

  function submit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    void run(async () => {
      const result = await post<ResetPasswordResult>("/api/team/password", { userId: member.userId, password });
      if (result.temporaryPassword) onGenerated({ email: result.email, appName: app.name, password: result.temporaryPassword, reset: true });
      else flash(`Mot de passe de ${result.email} changé.`);
      onClose();
    });
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>Changer le mot de passe</h2>
      <p>
        <strong>{member.email}</strong>
      </p>
      <label className="field">
        <span>Nouveau mot de passe</span>
        <input
          type="password"
          autoComplete="new-password"
          placeholder="Vide : généré"
          minLength={MIN_PASSWORD_LENGTH}
          maxLength={MAX_PASSWORD_LENGTH}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <div className="row-actions">
        <button type="submit" className="btn primary" disabled={busy}>
          Changer
        </button>
        <button type="button" className="btn ghost" onClick={onClose}>
          Annuler
        </button>
      </div>
      <p className="muted small">
        {`${MIN_PASSWORD_LENGTH} caractères minimum. Laissé vide, un mot de passe est généré et affiché une seule fois. L'ancien ne marche plus aussitôt.`}
      </p>
    </form>
  );
}
