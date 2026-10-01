-- Sondages BDE : toutes les données de l'appli, dans le projet Supabase de Flexfolio.
-- Tables préfixées « sondage_ » dans le schéma public : séparées des tables du portfolio
-- sans avoir à exposer un nouveau schéma dans les réglages de l'API.
--
-- Qui accède à quoi :
--   * votants     : jamais d'accès direct. Le serveur de l'appli agit pour eux avec la clé
--                   service_role, après avoir vérifié leur session (cookie).
--   * admin/staff : comptes Supabase Auth, rôle dans sondage_staff. Leurs requêtes arrivent
--                   avec leur propre jeton : la sécurité par ligne (RLS) ci-dessous s'applique.
--   * anon        : rien.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.sondage_polls (
  id text primary key,
  position int not null default 0,
  kind text not null check (kind in ('choice', 'text')),
  question text not null check (char_length(question) between 1 and 200),
  -- [{ "id": "0", "label": "Pour" }, ...]
  options jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  reveal boolean not null default false,
  hub boolean not null default false,
  category text not null default '' check (char_length(category) <= 40),
  reward text not null default '' check (char_length(reward) <= 80),
  created_at timestamptz not null default now(),
  -- Première mise en ligne, pour le succès « Plus rapide que la lumière »
  published_at timestamptz
);

-- Réglages globaux (une seule ligne)
create table if not exists public.sondage_settings (
  id int primary key default 1 check (id = 1),
  active_poll_id text references public.sondage_polls (id) on delete set null,
  theme_linked boolean not null default true
);
insert into public.sondage_settings (id) values (1) on conflict (id) do nothing;

-- Votants. L'id sert aussi de jeton de session (cookie HttpOnly).
create table if not exists public.sondage_participants (
  id uuid primary key default gen_random_uuid(),
  pseudo text not null check (char_length(pseudo) between 2 and 24),
  prenom text not null default '' check (char_length(prenom) <= 40),
  nom text not null default '' check (char_length(nom) <= 40),
  formation text not null default '' check (char_length(formation) <= 60),
  -- { version, acceptedAt, marketing, sponsors, updatedAt } : consentement RGPD
  consent jsonb,
  -- false après déconnexion : le profil reste pour l'export, le pseudo est libéré
  active boolean not null default true,
  created_at timestamptz not null default now()
);
-- Un pseudo n'est réservé que par une session ouverte
create unique index if not exists sondage_participants_active_pseudo
  on public.sondage_participants (lower(pseudo)) where active;

create table if not exists public.sondage_votes (
  poll_id text not null references public.sondage_polls (id) on delete cascade,
  participant_id uuid not null references public.sondage_participants (id) on delete cascade,
  -- optionId pour un choix, texte pour une réponse libre
  value text not null check (char_length(value) between 1 and 280),
  voted_at timestamptz not null default now(),
  primary key (poll_id, participant_id)
);
create index if not exists sondage_votes_participant on public.sondage_votes (participant_id);

-- Récompenses : un code à usage unique par votant et par sondage
create table if not exists public.sondage_reward_codes (
  code text primary key,
  poll_id text not null references public.sondage_polls (id) on delete cascade,
  participant_id uuid not null references public.sondage_participants (id) on delete cascade,
  created_at timestamptz not null default now(),
  redeemed_at timestamptz,
  redeemed_by uuid references auth.users (id) on delete set null,
  unique (poll_id, participant_id)
);

-- Comptes admin et staff (créés dans Authentication, puis ajoutés ici)
create table if not exists public.sondage_staff (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'staff')),
  created_at timestamptz not null default now()
);

-- Limitation de débit, partagée entre toutes les fonctions serverless
create table if not exists public.sondage_rate_limits (
  key text primary key,
  hits int not null,
  reset_at timestamptz not null
);

-- ---------------------------------------------------------------------------
-- Fonctions
-- ---------------------------------------------------------------------------

-- Rôle du compte connecté : 'admin', 'staff' ou null. security definer pour lire
-- sondage_staff sans dépendre de ses propres règles RLS (évite la récursion).
create or replace function public.sondage_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.sondage_staff where user_id = auth.uid()
$$;
revoke execute on function public.sondage_role() from public, anon;
grant execute on function public.sondage_role() to authenticated, service_role;

-- Compte une tentative et renvoie le nombre de tentatives dans la fenêtre en cours.
create or replace function public.sondage_hit_rate_limit(p_key text, p_window_seconds int)
returns int
language sql
volatile
set search_path = ''
as $$
  insert into public.sondage_rate_limits as r (key, hits, reset_at)
  values (p_key, 1, now() + make_interval(secs => p_window_seconds))
  on conflict (key) do update
    set hits = case when r.reset_at < now() then 1 else r.hits + 1 end,
        reset_at = case when r.reset_at < now() then now() + make_interval(secs => p_window_seconds) else r.reset_at end
  returning hits
$$;
revoke execute on function public.sondage_hit_rate_limit(text, int) from public, anon, authenticated;
grant execute on function public.sondage_hit_rate_limit(text, int) to service_role;

-- ---------------------------------------------------------------------------
-- Sécurité par ligne (RLS)
-- ---------------------------------------------------------------------------

alter table public.sondage_polls enable row level security;
alter table public.sondage_settings enable row level security;
alter table public.sondage_participants enable row level security;
alter table public.sondage_votes enable row level security;
alter table public.sondage_reward_codes enable row level security;
alter table public.sondage_staff enable row level security;
alter table public.sondage_rate_limits enable row level security;

-- Aucun accès pour les visiteurs non connectés, sur aucune table
revoke all on public.sondage_polls, public.sondage_settings, public.sondage_participants,
  public.sondage_votes, public.sondage_reward_codes, public.sondage_staff, public.sondage_rate_limits
  from anon;
-- Les comptes connectés passent ensuite par les règles ci-dessous ; rate_limits reste réservé au serveur
revoke all on public.sondage_rate_limits from authenticated;

-- Sondages : lecture admin et staff (le staff voit la question liée à une récompense), écriture admin
drop policy if exists "sondage_polls_read" on public.sondage_polls;
create policy "sondage_polls_read" on public.sondage_polls
  for select to authenticated using ((select public.sondage_role()) in ('admin', 'staff'));
drop policy if exists "sondage_polls_admin" on public.sondage_polls;
create policy "sondage_polls_admin" on public.sondage_polls
  for all to authenticated
  using ((select public.sondage_role()) = 'admin')
  with check ((select public.sondage_role()) = 'admin');

-- Réglages : admin uniquement
drop policy if exists "sondage_settings_admin" on public.sondage_settings;
create policy "sondage_settings_admin" on public.sondage_settings
  for all to authenticated
  using ((select public.sondage_role()) = 'admin')
  with check ((select public.sondage_role()) = 'admin');

-- Votants : l'admin voit et gère tout le monde ; le staff ne voit que les personnes
-- qui ont une récompense (nom et formation affichés au moment de la remise)
drop policy if exists "sondage_participants_admin" on public.sondage_participants;
create policy "sondage_participants_admin" on public.sondage_participants
  for all to authenticated
  using ((select public.sondage_role()) = 'admin')
  with check ((select public.sondage_role()) = 'admin');
drop policy if exists "sondage_participants_staff" on public.sondage_participants;
create policy "sondage_participants_staff" on public.sondage_participants
  for select to authenticated using (
    (select public.sondage_role()) = 'staff'
    and exists (select 1 from public.sondage_reward_codes c where c.participant_id = sondage_participants.id)
  );

-- Votes : admin uniquement
drop policy if exists "sondage_votes_admin" on public.sondage_votes;
create policy "sondage_votes_admin" on public.sondage_votes
  for all to authenticated
  using ((select public.sondage_role()) = 'admin')
  with check ((select public.sondage_role()) = 'admin');

-- Récompenses : admin et staff lisent ; les deux peuvent valider une remise
drop policy if exists "sondage_rewards_read" on public.sondage_reward_codes;
create policy "sondage_rewards_read" on public.sondage_reward_codes
  for select to authenticated using ((select public.sondage_role()) in ('admin', 'staff'));
drop policy if exists "sondage_rewards_redeem" on public.sondage_reward_codes;
create policy "sondage_rewards_redeem" on public.sondage_reward_codes
  for update to authenticated
  using ((select public.sondage_role()) in ('admin', 'staff'))
  with check ((select public.sondage_role()) in ('admin', 'staff'));
drop policy if exists "sondage_rewards_admin_delete" on public.sondage_reward_codes;
create policy "sondage_rewards_admin_delete" on public.sondage_reward_codes
  for delete to authenticated using ((select public.sondage_role()) = 'admin');
-- Une remise ne modifie que ces deux colonnes : impossible de réattribuer un code
revoke insert, update on public.sondage_reward_codes from authenticated;
grant update (redeemed_at, redeemed_by) on public.sondage_reward_codes to authenticated;

-- Équipe : chacun lit sa propre ligne ; l'admin gère l'équipe
drop policy if exists "sondage_staff_self" on public.sondage_staff;
create policy "sondage_staff_self" on public.sondage_staff
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "sondage_staff_admin" on public.sondage_staff;
create policy "sondage_staff_admin" on public.sondage_staff
  for all to authenticated
  using ((select public.sondage_role()) = 'admin')
  with check ((select public.sondage_role()) = 'admin');

-- ---------------------------------------------------------------------------
-- Sondages de l'AG (créés une seule fois)
-- ---------------------------------------------------------------------------

insert into public.sondage_polls (id, position, kind, question, options, category) values
  ('ag-roles', 1, 'choice', 'Quel rôle voudrais-tu prendre ou soutenir ?',
    '[{"id":"0","label":"Événementiel"},{"id":"1","label":"Communication"},{"id":"2","label":"Partenariats"},{"id":"3","label":"Respo projets"},{"id":"4","label":"Chargé·e de projet"},{"id":"5","label":"Autre"}]', 'Idées'),
  ('ag-event', 2, 'text', 'Quel type d''événement manque au BDE ?', '[]', 'Idées'),
  ('ag-comm', 3, 'text', 'Comment mieux communiquer avec tous les étudiants ?', '[]', 'Idées'),
  ('ag-vote-roles', 4, 'choice', 'Valides-tu les nouveaux rôles hors bureau ?',
    '[{"id":"0","label":"Pour"},{"id":"1","label":"Contre"},{"id":"2","label":"Abstention"}]', 'Votes AG'),
  ('ag-vote-projets', 5, 'choice', 'Valides-tu l''organisation par projets (respo projets + chargé·e·s de projet) ?',
    '[{"id":"0","label":"Pour"},{"id":"1","label":"Contre"},{"id":"2","label":"Abstention"}]', 'Votes AG'),
  ('ag-vote-whatsapp', 6, 'choice', 'Valides-tu la nouvelle communauté WhatsApp ?',
    '[{"id":"0","label":"Pour"},{"id":"1","label":"Contre"},{"id":"2","label":"Abstention"}]', 'Votes AG')
on conflict (id) do nothing;
