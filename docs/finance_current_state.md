# Finance Pipeline — État actuel
*Ardenne Padel / CQFD Consult — Antoine Zingaro*
*Dernière mise à jour : 2026-03-03*

---

## 1. Résumé exécutif

Le projet dispose d'un **pipeline bar fonctionnel et persistant** (Détrembleur, Nextore, NowJobs). La base de données PostgreSQL est peuplée et les rapports Excel générés sont corrects et validés.

En revanche, les modules **terrains, capital, charges fixes et consolidation sont absents**. L'objectif de "résultat opérationnel réel" n'est pas encore atteignable.

**Progression globale estimée : 25% des objectifs finaux.**
Bar seul : ~80% complet.

---

## 2. Modules existants

### 2.1 Core DB (`db.js` + `migrations/`)
| Élément | État | Notes |
|---------|------|-------|
| Schéma PostgreSQL | ✅ Stable | 8 migrations idempotentes |
| Pool de connexion | ✅ Opérationnel | pg Pool, port 5433 WSL |
| Helpers upsert | ✅ Fonctionnels | suppliers, invoices, invoice_lines |
| Suivi imports | ✅ Fonctionnel | Table `import_logs` |
| Tables bar | ✅ Complètes | nextore_sales, nowjobs_prestations, other_purchases |
| Tables terrains | ❌ Absentes | — |
| Tables capital | ❌ Absentes | — |
| Tables charges fixes | ❌ Absentes | — |

### 2.2 Ingestion — Bar
| Source | Importer | État | Données disponibles |
|--------|----------|------|---------------------|
| Detrembleur (PDF) | `import-invoices.js` + `detrembleur.js` | ✅ v5 stable | 11 factures OCT–JAN, 252 lignes |
| Nextore (Excel) | `import-nextore.js` | ✅ Fonctionnel | OCT–FÉV 2026 |
| NowJobs (Excel) | `import-nowjobs.js` | ✅ Fonctionnel | OCT–FÉV 2026, 117 prestations |
| Colruyt/Comarché | `import-other-purchases.js` | ⚠️ Hardcodé | 5 entrées, à migrer vers CSV/Excel |
| Belfius CODA | — | ❌ Absent | 48 fichiers CD2 disponibles |
| BNP CSV | — | ❌ Absent | Export disponible (stop 16/12/2025) |
| NowJobs (Playwright) | Scripts ailleurs | ❌ Non intégré | Code non localisé dans ce projet |

### 2.3 Analyse bar (`export-bar-reports.js`)
| Rapport | État | Contenu |
|---------|------|---------|
| DETREMBLEUR_recap_v4.xlsx | ✅ Complet | Synthèse + Détail (TVA/TVAC) + Récap produit + Vidanges + Contrôle total |
| MARGE_BAR_T4.xlsx | ✅ Complet | PA derniers prix + Marge brute + Classement |
| ANALYSE_BAR_JOUR_T4.xlsx | ✅ Complet | CA/jour + RH NowJobs/jour |
| RAPPORT_RENTABILITE_BAR.xlsx | ✅ Complet | Synthèse mensuelle + CA/catégorie + Conso T4 + Achats + RH |

**Données consolidées bar (T4 2025 → FÉV 2026) :**
- CA Bar HT : OCT=1 284€ | NOV=3 558€ | DEC=2 754€ | JAN=2 606€ | FÉV=1 758€
- RH NowJobs : 9 266€ total (OCT–FÉV)
- Achats Detrembleur : ~6 000€ HTVA sur T4
- Marge brute produit : ~59.5% stable

---

## 3. Modules incomplets ou absents

### 3.1 Ingestion bancaire (0%)
- Aucun parser pour fichiers CODA Belfius (48 fichiers .CD2)
- Aucun parser pour export BNP CSV
- Impact : impossible de catégoriser les charges fixes depuis les comptes bancaires

### 3.2 Courts economics (0%)
- Aucune table `court_bookings`, `court_sessions`, `court_revenue`
- "Code JS existant" pour exports réservations **non localisé dans ce projet**
- Aucune donnée sur : taux d'occupation, CA horaire, coût électricité par terrain

### 3.3 Capital structure (0%)
- Crédit 700K€ + crédit 417K€ connus mais pas en DB
- Aucune table `loans`, `amortization_schedule`, `equity_contributions`
- Fichiers Excel "investissements" sur OneDrive non intégrés
- Aucun calcul de cash runway, stress tests

### 3.4 Charges fixes (0%)
- Électricité, assurance, comptable, taxes locales : ni en DB ni importés
- Seuls les achats bar (Detrembleur + petits fournisseurs) sont trackés

### 3.5 Consolidation (0%)
- Aucune vue ou requête consolidant bar + terrains - charges fixes
- Les analyses BDO T4 dans les Excel OneDrive sont non persistantes et non liées à la DB

---

## 4. Risques identifiés

| # | Risque | Criticité | Probabilité | Mitigation |
|---|--------|-----------|-------------|------------|
| R1 | Scripts Playwright NowJobs non localisés dans ce projet | Haute | Certaine | Retrouver + intégrer au projet |
| R2 | Données investissements uniquement dans Excel OneDrive | Haute | Certaine | Créer importer + tables DB |
| R3 | Analyses BDO T4 non persistantes (Excel manuels) | Haute | Certaine | Migrer vers requêtes SQL → Excel généré |
| R4 | CODA Belfius 01-22/10/2025 manquant | Moyenne | Irrécupérable | Couvert par export T4, documenter le trou |
| R5 | Export BNP s'arrête au 16/12/2025 | Moyenne | Certaine | Utiliser CODA Belfius pour déc 16–31 |
| R6 | other_purchases hardcodé dans le script | Faible | Certaine | Migrer vers CSV ou table de saisie |
| R7 | Aucun test automatisé | Faible | Certaine | Risque augmente si les parsers évoluent |
| R8 | Pas de versionnement git | Faible | Certaine | `git init` + premier commit |

---

## 5. Dette technique actuelle

### 5.1 Critique
- **Achats manuels hardcodés** : `import-other-purchases.js` contient les données en dur. Toute mise à jour nécessite d'éditer le code source.
- **DATA_DIR non configuré dans .env** : la commande d'import Detrembleur nécessite de passer `DATA_DIR` en variable d'environnement au moment de l'exécution (non persisté dans `.env`).
- **Scripts Playwright/réservations hors projet** : risque de perte ou d'incohérence.

### 5.2 Significative
- **Aucun test** : le dossier `tests/` est vide. Les parsers complexes (detrembleur.js v5) n'ont aucun test de non-régression.
- **Pas de git** : aucun historique de version. En cas de corruption ou d'erreur, impossible de revenir en arrière.
- **Fichiers `__init__.py`** dans `src/parsers/` et `src/` : artefacts Python inutilisés, à supprimer.
- **Dossier `exports/`** vide, dossier `node/` non documenté.

### 5.3 Mineure
- **Pas de README.md** à la racine du projet.
- **Pas de `.gitignore`** (`.env` non protégé si git est initialisé).
- **`src/exporters/`** contient un seul fichier de 500+ lignes — à découper en modules.
- **Dépendances non verrouillées** sur version majeure (dotenv `^17`, risque de breaking change).

---

## 6. Ce qui fonctionne bien

- Architecture PostgreSQL propre : migrations idempotentes, transactions, upserts
- Parser Detrembleur v5 : robuste, 11 cas complexes gérés, validations intégrées
- Imports Nextore/NowJobs : idempotents, résistants aux re-runs
- Rapports Excel : générés depuis DB (pas de copier-coller), formatage correct
- Contrôle de cohérence : validation HTVA + total_a_payer intégrée dans le pipeline

---

*Pour l'architecture cible, voir `docs/finance_target_architecture.md`*
