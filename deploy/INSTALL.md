# Installazione Frameo

Questa distribuzione usa un'immagine già compilata: il PC che ospita Frameo non
deve installare Node.js, Prisma o compilare l'applicazione.

## Installazione online

1. Estrai l'archivio `frameo-<versione>-deploy.zip`.
2. Copia `.env.example` in `.env`.
3. Cambia obbligatoriamente `POSTGRES_PASSWORD` in `.env`.
4. Avvia Frameo:

   ```bash
   docker compose pull
   docker compose up -d
   ```

5. Apri `http://localhost:3000`.

## Archivio su disco esterno

Per salvare sia gli originali caricati sia miniature e anteprime su un disco
esterno, imposta in `.env` un percorso assoluto già montato e scrivibile:

```dotenv
FRAMEO_STORAGE_HOST_PATH=/mnt/disco-esterno/Frameo/storage
```

Poi ricrea il servizio con `docker compose up -d`. Se esiste già una libreria
nel volume Docker predefinito, copiane prima il contenuto nella nuova cartella.
Il database PostgreSQL resta separato e continua a usare il proprio volume.

## Libreria esterna

Per indicizzare e gestire una cartella già esistente senza copiarla nel volume di Frameo,
imposta `EXTERNAL_MEDIA_HOST_PATH` nel file `.env` e avvia anche l'override:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.external.yml \
  up -d
```

La cartella host viene montata in lettura/scrittura: l'eliminazione fisica,
protetta da conferma esplicita e permessi amministratore, rimuove davvero gli
originali. Dalla pagina **Gestione libreria** puoi scegliere quali sottocartelle scansionare, avviare una nuova
scansione, cambiare la cartella relativa degli upload e generare o rigenerare le
miniature e le clip di anteprima mancanti.

Se il package GHCR è privato, esegui prima `docker login ghcr.io` oppure usa
l'installazione offline.

## Installazione offline su AMD64

Scarica dalla stessa release anche `frameo-<versione>-linux-amd64.tar.gz`, quindi:

```bash
docker load -i frameo-<versione>-linux-amd64.tar.gz
docker compose up -d
```

Il tag indicato nel file `.env.example` della release corrisponde già
all'immagine caricata.

## Aggiornamento

I media e il database sono conservati nei volumi Docker e non vengono rimossi
durante un aggiornamento:

```bash
docker compose pull
docker compose up -d
```

Prima di aggiornare è comunque consigliato eseguire il backup dei volumi
`frameo_media` e `frameo_postgres`.

## Controlli

```bash
docker compose ps
docker compose logs --tail 100 frameo
```

Entrambi i servizi devono risultare `healthy`.
