-- Flexform : fin du lien d'apparence avec Flexfolio.
--
--   sondage_settings.theme_linked   Choix de l'admin Flexform : reprendre ou non la palette et les polices
--                                   de Flexfolio (site_settings). Flexform garde désormais son propre thème
--                                   (celui du BDE) et ne lit plus site_settings : la colonne ne sert plus.
--
-- sondage_settings reste : sa colonne active_poll_id désigne le sondage lancé en direct.
--
-- Ordre de déploiement : déployer d'abord la version de Flexform sans le lien, puis appliquer cette
-- migration. L'ancienne version lit theme_linked à chaque chargement des sondages (store.ts, loadMeta) :
-- sans la colonne, PostgREST refuse la requête et l'appli tombe en erreur.

alter table public.sondage_settings drop column if exists theme_linked;
