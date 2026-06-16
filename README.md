# NAS

API Rust + front React servis par le meme serveur.

## Configuration

Variables utiles :

```sh
export NAS_LOGIN_PASSWORD="change-me-please"
export NAS_BIND="127.0.0.1:3000"
export NAS_DATA_DIR="./data"
# Optionnel : chemin des medias originaux. Par defaut: "$NAS_DATA_DIR/files".
export NAS_FILES_DIR="./data/files"
export NAS_SESSION_TTL_HOURS="12"
# export NAS_PUBLIC_BASE_URL="https://nas.example.com"
```

`NAS_LOGIN_PASSWORD` est obligatoire. La session est conservee dans un cookie `HttpOnly` limite a `/api`.
Les liens publics de partage expirent automatiquement apres 1 heure.

## Lancer en local

```sh
cd web
bun install
bun run build
cd ..
cargo run
```

Puis ouvrir `http://127.0.0.1:3000`.

## Lancer avec Docker + Caddy HTTPS

Créer la configuration :

```sh
cp .env.example .env
```

Dans `.env`, remplacer `NAS_PUBLIC_BASE_URL` par l'adresse HTTPS a utiliser depuis le telephone :

```sh
NAS_LOGIN_PASSWORD=change-me-please
NAS_FILES_DIR=/data/files
NAS_PUBLIC_BASE_URL=https://192.168.1.42
```

`NAS_FILES_DIR` peut pointer ailleurs si tu veux separer les medias originaux du reste des donnees. Avec Docker, si tu mets un chemin hors de `/data`, ajoute aussi un volume correspondant dans `docker-compose.yml`.

Generer ensuite le certificat autosigne pour l'IP LAN :

```sh
./scripts/generate-self-signed-cert.sh 192.168.1.42
```

Puis lancer :

```sh
docker compose up --build -d
```

Ouvrir ensuite `https://192.168.1.42` depuis Android.

La configuration Caddy utilise `certs/nas.crt` et `certs/nas.key`. Pour que le navigateur Android considere vraiment la page comme sure, transferer `certs/nas.crt` sur Android puis l'installer comme certificat CA utilisateur. Sans certificat de confiance, Android peut afficher une alerte HTTPS et certaines APIs "secure context" peuvent rester bloquees.

Pour arreter :

```sh
docker compose down
```

## Stockage

- `NAS_FILES_DIR` contient l'arborescence reelle des dossiers et fichiers (`data/files` par defaut).
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
