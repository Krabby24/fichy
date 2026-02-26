const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// In-memory game state
const rooms = {};

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

async function generateQuestion(usedQuestions = []) {
  const usedStr = usedQuestions.length > 0 ? `Non ripetere queste domande: ${usedQuestions.join('; ')}. ` : '';
  const prompt = `${usedStr}Genera UNA domanda di cultura generale molto specifica con risposta numerica o brevissima (max 3 parole). La risposta deve essere sorprendente o non ovvia ma verificabile. 
Rispondi SOLO con JSON: {"question": "...", "answer": "...", "hint": "una brevissima spiegazione della risposta"}
Esempi di stile: "Quante ossa ha il corpo umano adulto?" -> "206", "Quanto dura in minuti un film standard di Hollywood?" -> "110 minuti", "In che anno fu inventata la pizza margherita?" -> "1889"`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text.trim();
  const clean = text.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
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
    if (room.state !== 'lobby') return socket.emit('error', { message: 'Partita già iniziata!' });
    if (Object.keys(room.players).length >= 8) return socket.emit('error', { message: 'Stanza piena!' });

    room.players[socket.id] = {
      id: socket.id,
      name: playerName,
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
    const q = await generateQuestion(room.usedQuestions);
    room.currentQuestion = q;
    room.usedQuestions.push(q.question);

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

  // Send to clients (without isCorrect flag)
  const publicPool = room.answerPool.map(a => ({ id: a.id, text: a.text }));

  io.to(code).emit('bettingPhase', {
    answers: publicPool,
    players: getPlayersPublic(room),
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
        // Bet on correct: win 2x
        deltas[bettorId] = (deltas[bettorId] || 0) + amt;
      } else {
        // Bet on wrong: lose the bet, author gets it
        deltas[bettorId] = (deltas[bettorId] || 0) - amt;
        if (answer.authorId && answer.authorId !== bettorId) {
          deltas[answer.authorId] = (deltas[answer.authorId] || 0) + amt;
        }
      }
    });
  });

  // Apply deltas
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
