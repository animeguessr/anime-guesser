const express = require('express');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const session = require('express-session');
const crypto = require('crypto');
const unaccent = require('unaccent'); // Assurez-vous que ce module est installé

const app = express();

// Chemins des répertoires d'images
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
    secret: process.env.SESSION_SECRET || 'votre_cle_secrete', // Utilisez une variable d'environnement pour la clé secrète
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Passez à true si vous utilisez HTTPS
}));
app.use(express.static(__dirname));
app.use('/caractere', express.static(imageDirectory));
app.use('/images', express.static(imagesDirectory));
app.use('/opening', express.static(openingDirectory));

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

app.get('/anime', async (req, res) => {
    try {
        const difficulty = req.query.difficulty;
        let minId = 1, maxId = 90;

        if (difficulty === 'normal') {
            minId = 20; maxId = 300;
        } else if (difficulty === 'hard') {
            minId = 301; maxId = 600;
        }

        const result = await pool.query(`SELECT id, alt, nom FROM opening WHERE id >= $1 AND id <= $2 ORDER BY RANDOM()`, [minId, maxId]);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Erreur du serveur');
    }
});

const mediaDir = path.join(__dirname, 'opening', 'opening');

app.get('/media/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const result = await pool.query('SELECT openingpath FROM opening WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).send('Média non trouvé');
        }
        const opening = result.rows[0];
        const openingpath = opening.openingpath;

        const fileName = path.basename(openingpath);
        const filePath = path.join(mediaDir, fileName);

        if (!filePath.startsWith(mediaDir)) {
            return res.status(403).send('Accès refusé');
        }

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

app.post('/validate', (req, res) => {
    const { userInput, correctNames } = req.body;
    const normalizedUserInput = normalizeString(userInput || '');
    const normalizedCorrectNames = (correctNames || []).map(name => normalizeString(name || ''));
    const isValid = normalizedCorrectNames.some(name => name === normalizedUserInput);
    res.json({ valid: isValid });
});

app.get('/current-anime-answer', (req, res) => {
    const currentAnime = req.session.currentAnime;
    if (currentAnime) {
        const correctAnswerFormatted = currentAnime.title !== currentAnime.alt_title
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

// Démarrage du serveur
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Serveur en cours d'exécution sur le port ${port}`);
});
