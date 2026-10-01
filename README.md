# Flexstaff

Gestion de l'équipe et des droits de **Flex Suite**, les applications qui partagent un même projet Supabase :

| Appli | Dépôt | Rôle |
|---|---|---|
| Flexfolio | `void19845/flexfolio` | Portfolio et son administration |
| Flexform | `void19845/flexform` | Sondages du BDE Montreuil |
| Flexstaff | ce dépôt | Ajouter du staff, transmettre le rôle admin, et socle commun de la base |

Ce dépôt contient :

- **tout le SQL de la base** partagée (`supabase/migrations/`) : tables de chaque appli, règles de
  sécurité et droits communs. Les autres dépôts ne contiennent pas de schéma ;
- les scripts de gestion des comptes (`npm run role`) et de test des droits (`npm run test:rls`) ;
- l'appli Flexstaff (à venir) : ajouter du staff et transmettre le rôle admin depuis une interface.

## Droits

| Table | Contenu | Qui peut la modifier |
|---|---|---|
| `suite_super_admins` | Le ou les vrais admins de toute la suite : admins de toutes les applis | Personne depuis une appli : uniquement en SQL |
| `suite_apps` | Les applis de la suite (`flexfolio`, `flexform`...) | Uniquement en SQL (migration) |
| `app_roles` | Rôle `admin` ou `staff` d'un compte dans une appli | L'admin de cette appli, ou un super admin |

Les règles RLS de chaque appli appellent `suite_has_app_role('appli', array['admin'])` (ou `staff`). C'est
la base qui décide : une appli ne peut pas donner plus de droits que ceux de son admin, ni créer de super admin.

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
(visiteur, staff et admin Flexform, admin Flexfolio, super admin). Il refuse de tourner sur une autre
base que la base locale. `npm run db:reset` repart d'une base vide, `npm run db:stop` l'arrête.

## Nouvelle appli

1. Une migration qui ajoute l'appli à `suite_apps` et ses tables, avec des règles RLS basées sur
   `suite_has_app_role('nouvelle-appli', ...)`.
2. Ses règles dans `scripts/rls-e2e.mjs` (au moins un cas refusé par règle).
3. Son propre dépôt, cloné dans le dossier Flex Suite à côté des autres.
