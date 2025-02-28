// ============================
// IMPORTS & INITIALISATIONS
// ============================
const express = require('express');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const session = require('express-session');
const WebSocket = require('ws');
const crypto = require('crypto');
const multer = require('multer');

const app = express();
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

// Directories de ressources
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

// ============================
// MIDDLEWARES
// ============================
app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'votre_cle_secrete',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

// Servir des fichiers statiques
app.use(express.static(__dirname));
app.use('/caractere', express.static(path.join(__dirname, 'caractere')));
app.use('/images', express.static(path.join(__dirname, 'images')));
app.use('/opening', express.static(path.join(__dirname, 'opening', 'opening')));

// ============================
// FONCTIONS UTILITAIRES
// ============================

/**
 * Normalise une chaîne de caractères : enlève les accents, les articles,
 * les caractères spéciaux, normalise les espaces, et convertit en minuscules.
 */
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

/**
 * Renvoie les critères de sélection d'anime en fonction du niveau et d'un modificateur.
 */
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

/**
 * Mélange un tableau en place en utilisant l'algorithme de Fisher-Yates.
 */
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

/**
 * Calcule la distance de Levenshtein entre deux chaînes.
 */
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

/**
 * Vérifie si un caractère est autorisé.
 */
function isCharAllowed(c) {
  return /[a-zA-Z0-9\s;:'\/.\-ïäëö]/.test(c);
}

/**
 * Récupère un anime de façon aléatoire en fonction de la difficulté.
 * Nettoie le titre et s'assure qu'il respecte les critères de longueur.
 */
async function getRandomAnime(difficulty) {
  let minID, maxID;
  if (difficulty === 'easy') {
    minID = 1;
    maxID = 250;
  } else if (difficulty === 'medium') {
    minID = 50;
    maxID = 400;
  } else {
    minID = 200;
    maxID = 1000;
  }

  for (let attempt = 0; attempt < 50; attempt++) {
    const result = await pool.query(
      `SELECT id, alt_title
       FROM animes
       WHERE id BETWEEN $1 AND $2
       AND anime_type = 'TV'
       AND is_sequel = false
       ORDER BY RANDOM()
       LIMIT 1`,
      [minID, maxID]
    );

    if (result.rows.length === 0) continue;

    let rawTitle = result.rows[0].alt_title || '';
    let cleaned = '';
    for (let i = 0; i < rawTitle.length; i++) {
      const c = rawTitle[i];
      if (!isCharAllowed(c)) break;
      cleaned += c;
    }
    cleaned = cleaned.trim();

    if (cleaned.length >= 5 && cleaned.length <= 15) {
      return cleaned;
    }
  }
  return null;
}

// ============================
// ROUTES HTTP
// ============================

// Pages principales
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/game.html', (req, res) => res.sendFile(path.join(__dirname, 'game.html')));
app.get('/gameplay.html', (req, res) => res.sendFile(path.join(__dirname, 'gameplay.html')));

// Définit le niveau de jeu et redirige vers la page gameplay
app.get('/set-level', (req, res) => {
    req.session.level = req.query.level;
    req.session.difficultyModifier = 0;
    res.redirect('/gameplay.html');
});

// Récupère une image d'anime en fonction des critères de difficulté
app.get('/anime-images', async (req, res) => {
    try {
        console.debug("[Route] /anime-images appelé");
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
            console.debug("Aucun anime correspondant, réinitialisation de usedAnimeIds");
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

// Réinitialise la liste des IDs d'animes utilisés
app.get('/reset-used-animes', (req, res) => {
    req.session.usedAnimeIds = [];
    res.sendStatus(200);
});

// Vérifie la réponse de l'utilisateur pour un anime
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

// Ajuste la difficulté selon la réponse précédente
app.post('/adjust-difficulty', (req, res) => {
    const correct = req.body.correct;
    req.session.difficultyModifier = req.session.difficultyModifier || 0;
    req.session.difficultyModifier += correct ? -50 : 50;
    console.debug(`[Route] /adjust-difficulty modifié à ${req.session.difficultyModifier}`);
    res.sendStatus(200);
});

// Fournit des suggestions d'anime pour une recherche
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

// Récupère un personnage selon la préférence de genre
app.get('/get-character', async (req, res) => {
    const preference = (req.query.preference || 'tout').toLowerCase();
    const validPreferences = ['femme', 'homme', 'tout'];

    if (!validPreferences.includes(preference)) {
        return res.status(400).json({ error: 'Préférence de genre invalide' });
    }

    const conditions = ['image_url IS NOT NULL', "image_url != ''", "id <= 1500"];
    const values = [];
    let paramIndex = 1;

    if (preference === 'femme' || preference === 'homme') {
        conditions.push(`genre = $${paramIndex}`);
        values.push(preference.charAt(0).toUpperCase() + preference.slice(1));
        paramIndex++;
    } else {
        conditions.push("genre IN ('Homme', 'Femme')");
    }

    const query = `SELECT id, name, anime, genre, image_url, character_url FROM caracteres WHERE ${conditions.join(' AND ')} ORDER BY RANDOM() LIMIT 1`;

    try {
        console.log("Exécution de la requête :", query, "avec valeurs :", values);

        const result = await pool.query(query, values);
        const character = result.rows[0];

        if (!character) {
            console.warn("Aucun personnage trouvé !");
            return res.status(404).json({ error: 'Aucun personnage trouvé' });
        }

        console.log("Personnage récupéré :", character);

        // Vérifie si `image_url` est bien une URL
        if (character.image_url) {
            const imageFileName = path.basename(character.image_url);
            character.image_url = `/caractere/${imageFileName}`;
        } else {
            console.warn("Attention: image_url manquante pour l'ID", character.id);
        }

        res.json(character);
    } catch (error) {
        console.error("Erreur lors de la récupération du personnage :", error);
        res.status(500).json({ error: "Erreur serveur" });
    }
});

// Sauvegarde les résultats Smash Pass dans la session
app.post('/save-smash-pass-results', (req, res) => {
    if (!req.session) return res.status(500).send('Erreur de session');
    req.session.smashPassResults = req.body;
    res.sendStatus(200);
});

// Récupère les résultats Smash Pass depuis la session
app.get('/get-results', (req, res) => {
    if (req.session && req.session.smashPassResults) {
        res.json(req.session.smashPassResults);
    } else {
        res.status(404).json({ message: 'Aucun résultat trouvé' });
    }
});

// Récupère une liste d'animes avec leurs données
app.get('/get-animes', async (req, res) => {
    try {
        const result = await pool.query(
          `SELECT id, title, REPLACE(image_url, $1, '/images/') AS image_url, popularity, score, members FROM animes`,
          [path.join('C:', 'Animeguesser', 'images')]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Erreur lors de la récupération des animes :', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des animes' });
    }
});

// Donne les données de jeu pour les personnages (pour un mini-jeu de quiz)
app.get('/get-character-game-data', async (req, res) => {
    try {
        const mainCharacterResult = await pool.query(
          `SELECT id, name, anime, genre, image_url FROM caracteres ORDER BY RANDOM() LIMIT 1`
        );
        const mainCharacter = mainCharacterResult.rows[0];
        if (!mainCharacter) return res.status(404).json({ error: 'Aucun personnage principal trouvé.' });

        mainCharacter.image_url = `/caractere/${path.basename(mainCharacter.image_url)}`;

        const additionalCharactersResult = await pool.query(
          `SELECT id, name, anime, genre FROM caracteres WHERE id != $1 ORDER BY RANDOM() LIMIT 3`,
          [mainCharacter.id]
        );
        const options = shuffleArray([
            ...additionalCharactersResult.rows,
            {
              id: mainCharacter.id,
              name: mainCharacter.name,
              anime: mainCharacter.anime
            }
        ]);

        res.json({
            mainCharacter: mainCharacter,
            options: options
        });
    } catch (error) {
        console.error('Erreur lors de la récupération des données de jeu :', error);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// Sert un média (opening) basé sur son ID
app.get('/media/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).send('ID invalide');
    }

    const result = await pool.query(
      'SELECT openingpath FROM opening WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).send('Média non trouvé');
    }

    const openingpath = result.rows[0].openingpath;
    const filePath = path.join(__dirname, 'opening', path.basename(openingpath));

    fs.access(filePath, fs.constants.F_OK, (err) => {
      if (err) {
        return res.status(404).send('Média non trouvé');
      }
      // Cache 1 jour
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.sendFile(filePath);
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Erreur du serveur');
  }
});

// Renvoie les animés selon la dif
app.get('/anime', async (req, res) => {
  console.log(` Requête reçue sur /anime avec params :`, req.query);
  console.log(" Requête reçue sur /anime avec params :", req.query);

  try {
    // Définir la difficulté de manière plus propre
    const difficultyLevels = { easy: 1, normal: 2, hard: 3 };
    const difficultyParam = req.query.difficulty?.toLowerCase() || 'easy';
    const diff = difficultyLevels[difficultyParam] || 1; // Default: easy

    const result = await pool.query(
      `SELECT id, alt, diff FROM opening WHERE diff = $1 ORDER BY RANDOM()`,
      [diff]
    );

    console.log(` NB d'animes renvoyés pour diff=${diff} :`, result.rows.length);
    console.log(" Données SQL récupérées :", result.rows);

    // Désactiver le cache HTTP
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const animes = result.rows.map(anime => ({
      id: anime.id,
      alt: anime.alt,
      audio_url: `/media/${anime.id}`
    }));

    res.json(animes);
  } catch (err) {
    console.error(" Erreur dans /anime :", err);
    res.status(500).send("Erreur du serveur");
  }
});

// Renvoie la réponse correcte pour l'anime en cours
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

// ============================
// GESTION DES UPLOADS D'OPENING
// ============================

// Configuration de Multer pour le téléchargement de fichiers vidéo
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Stocker les fichiers dans le dossier ./opening
    cb(null, path.join(__dirname, 'opening'));
  },
  filename: function (req, file, cb) {
    // Supprime les espaces dans le nom de fichier
    const noSpaces = file.originalname.replace(/\s+/g, '');
    cb(null, noSpaces);
  },
});

// Filtre les formats vidéo autorisés
function fileFilter(req, file, cb) {
  const allowedMimes = ['video/webm', 'video/mp4', 'video/x-matroska'];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Seuls .webm, .mp4 et .mkv sont autorisés.'));
  }
}

// Limite la taille de fichier à 150 Mo
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 150 * 1024 * 1024,
  },
});

// Ajout d'un nouvel opening via un upload de fichier vidéo
app.post('/add-opening', upload.single('openingFile'), async (req, res) => {
  try {
    const { animeName, opName, youtubeViews, diff } = req.body;

    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, error: 'Aucun fichier vidéo envoyé.' });
    }

    const sanitizedFileName = req.file.filename;

    await pool.query(
      `INSERT INTO opening (alt, artist, diff, ytvue, openingpath)
       VALUES ($1, $2, $3, $4, $5)`,
      [animeName, opName, diff, youtubeViews, sanitizedFileName]
    );

    return res.json({
      success: true,
      message: 'Nouvel opening inséré avec succès.',
      fileName: sanitizedFileName,
    });
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ success: false, error: "Erreur lors de l'insertion." });
  }
});

// Middleware global de gestion des erreurs pour Multer
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      error: 'Fichier trop volumineux (limite 150Mo).',
    });
  }

  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      error: `Erreur Multer : ${err.message}`,
    });
  }

  return res.status(500).json({
    success: false,
    error: 'Erreur serveur inconnue.',
  });
});

// Page pour 4image
app.get('/4image', (req, res) => {
    res.sendFile(path.join(__dirname, '4image.html'));
});

// Récupère les données d'images depuis un fichier JSON
app.get('/get-images-data', (req, res) => {
    const imagesDataPath = path.join(__dirname, 'image', 'images_data.json');
    if (fs.existsSync(imagesDataPath)) {
        const imagesData = JSON.parse(fs.readFileSync(imagesDataPath, 'utf-8'));
        res.json(imagesData);
    } else {
        res.status(500).send({ error: 'Le fichier images_data.json est introuvable.' });
    }
});

// Sert une image spécifique en vérifiant le chemin d'accès
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

// Valide une réponse utilisateur pour un jeu type pendu
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

// Route GET /pendu_getAnime pour le jeu du pendu
app.get('/pendu_getAnime', async (req, res) => {
  try {
    const difficulty = req.query.difficulty || 'easy';
    const animeName = await getRandomAnime(difficulty);

    if (!animeName) {
      return res.status(404).json({ error: 'Aucun anime valide trouvé.' });
    }

    res.json({ name: animeName });
  } catch (error) {
    console.error('Erreur sur /pendu_getAnime :', error);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ============================
// Endpoint pour le jeu "Lite Info"
// ============================
app.get('/game', async (req, res) => {
  const mode = req.query.mode || 'easy'; // 'easy', 'medium', 'hard'
  try {
    // Récupérer le maximum d'id dans la table liteinfo
    const maxResult = await pool.query('SELECT MAX(id) AS max_id FROM liteinfo');
    const maxId = maxResult.rows[0].max_id;
    
    // Choisir aléatoirement un id entre 1 et maxId
    const randomId = Math.floor(Math.random() * maxId) + 1;
    
    // Récupérer l'enregistrement correspondant à cet id
    let result = await pool.query('SELECT * FROM liteinfo WHERE id = $1', [randomId]);
    let anime = result.rows[0];
    
    // Au cas où il y aurait des id manquants, on fait une sauvegarde
    if (!anime) {
      result = await pool.query('SELECT * FROM liteinfo ORDER BY random() LIMIT 1');
      anime = result.rows[0];
    }
    
    // Liste des champs à deviner
    const fields = ['title', 'is_sequel', 'date_de_sortie', 'anime_type', 'origine', 'compositeur', 'auteur'];
    let prefillCount = 0;
    if (mode === 'easy') prefillCount = 4;
    else if (mode === 'medium') prefillCount = 2;
    else if (mode === 'hard') prefillCount = 0;

    // Choix aléatoire de champs à pré-remplir parmi ceux-ci
    const shuffled = fields.sort(() => 0.5 - Math.random());
    const prefillFields = shuffled.slice(0, prefillCount);

    res.json({ anime, prefillFields, mode });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error retrieving game data");
  }
});

app.get('/autocomplete', async (req, res) => {
  const field = req.query.field;
  const term = req.query.term || '';
  // Autoriser uniquement certains champs
  const allowedFields = ['title', 'anime_type', 'compositeur', 'auteur'];
  if (!allowedFields.includes(field)) {
    return res.status(400).json({ error: 'Champ invalide' });
  }
  try {
    const query = `SELECT DISTINCT ${field} FROM liteinfo WHERE ${field} ILIKE $1 ORDER BY ${field} LIMIT 10`;
    const values = [`%${term}%`];
    const result = await pool.query(query, values);
    const suggestions = result.rows.map(row => row[field]);
    res.json({ suggestions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur interne' });
  }
});


// Route pour servir la page du tournoi (par exemple bracket.html)
app.get('/bracket', (req, res) => {
  res.sendFile(path.join(__dirname, 'bracket.html'));
});

// Endpoint API pour générer le bracket
app.get('/api/bracket', async (req, res) => {
  try {
    let rounds = parseInt(req.query.rounds, 10);
    // Vérifier que rounds est une puissance de deux (ex: 8, 16, 32, etc.)
    if (!rounds || (rounds & (rounds - 1)) !== 0) {
      return res.status(400).json({ error: 'Le paramètre rounds doit être une puissance de deux (ex: 8, 16, 32).' });
    }
    
    // Détermine le type de tournoi (anime par défaut)
    const type = req.query.type || 'anime';
    let query;
    if (type === 'character') {
      // Pour les personnages
      query = "SELECT id, name, anime, image_url, character_url FROM caracteres where id<1300 ORDER BY RANDOM() LIMIT $1";
    } else {
      // Pour les animes
      query = "SELECT id, title, image_url FROM animes WHERE anime_type='TV' AND score>7.9 ORDER BY RANDOM() LIMIT $1";
    }
    
    const { rows } = await pool.query(query, [rounds]);
    if (rows.length < rounds) {
      return res.status(400).json({ error: 'Nombre insuffisant d\'entrées dans la base de données.' });
    }
    
    res.json({ participants: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur interne du serveur.' });
  }
});

// ============================
// GESTION WEBSOCKET
// ============================

// Structure globale pour stocker les rooms
const rooms = {};

/**
 * Diffuse un message à tous les clients d'une salle spécifiée.
 */
function broadcastToRoom(room, data) {
  const roomObj = rooms[room];
  if (!roomObj) return;
  
  console.debug(`[WS] broadcastToRoom(${room}):`, data.type || data);
  roomObj.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

/**
 * Récupère une question aléatoire basée sur la difficulté.
 */
// Extrait possible
async function getRandomQuestion(difficulty = 'easy') {
  let diffValue = 1;
  if (difficulty === 'normal') diffValue = 2;
  if (difficulty === 'hard')   diffValue = 3;

  const result = await pool.query(
    `SELECT id, alt
     FROM opening
     WHERE diff = $1
     ORDER BY RANDOM()
     LIMIT 1`,
    [diffValue]
  );

  if (result.rows.length === 0) return null;
  const anime = result.rows[0];
  return {
    id: anime.id,
    alt: anime.alt,
    audio_url: `/media/${anime.id}`
  };
}


/**
 * Passe au prochain round dans une salle.
 */
async function nextRound(room) {
  const currentRoom = rooms[room];
  if (!currentRoom) return;

  // Annulation des timers précédents
  currentRoom.hintTimers.forEach(t => clearTimeout(t));
  currentRoom.hintTimers = [];

  if (currentRoom.currentRound >= currentRoom.totalRounds) {
    console.debug(`[WS] Fin de jeu dans la room ${room}`);
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

  console.debug(`[WS] nextRound => Room ${room}, round ${currentRoom.currentRound}, questionID=${newQ.id}`);

  broadcastToRoom(room, { type: "newQuestion", question: newQ });
  broadcastToRoom(room, { type: "scoreUpdate", scores: currentRoom.scores });

  currentRoom.roundStartTime = Date.now();

  // Mise en place des timers pour les indices et la fin de round
  const hint1Timer = setTimeout(() => {
    console.debug(`[WS] Room ${room} => indice 1 disponible`);
    broadcastToRoom(room, { type: "hintAvailable", hint: 1 });
  }, 20000);

  const hint2Timer = setTimeout(() => {
    console.debug(`[WS] Room ${room} => indice 2 disponible`);
    broadcastToRoom(room, { type: "hintAvailable", hint: 2 });
  }, 35000);

  const roundEndTimer = setTimeout(() => {
    if (!currentRoom.firstCorrectPlayer) {
      console.debug(`[WS] Room ${room} => fin du round, personne n'a trouvé`);
      broadcastToRoom(room, {
        type: "roundEnded",
        message: "Temps écoulé ! Personne n'a trouvé."
      });
      nextRound(room);
    }
  }, 60000);

  currentRoom.hintTimers.push(hint1Timer, hint2Timer, roundEndTimer);
}

// ============================
// GESTION DES CONNEXIONS WEBSOCKET
// ============================
wss.on('connection', (ws) => {
  console.debug("[WS] Un client s'est connecté");

  ws.on('message', async (msg) => {
    try {
      const data = JSON.parse(msg);
      console.debug("[WS] Reçu", data);

      switch (data.type) {
        case "createRoom": {
          // Création d'une nouvelle salle
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
              roundStartTime: 0,
              hintsUsed: {}
            };

            ws.room = data.room;
            ws.playerName = data.player;
            ws.isChef = true;

            ws.send(JSON.stringify({
              type: "roomCreated",
              room: data.room
            }));

            broadcastToRoom(data.room, {
              type: "playerListUpdate",
              players: rooms[data.room].playerNames,
              scores: rooms[data.room].scores
            });

            console.debug(`[WS] Room créée: ${data.room}, Chef: ${data.player}`);
          } else {
            ws.send(JSON.stringify({
              type: "error",
              message: "Room déjà existante."
            }));
          }
          break;
        }

        case "joinRoom": {
          // Un joueur rejoint une salle existante
          if (!rooms[data.room]) {
            ws.send(JSON.stringify({
              type: "error",
              message: "Room introuvable."
            }));
            break;
          }
          const r = rooms[data.room];
          if (r.playerNames.includes(data.player)) {
            ws.send(JSON.stringify({
              type: "error",
              message: "Pseudo déjà utilisé."
            }));
            break;
          }

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

          broadcastToRoom(data.room, { type: "playerJoined", player: data.player });
          broadcastToRoom(data.room, {
            type: "playerListUpdate",
            players: r.playerNames,
            scores: r.scores
          });

          console.debug(`[WS] Player ${data.player} a rejoint la room ${data.room}`);
          break;
        }

        case "startGame": {
          // Démarrage d'une partie par le chef de salle
          const rm = ws.room;
          if (!rm || !rooms[rm]) {
            ws.send(JSON.stringify({ type: "error", message: "Room invalide." }));
            break;
          }
          if (!ws.isChef) {
            ws.send(JSON.stringify({ type: "error", message: "Seul le chef peut démarrer." }));
            break;
          }

          const currentRoom = rooms[rm];
          if (currentRoom.currentRound >= currentRoom.totalRounds) {
            ws.send(JSON.stringify({
              type: "error",
              message: "Le nombre de rounds est déjà atteint."
            }));
            break;
          }
          if (currentRoom.isGameStarted) {
            ws.send(JSON.stringify({
              type: "error",
              message: "Le jeu est déjà en cours."
            }));
            break;
          }

          const q = await getRandomQuestion(currentRoom.difficulty);
          if (!q) {
            ws.send(JSON.stringify({
              type: "error",
              message: "Aucune question dispo pour démarrer."
            }));
            break;
          }

          currentRoom.currentQuestion = q;
          currentRoom.currentRound++;
          currentRoom.isGameStarted = true;
          currentRoom.firstCorrectPlayer = null;
          currentRoom.skipVotes = new Set();
          currentRoom.roundStartTime = Date.now();

          broadcastToRoom(rm, { type: "startGame", round: currentRoom.currentRound });
          broadcastToRoom(rm, { type: "newQuestion", question: q });
          broadcastToRoom(rm, { type: "scoreUpdate", scores: currentRoom.scores });

          console.debug(`[WS] Jeu démarré dans la room ${rm}, Round: ${currentRoom.currentRound}, Chef: ${ws.playerName}`);

          // Mise en place des timers pour indices et fin de round
          const hint1Timer = setTimeout(() => {
            console.debug(`[WS] Room ${rm} => indice 1 disponible`);
            broadcastToRoom(rm, { type: "hintAvailable", hint: 1 });
          }, 20000);

          const hint2Timer = setTimeout(() => {
            console.debug(`[WS] Room ${rm} => indice 2 disponible`);
            broadcastToRoom(rm, { type: "hintAvailable", hint: 2 });
          }, 35000);

          const roundEndTimer = setTimeout(() => {
            if (!currentRoom.firstCorrectPlayer) {
              console.debug(`[WS] Room ${rm} => fin du round, personne n'a trouvé`);
              broadcastToRoom(rm, {
                type: "roundEnded",
                message: "Temps écoulé! Personne n'a trouvé."
              });
              nextRound(rm);
            }
          }, 60000);

          currentRoom.hintTimers.push(hint1Timer, hint2Timer, roundEndTimer);
          break;
        }

        case "submitAnswer": {
          // Soumission d'une réponse par un joueur
          const rm = ws.room;
          if (!rm || !rooms[rm]) {
            ws.send(JSON.stringify({ type: "error", message: "Room introuvable." }));
            break;
          }
          const currentRoom = rooms[rm];
          if (!currentRoom.isGameStarted) {
            ws.send(JSON.stringify({ type: "error", message: "Aucune partie en cours." }));
            break;
          }

          const player = ws.playerName;
          const answer = data.answer.trim();
          console.debug(`[WS] submitAnswer => player=${player}, answer="${answer}"`);

          // Gestion du skip (réponse vide)
          if (answer === "") {
            currentRoom.skipVotes.add(player);
            broadcastToRoom(rm, {
              type: "playerSkip",
              message: `${player} a passé son tour.`,
              player
            });

            if (currentRoom.skipVotes.size === currentRoom.playerNames.length) {
              console.debug(`[WS] Tous ont skip dans room ${rm}`);
              currentRoom.hintTimers.forEach(t => clearTimeout(t));
              currentRoom.hintTimers = [];
              broadcastToRoom(rm, {
                type: "roundEnded",
                message: "Tous les joueurs ont passé leur tour !"
              });
              nextRound(rm);
            }
            break;
          }

          if (currentRoom.firstCorrectPlayer) {
            ws.send(JSON.stringify({
              type: "answerResult",
              message: `Le round a déjà été gagné par ${currentRoom.firstCorrectPlayer}.`
            }));
            break;
          }

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
            currentRoom.scores[player] = (currentRoom.scores[player] || 0) + points;

            broadcastToRoom(rm, {
              type: "answerResult",
              message: `${player} a trouvé en ${timeTaken.toFixed(1)}s et gagne ${points} pts!`
            });
            broadcastToRoom(rm, { type: "roundWinner", winner: player });
            broadcastToRoom(rm, { type: "scoreUpdate", scores: currentRoom.scores });

            currentRoom.hintTimers.forEach(t => clearTimeout(t));
            currentRoom.hintTimers = [];

            setTimeout(() => { nextRound(rm); }, 3000);
          } else {
            ws.send(JSON.stringify({
              type: "answerResult",
              message: `Mauvaise réponse de ${player}.`
            }));
          }
          break;
        }

        case "useHint": {
          // Gestion de l'utilisation d'un indice par un joueur
          const rm = ws.room;
          if (!rm || !rooms[rm]) {
            ws.send(JSON.stringify({ type: "error", message: "Room introuvable." }));
            break;
          }
          const currentRoom = rooms[rm];
          if (!currentRoom.isGameStarted) {
            ws.send(JSON.stringify({ type: "error", message: "Partie non démarrée." }));
            break;
          }

          currentRoom.hintsUsed = currentRoom.hintsUsed || {};
          currentRoom.hintsUsed[ws.playerName] = currentRoom.hintsUsed[ws.playerName] || [];
          
          if (currentRoom.hintsUsed[ws.playerName].includes(data.hint)) {
            ws.send(JSON.stringify({ type: "error", message: "Indice déjà utilisé." }));
            break;
          }

          currentRoom.hintsUsed[ws.playerName].push(data.hint);

          broadcastToRoom(rm, { type: "hintAvailable", hint: data.hint });
          ws.send(JSON.stringify({
            type: "hintUsed",
            hint: data.hint,
            message: `Indice ${data.hint} utilisé`
          }));
          break;
        }

        case "allSkipped": {
          // Gestion du cas où tous les joueurs passent
          const rm = ws.room;
          if (!rm || !rooms[rm]) break;
          const currentRoom = rooms[rm];
          if (currentRoom.firstCorrectPlayer) break;

          currentRoom.hintTimers.forEach(t => clearTimeout(t));
          currentRoom.hintTimers = [];
          broadcastToRoom(rm, {
            type: "roundEnded",
            message: "Personne n'a trouvé. (Skip global)"
          });
          nextRound(rm);
          break;
        }

        default:
          ws.send(JSON.stringify({
            type: "error",
            message: "Type de message inconnu."
          }));
          break;
      }
    } catch (err) {
      console.error("[WS] Erreur message websocket:", err);
      ws.send(JSON.stringify({
        type: "error",
        message: "Erreur lors du traitement du message."
      }));
    }
  });

  ws.on('close', () => {
    console.debug("[WS] Un client s'est déconnecté");
    if (ws.room && rooms[ws.room]) {
      const r = rooms[ws.room];
      r.clients = r.clients.filter(c => c !== ws);
      r.playerNames = r.playerNames.filter(p => p !== ws.playerName);
      delete r.scores[ws.playerName];
      if (r.hintsUsed) delete r.hintsUsed[ws.playerName];

      if (r.clients.length === 0) {
        r.hintTimers.forEach(t => clearTimeout(t));
        delete rooms[ws.room];
        console.debug(`[WS] Room supprimée: ${ws.room}`);
      } else {
        broadcastToRoom(ws.room, { type: "playerLeft", player: ws.playerName });

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

        broadcastToRoom(ws.room, {
          type: "playerListUpdate",
          players: r.playerNames,
          scores: r.scores
        });
      }
    }
  });
});

// ============================
// DÉMARRAGE DU SERVEUR
// ============================
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Serveur lancé sur le port ${PORT}`);
});
