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

// Global sliding windows of used questions (max 100 per language)
// Persist across all rooms and sessions — prevent repeats server-wide
const QUESTION_BUFFER_SIZE = 100;
const globalUsedQuestions = {
  it: [],
  en: []
};

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

function normalizeLanguage(language) {
  return language === 'en' ? 'en' : 'it';
}

const SERVER_MESSAGES = {
  it: {
    roomNotFound: 'Stanza non trovata!',
    gameStarted: 'Partita già iniziata! Se eri in gioco, usa lo stesso nome per rientrare.',
    roomFull: 'Stanza piena!',
    needTwoPlayers: 'Servono almeno 2 giocatori!',
    playerDisconnected: 'Un giocatore ha lasciato il tavolo'
  },
  en: {
    roomNotFound: 'Room not found!',
    gameStarted: 'The game has already started! If you were playing, use the same name to rejoin.',
    roomFull: 'Room is full!',
    needTwoPlayers: 'At least 2 players are required!',
    playerDisconnected: 'A player has left the table'
  }
};

function getServerMessage(language, key) {
  const normalizedLanguage = normalizeLanguage(language);
  return SERVER_MESSAGES[normalizedLanguage][key];
}

async function generateQuestion(language = 'it') {
  const normalizedLanguage = normalizeLanguage(language);
  const languageName = normalizedLanguage === 'en' ? 'inglese' : 'italiano';
  const usedQuestions = globalUsedQuestions[normalizedLanguage];

  const usedStr = usedQuestions.length > 0
    ? `NON ripetere queste domande già usate: ${usedQuestions.join('; ')}. `
    : '';

  const prompt = `${usedStr}Genera UNA sola domanda trivia in ${languageName} per Fichy, un gioco tra amici basato anche sul bluff.

Domanda, risposta e hint devono essere interamente in ${languageName}.

La domanda ideale deve far pensare:
"Conosco l'argomento, posso ragionarci e inventare una risposta plausibile, ma non so con certezza quella corretta."

REGOLE:

- Usa un argomento familiare al pubblico generale, ma chiedi un fatto poco conosciuto.
- La difficoltà deve derivare dalla risposta non ovvia, NON da termini specialistici o argomenti oscuri.
- Deve essere possibile immaginare diverse risposte sbagliate ma credibili: questo è fondamentale per permettere ai giocatori di bluffare.
- Evita domande in cui la risposta è il primo pensiero che viene in mente o è praticamente suggerita dalla formulazione.
- Evita domande puramente nozionistiche in cui, se non conosci il fatto, puoi solo tirare a caso.
- La risposta deve essere sorprendente o curiosa quando viene rivelata.
- Deve esistere una sola risposta chiaramente corretta e verificabile. Evita fatti controversi, ambigui o dipendenti da definizioni discutibili.

VARIETÀ:
Guarda le domande già usate e cambia spesso area. Non concentrarti su animali, natura, scienza o qualunque altra categoria.
Alterna liberamente tra storia, geografia, sport, cinema, musica, tecnologia, aziende e prodotti famosi, cibo, vita quotidiana, spazio, natura, scienza e cultura generale.
Evita di ripetere la stessa curiosità o varianti molto simili.

ESEMPI DELLO STILE GIUSTO:

"Quale paese vinse il primo campionato mondiale di calcio femminile nel 1991?"
→ "Stati Uniti"

"Quale paese possiede il maggior numero di isole al mondo?"
→ "Svezia"

"Quale animale ha impronte digitali così simili a quelle umane da poter confondere un'indagine?"
→ "koala"

ESEMPI DA EVITARE:

"Quale frutto si usa per preparare il guacamole?"
→ troppo ovvia

"Quale casa automobilistica introdusse un modello con motore rotativo Wankel?"
→ troppo specialistica

RISPOSTA:
Deve essere un numero puro oppure un nome breve.
Se è numerica, non includere unità di misura nella risposta.

HINT:
Una sola frase breve che spiega la risposta o aggiunge una curiosità.

Rispondi esclusivamente con JSON valido:
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
  socket.on('createRoom', ({ playerName, language }) => {
    const code = generateRoomCode();
    const roomLanguage = normalizeLanguage(language);

    rooms[code] = {
      code,
      language: roomLanguage,
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
    socket.emit('roomCreated', {
      code,
      player: rooms[code].players[socket.id],
      language: roomLanguage
    });
    io.to(code).emit('roomUpdate', getRoomPublicState(code));
  });

  // Join room
  socket.on('joinRoom', ({ code, playerName, language }) => {
    const requestLanguage = normalizeLanguage(language);
    const room = rooms[code];

    if (!room) {
      return socket.emit('error', {
        message: getServerMessage(requestLanguage, 'roomNotFound')
      });
    }

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
      socket.emit('roomJoined', {
        code,
        player: room.players[socket.id],
        language: room.language,
        rejoin: true,
        gameState: room.state
      });
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
    if (room.state !== 'lobby') {
      return socket.emit('error', {
        message: getServerMessage(room.language, 'gameStarted')
      });
    }

    if (Object.keys(room.players).length >= 8) {
      return socket.emit('error', {
        message: getServerMessage(room.language, 'roomFull')
      });
    }

    room.players[socket.id] = {
      id: socket.id,
      name: playerName.trim(),
      fiches: STARTING_FICHES,
      connected: true
    };
    socket.join(code);
    socket.emit('roomJoined', {
      code,
      player: room.players[socket.id],
      language: room.language
    });
    io.to(code).emit('roomUpdate', getRoomPublicState(code));
  });

  // Start game
  socket.on('startGame', ({ code }) => {
    const room = rooms[code];

    if (!room || room.host !== socket.id) return;
    if (room.state !== 'lobby') return;

    if (Object.keys(room.players).length < 2) {
      return socket.emit('error', {
        message: getServerMessage(room.language, 'needTwoPlayers')
      });
    }

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
        io.to(code).emit('playerDisconnected', {
          playerId: socket.id,
          message: getServerMessage(room.language, 'playerDisconnected')
        });
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
    const q = await generateQuestion(room.language);
    room.currentQuestion = q;
    // Add to the language-specific global sliding window — remove oldest if over limit
    const questionBuffer = globalUsedQuestions[normalizeLanguage(room.language)];
    questionBuffer.push(q.question);

    if (questionBuffer.length > QUESTION_BUFFER_SIZE) {
      questionBuffer.shift();
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
    if (normalizeLanguage(room.language) === 'en') {
      room.currentQuestion = {
        question: 'How many bones are in the adult human body?',
        answer: '206',
        hint: 'Babies have around 270 bones, but some fuse together as they grow.'
      };
    } else {
      room.currentQuestion = {
        question: 'Quante ossa ha il corpo umano adulto?',
        answer: '206',
        hint: 'I neonati ne hanno circa 270, poi alcune si fondono.'
      };
    }
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
    language: room.language,
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