# Longueur d'onde en ligne

Le jeu Longueur d'onde (Wavelength), jouable à plusieurs, chacun sur son téléphone, avec des rooms.

## Lancer en local

```bash
npm install
npm start          # http://localhost:3000
```

Pour jouer avec des amis sur le même Wi-Fi : ouvre `http://<ip-de-ton-pc>:3000` sur les téléphones.

## Comment ça marche

1. Un joueur crée une room et obtient un code à 4 lettres (et un lien `/<CODE>` à partager).
2. Les autres rejoignent avec le code ou le lien. L'hôte (★) choisit le nombre de tours et lance la partie.
3. À chaque manche, le meneur change. Lui seul reçoit la cible (le serveur ne l'envoie qu'à lui). Il peut tirer une autre carte ou écrire un thème libre, puis envoie son indice.
4. Tous les autres placent leur aiguille en secret et valident. Quand tout le monde a validé, le cadran s'ouvre pour tout le monde.
5. Points : zone 4 / 3 / 2, +1 pour le devineur le plus proche, et le meneur gagne la moitié du meilleur score.

Si quelqu'un recharge la page ou perd le réseau, il revient automatiquement dans sa room avec son score. Si l'hôte part, un autre joueur devient hôte. L'hôte peut passer une manche bloquée.

## Fichiers

- `server.js` : serveur HTTP + Socket.IO, rooms et règles (le serveur fait foi)
- `deck.js` : les cartes (paires d'opposés), facile à compléter
- `public/index.html` : le client (une seule page)

Les rooms sont gardées en mémoire : un redémarrage du serveur les efface.

## Mettre en ligne

N'importe quel hébergeur Node qui supporte les WebSockets marche (Render, Railway, Fly.io…) :
commande de démarrage `npm start`, le port est lu dans `PORT`. Garde une seule instance (les rooms sont en mémoire).
