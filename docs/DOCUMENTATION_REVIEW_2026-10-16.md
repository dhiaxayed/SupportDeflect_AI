# Revue des commentaires et de la compréhension du projet

Passe commencée le 15 octobre et finalisée le 16 octobre 2026. Ce rapport clôt
la demande de documentation du code et décrit les contrôles utilisés ; il ne
certifie pas une absence absolue d’erreur ni un déploiement VM.

## Résultat et périmètre

- Les modules, classes et fonctions Python maintenus possèdent une docstring :
  **634 déclarations**, y compris les méthodes et helpers imbriqués.
- Les sources JavaScript/TypeScript possèdent un en-tête et une explication des
  contrats nommés : **405 déclarations**, comprenant composants, hooks, types,
  interfaces, méthodes et fonctions affectées aux propriétés d’objet.
- Les configurations, Dockerfiles, scripts shell, lanceur Windows, CSS et pages
  HTML ont des commentaires adaptés à leur grammaire.
- [FILE_GUIDE_FR](FILE_GUIDE_FR.md) explique individuellement les **300 fichiers
  maintenus** de la révision de suivi, dont les documents, images, JSON stricts,
  lockfiles et l’arbre de routes généré.

Les petites lambdas et fonctions anonymes intégrées aux événements, expressions
JSX, map et tests sont expliquées dans leur flux englobant. Le contrôle ne
demande pas un commentaire paraphrasant chaque ligne de langage. Les commentaires
des sources sont en anglais selon la convention du dépôt ; le guide transversal
et le dossier de présentation sont en français.

Les données locales, vrais fichiers d’environnement et variantes privées,
certificats, bases, journaux, sauvegardes, caches, dépendances et bundles sont
hors périmètre. Les images et JSON stricts sont expliqués dans le guide associé.
Le fichier TanStack généré est inventorié mais reste sous la responsabilité de
son générateur. Aucun fichier tiers n’a été modifié pour satisfaire un compteur.

## Contenu des explications

Les contrats documentent les rôles des composants, entrées/résultats, accès
attendus, erreurs et effets utiles à l’appelant. La revue a particulièrement
couvert les commits/rollbacks, quotas concurrents, baux et publications tardives,
isolation des locataires, révocations de session, états UI asynchrones, capacités
visiteur et différence entre acceptation SMTP et réception dans une boîte externe.

Une relecture a corrigé des promesses trop larges : les sondes natives commencent
sur loopback mais l’opener standard peut suivre une redirection ; un timeout
n’est pas une limite d’octets ; une archive intègre n’est pas automatiquement
authentifiée, et sa restauration reprend les UID/GID/modes enregistrés en retirant
les bits spéciaux. Les outils d’inspection PostgreSQL et de réindexation historique
ont leurs limites explicitées.

Le guide fonctionnel a aussi été aligné sur le RAG actuel : historique borné
potentiellement envoyé à Groq, panne fournisseur distincte d’un dossier métier,
et migrations allant jusqu’à `0007`. Le README de suivi de phase 1 explique
l’exception Groq à l’objectif général « sans cloud » sans la masquer.

## Vérification de l’absence de changement involontaire

Un instantané temporaire des sources a été pris avant les ajouts de documentation.
La comparaison a porté sur les fichiers existants à cet instant :

| Format | Comparaison | Résultat |
|---|---|---|
| 91 fichiers Python | Arbres AST sans positions, en retirant uniquement les véritables docstrings de tête ; autres chaînes/prompts conservés. | Logique identique. |
| 100 fichiers JS/TS existants | Impression sans commentaires, puis arbre syntaxique normalisé pour les différences de présentation multiligne ; types de nœuds, tokens et littéraux conservés. | Logique identique. |
| 4 CSS | Arbres PostCSS hors commentaires et métadonnées de présentation. | Règles identiques. |
| 5 YAML, 2 TOML, 5 JSON/JSONC, 1 INI | Comparaison des structures et valeurs parsées. | Identiques pendant la passe de commentaires. |
| 23 configurations/scripts textuels | Commandes/lignes actives hors commentaires ; contrôle des cinq scripts shell par Git Bash. | Identiques pendant la passe de commentaires. |

Les docstrings peuvent enrichir les descriptions OpenAPI et l’aide CLI : cet effet
documentaire est voulu. Les nouveaux contrôleurs de documentation n’ont pas
d’équivalent dans l’instantané. Pendant la revue de phase 1, deux changements
fonctionnels de configuration ont ensuite été ajoutés explicitement :

1. `.gitignore` exclut toutes les variantes privées `.env.*` et conserve les
   modèles `*.example` versionnables.
2. Le workflow CI contrôle toute la famille `scripts/` avec Ruff et exécute le
   contrôleur documentaire après installation des dépendances frontend.

Ces changements de politique ne sont pas présentés comme de simples commentaires.
Les comparaisons finales distinguent bien ces deux fichiers du reste de la passe.
Les commentaires HTML et le modèle Alembic ont été relus ; les pages frontend
sont aussi exercées par build et navigateur, sans prétendre à une comparaison
AST HTML globale inexistante.

## Contrôles exécutés

| Contrôle | Résultat observé |
|---|---|
| `python scripts/check_documentation.py --node CHEMIN_NODE_24 --json` | Aucun commentaire/en-tête/inventaire requis manquant ; 634 Python, 405 JS/TS. |
| Ruff backend depuis `backend` | Réussi après correction de six docstrings trop longues. |
| Ruff `scripts/` depuis la racine avec configuration backend | Réussi. |
| Suite backend après documentation | 165 réussites, un avertissement upstream Starlette ; 184,26 secondes. |
| ESLint strict et TypeScript sans émission | Réussis, aucun avertissement ESLint. |
| Vitest complet, pool threads, un worker | 44 réussites dans 8 fichiers ; 76,26 secondes. |
| Build client/SSR et smoke du serveur de production | Réussis ; vitrine/connexion, police locale/MIME et URL malformée. |
| Playwright avec Mailpit installé | 12 parcours réussis dans un seul passage de 2,6 minutes, SMTP local réel inclus. |
| Mailer | 8 tests réussis. |
| Scripts opérateur | 12 tests réussis. |
| MiniLM et widget/Groq réels | Vecteurs 384, passage persisté/relu, exclusion inter-locataire ; salutation puis réponse avec une source, HTTP 200. |
| Intégration PostgreSQL locale | 1 skip explicite faute de `TEST_POSTGRES_URL`. |
| Compose baseline et TLS, syntaxe Bash | Configurations et cinq scripts valides ; aucun démarrage Docker/VM revendiqué. |

Le premier passage Vitest en pool forks a échoué au démarrage d’un worker Windows,
avec seulement 34 tests exécutés ; il n’a pas été compté comme réussi. Le passage
threads a ensuite exécuté les 44 tests sans changement d’assertion ni de timeout.
La liste des commandes et la séparation des dates se trouvent dans [TESTING](TESTING.md).

## Contrôle durable

[check_documentation.py](../scripts/check_documentation.py) et
[check_documentation.mjs](../scripts/check_documentation.mjs) analysent les sources
sans démarrer l’application ni charger ses secrets. Ils échouent si une nouvelle
déclaration attendue n’a pas de commentaire ou si un fichier manque dans le guide.
Le parseur TypeScript installé accepte le JSONC réel de tsconfig ; les autres JSON
gardent une validation stricte.

Ce signal de présence complète une relecture humaine. Il ne peut pas juger à lui
seul la justesse d’une explication, l’exactitude d’une IA ni la conformité d’un
environnement Linux qui n’a pas été exécuté.
