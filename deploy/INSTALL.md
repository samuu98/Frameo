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

