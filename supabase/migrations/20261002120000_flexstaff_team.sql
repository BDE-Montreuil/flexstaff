-- Flexstaff : gestion de l'équipe de chaque appli de la suite.
--
--   suite_my_apps()             Les applis dont le compte connecté est admin (toutes pour un super admin).
--   suite_team(appli)           L'équipe d'une appli : admins et staff avec leur e-mail, plus les super admins.
--   suite_user_id_by_email(e)   Retrouve un compte par e-mail, pour lui donner un rôle. Admins seulement.
--   suite_hit_rate_limit(...)   Limite de tentatives côté serveur (clé service_role uniquement).
--   app_roles_keep_admin        Refuse de retirer le dernier admin d'une appli quand aucun super admin n'existe.
--
-- Erreurs renvoyées (PostgREST traduit PTxxx en statut HTTP xxx) :
--   PT403 'Réservé aux admins de cette appli.' / 'Réservé aux admins.'
--   PT404 'Appli inconnue.'
--   PT409 'Il doit rester au moins un admin dans cette appli.'

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.suite_rate_limits (
  key text primary key,
  hits int not null,
  reset_at timestamptz not null
);

-- Réservée au serveur : RLS active et aucune règle, aucun droit pour les visiteurs ni les comptes connectés
alter table public.suite_rate_limits enable row level security;
revoke all on public.suite_rate_limits from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Fonctions
-- ---------------------------------------------------------------------------

-- Applis dont le compte connecté est admin, triées par nom. Vide pour les autres comptes.
create or replace function public.suite_my_apps()
returns table (app text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.app, a.name
  from public.suite_apps a
  where public.suite_app_role(a.app) = 'admin'
  order by a.name, a.app
$$;
revoke execute on function public.suite_my_apps() from public, anon;
grant execute on function public.suite_my_apps() to authenticated;

-- Équipe d'une appli : les droits de app_roles avec l'e-mail du compte, plus chaque super admin
-- avec le rôle 'super' (une seule fois, même s'il a aussi une ligne dans app_roles).
-- Tri : super, admin, staff, puis e-mail.
create or replace function public.suite_team(p_app text)
returns table (user_id uuid, email text, role text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if public.suite_app_role(p_app) is distinct from 'admin' then
    raise sqlstate 'PT403' using message = 'Réservé aux admins de cette appli.';
  end if;
  if not exists (select 1 from public.suite_apps a where a.app = p_app) then
    raise sqlstate 'PT404' using message = 'Appli inconnue.';
  end if;

  return query
  select t.user_id, t.email, t.role, t.created_at
  from (
    select s.user_id, u.email::text as email, 'super'::text as role, s.created_at
    from public.suite_super_admins s
    join auth.users u on u.id = s.user_id
    union all
    select r.user_id, u.email::text, r.role, r.created_at
    from public.app_roles r
    join auth.users u on u.id = r.user_id
    where r.app = p_app
      and not exists (select 1 from public.suite_super_admins s where s.user_id = r.user_id)
  ) t
  order by case t.role when 'super' then 0 when 'admin' then 1 else 2 end, t.email;
end
$$;
revoke execute on function public.suite_team(text) from public, anon;
grant execute on function public.suite_team(text) to authenticated;

-- Identifiant du compte qui a cet e-mail (casse et espaces ignorés), ou null.
-- Réservé aux comptes admins d'au moins une appli : sinon, n'importe qui pourrait tester des e-mails.
create or replace function public.suite_user_id_by_email(p_email text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.suite_apps a where public.suite_app_role(a.app) = 'admin') then
    raise sqlstate 'PT403' using message = 'Réservé aux admins.';
  end if;
  return (
    select u.id from auth.users u
    where lower(u.email) = lower(trim(p_email))
    order by u.created_at
    limit 1
  );
end
$$;
revoke execute on function public.suite_user_id_by_email(text) from public, anon;
grant execute on function public.suite_user_id_by_email(text) to authenticated;

-- Compte une tentative et renvoie le nombre de tentatives dans la fenêtre en cours
-- (même fonctionnement que sondage_hit_rate_limit).
create or replace function public.suite_hit_rate_limit(p_key text, p_window_seconds int)
returns int
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.suite_rate_limits as r (key, hits, reset_at)
  values (p_key, 1, now() + make_interval(secs => p_window_seconds))
  on conflict (key) do update
    set hits = case when r.reset_at < now() then 1 else r.hits + 1 end,
        reset_at = case when r.reset_at < now() then now() + make_interval(secs => p_window_seconds) else r.reset_at end
  returning hits
$$;
revoke execute on function public.suite_hit_rate_limit(text, int) from public, anon, authenticated;
grant execute on function public.suite_hit_rate_limit(text, int) to service_role;

-- ---------------------------------------------------------------------------
-- Garde : toujours au moins un admin par appli
-- ---------------------------------------------------------------------------

-- Retirer un admin (suppression de sa ligne, ou passage en staff) est refusé s'il ne reste aucun autre
-- admin dans l'appli et qu'aucun super admin n'existe (un super admin peut toujours réparer).
-- Un verrou par appli, tenu jusqu'à la fin de la transaction, sérialise les changements simultanés :
-- deux admins qui se rétrogradent l'un l'autre en même temps ne passent pas tous les deux.
-- Suppression en cascade (compte ou appli supprimés) : la garde ne s'applique pas, sinon il serait
-- impossible de supprimer le compte du dernier admin.
create or replace function public.app_roles_keep_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'admin' and (tg_op = 'DELETE' or new.role is distinct from 'admin') then
    perform pg_advisory_xact_lock(hashtext('app_roles_keep_admin:' || old.app));
    if exists (select 1 from auth.users u where u.id = old.user_id)
      and exists (select 1 from public.suite_apps a where a.app = old.app)
      and not exists (
        select 1 from public.app_roles r
        where r.app = old.app and r.role = 'admin' and r.user_id <> old.user_id
      )
      and not exists (select 1 from public.suite_super_admins)
    then
      raise sqlstate 'PT409' using message = 'Il doit rester au moins un admin dans cette appli.';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;
revoke execute on function public.app_roles_keep_admin() from public, anon, authenticated;

drop trigger if exists app_roles_keep_admin on public.app_roles;
create trigger app_roles_keep_admin
  before update or delete on public.app_roles
  for each row execute function public.app_roles_keep_admin();
