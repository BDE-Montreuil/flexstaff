"use client";

import type { Run } from "@/components/team-panel";
import { post } from "@/lib/client/api";
import { dateTimeFmt } from "@/lib/client/format";
import type { Me, Member, Role, Team } from "@/lib/shared/types";

export const ROLE_LABEL: Record<Member["role"], string> = { super: "Super admin", admin: "Admin", staff: "Staff" };

/** Équipe d'une appli : rôle de chaque membre et actions (promouvoir, rétrograder, retirer, transmettre, mot de passe). */
export function TeamCard({
  team,
  me,
  busy,
  run,
  onResetPassword,
}: {
  team: Team;
  me: Me;
  busy: boolean;
  run: Run;
  onResetPassword: (member: Member) => void;
}) {
  function setRole(m: Member, role: Role | null): void {
    // Confirmation pour un retrait, ou pour un changement de son propre rôle (l'accès peut se fermer)
    const question = role === null ? `Retirer ${m.email} de l'équipe ${team.name} ?` : `Passer ${role} dans ${team.name} ?`;
    const warning = m.me ? " Tu perdras l'accès à cette équipe." : "";
    if ((role === null || m.me) && !window.confirm(question + warning)) return;
    void run(() => post("/api/team/role", { app: team.app, userId: m.userId, role }), { selfChanged: m.me });
  }

  function handover(m: Member): void {
    const after = me.superAdmin ? "Tu restes super admin." : "Tu deviendras staff et perdras l'accès à cette équipe.";
    if (!window.confirm(`Transmettre le rôle admin de ${team.name} à ${m.email} ? ${after}`)) return;
    void run(() => post("/api/team/handover", { app: team.app, userId: m.userId }), { selfChanged: true });
  }

  return (
    <section className="card">
      <div className="table-head">
        <h2>{`Équipe ${team.name} · ${team.members.length}`}</h2>
      </div>
      {team.members.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Membre</th>
                <th>Rôle</th>
                <th>Depuis</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {team.members.map((m) => (
                <tr key={m.userId}>
                  <td className="strong">
                    {m.email}
                    {m.me && <span className="badge you">toi</span>}
                  </td>
                  <td>
                    <span className={`badge role-${m.role}`}>{ROLE_LABEL[m.role]}</span>
                  </td>
                  <td className="num-cell">{Number.isNaN(m.since) ? "—" : dateTimeFmt.format(m.since)}</td>
                  <td>
                    {m.role === "super" ? (
                      <span className="muted small">Géré en SQL</span>
                    ) : (
                      <div className="row-actions">
                        {m.role === "staff" ? (
                          <button type="button" className="btn small" disabled={busy} onClick={() => setRole(m, "admin")}>
                            Passer admin
                          </button>
                        ) : (
                          <button type="button" className="btn small" disabled={busy} onClick={() => setRole(m, "staff")}>
                            Passer staff
                          </button>
                        )}
                        {m.role === "staff" && !m.me && (
                          <button type="button" className="btn warn small" disabled={busy} onClick={() => handover(m)}>
                            Transmettre
                          </button>
                        )}
                        {!m.me && (
                          <button type="button" className="btn ghost small" disabled={busy} onClick={() => onResetPassword(m)}>
                            Mot de passe
                          </button>
                        )}
                        <button type="button" className="btn ghost danger small" disabled={busy} onClick={() => setRole(m, null)}>
                          Retirer
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">{"Personne dans l'équipe pour l'instant."}</p>
      )}
    </section>
  );
}
