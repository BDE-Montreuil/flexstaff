-- Flexdesign : nouvelle appli de la suite (design system, studio de visuels, moodboards).
--
-- Pour l'instant, seulement son inscription dans suite_apps : ses admins et son staff se gèrent dans
-- app_roles (Flexstaff ou npm run role), et ses futures tables appelleront
-- suite_has_app_role('flexdesign', ...) dans leurs règles RLS.

insert into public.suite_apps (app, name) values
  ('flexdesign', 'Flexdesign')
on conflict (app) do nothing;
