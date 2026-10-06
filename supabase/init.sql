-- =====================================================================
-- Flex Suite : droits communs à toutes les applis (à appliquer en premier)
-- =====================================================================
-- Chaque appli a son propre supabase/init.sql dans son dépôt (flexfolio, flexform, flexdesign) et s'y
-- inscrit dans suite_apps. Ce fichier crée les droits partagés dont elles dépendent : il passe avant elles.
--
-- Idempotent : relançable tel quel, sur une base vierge comme sur la production existante.
--
--   En local      : npm run db:reset (base vierge : ce fichier puis ceux des applis, voir config.toml)
--                   ou npm run db:setup (les mêmes fichiers, sur la base en place, sans rien effacer)
--   En production : SQL Editor de Supabase, ce fichier d'abord, puis celui de chaque appli
--
-- Ajouter un super admin (une seule fois, dans le SQL Editor) :
--   insert into public.suite_super_admins (user_id)
--   select id from auth.users where email = 'ton.email@exemple.fr';
-- =====================================================================

create extension if not exists "pgcrypto";

--   suite_apps          Les applications de la suite. Une nouvelle appli = une ligne ici.
--   suite_super_admins  Le ou les vrais admins de toute la suite. Aucune appli ne peut y écrire :
--                       on l'édite uniquement en SQL (SQL Editor de Supabase ou clé service_role).
--   app_roles           Les droits par appli : 'admin' ou 'staff'. L'admin d'une appli gère les droits
--                       de cette appli seulement ; un super admin est admin de toutes les applis.
--
-- Erreurs renvoyées par les fonctions (PostgREST traduit PTxxx en statut HTTP xxx) :
--   PT403 'Réservé aux admins de cette appli.' / 'Réservé aux admins.'
--   PT404 'Appli inconnue.'
--   PT409 'Il doit rester au moins un admin dans cette appli.'

create table if not exists public.suite_apps (
  app text primary key check (app ~ '^[a-z][a-z0-9-]{1,30}$'),
  name text not null
);

create table if not exists public.suite_super_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.app_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  app text not null references public.suite_apps (app) on delete cascade,
  role text not null check (role in ('admin', 'staff')),
  created_at timestamptz not null default now(),
  primary key (user_id, app)
);

-- Limite de tentatives côté serveur (clé service_role uniquement)
create table if not exists public.suite_rate_limits (
  key text primary key,
  hits int not null,
  reset_at timestamptz not null
);

-- ---------------------------------------------------------------------
-- Fonctions : à utiliser dans les règles RLS de chaque appli
-- ---------------------------------------------------------------------
-- security definer : lisent les tables de droits sans dépendre de leurs propres règles (pas de récursion)

create or replace function public.suite_is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.suite_super_admins where user_id = auth.uid())
$$;

-- Rôle du compte connecté dans une appli : 'admin', 'staff' ou null. Un super admin est admin partout.
create or replace function public.suite_app_role(p_app text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.suite_is_super_admin() then 'admin'
    else (select role from public.app_roles where user_id = auth.uid() and app = p_app)
  end
$$;

create or replace function public.suite_has_app_role(p_app text, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.suite_app_role(p_app) = any (p_roles), false)
$$;

-- anon compris : les règles de lecture publiques (ex. projets visibles de Flexfolio) les appellent.
-- Sans compte connecté, elles répondent simplement « non ».
grant execute on function public.suite_is_super_admin() to anon, authenticated, service_role;
grant execute on function public.suite_app_role(text) to anon, authenticated, service_role;
grant execute on function public.suite_has_app_role(text, text[]) to anon, authenticated, service_role;

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

-- Compte une tentative et renvoie le nombre de tentatives dans la fenêtre en cours.
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

-- ---------------------------------------------------------------------
-- Garde : toujours au moins un admin par appli
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- Sécurité par ligne
-- ---------------------------------------------------------------------

alter table public.suite_apps enable row level security;
alter table public.suite_super_admins enable row level security;
alter table public.app_roles enable row level security;
alter table public.suite_rate_limits enable row level security;

revoke all on public.suite_apps, public.suite_super_admins, public.app_roles from anon;
-- Réservée au serveur : aucune règle, aucun droit pour les visiteurs ni les comptes connectés
revoke all on public.suite_rate_limits from anon, authenticated;

-- Applis : lisibles par tout compte connecté, modifiables seulement en SQL
drop policy if exists "suite_apps_read" on public.suite_apps;
create policy "suite_apps_read" on public.suite_apps
  for select to authenticated using (true);
revoke insert, update, delete, truncate on public.suite_apps from authenticated;

-- Super admins : chacun voit s'il en fait partie. Aucune règle d'écriture : aucune appli ne peut en créer.
drop policy if exists "suite_super_admins_self" on public.suite_super_admins;
create policy "suite_super_admins_self" on public.suite_super_admins
  for select to authenticated using (user_id = (select auth.uid()));
revoke insert, update, delete, truncate on public.suite_super_admins from authenticated;

-- Droits par appli : chacun lit les siens ; l'admin d'une appli lit et gère ceux de son appli
drop policy if exists "app_roles_read" on public.app_roles;
create policy "app_roles_read" on public.app_roles
  for select to authenticated
  using (user_id = (select auth.uid()) or public.suite_app_role(app) = 'admin');

drop policy if exists "app_roles_admin_insert" on public.app_roles;
create policy "app_roles_admin_insert" on public.app_roles
  for insert to authenticated with check (public.suite_app_role(app) = 'admin');

drop policy if exists "app_roles_admin_update" on public.app_roles;
create policy "app_roles_admin_update" on public.app_roles
  for update to authenticated
  using (public.suite_app_role(app) = 'admin')
  with check (public.suite_app_role(app) = 'admin');

drop policy if exists "app_roles_admin_delete" on public.app_roles;
create policy "app_roles_admin_delete" on public.app_roles
  for delete to authenticated using (public.suite_app_role(app) = 'admin');

-- Une mise à jour ne change que le rôle : impossible de déplacer un droit vers un autre compte ou une autre appli
revoke update on public.app_roles from authenticated;
grant update (role) on public.app_roles to authenticated;
