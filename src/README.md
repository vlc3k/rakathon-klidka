## Backend (API)

Endpointy jsou popsané v [docs/data_model/api.md](../docs/data_model/api.md), datový model v [docs/data_model/datovy-model.md](../docs/data_model/datovy-model.md).

```bash
cp .env.example .env     # PostgreSQL v Azure, Azure Blob Storage, STAFF_PASSWORD
npm run db:migrate       # migrace z db/migrations
npm run db:seed          # admin z AA podle .env (SEED_ADMIN_EMAIL, heslo STAFF_PASSWORD)
npm run staff:create -- --email eva.mala@vfn.cz --first Eva --last Malá --display "MUDr. Eva Malá"
npm test                 # testy API běží proti PostgreSQL v paměti, databázi ani Azure nepotřebují
npm run typecheck
npm run smoke            # ověří napojení na Azure PostgreSQL a Blob Storage podle .env
npm run smoke -- --api --base-url http://localhost:3000   # + celý tok přes běžící aplikaci, testovací data smaže
```

- `app/api/`: tenké route handlery (ověří přístup, načtou vstup, zavolají službu)
- `lib/server/`: session, oprávnění, HTTP vrstva, služby (`services/`) a pravidla (`rules/`); jen pro server (`server-only`)
- `db/`: schéma (Drizzle), katalog typů, tvary hodnot a migrace
- `tests/`: testy API a podpora (PGlite, úložiště v paměti)

Změna schématu: upravit `db/schema.ts`, `npm run db:generate -- --name <popis>`, migraci commitnout.

---

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Data z nemocnice (HL7 FHIR)

V detailu pacienta je panel „Z nemocnice“. Tlačítko „Aktualizovat“ stáhne pacienta z FHIR serveru (podle rodného
čísla z databáze) a ukáže kopii k této operaci. Kopie zatím drží jen otevřená stránka (ukládání chybí, viz
[MISSING_ENDPOINTS.md](../MISSING_ENDPOINTS.md)). Ve výchozím pohledu jsou jen údaje k operaci, ostatní jsou pod
„Zobrazit vše“. Hodnoty, které od předchozí kopie přibyly, mají štítek „Nové“.

Pacient se v nemocnici hledá podle rodného čísla, na FHIR serveru tedy musí být pacient se stejným RČ jako v databázi.

1. **Společný server týmu** (IRIS for Health v Azure, `rg-team71`): do `.env` dejte `FHIR_BASE_URL`,
   `FHIR_USER` a `FHIR_PASSWORD` (heslo dostanete od Štěpána, do gitu ani chatu nepatří). Je na něm 6 demo pacientů.
   Založení: `scripts/iris-azure.sh` v Azure Cloud Shellu. Po restartu kontejneru jsou data pryč, nahrají se znovu:
   `node --env-file=.env scripts/seed-fhir.mjs --nahrat <hackathon kit>/docker-iris-fhir/data/fhir`.
2. **Lokálně**: hackathon kit `docker-iris-fhir/start.ps1` (FHIR na `http://localhost:52773/fhir/r4`, výchozí bez
   nastavení), pak `npm run seed:fhir` (doplní demo pacientům rodná čísla).

Kód: `lib/fhir/` (FHIR klient, import a export), `app/api/fhir/[caseId]/route.ts`,
`app/components/staff/detail/HospitalPanel.tsx`.

## Data

Aplikace nemá žádná lokální data. Všechno čte a zapisuje přes API (`lib/api/`), které je bere z PostgreSQL
a souborů v Azure Blob Storage podle `.env`. Prázdná databáze = prázdná aplikace:

1. `npm run db:migrate`
2. `npm run db:seed` (admin z AA podle `SEED_ADMIN_EMAIL`, přihlásí se heslem `STAFF_PASSWORD`), další lidi z AA
   `npm run staff:create -- --email … --first … --last …`
3. pacienty a zákroky založí ambulance ve „Spravovat pacienty“, dokumenty nahraje pacient v portálu
   (přihlásí se identifikátorem a datem narození)
