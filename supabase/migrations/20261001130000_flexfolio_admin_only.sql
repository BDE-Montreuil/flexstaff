-- Flexfolio : seuls ses admins (app_roles flexfolio/admin) et les super admins modifient le portfolio
-- ou voient les projets masqués. Avant, tout compte connecté du projet Supabase le pouvait, y compris
-- les comptes staff des autres applis de la suite.
--
-- À appliquer après 20261001120000_suite_roles.sql, et avec un super admin (ou un admin Flexfolio)
-- déjà créé : sinon plus personne ne peut modifier le portfolio.

-- projects : le public voit les projets visibles, l'admin tout
drop policy if exists "projects_select" on public.projects;
create policy "projects_select" on public.projects
  for select using (is_visible = true or (select public.suite_has_app_role('flexfolio', array['admin'])));

drop policy if exists "projects_insert" on public.projects;
create policy "projects_insert" on public.projects
  for insert to authenticated with check ((select public.suite_has_app_role('flexfolio', array['admin'])));

drop policy if exists "projects_update" on public.projects;
create policy "projects_update" on public.projects
  for update to authenticated
  using ((select public.suite_has_app_role('flexfolio', array['admin'])))
  with check ((select public.suite_has_app_role('flexfolio', array['admin'])));

drop policy if exists "projects_delete" on public.projects;
create policy "projects_delete" on public.projects
  for delete to authenticated using ((select public.suite_has_app_role('flexfolio', array['admin'])));

-- project_images : suit la visibilité du projet parent
drop policy if exists "project_images_select" on public.project_images;
create policy "project_images_select" on public.project_images
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = project_images.project_id
        and (p.is_visible = true or (select public.suite_has_app_role('flexfolio', array['admin'])))
    )
  );

drop policy if exists "project_images_insert" on public.project_images;
create policy "project_images_insert" on public.project_images
  for insert to authenticated with check ((select public.suite_has_app_role('flexfolio', array['admin'])));

drop policy if exists "project_images_update" on public.project_images;
create policy "project_images_update" on public.project_images
  for update to authenticated
  using ((select public.suite_has_app_role('flexfolio', array['admin'])))
  with check ((select public.suite_has_app_role('flexfolio', array['admin'])));

drop policy if exists "project_images_delete" on public.project_images;
create policy "project_images_delete" on public.project_images
  for delete to authenticated using ((select public.suite_has_app_role('flexfolio', array['admin'])));

-- site_settings : lecture publique, écriture admin
drop policy if exists "site_settings_update" on public.site_settings;
create policy "site_settings_update" on public.site_settings
  for update to authenticated
  using ((select public.suite_has_app_role('flexfolio', array['admin'])))
  with check ((select public.suite_has_app_role('flexfolio', array['admin'])));

-- Stockage : lecture publique du bucket, écriture admin
drop policy if exists "project_images_bucket_auth_insert" on storage.objects;
create policy "project_images_bucket_auth_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'project-images' and (select public.suite_has_app_role('flexfolio', array['admin'])));

drop policy if exists "project_images_bucket_auth_update" on storage.objects;
create policy "project_images_bucket_auth_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'project-images' and (select public.suite_has_app_role('flexfolio', array['admin'])));

drop policy if exists "project_images_bucket_auth_delete" on storage.objects;
create policy "project_images_bucket_auth_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'project-images' and (select public.suite_has_app_role('flexfolio', array['admin'])));
