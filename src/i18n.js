// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, buttons, device and feature
// names), in English and French. No message ever carries a health value.
// -----------------------------------------------------------------------------

/** The text of `texts` in `language`, English otherwise. */
export const word = (texts, language) => texts[language] ?? texts.en;

const both = (en, fr) => ({ en, fr });

/** Two messages one after the other, in each language. */
export const join = (...messages) =>
  both(messages.map((m) => m.en).join(' '), messages.map((m) => m.fr).join(' '));

/** "25 min" / "3 h", for the pauses. */
export function age(ms) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 120) {
    return both(`${minutes} min`, `${minutes} min`);
  }
  const hours = Math.round(minutes / 60);
  return both(`${hours} h`, `${hours} h`);
}

export const DEVICE_NAME = both('Oura ring', 'Bague Oura');

/** Feature names, in the language chosen in the configuration (the unit in the name when the core has none). */
export const FEATURE_NAMES = {
  sleep_score: both('Sleep score', 'Score de sommeil'),
  readiness_score: both('Readiness score', 'Score de récupération (readiness)'),
  activity_score: both('Activity score', 'Score d’activité'),
  sleep_duration: both('Sleep duration', 'Durée de sommeil'),
  deep_sleep: both('Deep sleep', 'Sommeil profond'),
  rem_sleep: both('REM sleep', 'Sommeil paradoxal (REM)'),
  lowest_heart_rate: both(
    'Lowest heart rate during sleep (bpm)',
    'Fréquence cardiaque la plus basse du sommeil (bpm)',
  ),
  average_hrv: both(
    'Average heart rate variability during sleep (ms)',
    'Variabilité cardiaque moyenne du sommeil (ms)',
  ),
  temperature_deviation: both(
    'Body temperature deviation (°C)',
    'Écart de température corporelle (°C)',
  ),
  spo2: both(
    'Average blood oxygen during sleep (SpO2, %)',
    'Oxygène sanguin moyen du sommeil (SpO2, %)',
  ),
  steps: both('Steps of the day', 'Pas du jour'),
  active_calories: both('Active calories of the day (kcal)', 'Calories actives du jour (kcal)'),
  heart_rate: both('Latest heart rate (bpm)', 'Dernière fréquence cardiaque (bpm)'),
};

/** The names of the collections, for a status that lists those not read. */
export const COLLECTION_NAMES = {
  daily_readiness: both('readiness', 'récupération'),
  daily_activity: both('activity', 'activité'),
  sleep: both('sleep periods', 'périodes de sommeil'),
  daily_spo2: both('SpO2', 'SpO2'),
  heartrate: both('heart rate', 'fréquence cardiaque'),
};

export const T = {
  noClient: both(
    'Enter the client id and the client secret of your Oura app (see the guide), save, then click Connect.',
    'Saisissez l’identifiant client (client id) et le secret client (client secret) de votre application Oura (voir le guide), enregistrez, puis cliquez sur Connecter.',
  ),
  signedOut: both(
    'Not signed in to Oura: click Connect (see the steps above). The integration never signs in by itself.',
    'Non connecté à Oura : cliquez sur Connecter (voir les étapes plus haut). L’intégration ne se connecte jamais d’elle-même.',
  ),
  expired: both(
    'The Oura session ended (renewal refused): click Connect to authorize again. Nothing is retried by itself.',
    'La session Oura a pris fin (renouvellement refusé) : cliquez sur Connecter pour autoriser de nouveau. Rien n’est réessayé de lui-même.',
  ),
  unauthorized: both(
    'Oura refused the access even with a new token: click Connect to authorize again (or "Test Oura" once). Nothing is retried by itself.',
    'Oura a refusé l’accès même avec un nouveau jeton : cliquez sur Connecter pour autoriser de nouveau (ou une fois sur « Tester Oura »). Rien n’est réessayé de lui-même.',
  ),
  connecting: both('Reading Oura…', 'Lecture d’Oura…'),
  nextRead: (wait) =>
    both(`Oura: next read in ${wait.en}.`, `Oura : prochaine lecture dans ${wait.fr}.`),
  connected: both(
    'Connected to Oura. Open Discovery to add the ring.',
    'Connecté à Oura. Ouvrez Découverte pour ajouter la bague.',
  ),
  noRecentData: both(
    'Connected to Oura, but no recent sleep data (the ring or the Oura app did not sync since yesterday).',
    'Connecté à Oura, mais aucune donnée de sommeil récente (la bague ou l’application Oura n’a pas synchronisé depuis hier).',
  ),
  partial: (names) =>
    both(
      `Not read this time: ${names.map((n) => n.en).join(', ')} (scope not granted, feature absent or error; tried again at the next read).`,
      `Non lu cette fois : ${names.map((n) => n.fr).join(', ')} (autorisation non accordée, fonction absente ou erreur ; nouvel essai à la prochaine lecture).`,
    ),
  rateLimited: (wait) =>
    both(
      `Oura asks to slow down: pause of ${wait.en}.`,
      `Oura demande de ralentir : pause de ${wait.fr}.`,
    ),
  unavailable: (wait) =>
    both(
      `Oura is unavailable (server error): next try in ${wait.en}.`,
      `Oura est indisponible (erreur du serveur) : nouvel essai dans ${wait.fr}.`,
    ),
  forbidden: (wait) =>
    both(
      `Oura refused the data (403: the API needs an active Oura membership, or the daily data was not allowed: then click Connect): next try in ${wait.en}.`,
      `Oura a refusé les données (403 : l’API demande un abonnement Oura actif, ou les données du jour n’ont pas été autorisées : cliquez alors sur Connecter) : nouvel essai dans ${wait.fr}.`,
    ),
  budget: (wait) =>
    both(
      `The daily number of requests of this integration is reached: next read in ${wait.en} (after midnight UTC).`,
      `Le nombre de requêtes du jour de cette intégration est atteint : prochaine lecture dans ${wait.fr} (après minuit UTC).`,
    ),
  unreachable: (reason, wait) =>
    both(
      `Oura could not be read (${reason}): next try in ${wait.en}.`,
      `Oura n’a pas pu être lu (${reason}) : nouvel essai dans ${wait.fr}.`,
    ),
  renewWaiting: (reason, wait) =>
    both(
      `The Oura session could not be renewed (${reason}): next try in ${wait.en}.`,
      `La session Oura n’a pas pu être renouvelée (${reason}) : nouvel essai dans ${wait.fr}.`,
    ),
  busy: both(
    'A read is already running: try again in a moment.',
    'Une lecture est déjà en cours : réessayez dans un instant.',
  ),
  test: {
    cooldown: both('Tested less than 30 seconds ago.', 'Testé il y a moins de 30 secondes.'),
  },
  signIn: {
    redirectHint: (address) =>
      both(
        `The return address of this Gladys is ${address} — it must be a redirect URI of your Oura app.`,
        `L’adresse de retour de ce Gladys est ${address} — ce doit être une URL de redirection (redirect URI) de votre application Oura.`,
      ),
    noRedirect: both(
      'Gladys gave no return address: write the redirect URI of your Oura app in the configuration.',
      'Gladys n’a donné aucune adresse de retour : saisissez l’URL de redirection de votre application Oura dans la configuration.',
    ),
    noCode: both(
      'No authorization code in the pasted text: paste the whole address the browser ended on (it holds code= and state=).',
      'Aucun code d’autorisation dans le texte collé : collez l’adresse complète sur laquelle le navigateur s’est arrêté (elle contient code= et state=).',
    ),
    unknown: both(
      'This address does not belong to an authorization started in the last 15 minutes: click Connect again.',
      'Cette adresse ne correspond à aucune autorisation démarrée dans les 15 dernières minutes : cliquez de nouveau sur Connecter.',
    ),
    cancelled: (detail) =>
      both(
        `Oura did not authorize the app (${detail}): click Connect again.`,
        `Oura n’a pas autorisé l’application (${detail}) : cliquez de nouveau sur Connecter.`,
      ),
    refused: (detail) =>
      both(
        `Oura refused the authorization (${detail}): check the client id, the client secret, the redirect URI and the token endpoint, then click Connect again.`,
        `Oura a refusé l’autorisation (${detail}) : vérifiez l’identifiant client, le secret client, l’URL de redirection et le point d’échange des jetons, puis cliquez de nouveau sur Connecter.`,
      ),
    failed: (reason) =>
      both(
        `Oura could not be reached (${reason}): paste the same address again in a moment.`,
        `Oura n’a pas pu être joint (${reason}) : collez de nouveau la même adresse dans un instant.`,
      ),
    wrongAddress: both(
      'This address is not the redirect URI of the authorization: paste the address the browser ended on after the Oura page (the authorization stays usable).',
      'Cette adresse n’est pas l’URL de redirection de l’autorisation : collez l’adresse sur laquelle le navigateur s’est arrêté après la page d’Oura (l’autorisation reste utilisable).',
    ),
    retryConnect: (reason) =>
      both(
        `Oura could not be reached (${reason}): click Connect again.`,
        `Oura n’a pas pu être joint (${reason}) : cliquez de nouveau sur Connecter.`,
      ),
    slow: both(
      'Oura is slow to answer: click Connect again.',
      'Oura lent, cliquez de nouveau sur Connecter.',
    ),
    noRefresh: both(
      'Oura gave no renewal token: click Connect again.',
      'Oura n’a donné aucun jeton de renouvellement : cliquez de nouveau sur Connecter.',
    ),
    done: both('Authorized by Oura: reading the data…', 'Autorisé par Oura : lecture des données…'),
    doneLater: (wait) =>
      both(
        `Authorized by Oura; next read in ${wait.en} (never sooner than the refresh interval after the last read).`,
        `Autorisé par Oura ; prochaine lecture dans ${wait.fr} (jamais plus tôt que l’intervalle de relecture après la dernière lecture).`,
      ),
  },
};
