const express = require('express');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const session = require('express-session');
const WebSocket = require('ws');

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

app.get('/media/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const result = await pool.query('SELECT openingpath FROM opening WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).send('Média non trouvé');
        }
        const openingpath = result.rows[0].openingpath;
        const filePath = path.join(__dirname, 'opening', 'opening', path.basename(openingpath));

        if (fs.existsSync(filePath)) {
            res.sendFile(filePath);
        } else {
            res.status(404).send('Média non trouvé');
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('Erreur du serveur');
    }
});

// Route /anime adaptée pour le mode multijoueur
// Route /anime adaptée pour le mode multijoueur
app.get('/anime', async (req, res) => {
    try {
        const difficulty = req.query.difficulty || 'easy';
        let minId = 1, maxId = 90;

        if (difficulty === 'normal') {
            minId = 20; maxId = 300;
        } else if (difficulty === 'hard') {
            minId = 301; maxId = 600;
        }

        const result = await pool.query(`SELECT id, alt, alt AS title, alt AS name FROM opening WHERE id >= $1 AND id <= $2 ORDER BY RANDOM() LIMIT 100`, [minId, maxId]);
        const animes = result.rows.map(anime => ({
            id: anime.id,
            alt: anime.alt,
            title: anime.title,
            name: anime.name, // Ajout du champ name
            audio_url: `/media/${anime.id}` // Construction de l'URL audio basée sur l'ID
        }));
        res.json(animes);
    } catch (err) {
        console.error(err);
        res.status(500).send('Erreur du serveur');
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

const rooms = {}; // Chaque room aura { clients: [ws1, ws2], scores: { 'Joueur1': 0, 'Joueur2': 0 }, currentQuestion: {...}, currentRound: 0, totalRounds: 10, difficulty: 'easy', hintTimers: [TimeoutObject1, TimeoutObject2], isGameStarted: false, firstCorrectPlayer: null, roundStartTime: timestamp }

// Fonction pour diffuser un message à tous les clients d'une room
function broadcastToRoom(room, data) {
    if (rooms[room]) {
        rooms[room].clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(data));
            }
        });
    }
}

// Fonction pour obtenir une question aléatoire basée sur la difficulté
async function getRandomQuestion(difficulty = 'easy') {
    try {
        let minId = 1, maxId = 90;

        if (difficulty === 'normal') {
            minId = 20; maxId = 300;
        } else if (difficulty === 'hard') {
            minId = 301; maxId = 600;
        }

        const result = await pool.query(`SELECT id, alt FROM opening WHERE id >= $1 AND id <= $2 ORDER BY RANDOM() LIMIT 1`, [minId, maxId]);
        if (result.rows.length === 0) return null;

        const anime = result.rows[0];
        return {
            id: anime.id,
            alt: anime.alt,
            audio_url: `/media/${anime.id}`
        };
    } catch (error) {
        console.error("Erreur lors de la récupération d'une question aléatoire :", error);
        return null;
    }
}

// Fonction pour calculer la distance de Levenshtein (similaire à celle du client)
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

// Fonction pour normaliser les chaînes de caractères
function normalizeString(str) {
    return str
        .toLowerCase()
        .normalize('NFD') // Décompose les caractères accentués
        .replace(/[\u0300-\u036f]/g, '') // Supprime les accents
        .replace(/[^a-z0-9]/g, ''); // Supprime les caractères spéciaux
}

// Gestion des connexions WebSocket
wss.on("connection", (ws) => {
    console.log("Un client s'est connecté");

    ws.on("message", async (message) => {
        try {
            const data = JSON.parse(message);

            switch (data.type) {
                case "createRoom":
                    console.log(`Création de la room : ${data.room} par ${data.player}`);
                    if (!rooms[data.room]) {
                        rooms[data.room] = {
                            clients: [ws],
                            scores: { [data.player]: 0 }, // Initialisation correcte du score
                            currentQuestion: null,
                            currentRound: 0,
                            totalRounds: 10,
                            difficulty: data.difficulty || 'easy',
                            hintTimers: [],
                            isGameStarted: false,
                            firstCorrectPlayer: null,
                            roundStartTime: null,
                        };
                        ws.room = data.room;
                        ws.playerName = data.player;
                        ws.isChef = true;

                        ws.send(JSON.stringify({ type: "roomCreated", room: data.room }));
                        console.log(`Room créée : ${data.room}`);
                    } else {
                        ws.send(JSON.stringify({ type: "error", message: "Room déjà existante." }));
                    }
                    break;

                case "joinRoom":
                    console.log(`${data.player} tente de rejoindre la room : ${data.room}`);
                    if (rooms[data.room]) {
                        // Vérifier si le pseudo est unique dans la room
                        const isPseudoTaken = rooms[data.room].clients.some(client => client.playerName === data.player);
                        if (isPseudoTaken) {
                            ws.send(JSON.stringify({ type: "error", message: "Pseudo déjà utilisé dans cette room." }));
                            break;
                        }

                        rooms[data.room].clients.push(ws);
                        rooms[data.room].scores[data.player] = 0; // Initialisation correcte du score
                        ws.room = data.room;
                        ws.playerName = data.player;
                        ws.isChef = false;

                        ws.send(JSON.stringify({ type: "roomJoined", room: data.room }));
                        console.log(`${data.player} a rejoint la room : ${data.room}`);

                        // Informer les autres joueurs de la room
                        broadcastToRoom(data.room, {
                            type: "playerJoined",
                            message: `${data.player} a rejoint la room.`,
                            player: data.player
                        });
                    } else {
                        ws.send(JSON.stringify({ type: "error", message: "Room non trouvée." }));
                    }
                    break;

                case "startGame":
                    if (ws.isChef && ws.room) {
                        const room = rooms[ws.room];
                        if (room.currentRound >= room.totalRounds) {
                            ws.send(JSON.stringify({ type: "error", message: "Le nombre total de rounds a été atteint." }));
                            break;
                        }

                        if (room.isGameStarted) {
                            ws.send(JSON.stringify({ type: "error", message: "Le jeu est déjà en cours." }));
                            break;
                        }

                        room.currentQuestion = await getRandomQuestion(room.difficulty);
                        if (!room.currentQuestion) {
                            ws.send(JSON.stringify({ type: "error", message: "Aucune question disponible pour démarrer le jeu." }));
                            break;
                        }
                        room.currentRound++;
                        room.isGameStarted = true;

                        // Réinitialiser les réponses des joueurs
                        room.playersReady = {}; // Supprimer la gestion des "ready"

                        // Réinitialiser le premier joueur correct pour cette question
                        room.firstCorrectPlayer = null;

                        // Envoyer les messages de démarrage du jeu et de première question
                        broadcastToRoom(ws.room, { type: "startGame", round: room.currentRound });
                        broadcastToRoom(ws.room, { type: "newQuestion", question: room.currentQuestion });
                        broadcastToRoom(ws.room, { type: "scoreUpdate", scores: room.scores });

                        console.log(`Le chef a démarré le jeu dans la room : ${ws.room}`);

                        // Enregistrer le temps de début du round
                        const roundStartTime = Date.now();
                        room.roundStartTime = roundStartTime;

                        // Définir les timers pour les indices et la fin du round
                        // Indice 1 à 20 secondes
                        const hint1Timer = setTimeout(() => {
                            broadcastToRoom(ws.room, { type: "hintAvailable", hint: 1 });
                        }, 20000); // 20 000 ms

                        // Indice 2 à 35 secondes
                        const hint2Timer = setTimeout(() => {
                            broadcastToRoom(ws.room, { type: "hintAvailable", hint: 2 });
                        }, 35000); // 35 000 ms

                        // Fin du round à 60 secondes
                        const roundEndTimer = setTimeout(() => {
                            // Si aucun joueur n'a répondu correctement
                            if (!room.firstCorrectPlayer) {
                                broadcastToRoom(ws.room, { type: "roundEnded", message: "Temps écoulé! Aucun joueur n'a répondu correctement." });
                                nextRound(ws.room);
                            }
                        }, 60000); // 60 000 ms

                        // Enregistrer les timers pour pouvoir les annuler si nécessaire
                        room.hintTimers.push(hint1Timer, hint2Timer, roundEndTimer);
                    } else {
                        ws.send(JSON.stringify({ type: "error", message: "Vous n'êtes pas le chef ou la room est invalide." }));
                    }
                    break;

                case "submitAnswer":
                    if (ws.room && rooms[ws.room] && rooms[ws.room].isGameStarted) {
                        const room = rooms[ws.room];
                        const currentQuestion = room.currentQuestion;
                        const player = ws.playerName; // Utiliser ws.playerName
                        const answer = data.answer.trim();
                        const timeTaken = (Date.now() - room.roundStartTime) / 1000; // Temps en secondes

                        // Vérifier si le joueur a déjà répondu correctement
                        if (room.firstCorrectPlayer) {
                            // Le round est déjà gagné par un autre joueur
                            ws.send(JSON.stringify({
                                type: "answerResult",
                                player: player,
                                points: 0,
                                message: `Le round a déjà été gagné par ${room.firstCorrectPlayer}.`
                            }));
                            break;
                        }

                        // Normaliser les réponses
                        const normalizedUserInput = normalizeString(answer);
                        const normalizedCorrectAnswer = normalizeString(currentQuestion.alt);

                        const distance = levenshteinDistance(normalizedUserInput, normalizedCorrectAnswer);
                        const maxLen = Math.max(normalizedUserInput.length, normalizedCorrectAnswer.length);
                        const similarity = 1 - distance / maxLen;

                        const similarityThreshold = 0.6;
                        const isValid = similarity >= similarityThreshold;

                        if (isValid) {
                            if (!room.firstCorrectPlayer) {
                                room.firstCorrectPlayer = player;

                                // Calcul des points en fonction du temps
                                let points = 0;
                                if (timeTaken <= 20) {
                                    points = 5;
                                } else if (timeTaken <= 35) {
                                    points = 3;
                                } else {
                                    points = 1;
                                }

                                // Assurez-vous que le joueur existe dans la room
                                if (!room.scores[player] && room.scores[player] !== 0) {
                                    room.scores[player] = 0;
                                }

                                room.scores[player] += points; // Mise à jour correcte du score

                                // Informer tous les joueurs
                                broadcastToRoom(ws.room, {
                                    type: "answerResult",
                                    player: player,
                                    points: points,
                                    message: `${player} a répondu correctement en ${timeTaken.toFixed(1)} secondes et gagne ${points} points!`
                                });

                                // Envoyer un message spécifique indiquant qui a gagné le round
                                broadcastToRoom(ws.room, {
                                    type: "roundWinner",
                                    winner: player,
                                    message: `${player} a gagné ce round!`
                                });

                                // Mettre à jour les scores
                                broadcastToRoom(ws.room, {
                                    type: "scoreUpdate",
                                    scores: room.scores
                                });

                                console.log(`Réponse correcte de ${player} dans la room ${ws.room}, points attribués: ${points}`);

                                // Passer au round suivant après un court délai
                                // Avant d'appeler nextRound, il faut annuler les timers
                                room.hintTimers.forEach(timer => clearTimeout(timer));
                                room.hintTimers = [];

                                // Passer au round suivant après 3 secondes
                                setTimeout(() => {
                                    nextRound(ws.room);
                                }, 3000); // 3 secondes
                            }
                        } else {
                            // Réponse incorrecte, envoyer un message au joueur
                            ws.send(JSON.stringify({
                                type: "answerResult",
                                player: player,
                                points: 0,
                                message: `Mauvaise réponse de la part de ${player}.`
                            }));
                        }

                        // Pas de désactivation des joueurs ou limitation des tentatives
                        // Les joueurs peuvent continuer à répondre jusqu'à ce que le round soit gagné ou le temps écoulé
                    } else {
                        ws.send(JSON.stringify({ type: "error", message: "Aucune partie en cours dans cette room." }));
                    }
                    break;

                case "useHint":
                    if (ws.room && rooms[ws.room] && rooms[ws.room].isGameStarted) {
                        const room = rooms[ws.room];
                        const player = ws.playerName;
                        const hintNumber = data.hint; // 1 ou 2

                        if (!room.hintsUsed) {
                            room.hintsUsed = {};
                        }

                        if (room.hintsUsed[player] && room.hintsUsed[player].includes(hintNumber)) {
                            ws.send(JSON.stringify({ type: "error", message: "Vous avez déjà utilisé cet indice." }));
                            break;
                        }

                        if (!room.hintsUsed[player]) {
                            room.hintsUsed[player] = [];
                        }

                        room.hintsUsed[player].push(hintNumber);

                        // Informer tous les joueurs que l'indice est disponible
                        broadcastToRoom(ws.room, {
                            type: "hintAvailable",
                            hint: hintNumber,
                            message: `Un indice (${hintNumber}) a été disponible pour tous les joueurs.`
                        });

                        // Informer le joueur qu'il a utilisé l'indice
                        ws.send(JSON.stringify({
                            type: "hintUsed",
                            hint: hintNumber,
                            message: `Vous avez utilisé l'indice ${hintNumber}.`
                        }));
                    } else {
                        ws.send(JSON.stringify({ type: "error", message: "Aucune partie en cours dans cette room." }));
                    }
                    break;

                default:
                    console.log("Message inconnu :", data);
                    ws.send(JSON.stringify({ type: "error", message: "Type de message inconnu." }));
            }
        } catch (err) {
            console.error("Erreur lors du traitement du message :", err);
            ws.send(JSON.stringify({ type: "error", message: "Erreur lors du traitement de votre message." }));
        }
    });

    ws.on("close", () => {
        console.log("Un client s'est déconnecté");
        // Retirer le client de sa room
        if (ws.room && rooms[ws.room]) {
            const room = rooms[ws.room];
            room.clients = room.clients.filter(client => client !== ws);
            delete room.scores[ws.playerName];
            delete room.hintsUsed?.[ws.playerName]; // Supprimer les hints utilisés

            if (room.clients.length === 0) {
                // Annuler les timers si le jeu est en cours
                room.hintTimers.forEach(timer => clearTimeout(timer));
                room.hintTimers = [];
                delete rooms[ws.room]; // Supprimer la room si elle est vide
                console.log(`Room supprimée : ${ws.room}`);
            } else {
                // Informer les autres joueurs de la room qu'un joueur a quitté
                broadcastToRoom(ws.room, {
                    type: "playerLeft",
                    message: `${ws.playerName} a quitté la room.`,
                    player: ws.playerName
                });

                // Si le chef quitte, assigner un nouveau chef
                if (ws.isChef) {
                    room.clients[0].isChef = true;
                    room.clients[0].send(JSON.stringify({ type: "newChef", message: "Vous êtes maintenant le chef de la room." }));
                    broadcastToRoom(ws.room, { type: "newChefAnnouncement", message: `${room.clients[0].playerName} est maintenant le chef de la room.` });
                }

                // Informer les autres joueurs si le jeu est en cours
                if (room.isGameStarted) {
                    broadcastToRoom(ws.room, { type: "statusUpdate", message: `${ws.playerName} a quitté la partie.` });
                }
            }
        }
    });
});

// Fonction pour passer au round suivant
async function nextRound(room) {
    const currentRoom = rooms[room];
    if (!currentRoom) return;

    // Annuler les timers actuels
    currentRoom.hintTimers.forEach(timer => clearTimeout(timer));
    currentRoom.hintTimers = [];

    if (currentRoom.currentRound >= currentRoom.totalRounds) {
        // Terminer le jeu
        broadcastToRoom(room, {
            type: "gameOver",
            message: "Le jeu est terminé !",
            finalScores: currentRoom.scores
        });
        currentRoom.isGameStarted = false;
        return;
    }

    // Obtenir une nouvelle question
    currentRoom.currentQuestion = await getRandomQuestion(currentRoom.difficulty);
    if (!currentRoom.currentQuestion) {
        broadcastToRoom(room, { type: "error", message: "Aucune nouvelle question disponible." });
        return;
    }
    currentRoom.currentRound++;

    // Réinitialiser les réponses des joueurs
    currentRoom.playersReady = {}; // Supprimer la gestion des "ready"

    // Réinitialiser le premier joueur correct pour cette question
    currentRoom.firstCorrectPlayer = null;

    // Envoyer la nouvelle question et les mises à jour
    broadcastToRoom(room, { type: "newQuestion", question: currentRoom.currentQuestion });
    broadcastToRoom(room, { type: "scoreUpdate", scores: currentRoom.scores });

    console.log(`Nouvelle question envoyée dans la room : ${room}`);

    // Enregistrer le temps de début du round
    const roundStartTime = Date.now();
    currentRoom.roundStartTime = roundStartTime;

    // Définir les timers pour les indices et la fin du round
    // Indice 1 à 20 secondes
    const hint1Timer = setTimeout(() => {
        broadcastToRoom(room, { type: "hintAvailable", hint: 1 });
    }, 20000); // 20 000 ms

    // Indice 2 à 35 secondes
    const hint2Timer = setTimeout(() => {
        broadcastToRoom(room, { type: "hintAvailable", hint: 2 });
    }, 35000); // 35 000 ms

    // Fin du round à 60 secondes
    const roundEndTimer = setTimeout(() => {
        // Si aucun joueur n'a répondu correctement
        if (!currentRoom.firstCorrectPlayer) {
            broadcastToRoom(room, { type: "roundEnded", message: "Temps écoulé! Aucun joueur n'a répondu correctement." });
            nextRound(room);
        }
    }, 60000); // 60 000 ms

    // Enregistrer les timers pour pouvoir les annuler si nécessaire
    currentRoom.hintTimers.push(hint1Timer, hint2Timer, roundEndTimer);
}

// Démarrer le serveur
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Serveur en écoute sur le port ${PORT}`);
});
