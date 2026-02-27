# 🎲 FICHY

> **Bluffa. Scommetti. Vinci.**  
> Il gioco del bluff con le fiches da poker — domande generate da AI, ogni partita è diversa.

![Status](https://img.shields.io/badge/status-live-brightgreen)
![Players](https://img.shields.io/badge/giocatori-2--8-gold)
![Stack](https://img.shields.io/badge/stack-React%20%2B%20Node.js%20%2B%20Socket.io-blue)
![AI](https://img.shields.io/badge/AI-Claude%20Sonnet-purple)

---

## 🕹️ Come si gioca

Fichy è un gioco multiplayer in tempo reale ispirato ai party game da salotto. Ogni round si svolge in due fasi:

**1. Fase risposta** — Viene posta una domanda di cultura generale con risposta precisa (un numero, un anno, un nome). Ogni giocatore scrive la propria risposta, giusta o volutamente falsa.

**2. Fase scommessa** — Tutte le risposte vengono mescolate con quella corretta e mostrate a tutti. Ognuno scommette le proprie fiches su quelle che ritiene vere:
- 🟢 Punti sulla **risposta corretta** → guadagni tante fiches quante ne hai puntate (+2x)
- 🔴 Punti su una **risposta sbagliata** → le perdi, e chi l'ha scritta le guadagna per averti ingannato

Vince chi ha più fiches dopo 6 round.

---

## ✨ Features

- 🤖 **Domande generate da AI** — Claude Sonnet genera domande trivia uniche ad ogni partita, su temi vari: storia, scienza, sport, cinema, gastronomia, tecnologia e altro
- ⚡ **Multiplayer real-time** — Socket.io garantisce sincronizzazione istantanea tra tutti i dispositivi
- 🔄 **Rejoin dopo disconnessione** — Se un giocatore cade, può rientrare con lo stesso nome e ritrova le sue fiches intatte
- 🎨 **Interfaccia stile casinò** — UI dark con estetica poker, animazioni fluide, ottimizzata per mobile
- 🏠 **Locale o online** — Giocabile sulla stessa rete WiFi o a distanza via internet
- 👑 **Codice stanza sempre visibile** — Il codice rimane in overlay durante tutta la partita per facilitare i rejoin

---

## 🚀 Deploy

### Server (Railway)
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app)

1. Fork questo repository
2. Crea un nuovo progetto su [railway.app](https://railway.app) → Deploy from GitHub repo
3. Aggiungi la variabile d'ambiente:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```
4. Copia l'URL pubblico generato da Railway

### Client (Netlify)
1. Crea `client/.env.production`:
   ```
   REACT_APP_SERVER_URL=https://tuo-server.up.railway.app
   ```
2. Build e deploy:
   ```bash
   cd client
   npm install && npm run build
   ```
3. Trascina la cartella `build/` su [netlify.com](https://netlify.com)

---

## 💻 Sviluppo locale

**Prerequisiti:** Node.js 18+, una API key Anthropic

```bash
# Clona il repo
git clone https://github.com/tuo-username/fichy.git
cd fichy

# Avvia il server
cd server
npm install
ANTHROPIC_API_KEY=sk-ant-xxxx node index.js
# → http://localhost:3001

# In un altro terminale, avvia il client
cd client
npm install
npm start
# → http://localhost:3000
```

Per giocare sulla stessa rete WiFi condividi l'IP locale del tuo PC con gli altri dispositivi.

---

## ⚙️ Configurazione

Nel file `server/index.js` puoi modificare i parametri di gioco:

```js
const STARTING_FICHES = 20;   // Fiches iniziali per giocatore
const ROUNDS_PER_GAME = 6;    // Numero di round per partita
const ANSWER_TIME = 60;       // Secondi per scrivere la risposta
const BET_TIME = 45;          // Secondi per piazzare le scommesse
```

---

## 🗂️ Struttura del progetto

```
fichy/
├── server/
│   ├── index.js        ← Logica di gioco, Socket.io, generazione domande AI
│   ├── package.json
│   └── Procfile        ← Configurazione Railway
└── client/
    ├── src/
    │   ├── App.js      ← Intera UI React (single file)
    │   └── index.js
    ├── public/
    │   └── index.html
    └── package.json
```

---

## 🛠️ Stack tecnico

| Layer | Tecnologia |
|---|---|
| Frontend | React 18, Socket.io-client |
| Backend | Node.js, Express, Socket.io |
| AI | Anthropic Claude Sonnet (generazione domande) |
| Deploy server | Railway |
| Deploy client | Netlify |
| Comunicazione | WebSocket (Socket.io) |

---

## 💰 Costi API

Le domande vengono generate da Claude Sonnet. Il costo per partita è irrisorio:

| Utilizzo | Costo stimato |
|---|---|
| 1 partita (6 round) | ~$0.013 |
| 100 partite | ~$1.30 |
| 1.000 partite | ~$13 |

Ottieni la tua API key su [console.anthropic.com](https://console.anthropic.com).

---

## 📋 Roadmap

- [ ] Link di invito diretto (join via URL)
- [ ] Modalità spettatore
- [ ] Reveal drammatico dei risultati
- [ ] Categorie a tema selezionabili
- [ ] Avatar giocatori
- [ ] Classifica condivisibile sui social
- [ ] Domanda del giorno con classifica globale

---

## 📄 Licenza

MIT — libero di usare, modificare e distribuire.