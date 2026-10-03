-- Flexform : sondages réservés au staff.
--
--   sondage_polls.staff_only   Le sondage n'est jamais montré aux votants. Le staff et les admins y répondent
--                              depuis la page /staff, avec leur compte, tant qu'il est « dans le hub ».
--   sondage_staff_votes        Les réponses du staff, une par compte et par sondage. Séparées de sondage_votes :
--                              ce ne sont pas des votants (pas de pseudo, pas de classement, pas de « Mes données »).
--
-- Les votants passent par le serveur avec la clé service_role : c'est le serveur qui leur refuse ces sondages.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

alter table public.sondage_polls add column if not exists staff_only boolean not null default false;
-- Pas de récompense : les codes de récompense appartiennent aux votants
alter table public.sondage_polls drop constraint if exists sondage_polls_staff_no_reward;
alter table public.sondage_polls add constraint sondage_polls_staff_no_reward check (not staff_only or reward = '');

create table if not exists public.sondage_staff_votes (
  poll_id text not null references public.sondage_polls (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- optionId pour un choix, texte pour une réponse libre
  value text not null check (char_length(value) between 1 and 280),
  voted_at timestamptz not null default now(),
  primary key (poll_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Sécurité par ligne (RLS)
-- ---------------------------------------------------------------------------

alter table public.sondage_staff_votes enable row level security;
revoke all on public.sondage_staff_votes from anon;

-- Lecture : chacun ses propres réponses ; l'admin les lit toutes (résultats)
drop policy if exists "sondage_staff_votes_read" on public.sondage_staff_votes;
create policy "sondage_staff_votes_read" on public.sondage_staff_votes
  for select to authenticated using (
    (select public.sondage_role()) = 'admin'
    or (user_id = (select auth.uid()) and (select public.sondage_role()) = 'staff')
  );

-- Réponse : en son propre nom, à un sondage réservé au staff et ouvert (dans le hub)
drop policy if exists "sondage_staff_votes_insert" on public.sondage_staff_votes;
create policy "sondage_staff_votes_insert" on public.sondage_staff_votes
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and (select public.sondage_role()) in ('admin', 'staff')
    and exists (select 1 from public.sondage_polls p where p.id = poll_id and p.staff_only and p.hub)
  );
drop policy if exists "sondage_staff_votes_update" on public.sondage_staff_votes;
create policy "sondage_staff_votes_update" on public.sondage_staff_votes
  for update to authenticated
  using (user_id = (select auth.uid()) and (select public.sondage_role()) in ('admin', 'staff'))
  with check (
    user_id = (select auth.uid())
    and (select public.sondage_role()) in ('admin', 'staff')
    and exists (select 1 from public.sondage_polls p where p.id = poll_id and p.staff_only and p.hub)
  );

-- Effacement (remise à zéro d'un sondage) : admin uniquement
drop policy if exists "sondage_staff_votes_admin_delete" on public.sondage_staff_votes;
create policy "sondage_staff_votes_admin_delete" on public.sondage_staff_votes
  for delete to authenticated using ((select public.sondage_role()) = 'admin');
