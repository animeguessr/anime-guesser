const express = require('express');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const session = require('express-session');
const WebSocket = require('ws');
const crypto = require('crypto');
const unaccent = require('unaccent'); // Assurez-vous que ce module est installé

const app = express();
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

const imageDirectory = path.join(__dirname, 'caractere');
const openingDirectory = path.join(__dirname, 'opening', 'opening');
const imagesDirectory = path.join(__dirname, 'images');


// Configuration du pool de connexions à la base de données
const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'animeguesse',
    password: process.env.DB_PASSWORD || '2fG^cFx$#f7N@',
    port: process.env.DB_PORT || 5432
});

// Middleware
app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'votre_cle_secrete',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));
app.use(express.static(__dirname));
app.use('/caractere', express.static(path.join(__dirname, 'caractere')));
app.use('/images', express.static(path.join(__dirname, 'images')));
app.use('/opening', express.static(path.join(__dirname, 'opening', 'opening')));

// Fonctions utilitaires
function normalizeString(str) {
    return str
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^(le|la|les|l|un|une|des)\s+/i, "");
}

function getLevelCriteria(level, modifier = 0) {
    const criteriaByLevel = {
        'very_easy': { maxPopularity: 350, types: ['TV'], includeSequels: false },
        'easy': { maxPopularity: 650, types: ['TV', 'Movie'], includeSequels: false },
        'normal': { maxPopularity: 900, types: ['TV', 'Movie'], includeSequels: false },
        'hard': { maxPopularity: 2000, types: ['TV', 'Movie', 'OVA'], includeSequels: true, excludeTop: 400 },
        'impossible': { maxPopularity: 5000, types: ['Movie', 'OVA', 'ONA', 'Special'], includeSequels: true, excludeTop: 1000 }
    };
    const baseCriteria = criteriaByLevel[level] || criteriaByLevel['very_easy'];
    baseCriteria.maxPopularity = Math.min(Math.max(baseCriteria.maxPopularity + modifier, 100), 5000);
    return baseCriteria;
}

function shuffleArray(array) {
    let m = array.length, t, i;
    while (m) {
        i = Math.floor(crypto.randomInt(0, m--));
        t = array[m];
        array[m] = array[i];
        array[i] = t;
    }
    return array;
}

// Routes existantes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/game.html', (req, res) => res.sendFile(path.join(__dirname, 'game.html')));
app.get('/gameplay.html', (req, res) => res.sendFile(path.join(__dirname, 'gameplay.html')));

app.get('/set-level', (req, res) => {
    req.session.level = req.query.level;
    req.session.difficultyModifier = 0;
    res.redirect('/gameplay.html');
});

app.get('/anime-images', async (req, res) => {
    try {
        const level = req.session.level || 'very_easy';
        const difficultyModifier = req.session.difficultyModifier || 0;
        const criteria = getLevelCriteria(level, difficultyModifier);
        req.session.usedAnimeIds = req.session.usedAnimeIds || [];

        const conditions = ['popularity <= $1', 'anime_type = ANY($2)'];
        const values = [criteria.maxPopularity, criteria.types];
        let paramIndex = 3;

        if (!criteria.includeSequels) {
            conditions.push(`is_sequel = FALSE`);
        }
        if (criteria.excludeTop) {
            conditions.push(`popularity > $${paramIndex}`);
            values.push(criteria.excludeTop);
            paramIndex++;
        }
        if (req.session.usedAnimeIds.length > 0) {
            conditions.push(`id != ALL($${paramIndex})`);
            values.push(req.session.usedAnimeIds);
            paramIndex++;
        }

        const query = `SELECT * FROM animes WHERE ${conditions.join(' AND ')} ORDER BY RANDOM() LIMIT 1`;
        const { rows } = await pool.query(query, values);

        if (rows.length === 0) {
            req.session.usedAnimeIds = [];
            const resetConditions = conditions.filter(cond => !cond.includes('id != ALL'));
            const resetQuery = `SELECT * FROM animes WHERE ${resetConditions.join(' AND ')} ORDER BY RANDOM() LIMIT 1`;
            const resetValues = values.slice(0, paramIndex - 1);
            const resetResult = await pool.query(resetQuery, resetValues);
            if (resetResult.rows.length === 0) {
                return res.status(404).send('Aucun animé trouvé');
            }
            rows.push(resetResult.rows[0]);
        }

        const currentAnime = rows[0];
        req.session.currentAnime = currentAnime;
        req.session.usedAnimeIds.push(currentAnime.id);

        const imageFileName = path.basename(currentAnime.image_url);
        const imageUrl = `/images/${imageFileName}`;
        const imagePath = path.join(imagesDirectory, imageFileName);

        if (!fs.existsSync(imagePath)) {
            console.error('Image non trouvée :', imagePath);
            return res.status(404).send('Image non trouvée');
        }

        res.json({
            id: currentAnime.id,
            title: currentAnime.title,
            alt_title: currentAnime.alt_title,
            popularity: currentAnime.popularity,
            image_url: imageUrl
        });
    } catch (error) {
        console.error('Erreur lors de la récupération de l\'image :', error);
        res.status(500).send('Erreur lors de la récupération de l\'image');
    }
});

app.get('/reset-used-animes', (req, res) => {
    req.session.usedAnimeIds = [];
    res.sendStatus(200);
});

app.post('/check-answer', (req, res) => {
    const userAnswer = normalizeString(req.body.answer || '');
    const possibleTitles = (req.body.possibleTitles || []).map(title => normalizeString(title || ''));
    const currentAnime = req.session.currentAnime;

    if (!currentAnime) return res.json({ correct: false });

    const correctTitles = [
        normalizeString(currentAnime.title || ''),
        normalizeString(currentAnime.alt_title || '')
    ];

    const isSimilar = (a, b) => {
        const distance = levenshteinDistance(a, b);
        const maxLength = Math.max(a.length, b.length);
        return (maxLength - distance) / maxLength >= 0.8;
    };

    const correct = possibleTitles.some(userTitle =>
        correctTitles.some(correctTitle => isSimilar(userTitle, correctTitle))
    );

    if (correct) {
        res.json({ correct: true });
    } else {
        const correctAnswerFormatted = currentAnime.title !== currentAnime.alt_title
            ? `${currentAnime.alt_title} (${currentAnime.title})`
            : currentAnime.title;
        res.json({ correct: false, correctAnswer: correctAnswerFormatted });
    }
});

// Fonction pour calculer la distance de Levenshtein
function levenshteinDistance(a, b) {
    const an = a.length;
    const bn = b.length;
    const matrix = Array.from({ length: bn + 1 }, () => []);

    for (let i = 0; i <= bn; i++) matrix[i][0] = i;
    for (let j = 0; j <= an; j++) matrix[0][j] = j;

    for (let i = 1; i <= bn; i++) {
        for (let j = 1; j <= an; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    return matrix[bn][an];
}

app.post('/adjust-difficulty', (req, res) => {
    const correct = req.body.correct;
    req.session.difficultyModifier = req.session.difficultyModifier || 0;
    req.session.difficultyModifier += correct ? -50 : 50;
    res.sendStatus(200);
});

app.get('/anime-suggestions', async (req, res) => {
    const searchQuery = req.query.query.toLowerCase();
    const level = req.session.level || 'very_easy';

    const levelCriteria = getLevelCriteria(level);
    const animeTypes = levelCriteria.types;
    const excludeSequels = !levelCriteria.includeSequels;

    const conditions = [
        `(LOWER(unaccent(title)) LIKE '%' || unaccent($1) || '%' OR LOWER(unaccent(alt_title)) LIKE '%' || unaccent($1) || '%')`,
        `anime_type = ANY($2)`
    ];
    const values = [searchQuery, animeTypes];

    if (excludeSequels) {
        conditions.push(`is_sequel = FALSE`);
    }

    const query = `SELECT title, alt_title FROM animes WHERE ${conditions.join(' AND ')} LIMIT 10`;

    try {
        const result = await pool.query(query, values);
        res.json(result.rows);
    } catch (err) {
        console.error("Erreur lors de la récupération des suggestions", err);
        res.status(500).send('Erreur serveur');
    }
});

app.get('/get-character', async (req, res) => {
    const preference = (req.query.preference || 'tout').toLowerCase();
    const validPreferences = ['femme', 'homme', 'tout'];

    if (!validPreferences.includes(preference)) {
        return res.status(400).json({ error: 'Préférence de genre invalide' });
    }

    const conditions = ['image_url IS NOT NULL', "image_url != ''"];
    const values = [];
    let paramIndex = 1;

    if (preference === 'femme' || preference === 'homme') {
        conditions.push(`genre = $${paramIndex++}`);
        values.push(preference.charAt(0).toUpperCase() + preference.slice(1));
    } else {
        conditions.push(`genre IN ('Homme', 'Femme')`);
    }

    const query = `SELECT id, name, anime, genre, image_url, character_url FROM caracteres WHERE ${conditions.join(' AND ')} ORDER BY RANDOM() LIMIT 1`;

    try {
        const result = await pool.query(query, values);
        const character = result.rows[0];
        if (!character) return res.status(404).json({ error: 'Aucun personnage trouvé' });

        const imageFileName = path.basename(character.image_url);
        character.image_url = `/caractere/${imageFileName}`;

        res.json(character);
    } catch (error) {
        console.error("Erreur lors de la récupération du personnage :", error);
        res.status(500).json({ error: "Erreur serveur" });
    }
});

app.post('/save-smash-pass-results', (req, res) => {
    if (!req.session) return res.status(500).send('Erreur de session');
    req.session.smashPassResults = req.body;
    res.sendStatus(200);
});

app.get('/get-results', (req, res) => {
    if (req.session && req.session.smashPassResults) {
        res.json(req.session.smashPassResults);
    } else {
        res.status(404).json({ message: 'Aucun résultat trouvé' });
    }
});

app.get('/get-animes', async (req, res) => {
    try {
        const result = await pool.query(`SELECT id, title, REPLACE(image_url, $1, '/images/') AS image_url, popularity, score, members FROM animes`, [path.join('C:', 'Animeguesser', 'images')]);
        res.json(result.rows);
    } catch (error) {
        console.error('Erreur lors de la récupération des animes :', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des animes' });
    }
});

app.get('/get-character-game-data', async (req, res) => {
    try {
        const mainCharacterResult = await pool.query(`SELECT id, name, anime, genre, image_url FROM caracteres ORDER BY RANDOM() LIMIT 1`);
        const mainCharacter = mainCharacterResult.rows[0];
        if (!mainCharacter) return res.status(404).json({ error: 'Aucun personnage principal trouvé.' });

        mainCharacter.image_url = `/caractere/${path.basename(mainCharacter.image_url)}`;

        const additionalCharactersResult = await pool.query(`SELECT id, name, anime, genre FROM caracteres WHERE id != $1 ORDER BY RANDOM() LIMIT 3`, [mainCharacter.id]);
        const options = shuffleArray([...additionalCharactersResult.rows, {
            id: mainCharacter.id,
            name: mainCharacter.name,
            anime: mainCharacter.anime
        }]);

        res.json({
            mainCharacter: mainCharacter,
            options: options
        });
    } catch (error) {
        console.error('Erreur lors de la récupération des données de jeu :', error);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// ROUTE /media/:id
app.get('/media/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const result = await pool.query(
      'SELECT openingpath FROM opening WHERE id = $1', 
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).send('Média non trouvé');
    }
    const openingpath = result.rows[0].openingpath;
    const filePath = path.join(
      __dirname, 
      'opening', 
      'opening', 
      path.basename(openingpath)
    );

    if (fs.existsSync(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.sendFile(filePath);
    } else {
      res.status(404).send('Média non trouvé');
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('Erreur du serveur');
  }
});

// ROUTE /anime
app.get('/anime', async (req, res) => {
  try {
    const difficulty = req.query.difficulty || 'easy';
    let minId = 1, maxId = 90;
    if (difficulty === 'normal') {
      minId = 20;
      maxId = 300;
    } else if (difficulty === 'hard') {
      minId = 301;
      maxId = 600;
    }

    const result = await pool.query(
      `SELECT id, alt, alt AS title, alt AS name
       FROM opening
       WHERE id >= $1 AND id <= $2
       ORDER BY RANDOM()
       LIMIT 100`,
      [minId, maxId]
    );

    const animes = result.rows.map(anime => ({
      id: anime.id,
      alt: anime.alt,
      title: anime.title,
      name: anime.name,
      audio_url: `/media/${anime.id}`
    }));

    res.json(animes);
  } catch (err) {
    console.error(err);
    res.status(500).send('Erreur du serveur');
  }
});

// ROUTE /current-anime-answer
app.get('/current-anime-answer', (req, res) => {
  const currentAnime = req.session.currentAnime;
  if (currentAnime) {
    const correctAnswerFormatted =
      currentAnime.title !== currentAnime.alt_title
        ? `${currentAnime.alt_title} (${currentAnime.title})`
        : currentAnime.title;
    res.json({ correctAnswer: correctAnswerFormatted });
  } else {
    res.status(404).json({ error: 'Aucun animé en cours' });
  }
});

app.get('/4image', (req, res) => {
    res.sendFile(path.join(__dirname, '4image.html'));
});

app.get('/get-images-data', (req, res) => {
    const imagesDataPath = path.join(__dirname, 'image', 'images_data.json');
    if (fs.existsSync(imagesDataPath)) {
        const imagesData = JSON.parse(fs.readFileSync(imagesDataPath, 'utf-8'));
        res.json(imagesData);
    } else {
        res.status(500).send({ error: 'Le fichier images_data.json est introuvable.' });
    }
});

app.get('/get-image', (req, res) => {
    const imagePath = decodeURIComponent(req.query.path || '');

    if (!imagePath) {
        return res.status(400).send({ error: 'Aucun chemin fourni.' });
    }

    const baseDir = path.join(__dirname, 'image');
    const normalizedPath = path.normalize(path.join(baseDir, imagePath));

    if (!normalizedPath.startsWith(baseDir)) {
        return res.status(403).send({ error: 'Accès refusé.' });
    }

    if (fs.existsSync(normalizedPath)) {
        res.sendFile(normalizedPath);
    } else {
        res.status(404).send({ error: 'Image introuvable.' });
    }
});

app.post('/validate', (req, res) => {
    const { userInput, correctNames } = req.body;
    const normalizedUserInput = normalizeString(userInput || '');
    const normalizedCorrectNames = (correctNames || []).map(name => normalizeString(name || ''));
    const currentAnime = req.session.currentAnime;

    if (!currentAnime) return res.json({ correct: false });

    const isValid = normalizedCorrectNames.includes(normalizedUserInput);

    if (isValid) {
        res.json({ correct: true });
    } else {
        const correctAnswerFormatted = currentAnime.title !== currentAnime.alt_title
            ? `${currentAnime.alt_title} (${currentAnime.title})`
            : currentAnime.title;
        res.json({ correct: false, correctAnswer: correctAnswerFormatted });
    }
});

// ----------------- LOGIQUE WEBSOCKET --------------------

const rooms = {};

/*
  rooms[room] = {
    clients: [ws1, ws2, ...],
    playerNames: ['NomJoueur1', 'NomJoueur2', ...],
    scores: { NomJoueur1: 0, NomJoueur2: 0 },
    skipVotes: Set() des joueurs qui ont skip,
    currentQuestion: { id, alt, audio_url },
    currentRound: 0,
    totalRounds: 10,
    difficulty: 'easy' | 'normal' | 'hard',
    hintTimers: [Timer1, Timer2, Timer3],
    isGameStarted: false,
    firstCorrectPlayer: null,
    roundStartTime: 0
  }
*/

// DIFFUSE A TOUTE LA ROOM
function broadcastToRoom(room, data) {
  if (rooms[room]) {
    rooms[room].clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    });
  }
}

// RECUPERE UNE QUESTION ALEATOIRE
async function getRandomQuestion(difficulty = 'easy') {
  try {
    let minId = 1, maxId = 90;
    if (difficulty === 'normal') {
      minId = 20;
      maxId = 300;
    } else if (difficulty === 'hard') {
      minId = 301;
      maxId = 600;
    }

    const result = await pool.query(
      `SELECT id, alt 
       FROM opening 
       WHERE id >= $1 AND id <= $2 
       ORDER BY RANDOM() 
       LIMIT 1`,
      [minId, maxId]
    );
    if (result.rows.length === 0) return null;

    const anime = result.rows[0];
    return {
      id: anime.id,
      alt: anime.alt,
      audio_url: `/media/${anime.id}`
    };
  } catch (error) {
    console.error("Erreur question aléatoire :", error);
    return null;
  }
}

// LEVENSHTEIN
function levenshteinDistance(a, b) {
  const an = a.length;
  const bn = b.length;
  const matrix = Array.from({ length: bn + 1 }, () => []);

  for (let i = 0; i <= bn; i++) matrix[i][0] = i;
  for (let j = 0; j <= an; j++) matrix[0][j] = j;

  for (let i = 1; i <= bn; i++) {
    for (let j = 1; j <= an; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[bn][an];
}

// NORMALISATION
function normalizeString(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

// FONCTION NEXT ROUND
async function nextRound(room) {
  const currentRoom = rooms[room];
  if (!currentRoom) return;

  // Annule tous les timers
  currentRoom.hintTimers.forEach(t => clearTimeout(t));
  currentRoom.hintTimers = [];

  // Vérifie si on a atteint totalRounds
  if (currentRoom.currentRound >= currentRoom.totalRounds) {
    broadcastToRoom(room, {
      type: "gameOver",
      finalScores: currentRoom.scores
    });
    currentRoom.isGameStarted = false;
    return;
  }

  const newQ = await getRandomQuestion(currentRoom.difficulty);
  if (!newQ) {
    broadcastToRoom(room, {
      type: "error",
      message: "Aucune nouvelle question."
    });
    return;
  }

  currentRoom.currentQuestion = newQ;
  currentRoom.currentRound++;
  currentRoom.firstCorrectPlayer = null;
  currentRoom.skipVotes = new Set();

  broadcastToRoom(room, {
    type: "newQuestion",
    question: newQ
  });
  broadcastToRoom(room, {
    type: "scoreUpdate",
    scores: currentRoom.scores
  });

  console.log(`Nouvelle question => Room ${room}, round ${currentRoom.currentRound}`);

  currentRoom.roundStartTime = Date.now();

  const hint1Timer = setTimeout(() => {
    broadcastToRoom(room, { type: "hintAvailable", hint: 1 });
  }, 20000);

  const hint2Timer = setTimeout(() => {
    broadcastToRoom(room, { type: "hintAvailable", hint: 2 });
  }, 35000);

  const roundEndTimer = setTimeout(() => {
    if (!currentRoom.firstCorrectPlayer) {
      broadcastToRoom(room, {
        type: "roundEnded",
        message: "Temps écoulé ! Personne n'a trouvé."
      });
      nextRound(room);
    }
  }, 60000);

  currentRoom.hintTimers.push(hint1Timer, hint2Timer, roundEndTimer);
}

wss.on('connection', (ws) => {
  console.log("Un client s'est connecté");

  ws.on('message', async (msg) => {
    try {
      const data = JSON.parse(msg);

      if (data.type === "createRoom") {
        if (!rooms[data.room]) {
          rooms[data.room] = {
            clients: [ws],
            playerNames: [data.player],
            scores: { [data.player]: 0 },
            skipVotes: new Set(),
            currentQuestion: null,
            currentRound: 0,
            totalRounds: 10,
            difficulty: data.difficulty || 'easy',
            hintTimers: [],
            isGameStarted: false,
            firstCorrectPlayer: null,
            roundStartTime: null
          };
          ws.room = data.room;
          ws.playerName = data.player;
          ws.isChef = true;

          // Envoie la confirmation
          ws.send(JSON.stringify({
            type: "roomCreated",
            room: data.room
          }));

          // Broadcast du scoreboard et de la liste des joueurs
          broadcastToRoom(data.room, {
            type: "playerListUpdate",
            players: rooms[data.room].playerNames,
            scores: rooms[data.room].scores
          });
        } else {
          ws.send(JSON.stringify({
            type: "error",
            message: "Room déjà existante."
          }));
        }
      }

      else if (data.type === "joinRoom") {
        if (!rooms[data.room]) {
          ws.send(JSON.stringify({
            type: "error",
            message: "Room introuvable."
          }));
          return;
        }
        const r = rooms[data.room];

        // Vérifier si pseudo déjà pris
        const isPseudoTaken = r.playerNames.includes(data.player);
        if (isPseudoTaken) {
          ws.send(JSON.stringify({
            type: "error",
            message: "Pseudo déjà utilisé dans cette room."
          }));
          return;
        }

        // On ajoute le ws
        r.clients.push(ws);
        r.playerNames.push(data.player);
        r.scores[data.player] = 0; 
        ws.room = data.room;
        ws.playerName = data.player;
        ws.isChef = false;

        ws.send(JSON.stringify({
          type: "roomJoined",
          room: data.room
        }));

        // Informe tout le monde qu'un nouveau joueur est là
        broadcastToRoom(data.room, {
          type: "playerJoined",
          player: data.player
        });

        // MET A JOUR LA LISTE DES JOUEURS + SCORES CHEZ TOUS
        broadcastToRoom(data.room, {
          type: "playerListUpdate",
          players: r.playerNames,
          scores: r.scores
        });
      }

      else if (data.type === "startGame") {
        const rm = ws.room;
        if (!rm || !rooms[rm]) {
          ws.send(JSON.stringify({ 
            type: "error", 
            message: "Room invalide." 
          }));
          return;
        }
        if (!ws.isChef) {
          ws.send(JSON.stringify({ 
            type: "error", 
            message: "Seul le chef peut démarrer." 
          }));
          return;
        }

        const currentRoom = rooms[rm];
        if (currentRoom.currentRound >= currentRoom.totalRounds) {
          ws.send(JSON.stringify({
            type: "error",
            message: "Le nombre de rounds est déjà atteint."
          }));
          return;
        }
        if (currentRoom.isGameStarted) {
          ws.send(JSON.stringify({
            type: "error",
            message: "Le jeu est déjà en cours."
          }));
          return;
        }

        const q = await getRandomQuestion(currentRoom.difficulty);
        if (!q) {
          ws.send(JSON.stringify({
            type: "error",
            message: "Aucune question disponible."
          }));
          return;
        }

        currentRoom.currentQuestion = q;
        currentRoom.currentRound++;
        currentRoom.isGameStarted = true;
        currentRoom.firstCorrectPlayer = null;
        currentRoom.skipVotes = new Set();

        broadcastToRoom(rm, {
          type: "startGame",
          round: currentRoom.currentRound
        });
        broadcastToRoom(rm, {
          type: "newQuestion",
          question: q
        });
        broadcastToRoom(rm, {
          type: "scoreUpdate",
          scores: currentRoom.scores
        });

        currentRoom.roundStartTime = Date.now();

        const hint1Timer = setTimeout(() => {
          broadcastToRoom(rm, { type: "hintAvailable", hint: 1 });
        }, 20000);

        const hint2Timer = setTimeout(() => {
          broadcastToRoom(rm, { type: "hintAvailable", hint: 2 });
        }, 35000);

        const roundEndTimer = setTimeout(() => {
          if (!currentRoom.firstCorrectPlayer) {
            broadcastToRoom(rm, {
              type: "roundEnded",
              message: "Temps écoulé! Personne n'a trouvé."
            });
            nextRound(rm);
          }
        }, 60000);

        currentRoom.hintTimers.push(hint1Timer, hint2Timer, roundEndTimer);
      }

      else if (data.type === "submitAnswer") {
        const rm = ws.room;
        if (!rm || !rooms[rm]) {
          ws.send(JSON.stringify({
            type: "error",
            message: "Room introuvable."
          }));
          return;
        }
        const currentRoom = rooms[rm];
        if (!currentRoom.isGameStarted) {
          ws.send(JSON.stringify({
            type: "error",
            message: "Aucune partie en cours."
          }));
          return;
        }

        const player = ws.playerName;
        const answer = data.answer.trim();

        // DEBUT DU TRAITEMENT SKIP 
        if (answer === "") {
          // On considère ça comme un skip
          if (!currentRoom.skipVotes) {
            currentRoom.skipVotes = new Set();
          }
          currentRoom.skipVotes.add(player);

          broadcastToRoom(rm, {
            type: "playerSkip",
            message: `${player} a passé son tour.`,
            player: player
          });

          // Si tous ont skip
          if (currentRoom.skipVotes.size === currentRoom.playerNames.length) {
            currentRoom.hintTimers.forEach(t => clearTimeout(t));
            currentRoom.hintTimers = [];

            broadcastToRoom(rm, {
              type: "roundEnded",
              message: "Tous les joueurs ont passé leur tour !"
            });
            nextRound(rm);
          }
          return;
        }
        // FIN DU TRAITEMENT SKIP

        // SI UN JOUEUR A DEJA GAGNE LE ROUND
        if (currentRoom.firstCorrectPlayer) {
          ws.send(JSON.stringify({
            type: "answerResult",
            message: `Le round a déjà été gagné par ${currentRoom.firstCorrectPlayer}.`
          }));
          return;
        }

        // CALCUL DE SIMILARITE
        const timeTaken = (Date.now() - currentRoom.roundStartTime) / 1000;
        const normUser = normalizeString(answer);
        const normCorrect = normalizeString(currentRoom.currentQuestion.alt);
        const dist = levenshteinDistance(normUser, normCorrect);
        const maxLen = Math.max(normUser.length, normCorrect.length);
        const similarity = 1 - dist / maxLen;
        const threshold = 0.6;
        const isValid = similarity >= threshold;

        if (isValid) {
          currentRoom.firstCorrectPlayer = player;
          let points = 0;
          if (timeTaken <= 20) {
            points = 5;
          } else if (timeTaken <= 35) {
            points = 3;
          } else {
            points = 1;
          }
          if (!currentRoom.scores[player] && currentRoom.scores[player] !== 0) {
            currentRoom.scores[player] = 0;
          }
          currentRoom.scores[player] += points;

          broadcastToRoom(rm, {
            type: "answerResult",
            message: `${player} a trouvé en ${timeTaken.toFixed(1)}s et gagne ${points} pts!`
          });
          broadcastToRoom(rm, {
            type: "roundWinner",
            winner: player
          });
          broadcastToRoom(rm, {
            type: "scoreUpdate",
            scores: currentRoom.scores
          });

          currentRoom.hintTimers.forEach(t => clearTimeout(t));
          currentRoom.hintTimers = [];

          setTimeout(() => {
            nextRound(rm);
          }, 3000);
        } else {
          ws.send(JSON.stringify({
            type: "answerResult",
            message: `Mauvaise réponse de ${player}.`
          }));
        }
      }

      else if (data.type === "useHint") {
        const rm = ws.room;
        if (!rm || !rooms[rm]) {
          ws.send(JSON.stringify({
            type: "error",
            message: "Room introuvable."
          }));
          return;
        }
        const currentRoom = rooms[rm];
        if (!currentRoom.isGameStarted) {
          ws.send(JSON.stringify({
            type: "error",
            message: "Partie non démarrée."
          }));
          return;
        }

        if (!currentRoom.hintsUsed) {
          currentRoom.hintsUsed = {};
        }
        if (!currentRoom.hintsUsed[ws.playerName]) {
          currentRoom.hintsUsed[ws.playerName] = [];
        }
        if (currentRoom.hintsUsed[ws.playerName].includes(data.hint)) {
          ws.send(JSON.stringify({
            type: "error",
            message: "Indice déjà utilisé."
          }));
          return;
        }

        currentRoom.hintsUsed[ws.playerName].push(data.hint);

        broadcastToRoom(rm, {
          type: "hintAvailable",
          hint: data.hint
        });
        ws.send(JSON.stringify({
          type: "hintUsed",
          hint: data.hint,
          message: `Indice ${data.hint} utilisé`
        }));
      }

      else if (data.type === "allSkipped") {
        // Si tu gardes un message allSkipped côté client, on peut gérer ici.
        const rm = ws.room;
        if (!rm || !rooms[rm]) return;
        const currentRoom = rooms[rm];
        if (currentRoom.firstCorrectPlayer) return;

        currentRoom.hintTimers.forEach(t => clearTimeout(t));
        currentRoom.hintTimers = [];

        broadcastToRoom(rm, {
          type: "roundEnded",
          message: "Personne n'a trouvé. (Skip global)"
        });
        nextRound(rm);
      }

      else {
        ws.send(JSON.stringify({
          type: "error",
          message: "Type de message inconnu."
        }));
      }
    } catch (err) {
      console.error("Erreur message websocket:", err);
      ws.send(JSON.stringify({
        type: "error",
        message: "Erreur lors du traitement du message."
      }));
    }
  });

  ws.on('close', () => {
    console.log("Un client s'est déconnecté");
    if (ws.room && rooms[ws.room]) {
      const r = rooms[ws.room];
      r.clients = r.clients.filter(c => c !== ws);

      // Retire aussi le pseudo
      r.playerNames = r.playerNames.filter(p => p !== ws.playerName);

      // Retire le score
      delete r.scores[ws.playerName];

      if (r.hintsUsed && r.hintsUsed[ws.playerName]) {
        delete r.hintsUsed[ws.playerName];
      }

      if (r.clients.length === 0) {
        r.hintTimers.forEach(t => clearTimeout(t));
        delete rooms[ws.room];
        console.log(`Room supprimée: ${ws.room}`);
      } else {
        broadcastToRoom(ws.room, {
          type: "playerLeft",
          player: ws.playerName
        });

        // Si c'était le chef, on passe le chef à un autre
        if (ws.isChef) {
          r.clients[0].isChef = true;
          r.clients[0].send(JSON.stringify({
            type: "newChef",
            message: "Vous êtes maintenant le chef."
          }));
          broadcastToRoom(ws.room, {
            type: "newChefAnnouncement",
            message: `${r.clients[0].playerName} est le chef.`
          });
        }

        broadcastToRoom(ws.room, {
          type: "statusUpdate",
          message: `${ws.playerName} a quitté la partie.`
        });

        // MET A JOUR LA LISTE + SCORES POUR TOUS
        broadcastToRoom(ws.room, {
          type: "playerListUpdate",
          players: r.playerNames,
          scores: r.scores
        });
      }
    }
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Serveur lancé sur le port ${PORT}`);
});