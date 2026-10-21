# Oura

Lit les données de votre **bague Oura** dans Gladys par l’**API v2 officielle
d’Oura**, en lecture seule : scores de sommeil, de récupération (readiness) et
d’activité, durées de sommeil (total, profond, paradoxal), fréquence cardiaque
la plus basse et variabilité cardiaque de la nuit, écart de température
corporelle, SpO2 moyenne de la nuit, pas et calories actives du jour, dernière
fréquence cardiaque.

> **Pas un dispositif médical.** Ne vous servez jamais de ces valeurs pour un
> diagnostic ni une décision de traitement. Elles viennent du cloud d’Oura
> quand l’application Oura synchronise : elles peuvent être en retard,
> manquer ou être fausses.

Intégration non officielle, sans lien avec Oura. Oura est une marque de son
propriétaire. **Jamais testée avec un vrai appareil** (bague) ni avec un vrai
compte : les réponses de l’API ont été reproduites d’après la documentation
d’Oura, la bibliothèque oura-ring et l’intégration Home Assistant.

## Ce qu’il faut

- Une bague Oura et son compte Oura (l’API d’Oura demande un abonnement Oura
  actif : sans lui, elle refuse les données, voir « États »).
- Une **application** que vous créez vous-même sur le portail développeur
  d’Oura (OAuth2). Les jetons d’accès personnels ne sont plus acceptés par
  Oura.
- Gladys 5.1 ou plus récent.

## Pas à pas

### 1. Trouver l’adresse de retour de Gladys

1. Dans Gladys, ouvrez l’intégration, puis son onglet **Configuration**.
2. Saisissez pour l’instant n’importe quel texte dans **Client ID** et
   **Client Secret**, enregistrez, puis cliquez une fois sur **Connecter**. La
   page d’Oura refusera (application inconnue) : fermez-la.
3. L’état en haut de la page affiche maintenant **« L’adresse de retour de ce
   Gladys est https://… »**. Copiez cette adresse à l’identique (schéma, hôte,
   port, chemin).

Si vous ne pouvez pas utiliser cette adresse (par exemple Gladys n’est
joignable que sur votre réseau local en http, et le portail demande du
https), utilisez une adresse à vous et saisissez-la dans **URL de
redirection** (voir l’étape 4).

### 2. Créer l’application Oura

1. Ouvrez <https://developer.ouraring.com/> et connectez-vous avec votre
   compte Oura.
2. Ouvrez **My Applications**, puis créez une nouvelle application (les noms
   exacts des boutons et des champs n’ont pas été vérifiés sur un vrai
   compte).
3. Donnez-lui un nom (par exemple « Gladys »), une description, votre adresse
   e-mail et les adresses de site ou de politique de confidentialité si le
   formulaire les demande.
4. Dans **Redirect URIs**, collez l’adresse de l’étape 1 (ou la vôtre). Elle
   doit correspondre à l’identique.
5. Si le formulaire demande des autorisations (scopes), autorisez au moins
   **daily**, **heartrate** et **spo2** (rien d’autre n’est utile).
6. Enregistrez. Copiez le **Client ID** et le **Client Secret** de
   l’application.

### 3. Remplir la configuration

1. Collez le **Client ID** et le **Client Secret** dans Gladys, puis
   enregistrez. Le Client Secret est gardé par Gladys dans sa base, jamais
   réaffiché, envoyé seulement à Oura.
2. Laissez **Point d’échange des jetons** sur `moi.ouraring.com` : celui en
   service pour les applications du portail développeur actuel et pour la
   plupart des anciennes (c’est celui qu’utilise l’intégration Home
   Assistant).

### 4. Autoriser

1. Cliquez sur **Connecter** : la page d’Oura s’ouvre. Connectez-vous et
   autorisez l’accès demandé : données du jour, fréquence cardiaque et SpO2,
   en lecture seule (ni e-mail, ni informations personnelles). Votre mot de
   passe se saisit sur la page d’Oura seulement, jamais dans Gladys.
2. Oura vous renvoie vers Gladys ; l’intégration lit vos données.
3. **Avec votre propre URL de redirection** : à la fin, le navigateur affiche
   votre adresse avec `code=` et `state=`. Copiez l’adresse complète et
   collez-la dans **Terminer l’autorisation**, dans les 15 minutes.
4. Ouvrez l’onglet **Découverte** et ajoutez la bague.

Si Oura refuse l’autorisation alors que le Client ID, le Client Secret et
l’URL de redirection sont justes (quelques anciennes applications), choisissez
`api.ouraring.com` dans **Point d’échange des jetons** (celui que la
spécification OpenAPI nomme encore), enregistrez et cliquez de nouveau sur
**Connecter**. Un code refusé est consommé : les deux points ne sont jamais
essayés l’un après l’autre. Un changement de ce champ vaut au prochain
Connecter : une session en cours continue de se renouveler là où elle a été
émise.

## L’appareil

Un appareil **Bague Oura** (ou **Oura ring**), toutes les fonctions en lecture
seule, sans historique par défaut (données de santé ; vous pouvez activer
l’historique fonction par fonction) :

| Fonction                                             | Type dans Gladys | Source                                             |
| ---------------------------------------------------- | ---------------- | -------------------------------------------------- |
| Score de sommeil                                     | nombre 0-100     | dernier `daily_sleep`                              |
| Score de récupération                                | nombre 0-100     | dernier `daily_readiness`                          |
| Score d’activité                                     | nombre 0-100     | dernier `daily_activity`                           |
| Durée de sommeil, sommeil profond, sommeil paradoxal | durée (heures)   | sommeil principal de la dernière nuit (`sleep`)    |
| Fréquence cardiaque la plus basse du sommeil (bpm)   | nombre           | idem                                               |
| Variabilité cardiaque moyenne du sommeil (ms)        | nombre           | idem                                               |
| Écart de température corporelle (°C)                 | nombre           | dernier `daily_readiness`                          |
| Oxygène sanguin moyen du sommeil (SpO2, %)           | nombre           | dernier `daily_spo2`                               |
| Pas du jour, calories actives (kcal)                 | nombre           | dernier `daily_activity`                           |
| Dernière fréquence cardiaque (bpm)                   | nombre           | dernière mesure `heartrate` des 3 dernières heures |

Gladys n’a pas d’unité pour une fréquence cardiaque, un score ou un oxygène
sanguin : l’unité est dans le nom. Seules les données d’hier ou d’aujourd’hui
comptent comme actuelles : un jour plus ancien (la bague n’a pas synchronisé)
et une fréquence cardiaque de plus de 3 heures ne sont jamais publiés.

La **Dernière fréquence cardiaque** est publiée avec l’heure de sa mesure (elle
arrive souvent des minutes ou des heures plus tard, quand l’application
synchronise). Gladys l’enregistre alors comme une valeur datée : **une scène
déclenchée sur cette fonction ne se déclenche pas** (les autres fonctions,
publiées sans date, déclenchent les scènes comme d’habitude).

## Requêtes et limites

- Une lecture toutes les **30 minutes** par défaut (15 à 240) : 6 à 8
  requêtes par lecture, 1 000 par jour au plus (Oura en permet bien plus). La
  bague envoie ses données quand l’application Oura synchronise : lire plus
  souvent n’apporte rien.
- Jamais plus tôt que l’intervalle, quoi qui la lance : le bouton **Tester
  Oura**, une configuration enregistrée, Découverte, une reconnexion de
  Gladys, un redémarrage du conteneur (l’heure de la dernière lecture est
  gardée dans `/data`).
- Un 429 (trop de requêtes), une erreur du serveur (5xx) ou le budget du jour
  mettent toutes les requêtes en pause, gardée dans `/data` à travers un
  redémarrage.
- Le jeton est renouvelé par un minuteur avant sa fin, un renouvellement à la
  fois, jamais deux en moins d’une minute. Les jetons de renouvellement
  d’Oura ne servent qu’une fois : le nouveau est enregistré tout de suite.
- Une valeur est publiée une fois par enregistrement (la valeur et son jour,
  ou la fréquence cardiaque et son heure) : rien n’est renvoyé quand Oura est
  en panne ou que la bague ne synchronise pas, et la fréquence cardiaque porte
  l’heure de sa mesure.

## États

- **Non connecté** : cliquez sur Connecter. L’intégration ne se connecte
  jamais d’elle-même.
- **Session terminée (renouvellement refusé)** : gardé à travers un
  redémarrage, jamais réessayé de lui-même ; cliquez sur Connecter pour
  autoriser de nouveau.
- **Accès refusé même avec un nouveau jeton** : gardé à travers un
  redémarrage ; cliquez sur Connecter, ou une fois sur **Tester Oura** (après
  l’intervalle).
- **Oura a refusé les données (403)** : l’API demande un abonnement Oura
  actif, ou les données du jour n’ont pas été autorisées (cliquez alors sur
  Connecter) ; nouvelle lecture après 6 heures.
- **Non lu cette fois : SpO2…** : une collection a été refusée (autorisation
  non accordée, bague sans cette fonction) ou a échoué ; les autres sont
  publiées.
- Un redémarrage du conteneur, ou une réponse d’Oura arrivée trop tard, dans
  les secondes mêmes d’un renouvellement peut perdre le nouveau jeton de
  renouvellement (il ne sert qu’une fois) : l’état devient alors **Session
  terminée** ; cliquez sur Connecter. Rare, inhérent aux jetons à usage
  unique.

## Confidentialité

- Lecture seule : l’intégration n’écrit jamais chez Oura.
- Les valeurs de santé restent en mémoire et vont seulement à Gladys : jamais
  dans les journaux, jamais dans un message d’état, jamais dans `/data`.
- Les jetons sont gardés en clair dans le volume `/data` de l’intégration
  (lisible par son conteneur seulement), envoyés seulement à Oura.
- Retirez l’accès quand vous voulez dans votre compte Oura (applications
  autorisées) ou en supprimant l’application sur le portail développeur.
