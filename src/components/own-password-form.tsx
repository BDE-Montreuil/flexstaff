"use client";

import { useState, type FormEvent } from "react";
import type { Run } from "@/components/team-panel";
import { post } from "@/lib/client/api";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/shared/types";

/** Changer le mot de passe du compte connecté : l'actuel est demandé, le nouveau deux fois. */
export function OwnPasswordForm({ busy, run, onClose, flash }: { busy: boolean; run: Run; onClose: () => void; flash: (message: string) => void }) {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  function submit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    if (password !== confirm) {
      flash("Les deux nouveaux mots de passe ne sont pas identiques.");
      return;
    }
    void run(async () => {
      await post("/api/auth/password", { current, password });
      flash("Ton mot de passe a été changé.");
      onClose();
    });
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>Mon mot de passe</h2>
      <label className="field">
        <span>Mot de passe actuel</span>
        <input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
      </label>
      <label className="field">
        <span>Nouveau mot de passe</span>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          maxLength={MAX_PASSWORD_LENGTH}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Confirmer le nouveau</span>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          maxLength={MAX_PASSWORD_LENGTH}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
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
    </form>
  );
}
