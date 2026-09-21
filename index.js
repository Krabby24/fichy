const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const OpenAI = require('openai');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// In-memory game state
const rooms = {};

// Global sliding window of used questions (max 100)
// Persists across all rooms and sessions — prevents repeats server-wide
const QUESTION_BUFFER_SIZE = 100;
const globalUsedQuestions = [];

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function generateQuestion() {
  const usedStr = globalUsedQuestions.length > 0 ? `NON ripetere queste domande già usate: ${globalUsedQuestions.join('; ')}. ` : '';
  const prompt = `${usedStr}Genera UNA sola domanda trivia in italiano per Fichy, un gioco tra amici adulti.

## OBIETTIVO DEL GIOCO

La domanda ideale di Fichy riguarda qualcosa che quasi tutti conoscono o riescono immediatamente a comprendere, ma chiede un fatto che quasi nessuno conosce con certezza.

Il giocatore deve pensare:
"Conosco bene l'argomento, potrei ragionarci... ma non so davvero la risposta."

Questa caratteristica è PIÙ IMPORTANTE della semplice difficoltà.

## CARATTERISTICHE DI UNA DOMANDA PERFETTA

La domanda deve avere contemporaneamente queste caratteristiche:

1. TEMA FAMILIARE
L'argomento deve essere comprensibile da una persona adulta senza conoscenze specialistiche.

Sono ottimi temi:
- vita quotidiana
- animali
- corpo umano
- tecnologia comune
- automobili
- cibo e bevande
- sport conosciuti
- cinema e musica
- geografia
- storia accessibile
- aziende e prodotti famosi
- invenzioni
- spazio e pianeti
- curiosità scientifiche comprensibili
- oggetti comuni
- cultura popolare
- record curiosi

2. RISPOSTA POCO CONOSCIUTA
La maggior parte dei giocatori non dovrebbe sapere immediatamente la risposta.

Evita fatti scolastici, domande classiche da quiz o informazioni estremamente famose.

3. POSSIBILITÀ DI RAGIONARE
Anche senza sapere la risposta, un giocatore deve poter formulare 2-5 ipotesi plausibili usando intuizione, cultura generale o associazioni.

Una domanda NON è buona se:
- o conosci una nozione specialistica,
- oppure puoi soltanto tirare completamente a caso.

4. EFFETTO "NON LO SAPEVO"
La risposta dovrebbe essere interessante, curiosa o leggermente sorprendente quando viene rivelata.

5. POCHI INDIZI, MA SUFFICIENTI
Non inserire nella domanda così tanti dettagli da rendere la risposta quasi evidente.

Gli indizi devono permettere di capire bene la domanda, non risolverla automaticamente.

6. NIENTE NICCHIE SPECIALISTICHE
Evita termini o conoscenze che appartengono soprattutto a:
- ingegneria specialistica
- medicina avanzata
- modelli specifici di automobili
- componenti tecnici
- tassonomia scientifica avanzata
- battaglie o personaggi storici minori
- statistiche sportive oscure
- prodotti tecnologici dimenticati
- dettagli industriali molto specifici

Un termine tecnico può essere usato solamente se è ampiamente conosciuto dal pubblico generale.

## CONTROLLO DELLA DIFFICOLTÀ

NON confondere "difficile" con "oscuro".

Una buona domanda è difficile perché la risposta è poco conosciuta.

Una cattiva domanda è difficile perché l'argomento stesso è sconosciuto.

Preferisci sempre:
ARGOMENTO FAMILIARE + RISPOSTA INSOLITA

rispetto a:
ARGOMENTO SPECIALISTICO + RISPOSTA IMPOSSIBILE DA DEDURRE

## EVITA DOMANDE TROPPO FACILI

Evita domande in cui:
- un singolo indizio famoso rivela praticamente la risposta;
- la risposta è cultura generale elementare;
- la formulazione contiene indirettamente la soluzione;
- esiste una sola associazione immediata possibile.

Esempio da evitare:
"Quale azienda produttrice di pneumatici pubblicò una famosa guida gastronomica?"
È troppo guidata: pneumatici + guida gastronomica rende la risposta quasi immediata.

## EVITA DOMANDE TROPPO DI NICCHIA

Esempio da evitare:
"Quale casa automobilistica introdusse per prima un modello di serie con motore rotativo Wankel?"
Richiede familiarità con una tecnologia automobilistica specifica e non permette alla maggior parte delle persone di ragionare.

## ESEMPI DEL TIPO DI DOMANDA CHE FUNZIONA BENE

"Quale paese vinse il primo campionato mondiale di calcio femminile nel 1991?"
→ "Stati Uniti"

"Quale animale è noto per avere tre cuori e sangue blu?"
→ "polpo"

"Quale paese è considerato il luogo di nascita del karaoke?"
→ "Giappone"

"Quale oggetto fu il primo prodotto ad avere il proprio codice a barre scansionato alla cassa nel 1974?"
→ "chewing gum"

"In che anno fu fondata IKEA?"
→ "1943"

Nota il principio comune:
il soggetto è conosciuto, ma la risposta non è normalmente conosciuta con certezza.

NON copiare o riformulare continuamente questi esempi.

## RISPOSTE NUMERICHE E NON NUMERICHE

NON privilegiare le domande numeriche.

La risposta può essere indifferentemente:
- un numero;
- un anno;
- un paese;
- una città;
- una persona;
- un animale;
- un'azienda;
- un prodotto;
- un oggetto;
- un pianeta;
- un nome molto breve.

Scegli il formato che produce la domanda più divertente.

Cerca varietà rispetto alle domande già utilizzate.

## FORMATO DELLA RISPOSTA CORRETTA

La risposta deve essere:
- un numero puro; oppure
- un nome molto breve, idealmente da 1 a 4 parole.

Se la risposta è numerica, NON inserire unità di misura nella risposta.

SBAGLIATO:
"160 km/h"
"4 anni"
"3 litri"

CORRETTO:
"160"
"4"
"3"

L'unità deve già comparire nella domanda.

## SOLIDITÀ FATTUALE — REGOLA FONDAMENTALE

Genera solamente domande la cui risposta ritieni altamente affidabile e univoca.

Evita una domanda se:
- esistono diverse risposte possibili a seconda della definizione;
- il fatto è controverso;
- dipende da una leggenda o da una versione non verificabile;
- il dato cambia frequentemente;
- il record potrebbe non essere più attuale;
- non sei sicuro della risposta;
- parole come "primo", "inventò", "più grande", "più antico" o "maggior numero" rendono la risposta ambigua.

Puoi usare questi concetti solamente quando il fatto è stabile e la risposta è chiaramente riconosciuta.

Meglio rinunciare a una domanda interessante che generare una domanda contestabile.

## STILE

La domanda deve:
- essere breve;
- essere naturale in italiano;
- essere immediatamente comprensibile;
- non contenere spiegazioni inutili;
- non sembrare scritta da un'enciclopedia;
- non aggiungere frasi decorative che non aiutano il gioco.

Elimina dettagli superflui.

## VARIETÀ

Osserva le domande già utilizzate indicate sopra.

Evita:
- domande identiche o quasi identiche;
- lo stesso fatto raccontato in modo diverso;
- sequenze di domande tutte sullo stesso argomento;
- troppe risposte dello stesso tipo;
- troppe domande basate su "chi fu il primo...";
- troppe domande basate su anni o numeri.

## HINT

L'hint deve essere una sola frase breve che, dopo la rivelazione della risposta, spiega perché quella risposta è corretta o aggiunge una piccola curiosità utile.

Non deve introdurre affermazioni dubbie o inutilmente complicate.

Rispondi ESCLUSIVAMENTE con JSON valido nel seguente formato:

{"question":"...","answer":"...","hint":"..."}`;

  const response = await openai.responses.create({
    model: 'gpt-5.6-luna',
    reasoning: { effort: 'none' },
    max_output_tokens: 300,
    input: prompt,
    text: {
      format: {
        type: 'json_schema',
        name: 'trivia_question',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            question: { type: 'string' },
            answer: { type: 'string' },
            hint: { type: 'string' }
          },
          required: ['question', 'answer', 'hint'],
          additionalProperties: false
        }
      }
    }
  });

  if (response.status !== 'completed' || !response.output_text) {
    throw new Error(`OpenAI question generation failed: ${response.status}`);
  }
  return JSON.parse(response.output_text);
}

const STARTING_FICHES = 20;
const ROUNDS_PER_GAME = 6;
const ANSWER_TIME = 60; // seconds
const BET_TIME = 45; // seconds

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Create room
  socket.on('createRoom', ({ playerName }) => {
    const code = generateRoomCode();
    rooms[code] = {
      code,
      host: socket.id,
      players: {
        [socket.id]: {
          id: socket.id,
          name: playerName,
          fiches: STARTING_FICHES,
          connected: true
        }
      },
      state: 'lobby', // lobby | answering | betting | results | gameover
      round: 0,
      currentQuestion: null,
      answers: {}, // playerId -> answer text
      bets: {},    // playerId -> { answerId: amount }
      usedQuestions: [],
      timer: null
    };
    socket.join(code);
    socket.emit('roomCreated', { code, player: rooms[code].players[socket.id] });
    io.to(code).emit('roomUpdate', getRoomPublicState(code));
  });

  // Join room
  socket.on('joinRoom', ({ code, playerName }) => {
    const room = rooms[code];
    if (!room) return socket.emit('error', { message: 'Stanza non trovata!' });

    // Check if this is a REJOIN (same name, was in the room before)
    const existingEntry = Object.values(room.players).find(
      p => p.name.toLowerCase() === playerName.trim().toLowerCase() && !p.connected
    );

    if (existingEntry) {
      // Rejoin: migrate old player data to new socket id
      const oldId = existingEntry.id;
      const playerData = { ...existingEntry, id: socket.id, connected: true };
      delete room.players[oldId];
      room.players[socket.id] = playerData;

      // Update host if needed
      if (room.host === oldId) room.host = socket.id;

      // Update answers/bets keys if they referenced old socket id
      if (room.answers[oldId] !== undefined) {
        room.answers[socket.id] = room.answers[oldId];
        delete room.answers[oldId];
      }
      if (room.bets[oldId] !== undefined) {
        room.bets[socket.id] = room.bets[oldId];
        delete room.bets[oldId];
      }
      // Update answerPool authorId if present
      if (room.answerPool) {
        room.answerPool = room.answerPool.map(a =>
          a.authorId === oldId ? { ...a, id: socket.id, authorId: socket.id } : a
        );
      }

      socket.join(code);
      socket.emit('roomJoined', { code, player: room.players[socket.id], rejoin: true, gameState: room.state });
      io.to(code).emit('roomUpdate', getRoomPublicState(code));
      io.to(code).emit('playerRejoined', { playerName: playerData.name });

      // Send current game state so the rejoining player can catch up
      if (room.state === 'answering') {
        socket.emit('questionReady', {
          round: room.round,
          total: ROUNDS_PER_GAME,
          question: room.currentQuestion.question,
          timeLimit: ANSWER_TIME
        });
      } else if (room.state === 'betting') {
        const publicPool = room.answerPool.map(a => ({ id: a.id, text: a.text }));
        socket.emit('bettingPhase', {
          answers: publicPool,
          players: getPlayersPublic(room),
          timeLimit: BET_TIME
        });
      } else if (room.state === 'results') {
        // They missed the results, just show room update — next round will catch them
      }
      return;
    }

    // Normal join — only allowed in lobby
    if (room.state !== 'lobby') return socket.emit('error', { message: 'Partita già iniziata! Se eri in gioco, usa lo stesso nome per rientrare.' });
    if (Object.keys(room.players).length >= 8) return socket.emit('error', { message: 'Stanza piena!' });

    room.players[socket.id] = {
      id: socket.id,
      name: playerName.trim(),
      fiches: STARTING_FICHES,
      connected: true
    };
    socket.join(code);
    socket.emit('roomJoined', { code, player: room.players[socket.id] });
    io.to(code).emit('roomUpdate', getRoomPublicState(code));
  });

  // Start game
  socket.on('startGame', ({ code }) => {
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;
    if (Object.keys(room.players).length < 2) return socket.emit('error', { message: 'Servono almeno 2 giocatori!' });
    startRound(code);
  });

  // Submit answer
  socket.on('submitAnswer', ({ code, answer }) => {
    const room = rooms[code];
    if (!room || room.state !== 'answering') return;
    if (room.answers[socket.id] !== undefined) return; // already answered
    room.answers[socket.id] = answer.trim() || '???';
    io.to(code).emit('answerReceived', { playerId: socket.id, count: Object.keys(room.answers).length });

    // All answered?
    if (Object.keys(room.answers).length === Object.keys(room.players).length) {
      clearTimeout(room.timer);
      startBetting(code);
    }
  });

  // Submit bets
  socket.on('submitBets', ({ code, bets }) => {
    const room = rooms[code];
    if (!room || room.state !== 'betting') return;
    if (room.bets[socket.id] !== undefined) return;
    room.bets[socket.id] = bets; // { answerId: amount }
    io.to(code).emit('betReceived', { playerId: socket.id, count: Object.keys(room.bets).length });

    if (Object.keys(room.bets).length === Object.keys(room.players).length) {
      clearTimeout(room.timer);
      resolveRound(code);
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    for (const code in rooms) {
      const room = rooms[code];
      if (room.players[socket.id]) {
        room.players[socket.id].connected = false;
        io.to(code).emit('playerDisconnected', { playerId: socket.id });
        // If host disconnects, assign new host
        if (room.host === socket.id) {
          const others = Object.keys(room.players).filter(id => id !== socket.id && room.players[id].connected);
          if (others.length > 0) {
            room.host = others[0];
            io.to(code).emit('newHost', { hostId: room.host });
          }
        }
      }
    }
  });

  // Next round (host only)
  socket.on('nextRound', ({ code }) => {
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;
    if (room.round >= ROUNDS_PER_GAME) {
      endGame(code);
    } else {
      startRound(code);
    }
  });
});

async function startRound(code) {
  const room = rooms[code];
  room.state = 'answering';
  room.answers = {};
  room.bets = {};
  room.round += 1;

  io.to(code).emit('roundStarting', { round: room.round, total: ROUNDS_PER_GAME });

  try {
    const q = await generateQuestion();
    room.currentQuestion = q;
    // Add to global sliding window — remove oldest if over limit
    globalUsedQuestions.push(q.question);
    if (globalUsedQuestions.length > QUESTION_BUFFER_SIZE) {
      globalUsedQuestions.shift();
    }

    io.to(code).emit('questionReady', {
      round: room.round,
      total: ROUNDS_PER_GAME,
      question: q.question,
      timeLimit: ANSWER_TIME
    });

    room.timer = setTimeout(() => {
      // Fill missing answers
      Object.keys(room.players).forEach(pid => {
        if (!room.answers[pid]) room.answers[pid] = '???';
      });
      startBetting(code);
    }, ANSWER_TIME * 1000);

  } catch (e) {
    console.error('Question generation failed:', e);
    // Fallback question
    room.currentQuestion = {
      question: 'Quante ossa ha il corpo umano adulto?',
      answer: '206',
      hint: 'I neonati ne hanno circa 270, poi alcune si fondono.'
    };
    io.to(code).emit('questionReady', {
      round: room.round,
      total: ROUNDS_PER_GAME,
      question: room.currentQuestion.question,
      timeLimit: ANSWER_TIME
    });
    room.timer = setTimeout(() => {
      Object.keys(room.players).forEach(pid => {
        if (!room.answers[pid]) room.answers[pid] = '???';
      });
      startBetting(code);
    }, ANSWER_TIME * 1000);
  }
}

function startBetting(code) {
  const room = rooms[code];
  room.state = 'betting';

  // Save fiches snapshot at start of betting round (for reference)
  room.fichesAtRoundStart = {};
  Object.keys(room.players).forEach(pid => {
    room.fichesAtRoundStart[pid] = room.players[pid].fiches;
  });

  // Build answer pool: all player answers + correct answer
  const correctAnswer = room.currentQuestion.answer;
  const playerAnswers = Object.entries(room.answers).map(([pid, ans]) => ({
    id: pid,
    text: ans,
    isCorrect: ans.toLowerCase().trim() === correctAnswer.toLowerCase().trim(),
    authorId: pid
  }));

  // Add correct answer if no one got it right
  const hasCorrect = playerAnswers.some(a => a.isCorrect);
  const allAnswers = [...playerAnswers];
  if (!hasCorrect) {
    allAnswers.push({
      id: 'correct_' + Date.now(),
      text: correctAnswer,
      isCorrect: true,
      authorId: null
    });
  }

  // Shuffle
  room.answerPool = shuffleArray(allAnswers);

  // Send to clients (without isCorrect flag, but with FRESH fiches)
  const publicPool = room.answerPool.map(a => ({ id: a.id, text: a.text }));

  io.to(code).emit('bettingPhase', {
    answers: publicPool,
    players: getPlayersPublic(room), // always fresh from room.players
    timeLimit: BET_TIME
  });

  room.timer = setTimeout(() => {
    // Auto-bet nothing for those who didn't bet
    Object.keys(room.players).forEach(pid => {
      if (!room.bets[pid]) room.bets[pid] = {};
    });
    resolveRound(code);
  }, BET_TIME * 1000);
}

function resolveRound(code) {
  const room = rooms[code];
  room.state = 'results';

  const correctAnswer = room.currentQuestion.answer;
  const pool = room.answerPool;

  // Calculate winnings/losses
  const deltas = {};
  Object.keys(room.players).forEach(pid => { deltas[pid] = 0; });

  Object.entries(room.bets).forEach(([bettorId, bets]) => {
    Object.entries(bets).forEach(([answerId, amount]) => {
      const amt = parseInt(amount) || 0;
      if (amt <= 0) return;
      const answer = pool.find(a => a.id === answerId);
      if (!answer) return;

      if (answer.isCorrect) {
        // Bet on correct: win back bet + same profit (net +amt)
        deltas[bettorId] = (deltas[bettorId] || 0) + amt;
      } else {
        // Bet on wrong: lose bet, author gains it
        deltas[bettorId] = (deltas[bettorId] || 0) - amt;
        if (answer.authorId && answer.authorId !== bettorId) {
          deltas[answer.authorId] = (deltas[answer.authorId] || 0) + amt;
        }
      }
    });
  });

  // Apply deltas to actual fiches — this is the single source of truth
  Object.entries(deltas).forEach(([pid, delta]) => {
    if (room.players[pid]) {
      room.players[pid].fiches = Math.max(0, room.players[pid].fiches + delta);
    }
  });

  // Reveal who wrote what
  const revealedPool = pool.map(a => ({
    ...a,
    authorName: a.authorId && room.players[a.authorId] ? room.players[a.authorId].name : null
  }));

  io.to(code).emit('roundResults', {
    correctAnswer,
    hint: room.currentQuestion.hint,
    pool: revealedPool,
    bets: room.bets,
    deltas,
    players: getPlayersPublic(room),
    round: room.round,
    total: ROUNDS_PER_GAME,
    isLastRound: room.round >= ROUNDS_PER_GAME
  });
}

function endGame(code) {
  const room = rooms[code];
  room.state = 'gameover';
  const ranking = Object.values(room.players)
    .sort((a, b) => b.fiches - a.fiches);
  io.to(code).emit('gameOver', { ranking });
}

function getRoomPublicState(code) {
  const room = rooms[code];
  return {
    code: room.code,
    state: room.state,
    round: room.round,
    total: ROUNDS_PER_GAME,
    players: getPlayersPublic(room),
    hostId: room.host
  };
}

function getPlayersPublic(room) {
  return Object.values(room.players).map(p => ({
    id: p.id,
    name: p.name,
    fiches: p.fiches,
    connected: p.connected
  }));
}

// Health check
app.get('/', (req, res) => res.json({ status: 'Fichy server running' }));

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Fichy server on port ${PORT}`));