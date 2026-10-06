# Flexstaff

Gestion de l'équipe et des droits de **Flex Suite**, les applications qui partagent un même projet Supabase :

| Appli | Dépôt | Rôle |
|---|---|---|
| Flexfolio | `void19845/flexfolio` | Portfolio et son administration |
| Flexform | `void19845/flexform` | Sondages du BDE Montreuil |
| Flexdesign | `void19845/flexdesign` | Design system, studio de visuels et moodboards (en construction) |
| Flexstaff | ce dépôt | Ajouter du staff, transmettre le rôle admin, et socle commun de la base |

Ce dépôt contient :

- **tout le SQL de la base** partagée (`supabase/migrations/`) : tables de chaque appli, règles de
  sécurité et droits communs. Les autres dépôts ne contiennent pas de schéma ;
- les scripts de gestion des comptes (`npm run role`) et de test des droits (`npm run test:rls`) ;
- l'appli Flexstaff : ajouter du staff et transmettre le rôle admin depuis une interface.

## Droits

| Table | Contenu | Qui peut la modifier |
|---|---|---|
| `suite_super_admins` | Le ou les vrais admins de toute la suite : admins de toutes les applis | Personne depuis une appli : uniquement en SQL |
| `suite_apps` | Les applis de la suite (`flexfolio`, `flexform`...) | Uniquement en SQL (migration) |
| `app_roles` | Rôle `admin` ou `staff` d'un compte dans une appli | L'admin de cette appli, ou un super admin |

Les règles RLS de chaque appli appellent `suite_has_app_role('appli', array['admin'])` (ou `staff`). C'est
la base qui décide : une appli ne peut pas donner plus de droits que ceux de son admin, ni créer de super admin.

Thèmes de Flexdesign (`design_themes`, `design_theme_colors`, `design_theme_fonts`, `design_fonts`,
`design_font_files`, fonction `design_save_theme`, bucket public `design-fonts`) : lecture publique, visiteurs
compris (les applis qui se lient à un thème le lisent avec la clé anon) ; écriture réservée aux admins de
Flexdesign et aux super admins. Le staff Flexdesign lit seulement.

## Mettre en place la base de production

1. Appliquer les migrations de `supabase/migrations/`, dans l'ordre : `npx supabase link` puis
   `npx supabase db push`, ou coller chaque fichier dans le SQL Editor de Supabase. Les fichiers sont
   idempotents quand il le faut (le schéma de Flexfolio déjà en place n'est pas recréé).
2. **Tout de suite après**, se déclarer super admin dans le SQL Editor (sinon plus personne ne peut
   modifier le portfolio) :

   ```sql
   insert into public.suite_super_admins (user_id)
   select id from auth.users where email = 'ton.email@exemple.fr';
   ```

3. Donner les autres rôles avec `npm run role` (ci-dessous), avec les clés de production dans `.env`.

## Gérer les comptes

```bash
npm install
npm run role -- prenom.nom@exemple.fr flexform staff
```

`admin` pour un admin, `remove` pour retirer le rôle (le compte Supabase est conservé). Un compte qui
n'existe pas est créé, avec un mot de passe provisoire affiché une seule fois. `.env` doit contenir
`SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` (clé secrète : uniquement sur ton poste).

## Importer un export Flexfolio

Un export « flexfolio-pour-ami » (`base-public.sql`, `base-storage.sql`, `supabase-storage-*.tgz`) se
reprend avec `scripts/import-flexfolio.mjs`, **jamais en exécutant ses fichiers SQL** : `base-public.sql`
recrée l'ancien schéma, où tout compte connecté peut modifier le portfolio.

```bash
cd chemin/vers/flexfolio-pour-ami
tar -xzf supabase-storage-*.tgz
cd chemin/vers/flexstaff
node --env-file=.env scripts/import-flexfolio.mjs chemin/vers/flexfolio-pour-ami
node --env-file=.env scripts/import-flexfolio.mjs chemin/vers/flexfolio-pour-ami --apply
```

Sans `--apply`, rien n'est écrit : le script vérifie l'export et la base cible (`setup.sql` appliqué, slugs
déjà pris) et affiche ce qu'il ferait. Avec `--apply`, il envoie les fichiers dans le bucket `project-images`
par l'API Storage, réécrit l'adresse des images vers `NEXT_PUBLIC_SUPABASE_URL` (sinon `SUPABASE_URL`), puis
ajoute ou met à jour projets, images et réglages du site (relancer ne crée pas de doublon). Les anciennes
colonnes `cv_*` de l'export ne sont pas reprises : le schéma actuel ne les a plus. Si les lignes sont
importées par un fichier SQL (SQL Editor de Supabase), `--images-only` n'envoie que les fichiers.

## Base locale et tests

Docker Desktop doit tourner.

```bash
npm run db:start
npx supabase status -o env
```

Copier `API_URL`, `ANON_KEY` et `SERVICE_ROLE_KEY` dans `.env` sous les noms `SUPABASE_URL`,
`SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY` (les mêmes valeurs servent aux applis en local).
Créer les comptes de test (`TEST_*` dans `.env`) avec `npm run role`, déclarer `TEST_SUPER_EMAIL` super admin
en SQL (`docker exec -i supabase_db_flexstaff psql -U postgres -c "insert ..."`), puis :

```bash
npm run test:rls
```

`scripts/rls-e2e.mjs` vérifie chaque règle directement dans la base, avec le jeton de chaque rôle
(visiteur, staff et admin Flexform, admin Flexfolio, super admin). Pour les thèmes de Flexdesign, il donne
au staff Flexform un rôle staff Flexdesign le temps du test (retiré à la fin) et vérifie : lecture publique,
écriture et `design_save_theme` refusées à tout autre qu'un admin Flexdesign, thème incomplet ou couleur
invalide refusés par la base, envoi dans `design-fonts` réservé aux admins et limité aux types de police.
Il refuse de tourner sur une autre base que la base locale. `npm run db:reset` repart d'une base vide, `npm run db:stop` l'arrête.

## L'appli Flexstaff

Réservée aux admins d'au moins une appli de la suite (un compte staff ou sans rôle est refusé à la
connexion). Chaque admin ne voit que les applis qu'il administre ; un super admin les voit toutes.

- ajouter un membre par e-mail, en `admin` ou `staff` : un compte qui n'existe pas est créé, avec un mot
  de passe provisoire affiché une seule fois ;
- promouvoir, rétrograder ou retirer un membre ;
- transmettre son rôle admin à un membre : il devient admin, l'ancien admin devient staff (un super admin
  le reste) ;
- les super admins apparaissent dans chaque équipe mais ne se gèrent qu'en SQL.

La base décide de tout avec le jeton du compte connecté (fonctions `suite_*`, RLS de `app_roles`) ; elle
refuse de retirer le dernier admin d'une appli quand aucun super admin n'existe. Les droits sont relus à
chaque requête : un admin rétrogradé perd l'accès aussitôt. La clé `service_role` ne sert qu'à créer un
compte (après vérification du rôle avec le jeton du compte) et à limiter les tentatives.

### Lancer

Avec la base locale et le `.env` décrits plus haut :

```bash
npm run dev
```

Ouvre http://localhost:8786. `npm run build` puis `npm start` pour la version de production (même port).

### Tester

Avec l'appli lancée et la base locale :

```bash
node --env-file=.env scripts/app-e2e.mjs http://localhost:8786
```

`scripts/app-e2e.mjs` vérifie chaque route (connexion, équipe, ajout, rôles, transmission), dont les cas
refusés. Il crée puis supprime un compte de test et remet les rôles comme au départ.

### Variables d'environnement

| Variable | Rôle |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Projet Supabase (les noms `NEXT_PUBLIC_*` marchent aussi) |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé serveur : création de comptes et limite de tentatives |
| `TEST_*` | Comptes de test, pour `npm run test:rls` et `scripts/app-e2e.mjs` uniquement |

## Nouvelle appli

1. Une migration qui ajoute l'appli à `suite_apps` et ses tables, avec des règles RLS basées sur
   `suite_has_app_role('nouvelle-appli', ...)`.
2. Ses règles dans `scripts/rls-e2e.mjs` (au moins un cas refusé par règle).
3. Son propre dépôt, cloné dans le dossier Flex Suite à côté des autres.
