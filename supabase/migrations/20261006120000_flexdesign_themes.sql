-- Flexdesign : thèmes (couleurs, polices) que chaque appli de la suite peut adopter si elle le veut.
--
--   design_fonts          Polices disponibles : copiées du catalogue Google Fonts (via Fontsource) ou
--                         envoyées par l'équipe (licence détenue, cochée à l'envoi).
--   design_font_files     Fichiers de chaque police (graisse, style, sous-ensemble) dans le bucket public
--                         design-fonts. Chemins et noms de famille générés par Flexdesign, jamais saisis.
--   design_themes         Thèmes : nom, variante sombre ou non.
--   design_theme_colors   Couleurs d'un thème : 12 rôles fixes par mode, jusqu'à 24 couleurs nommées
--                         (une seule valeur pour les deux modes), nuances calculées par Flexdesign.
--   design_theme_fonts    Police de chaque rôle d'un thème (titre, texte, accent, chasse fixe).
--   design_save_theme()   Enregistre un thème avec toutes ses couleurs et polices, en une transaction.
--
-- Droits : lecture publique (visiteurs compris : les applis qui se lient à un thème le lisent avec la clé
-- anon) ; écriture réservée aux admins Flexdesign et aux super admins. Le staff Flexdesign lit seulement.
--
-- Erreurs renvoyées par design_save_theme (PostgREST traduit PTxxx en statut HTTP xxx) :
--   PT403 'Réservé aux admins de Flexdesign.'
--   PT404 'Thème introuvable.'
--   PT400 'Il manque des couleurs : chaque rôle doit en avoir une.' / '24 couleurs nommées au maximum.'

-- ---------------------------------------------------------------------------
-- Polices
-- ---------------------------------------------------------------------------

create table if not exists public.design_fonts (
  id uuid primary key default gen_random_uuid(),
  -- Nom de famille utilisé dans le CSS : celui du catalogue, ou généré pour une police envoyée
  family text not null unique check (family ~ '^[A-Za-z0-9][A-Za-z0-9 ]{0,62}$'),
  -- Nom affiché dans Flexdesign (saisi pour une police envoyée) : jamais utilisé dans du CSS
  label text not null check (char_length(label) between 1 and 80),
  source text not null check (source in ('catalog', 'upload')),
  catalog_id text unique check (catalog_id ~ '^[a-z0-9-]{1,80}$'),
  category text not null check (category in ('sans-serif', 'serif', 'display', 'handwriting', 'monospace', 'other')),
  -- 'own' : police envoyée, l'admin a coché « je détiens la licence »
  license text not null check (license in ('OFL-1.1', 'Apache-2.0', 'UFL-1.0', 'own')),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((source = 'catalog') = (catalog_id is not null)),
  check ((source = 'upload') = (license = 'own'))
);

create table if not exists public.design_font_files (
  id uuid primary key default gen_random_uuid(),
  font_id uuid not null references public.design_fonts (id) on delete cascade,
  weight int not null check (weight between 100 and 900 and weight % 100 = 0),
  style text not null check (style in ('normal', 'italic')),
  -- Sous-ensemble du catalogue (ex. latin) et sa plage Unicode ; null pour une police envoyée (fichier complet)
  subset text check (subset ~ '^[a-z0-9-]{1,40}$'),
  unicode_range text check (unicode_range ~ '^U\+[0-9A-Fa-f?]{1,6}(-[0-9A-Fa-f]{1,6})?(,U\+[0-9A-Fa-f?]{1,6}(-[0-9A-Fa-f]{1,6})?)*$'),
  format text not null check (format in ('woff2', 'woff', 'truetype', 'opentype')),
  -- Chemin dans le bucket design-fonts : <id de la police>/<nom généré>.<extension>
  path text not null unique check (path ~ '^[0-9a-f-]{36}/[a-z0-9-]{1,80}\.(woff2|woff|ttf|otf)$'),
  unique nulls not distinct (font_id, weight, style, subset)
);

-- ---------------------------------------------------------------------------
-- Thèmes
-- ---------------------------------------------------------------------------

create table if not exists public.design_themes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 60),
  has_dark boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.design_theme_colors (
  theme_id uuid not null references public.design_themes (id) on delete cascade,
  mode text not null check (mode in ('light', 'dark')),
  kind text not null check (kind in ('role', 'named', 'derived')),
  name text not null,
  -- Toujours #rrggbb en minuscules : chaque appli revérifie à la lecture avant de l'utiliser
  hex text not null check (hex ~ '^#[0-9a-f]{6}$'),
  position int not null default 0,
  primary key (theme_id, mode, name),
  check (kind <> 'role' or name in ('background', 'surface', 'text', 'muted', 'border', 'primary', 'onPrimary',
                                    'accent', 'onAccent', 'success', 'warning', 'danger')),
  check (kind <> 'derived' or name in ('primaryHover', 'primarySoft', 'accentHover', 'accentSoft', 'successHover',
                                       'successSoft', 'warningHover', 'warningSoft', 'dangerHover', 'dangerSoft')),
  check (kind <> 'named' or (mode = 'light' and name ~ '^[a-z][a-z0-9-]{0,31}$'))
);

create table if not exists public.design_theme_fonts (
  theme_id uuid not null references public.design_themes (id) on delete cascade,
  role text not null check (role in ('heading', 'body', 'accent', 'mono')),
  -- Une police utilisée par un thème ne peut pas être supprimée
  font_id uuid not null references public.design_fonts (id) on delete restrict,
  fallback text not null check (fallback in ('sans-serif', 'serif', 'monospace', 'cursive', 'system-ui')),
  primary key (theme_id, role)
);
create index if not exists design_theme_fonts_font_id on public.design_theme_fonts (font_id);

-- ---------------------------------------------------------------------------
-- Sécurité par ligne : lecture publique, écriture admin Flexdesign
-- ---------------------------------------------------------------------------

alter table public.design_fonts enable row level security;
alter table public.design_font_files enable row level security;
alter table public.design_themes enable row level security;
alter table public.design_theme_colors enable row level security;
alter table public.design_theme_fonts enable row level security;

revoke insert, update, delete, truncate on public.design_fonts, public.design_font_files, public.design_themes,
  public.design_theme_colors, public.design_theme_fonts from anon;

drop policy if exists "design_fonts_read" on public.design_fonts;
create policy "design_fonts_read" on public.design_fonts for select using (true);
drop policy if exists "design_fonts_admin_write" on public.design_fonts;
create policy "design_fonts_admin_write" on public.design_fonts
  for all to authenticated
  using ((select public.suite_has_app_role('flexdesign', array['admin'])))
  with check ((select public.suite_has_app_role('flexdesign', array['admin'])));

drop policy if exists "design_font_files_read" on public.design_font_files;
create policy "design_font_files_read" on public.design_font_files for select using (true);
drop policy if exists "design_font_files_admin_write" on public.design_font_files;
create policy "design_font_files_admin_write" on public.design_font_files
  for all to authenticated
  using ((select public.suite_has_app_role('flexdesign', array['admin'])))
  with check ((select public.suite_has_app_role('flexdesign', array['admin'])));

drop policy if exists "design_themes_read" on public.design_themes;
create policy "design_themes_read" on public.design_themes for select using (true);
drop policy if exists "design_themes_admin_write" on public.design_themes;
create policy "design_themes_admin_write" on public.design_themes
  for all to authenticated
  using ((select public.suite_has_app_role('flexdesign', array['admin'])))
  with check ((select public.suite_has_app_role('flexdesign', array['admin'])));

drop policy if exists "design_theme_colors_read" on public.design_theme_colors;
create policy "design_theme_colors_read" on public.design_theme_colors for select using (true);
drop policy if exists "design_theme_colors_admin_write" on public.design_theme_colors;
create policy "design_theme_colors_admin_write" on public.design_theme_colors
  for all to authenticated
  using ((select public.suite_has_app_role('flexdesign', array['admin'])))
  with check ((select public.suite_has_app_role('flexdesign', array['admin'])));

drop policy if exists "design_theme_fonts_read" on public.design_theme_fonts;
create policy "design_theme_fonts_read" on public.design_theme_fonts for select using (true);
drop policy if exists "design_theme_fonts_admin_write" on public.design_theme_fonts;
create policy "design_theme_fonts_admin_write" on public.design_theme_fonts
  for all to authenticated
  using ((select public.suite_has_app_role('flexdesign', array['admin'])))
  with check ((select public.suite_has_app_role('flexdesign', array['admin'])));

-- ---------------------------------------------------------------------------
-- Enregistrement d'un thème
-- ---------------------------------------------------------------------------

-- p_theme : { id (absent = nouveau thème), name, has_dark, colors: [{ mode, kind, name, hex, position }],
--             fonts: [{ role, font_id, fallback }] }. Remplace toutes les couleurs et polices du thème.
-- security invoker : la RLS s'applique avec le jeton de l'admin, comme pour une écriture directe.
create or replace function public.design_save_theme(p_theme jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := nullif(p_theme->>'id', '')::uuid;
  v_dark boolean := coalesce((p_theme->>'has_dark')::boolean, false);
begin
  if not public.suite_has_app_role('flexdesign', array['admin']) then
    raise sqlstate 'PT403' using message = 'Réservé aux admins de Flexdesign.';
  end if;

  if v_id is null then
    insert into public.design_themes (name, has_dark) values (p_theme->>'name', v_dark) returning id into v_id;
  else
    update public.design_themes set name = p_theme->>'name', has_dark = v_dark, updated_at = now() where id = v_id;
    if not found then
      raise sqlstate 'PT404' using message = 'Thème introuvable.';
    end if;
    delete from public.design_theme_colors where theme_id = v_id;
    delete from public.design_theme_fonts where theme_id = v_id;
  end if;

  insert into public.design_theme_colors (theme_id, mode, kind, name, hex, position)
  select v_id, c.mode, c.kind, c.name, c.hex, coalesce(c.position, 0)
  from jsonb_to_recordset(coalesce(p_theme->'colors', '[]'::jsonb)) as c(mode text, kind text, name text, hex text, position int);

  insert into public.design_theme_fonts (theme_id, role, font_id, fallback)
  select v_id, f.role, f.font_id, f.fallback
  from jsonb_to_recordset(coalesce(p_theme->'fonts', '[]'::jsonb)) as f(role text, font_id uuid, fallback text);

  -- Les 12 rôles en clair ; en sombre, les 12 si la variante existe, aucune couleur sinon
  if (select count(*) from public.design_theme_colors where theme_id = v_id and mode = 'light' and kind = 'role') <> 12
     or (select count(*) from public.design_theme_colors where theme_id = v_id and mode = 'dark' and kind = 'role') <> 12 * v_dark::int
     or (not v_dark and exists (select 1 from public.design_theme_colors where theme_id = v_id and mode = 'dark')) then
    raise sqlstate 'PT400' using message = 'Il manque des couleurs : chaque rôle doit en avoir une.';
  end if;
  if (select count(*) from public.design_theme_colors where theme_id = v_id and kind = 'named') > 24 then
    raise sqlstate 'PT400' using message = '24 couleurs nommées au maximum.';
  end if;

  return v_id;
end;
$$;
revoke execute on function public.design_save_theme(jsonb) from public, anon;
grant execute on function public.design_save_theme(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Stockage : bucket public des polices
-- ---------------------------------------------------------------------------
-- Public : les applis liées chargent les fichiers sans compte (aucun appel à Google depuis le navigateur
-- des visiteurs). Écriture, liste et suppression réservées aux admins Flexdesign. 2 Mo max par fichier.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('design-fonts', 'design-fonts', true, 2097152, array['font/woff2', 'font/woff', 'font/ttf', 'font/otf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "design_fonts_bucket_admin_read" on storage.objects;
create policy "design_fonts_bucket_admin_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'design-fonts' and (select public.suite_has_app_role('flexdesign', array['admin'])));

drop policy if exists "design_fonts_bucket_admin_insert" on storage.objects;
create policy "design_fonts_bucket_admin_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'design-fonts' and (select public.suite_has_app_role('flexdesign', array['admin'])));

drop policy if exists "design_fonts_bucket_admin_update" on storage.objects;
create policy "design_fonts_bucket_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'design-fonts' and (select public.suite_has_app_role('flexdesign', array['admin'])))
  with check (bucket_id = 'design-fonts' and (select public.suite_has_app_role('flexdesign', array['admin'])));

drop policy if exists "design_fonts_bucket_admin_delete" on storage.objects;
create policy "design_fonts_bucket_admin_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'design-fonts' and (select public.suite_has_app_role('flexdesign', array['admin'])));
