# Finance Pipeline — Architecture cible
*Ardenne Padel / CQFD Consult — Antoine Zingaro*
*Dernière mise à jour : 2026-03-03*

---

## 1. Principes directeurs

1. **Persistance totale** : toute donnée analysée doit être en base avant d'être dans un rapport.
2. **Idempotence** : tout import peut être relancé sans créer de doublons ni corrompre les données.
3. **Traçabilité** : chaque ligne de données porte sa source, sa date d'import et son statut.
4. **Séparation ingestion / calcul / présentation** : un module ne fait qu'une chose.
5. **Pas d'analyse freestyle** : aucun chiffre dans un rapport qui n't est pas issu d'une requête SQL sur la DB.

---

## 2. Architecture modulaire

```
ardenne-padel-pnl/
│
├── docs/                          ← Documentation architecture (ce fichier)
│   ├── finance_current_state.md
│   └── finance_target_architecture.md
│
├── migrations/                    ← Schéma DB — ordonnées, idempotentes
│   ├── 001_suppliers.sql          [existant]
│   ├── 002_products.sql           [existant]
│   ├── 003_invoices.sql           [existant]
│   ├── 004_invoice_lines.sql      [existant]
│   ├── 005_import_logs.sql        [existant]
│   ├── 006_nextore_sales.sql      [existant]
│   ├── 007_nowjobs_prestations.sql [existant]
│   ├── 008_other_purchases.sql    [existant]
│   ├── 009_court_sessions.sql     [à créer] réservations terrains
│   ├── 010_fixed_costs.sql        [à créer] charges fixes (élec, assurance...)
│   ├── 011_loans.sql              [à créer] crédits + échéanciers
│   ├── 012_equity.sql             [à créer] fonds propres + apports
│   └── 013_amortization.sql       [à créer] plan d'amortissement actifs
│
├── db.js                          ← Core DB [existant — stable]
│
├── src/
│   │
│   ├── adapters/                  ← Ingestion : un adapter par source
│   │   ├── detrembleur/
│   │   │   ├── parser.js          [existant, était src/parsers/detrembleur.js]
│   │   │   └── importer.js        [existant, était src/importers/import-invoices.js]
│   │   ├── nextore/
│   │   │   └── importer.js        [existant, était src/importers/import-nextore.js]
│   │   ├── nowjobs/
│   │   │   └── importer.js        [existant, était src/importers/import-nowjobs.js]
│   │   ├── manual-purchases/
│   │   │   └── importer.js        [existant, à migrer depuis hardcodé → CSV/Excel]
│   │   ├── belfius-coda/
│   │   │   ├── parser.js          [à créer] parser fichiers .CD2 Belfius
│   │   │   └── importer.js        [à créer] → table bank_transactions
│   │   ├── bnp-csv/
│   │   │   └── importer.js        [à créer] → table bank_transactions
│   │   ├── court-reservations/
│   │   │   └── importer.js        [à créer] export réservations → court_sessions
│   │   └── manual-capital/
│   │       └── importer.js        [à créer] loans.xlsx / equity.xlsx → DB
│   │
│   ├── modules/                   ← Calculs métier (requêtes SQL → objets JS)
│   │   ├── bar/
│   │   │   ├── purchases.js       [à créer] agrège achats bar (Detrembleur + autres)
│   │   │   ├── sales.js           [à créer] agrège CA bar (Nextore)
│   │   │   ├── labor.js           [à créer] agrège coûts RH (NowJobs)
│   │   │   └── economics.js       [à créer] marge brute, nette, par période
│   │   ├── courts/
│   │   │   ├── revenue.js         [à créer] CA terrains par terrain / heure
│   │   │   ├── occupancy.js       [à créer] taux d'occupation, CA horaire moyen
│   │   │   └── economics.js       [à créer] résultat net courts (CA - élec - amort)
│   │   ├── fixed-costs/
│   │   │   └── costs.js           [à créer] agrège charges fixes (élec, assurance, compta)
│   │   ├── capital/
│   │   │   ├── loans.js           [à créer] encours crédit, mensualités, intérêts
│   │   │   ├── amortization.js    [à créer] tableau amortissement actifs
│   │   │   └── cashflow.js        [à créer] projection trésorerie, runway, stress tests
│   │   └── consolidation/
│   │       └── pnl.js             [à créer] P&L consolidé bar + courts - charges
│   │
│   └── reports/                   ← Présentation : génère Excel/JSON depuis modules
│       ├── bar-reports.js         [existant, était src/exporters/export-bar-reports.js]
│       ├── courts-reports.js      [à créer]
│       ├── capital-report.js      [à créer]
│       └── consolidated-pnl.js    [à créer]
│
├── tests/                         ← Tests unitaires et d'intégration [à créer]
│   ├── adapters/
│   │   └── detrembleur.test.js    cas limites parser PDF
│   └── modules/
│       └── bar-economics.test.js  calculs marges
│
├── output/                        ← Excel générés (existant)
├── .env                           ← Config (existant)
├── .env.example                   ← Template (existant)
├── .gitignore                     ← À créer
├── package.json                   ← Existant
└── README.md                      ← À créer
```

---

## 3. Description des modules

### Module A — Core DB
**Rôle** : connexion, migrations, helpers bas niveau
**Fichier** : `db.js`
**État** : ✅ stable
**Ne contient pas** : logique métier, calculs, formatage

### Module B — Adapters (ingestion)
**Rôle** : transformer une source externe en lignes DB propres
**Règle** : un adapter = une source = une table cible
**Contrat** : idempotent, transactionnel, loggé dans `import_logs`

| Adapter | Source | Table cible | État |
|---------|--------|-------------|------|
| detrembleur | PDFs factures | invoices + invoice_lines | ✅ v5 |
| nextore | Excel ventes bar | nextore_sales | ✅ |
| nowjobs | Excel prestations | nowjobs_prestations | ✅ |
| manual-purchases | Excel/CSV | other_purchases | ⚠️ hardcodé |
| belfius-coda | Fichiers .CD2 | bank_transactions | ❌ |
| bnp-csv | CSV BNP | bank_transactions | ❌ |
| court-reservations | Export réservations | court_sessions | ❌ |
| manual-capital | Excel crédits/FP | loans + equity | ❌ |

### Module C — Bar Economics
**Rôle** : calculer la rentabilité du bar par période
**Sources DB** : invoice_lines + nextore_sales + nowjobs_prestations + other_purchases
**Outputs** :
- Marge brute = CA HT - coût achats HTVA
- Marge nette = Marge brute - RH NowJobs
- Résultat bar = Marge nette - charges fixes bar (électricité frigo, Europabank ~2-3%)

### Module D — Courts Economics
**Rôle** : calculer la rentabilité des terrains
**Sources DB** : court_sessions + bank_transactions (énergie) + amortization
**Outputs** :
- CA terrains (par terrain, par heure, par type : cours/libre)
- Taux d'occupation (heures réservées / heures disponibles)
- CA moyen par heure disponible
- Résultat courts = CA - électricité courts - amortissement équipements

### Module E — Charges fixes
**Rôle** : tracker les charges non attribuables à un centre de profit spécifique
**Sources DB** : bank_transactions (filtré par catégorie) + fixed_costs
**Contenu** : assurance, comptable (BDO), taxes locales, entretien général
**Note** : l'électricité bar et l'électricité courts sont attribuées à leurs modules respectifs

### Module F — Capital Structure
**Rôle** : modéliser le financement et les flux de trésorerie
**Sous-modules** :
- **Loans** : crédits 700K + 417K, mensualités, capital restant dû, intérêts
- **Equity** : apports fonds propres Antoine Zingaro (compte courant)
- **Amortization** : plan d'amortissement infrastructure (terrains, matériel)
- **Cash flow** : projection mensuelle, runway, stress tests (-20% CA, +10% charges)

### Module G — Consolidation
**Rôle** : P&L global à partir des modules Economics
**Formule** :
```
Résultat opérationnel =
  Résultat bar
+ Résultat courts
- Charges fixes transverses
─────────────────────────
= EBITDA opérationnel

- Amortissements
- Charges financières (intérêts crédits)
─────────────────────────
= Résultat net avant IS
```

### Module H — Reports (présentation)
**Rôle** : générer les Excel/exports depuis les modules Economics
**Règle** : aucune logique métier ici — appel aux modules C/D/E/F/G uniquement
**Outputs** : fichiers Excel dans `output/`, éventuellement JSON pour dashboard futur

---

## 4. Flux de données

```
Sources externes
      │
      ▼
┌─────────────────────────────────────────────────────────┐
│                     ADAPTERS                            │
│  PDF Detrembleur │ Excel Nextore │ Excel NowJobs │ ...  │
│  CODA Belfius    │ CSV BNP       │ Excel crédits │      │
└─────────────────────────────────────────────────────────┘
      │  (toutes idempotentes, loggées dans import_logs)
      ▼
┌─────────────────────────────────────────────────────────┐
│                  POSTGRESQL DATABASE                    │
│  invoices │ invoice_lines │ nextore_sales │ nowjobs      │
│  bank_transactions │ court_sessions │ loans │ equity     │
│  fixed_costs │ amortization │ other_purchases            │
└─────────────────────────────────────────────────────────┘
      │
      ▼
┌────────────────┐  ┌─────────────────┐  ┌──────────────┐
│  Bar Economics │  │ Courts Economics│  │   Capital    │
│  (C)           │  │ (D)             │  │ Structure (F)│
└───────┬────────┘  └────────┬────────┘  └──────┬───────┘
        │                   │                   │
        └──────────┬────────┘                   │
                   ▼                            │
          ┌────────────────┐                    │
          │  Charges fixes │                    │
          │  (E)           │                    │
          └───────┬────────┘                    │
                  │                             │
                  ▼                             ▼
         ┌───────────────────────────────────────┐
         │           CONSOLIDATION (G)            │
         │   Résultat bar + Courts - Fixes        │
         │   - Amortissements - Intérêts          │
         └───────────────┬───────────────────────┘
                         │
                         ▼
              ┌──────────────────┐
              │   REPORTS (H)    │
              │   Excel / JSON   │
              └──────────────────┘
```

---

## 5. Dépendances entre modules

```
Core DB (A)
  └── tous les autres dépendent de A

Adapters (B)
  └── dépendent de A uniquement
  └── ne dépendent pas entre eux

Bar Economics (C)
  └── dépend de : detrembleur + nextore + nowjobs + manual-purchases adapters

Courts Economics (D)
  └── dépend de : court-reservations + belfius-coda adapters

Charges fixes (E)
  └── dépend de : belfius-coda + bnp-csv adapters (catégories)

Capital Structure (F)
  └── dépend de : manual-capital adapter
  └── ne dépend pas de C, D, E

Consolidation (G)
  └── dépend de : C + D + E + F

Reports (H)
  └── dépend de : C + D + E + F + G
```

---

## 6. Ordre de développement recommandé

### Phase 1 — Bar (✅ quasi-complète)
Priorité : livraison BDO T4 2025

| # | Tâche | État |
|---|-------|------|
| 1.1 | Core DB + migrations 001-008 | ✅ |
| 1.2 | Adapter Detrembleur v5 | ✅ |
| 1.3 | Adapter Nextore | ✅ |
| 1.4 | Adapter NowJobs | ✅ |
| 1.5 | Bar reports Excel | ✅ |
| 1.6 | Migrer manual-purchases vers CSV/Excel | ⚠️ dette tech |
| 1.7 | git init + .gitignore + README | ⚠️ dette tech |

### Phase 2 — Banque + Charges fixes
Priorité : catégoriser les charges du compte bancaire

| # | Tâche | Dépend de |
|---|-------|-----------|
| 2.1 | Migration 010_fixed_costs.sql | — |
| 2.2 | Adapter Belfius CODA (.CD2 parser) | migration |
| 2.3 | Adapter BNP CSV | migration |
| 2.4 | Module charges fixes (E) | 2.2 + 2.3 |

### Phase 3 — Terrains
Priorité : compléter le tableau de rentabilité

| # | Tâche | Dépend de |
|---|-------|-----------|
| 3.1 | Migration 009_court_sessions.sql | — |
| 3.2 | Localiser/intégrer code JS exports réservations | — |
| 3.3 | Adapter court-reservations | 3.1 + 3.2 |
| 3.4 | Module Courts Economics (D) | 3.3 + 2.2 (élec) |

### Phase 4 — Capital (peut démarrer en parallèle de 2/3)
Priorité : cash runway et stress tests

| # | Tâche | Dépend de |
|---|-------|-----------|
| 4.1 | Migrations 011-013 (loans, equity, amortization) | — |
| 4.2 | Créer loans.xlsx + equity.xlsx depuis données existantes | — |
| 4.3 | Adapter manual-capital | 4.1 + 4.2 |
| 4.4 | Module Capital Structure (F) | 4.3 |

### Phase 5 — Consolidation
Priorité : P&L global

| # | Tâche | Dépend de |
|---|-------|-----------|
| 5.1 | Module Consolidation (G) | C + D + E + F |
| 5.2 | Report P&L consolidé (Excel) | G |
| 5.3 | Dashboard (optionnel, futur) | G |

---

## 7. Critique de la proposition initiale

La proposition originale (Core DB / Ingestion / Bar / Courts / Capital / Consolidation / Reporting) est **correcte dans ses domaines** mais présente les ajustements suivants :

| Point | Proposition | Recommandation |
|-------|-------------|----------------|
| Ingestion | Module unique | Découper en adapters par source (1 source = 1 adapter) |
| Capital Structure | Inclut tout | Séparer loans/equity (bilan) du cashflow (trésorerie) |
| Manque | — | Ajouter module "Charges fixes" transverse |
| Manque | — | Ajouter module "Reference Data" si catalogue produits/terrains grandit |
| Reporting | Module séparé | OK mais : aucune logique métier, seulement présentation |
| Sur-architecture | — | Risque faible : la structure est pragmatique, pas sur-engineered |

---

*Pour l'état actuel, voir `docs/finance_current_state.md`*
