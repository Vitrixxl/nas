# NAS

API Rust + front React servis par le meme serveur.

## Configuration

Variables utiles :

```sh
export NAS_LOGIN_PASSWORD="change-me-please"
export NAS_BIND="127.0.0.1:3000"
export NAS_DATA_DIR="./data"
export NAS_SESSION_TTL_HOURS="12"
# export NAS_PUBLIC_BASE_URL="https://nas.example.com"
```

`NAS_LOGIN_PASSWORD` est obligatoire. Le front garde le token de session dans `sessionStorage`.

## Lancer en local

```sh
cd web
bun install
bun run build
cd ..
cargo run
```

Puis ouvrir `http://127.0.0.1:3000`.

## Stockage

- `data/files` contient l'arborescence reelle des dossiers et fichiers.
- `data/preview` contient les thumbnails generees cote client.
- `data/tmp` contient les fichiers `.part` pendant les uploads streamés.
- `data/nas.sqlite` indexe les ids, chemins, metadonnees, sessions et partages.

Les uploads sont envoyes en body brut et ecrits par chunks sur disque cote API.

## Navigation et tri

- Les dossiers sont navigables par URL : `/folder/<id>?sort=name` ou `/folder/<id>?sort=date`.
- La vue globale des fichiers est disponible via `/files?sort=name` ou `/files?sort=date&q=photo`.
- Le bouton retour du navigateur revient au dossier precedent grace a React Router.
- La recherche globale est recursive et interroge les noms et chemins de fichiers indexes en SQLite.
- La barre de recherche est disponible dans les dossiers, avec un scope `scope=current` ou `scope=all`.
- L'API de recherche recursive est `/api/search?folder_id=<id>&scope=current|all&q=<texte>&sort=name|date`.
- Le tri par date utilise la date fichier fournie par le navigateur (`File.lastModified`) et la stocke dans SQLite (`file_date_at`).
- En tri par date, l'interface groupe les fichiers par mois avec un en-tete sticky pendant le scroll.
