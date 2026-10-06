/**
 * Importe un export Flexfolio (dossier « flexfolio-pour-ami ») dans la base de la suite : projets, images
 * des projets, réglages du site, et les fichiers du bucket project-images.
 *
 *   node --env-file=.env scripts/import-flexfolio.mjs <dossier> [--apply] [--images-only]
 *
 * <dossier> contient base-public.sql, base-storage.sql et le contenu décompressé de
 * supabase-storage-*.tgz (tar -xzf supabase-storage-*.tgz, dans <dossier>).
 * Sans --apply : rien n'est écrit, le script vérifie l'export et la base cible et affiche ce qu'il ferait.
 * --images-only : n'envoie que les fichiers (quand les lignes sont importées autrement, par un fichier SQL).
 *
 * On n'exécute PAS les fichiers SQL de l'export : base-public.sql recrée le schéma avec les anciennes règles
 * (tout compte connecté peut modifier le portfolio), et base-storage.sql vise une autre version de Storage.
 * Ici, seules les données sont reprises, dans les tables créées par le schéma de ce dépôt :
 *   - les fichiers sont envoyés par l'API Storage (marche sur Supabase hébergé comme auto-hébergé) ;
 *   - les adresses des images sont réécrites vers la base cible ;
 *   - projets et images : ajoutés ou mis à jour par id (relancer le script ne crée pas de doublon) ;
 *   - réglages du site : la ligne unique est mise à jour, sans les anciennes colonnes cv_* (inutilisées).
 *
 * Utilise la clé service_role (SUPABASE_SERVICE_ROLE_KEY dans .env) : à lancer sur ton poste, jamais ailleurs.
 * Adresse publique des images : NEXT_PUBLIC_SUPABASE_URL, sinon SUPABASE_URL.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const imagesOnly = args.includes("--images-only");
const dir = args.find((a) => !a.startsWith("--"));
const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL)?.replace(/\/+$/, "");
const publicUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL)?.replace(/\/+$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!dir) {
  console.error("Usage : node --env-file=.env scripts/import-flexfolio.mjs <dossier> [--apply] [--images-only]");
  process.exit(1);
}
if (!url || !key) {
  console.error("Définis SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY (dans .env).");
  process.exit(1);
}

const BUCKET = "project-images";
const STORAGE_DIR = join(dir, "flexfolio-supabase", "volumes", "storage", "stub", "stub", BUCKET);
// Colonnes de l'ancien schéma supprimées depuis (voir 20260901000000_flexfolio.sql)
const DROPPED_COLUMNS = ["cv_experience", "cv_education", "cv_skills", "cv_software", "cv_languages"];

// --- Lecture des blocs COPY de pg_dump (format texte) ---------------------

/** Décode un champ COPY : \N = null, puis les échappements \t, \n, \\... */
function unescapeField(field) {
  if (field === "\\N") return null;
  return field.replace(/\\(?:([0-7]{1,3})|x([0-9a-fA-F]{1,2})|(.))/g, (_, oct, hex, ch) => {
    if (oct) return String.fromCharCode(parseInt(oct, 8));
    if (hex) return String.fromCharCode(parseInt(hex, 16));
    return { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v" }[ch] ?? ch;
  });
}

/** Lignes du bloc « COPY <table> (colonnes) FROM stdin; ... \. », en objets { colonne: texte | null }. */
function copyRows(sql, table) {
  const start = sql.match(new RegExp(`^COPY ${table.replace(".", "\\.")} \\(([^)]*)\\) FROM stdin;$`, "m"));
  if (!start) throw new Error(`Bloc COPY introuvable pour ${table}`);
  const columns = start[1].split(", ");
  const body = sql.slice(start.index + start[0].length + 1);
  const lines = body.slice(0, body.search(/^\\\.$/m)).split("\n").filter((l) => l !== "");
  return lines.map((line) => Object.fromEntries(line.split("\t").map((f, i) => [columns[i], unescapeField(f)])));
}

/** Tableau Postgres en texte ({a,"b c"}) vers tableau JS. */
function pgArray(text) {
  const inner = text.slice(1, -1);
  const out = [];
  let i = 0;
  while (i < inner.length) {
    let value = "";
    if (inner[i] === '"') {
      i++;
      while (inner[i] !== '"') {
        if (inner[i] === "\\") i++;
        value += inner[i++];
      }
      i++;
    } else {
      while (i < inner.length && inner[i] !== ",") value += inner[i++];
    }
    out.push(value);
    i++; // virgule
  }
  return out;
}

const toBool = (v) => (v === null ? null : v === "t");
const toInt = (v) => (v === null ? null : Number(v));

// --- Appels à Supabase ----------------------------------------------------

const headers = { apikey: key, Authorization: `Bearer ${key}` };

async function call(path, init = {}) {
  const res = await fetch(`${url}${path}`, { ...init, headers: { ...headers, ...init.headers } });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new Error(`${res.status} ${body?.message ?? body?.msg ?? text}`);
  return body;
}

const json = (body, extra = {}) => ({ body: JSON.stringify(body), headers: { "Content-Type": "application/json", ...extra } });
const objectPath = (name) => name.split("/").map(encodeURIComponent).join("/");

// Pas de process.exit() juste après une requête : sous Windows, Node peut planter en fermant la connexion.
async function main() {
  const publicSql = readFileSync(join(dir, "base-public.sql"), "utf8");
  const storageSql = readFileSync(join(dir, "base-storage.sql"), "utf8");

  // 1. Export : lecture et contrôles
  const projects = copyRows(publicSql, "public.projects").map((r) => ({
    ...r,
    tech_stack: r.tech_stack === null ? [] : pgArray(r.tech_stack),
    is_visible: toBool(r.is_visible),
    display_order: toInt(r.display_order),
  }));
  const images = copyRows(publicSql, "public.project_images").map((r) => ({
    ...r,
    sort_order: toInt(r.sort_order),
    is_featured: toBool(r.is_featured),
  }));
  const [settingsRow] = copyRows(publicSql, "public.site_settings");
  const objects = copyRows(storageSql, "storage.objects")
    .filter((o) => o.bucket_id === BUCKET)
    .map((o) => ({ name: o.name, version: o.version, mimetype: JSON.parse(o.metadata ?? "{}").mimetype }));

  const missingFiles = objects.filter((o) => !existsSync(join(STORAGE_DIR, o.name, o.version)));
  if (missingFiles.length) {
    throw new Error(`Fichiers absents (décompresser supabase-storage-*.tgz dans ${dir}) : ${missingFiles.map((o) => o.name).join(", ")}`);
  }

  // Ancienne adresse des fichiers, déduite des données
  const oldPrefix = publicSql.match(new RegExp(`https?://[^\\s\\t]+?/storage/v1/object/public/${BUCKET}/`))?.[0];
  const newPrefix = `${publicUrl}/storage/v1/object/public/${BUCKET}/`;
  const rewrite = (v) => (typeof v === "string" && oldPrefix ? v.split(oldPrefix).join(newPrefix) : v);
  const names = new Set(objects.flatMap((o) => [o.name, encodeURI(o.name)]));
  const urls = [...publicSql.matchAll(/https?:\/\/[^\s\t"\\]+/g)].map((m) => m[0]).filter((u) => oldPrefix && u.startsWith(oldPrefix));
  const dangling = urls.filter((u) => !names.has(u.slice(oldPrefix.length)) && !names.has(decodeURIComponent(u.slice(oldPrefix.length))));

  const settings = Object.fromEntries(
    Object.entries(settingsRow)
      .filter(([k]) => k !== "id" && k !== "updated_at" && !DROPPED_COLUMNS.includes(k))
      .map(([k, v]) => [k, ["about_paragraphs", "social_links"].includes(k) && v !== null ? JSON.parse(v) : rewrite(v)]),
  );
  const droppedWithData = DROPPED_COLUMNS.filter((c) => settingsRow[c] !== null && settingsRow[c] !== undefined && !["[]", "{}", ""].includes(settingsRow[c]));

  // 2. Base cible : contrôles
  const existing = await call(`/rest/v1/projects?select=id,slug`);
  const exportIds = new Set(projects.map((p) => p.id));
  const slugConflicts = existing.filter((e) => !exportIds.has(e.id) && projects.some((p) => p.slug === e.slug));
  const bucket = await call(`/storage/v1/bucket/${BUCKET}`).catch(() => null);

  console.log(`Export : ${projects.length} projets, ${images.length} images de projets, réglages du site, ${objects.length} fichiers.`);
  console.log(`Base cible : ${url}`);
  console.log(`Adresses des images : ${oldPrefix ?? "(aucune)"} -> ${newPrefix} (${urls.length} adresses)`);
  if (dangling.length) console.log(`Attention : ${dangling.length} adresse(s) sans fichier dans l'export :\n  ${dangling.join("\n  ")}`);
  if (droppedWithData.length) console.log(`Ignorées (colonnes supprimées du schéma) : ${droppedWithData.join(", ")}`);
  console.log(`Projets déjà présents dans la cible : ${existing.length} (${existing.filter((e) => exportIds.has(e.id)).length} seront mis à jour)`);
  if (!bucket) console.log(`Erreur : le bucket ${BUCKET} n'existe pas dans la cible (appliquer supabase/setup.sql).`);
  if (slugConflicts.length) console.log(`Erreur : slug déjà pris par un autre projet : ${slugConflicts.map((c) => c.slug).join(", ")}`);
  if (!bucket || slugConflicts.length) {
    process.exitCode = 1;
    return;
  }
  if (!apply) {
    console.log(`\nRien n'a été écrit. Relance avec --apply pour importer${imagesOnly ? " les fichiers" : ""}.`);
    return;
  }

  // 3. Import : fichiers d'abord, pour que les adresses fonctionnent dès que les lignes existent
  for (const o of objects) {
    await call(`/storage/v1/object/${BUCKET}/${objectPath(o.name)}`, {
      method: "POST",
      body: readFileSync(join(STORAGE_DIR, o.name, o.version)),
      headers: { "Content-Type": o.mimetype ?? "application/octet-stream", "x-upsert": "true" },
    });
  }
  console.log(`${objects.length} fichiers envoyés.`);
  if (imagesOnly) return;

  await call(`/rest/v1/projects?on_conflict=id`, { method: "POST", ...json(projects, { Prefer: "resolution=merge-duplicates,return=minimal" }) });
  console.log(`${projects.length} projets importés.`);
  await call(`/rest/v1/project_images?on_conflict=id`, {
    method: "POST",
    ...json(images.map((i) => ({ ...i, image_url: rewrite(i.image_url) })), { Prefer: "resolution=merge-duplicates,return=minimal" }),
  });
  console.log(`${images.length} images de projets importées.`);
  await call(`/rest/v1/site_settings?on_conflict=id`, { method: "POST", ...json({ id: 1, ...settings }, { Prefer: "resolution=merge-duplicates,return=minimal" }) });
  console.log("Réglages du site importés.");
}

main().catch((err) => {
  console.error(`Échec : ${err.message}`);
  process.exitCode = 1;
});
