-- Flex Suite : droits communs à toutes les applications du projet Supabase.
--
--   suite_apps          Les applications de la suite. Une nouvelle appli = une ligne ici.
--   suite_super_admins  Le ou les vrais admins de toute la suite. Aucune appli ne peut y écrire :
--                       on l'édite uniquement en SQL (SQL Editor de Supabase ou clé service_role).
--   app_roles           Les droits par appli : 'admin' ou 'staff'. L'admin d'une appli gère les droits
--                       de cette appli seulement ; un super admin est admin de toutes les applis.
--
-- Ajouter un super admin (une seule fois, dans le SQL Editor) :
--   insert into public.suite_super_admins (user_id)
--   select id from auth.users where email = 'ton.email@exemple.fr';

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.suite_apps (
  app text primary key check (app ~ '^[a-z][a-z0-9-]{1,30}$'),
  name text not null
);
insert into public.suite_apps (app, name) values
  ('flexfolio', 'Flexfolio'),
  ('flexform', 'Flexform')
on conflict (app) do nothing;

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

-- ---------------------------------------------------------------------------
-- Fonctions : à utiliser dans les règles RLS de chaque appli
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Sécurité par ligne
-- ---------------------------------------------------------------------------

alter table public.suite_apps enable row level security;
alter table public.suite_super_admins enable row level security;
alter table public.app_roles enable row level security;

revoke all on public.suite_apps, public.suite_super_admins, public.app_roles from anon;

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

-- ---------------------------------------------------------------------------
-- Flexform : sondage_staff rejoint app_roles
-- ---------------------------------------------------------------------------

insert into public.app_roles (user_id, app, role)
select user_id, 'flexform', role from public.sondage_staff
on conflict (user_id, app) do nothing;

-- Même nom et même résultat pour les règles de Flexform : 'admin', 'staff' ou null
create or replace function public.sondage_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select public.suite_app_role('flexform')
$$;

drop table public.sondage_staff;
