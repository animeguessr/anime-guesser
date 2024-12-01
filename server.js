const express = require('express');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const session = require('express-session');
const levenshtein = require('fast-levenshtein');
const unaccent = require('unaccent');
const crypto = require('crypto');

const app = express();

// Chemins des répertoires d'images
const imageDirectory = path.join(__dirname, 'caractere');
const openingDirectory = path.join(__dirname, 'opening', 'opening');
const imagesDirectory = path.join(__dirname, 'images');  // Chemin corrigé pour le répertoire des images

// Configuration du pool de connexions à la base de données
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'animeguesse',
    password: '2fG^cFx$#f7N@',
    port: 5432
});

// Middleware
app.use(express.json());
app.use(session({
    secret: 'votre_cle_secrete',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Passez à true si vous utilisez HTTPS
}));
app.use(express.static(path.join(__dirname)));
app.use('/caractere', express.static(imageDirectory));
app.use('/images', express.static(imagesDirectory));
app.use('/opening', express.static(openingDirectory));


// Fonctions utilitaires
function normalizeString(str) {
    let normalized = str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    normalized = normalized.replace(/[^a-z0-9\s]/g, "");
    normalized = normalized.replace(/\s+/g, " ").trim();
    normalized = normalized.replace(/^(le|la|les|l|un|une|des)\s+/i, "");
    return normalized;
}

function getLevelCriteria(level, modifier = 0) {
    let baseCriteria = {
        maxPopularity: 550,
        types: ['TV'],
        includeSequels: false,
        excludeTop: null
    };

    switch (level) {
        case 'very_easy':
            baseCriteria = { maxPopularity: 350, types: ['TV'], includeSequels: false };
            break;
        case 'easy':
            baseCriteria = { maxPopularity: 650, types: ['TV', 'Movie'], includeSequels: false };
            break;
        case 'normal':
            baseCriteria = { maxPopularity: 900, types: ['TV', 'Movie'], includeSequels: false };
            break;
        case 'hard':
            baseCriteria = { maxPopularity: 2000, types: ['TV', 'Movie', 'OVA'], includeSequels: true, excludeTop: 400 };
            break;
        case 'impossible':
            baseCriteria = { maxPopularity: 5000, types: ['Movie', 'OVA', 'ONA', 'Special'], includeSequels: true, excludeTop: 1000 };
            break;
    }

    baseCriteria.maxPopularity = Math.min(Math.max(baseCriteria.maxPopularity + modifier, 100), 5000);
    return baseCriteria;
}

function cryptoRandom() {
    const buffer = crypto.randomBytes(4);
    return buffer.readUInt32BE(0) / 0xffffffff;
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(cryptoRandom() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
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

        if (!criteria.includeSequels) conditions.push(`is_sequel = FALSE`);
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
        let { rows } = await pool.query(query, values);

        if (rows.length === 0) {
            req.session.usedAnimeIds = [];
            const resetConditions = conditions.filter(cond => !cond.includes('id != ALL'));
            const resetQuery = `SELECT * FROM animes WHERE ${resetConditions.join(' AND ')} ORDER BY RANDOM() LIMIT 1`;
            const resetResult = await pool.query(resetQuery, values.slice(0, paramIndex - 1));
            rows = resetResult.rows;
            if (rows.length === 0) return res.status(404).send('Aucun animé trouvé');
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
            image_url: imageUrl  // S'assurer que l'URL de l'image est correcte
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
    const userAnswer = normalizeString(req.body.answer.trim());
    const possibleTitles = req.body.possibleTitles.map(title => normalizeString(title.trim()));
    const currentAnime = req.session.currentAnime;

    if (!currentAnime) return res.json({ correct: false });

    const correctTitles = [
        normalizeString(currentAnime.title.trim()),
        normalizeString(currentAnime.alt_title.trim())
    ];

    const isSimilar = (a, b) => {
        const distance = levenshtein.get(a, b);
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

app.post('/adjust-difficulty', (req, res) => {
    const correct = req.body.correct;
    req.session.difficultyModifier = req.session.difficultyModifier || 0;
    req.session.difficultyModifier += correct ? -50 : 50;
    res.sendStatus(200);
});

app.get('/anime-suggestions', async (req, res) => {
    const searchQuery = req.query.query.toLowerCase();
    const level = req.session.level || 'very_easy';

    let animeTypes;
    let excludeSequels = false;

    switch (level) {
        case 'very_easy':
            animeTypes = ['TV'];
            excludeSequels = true;
            break;
        case 'easy':
            animeTypes = ['TV', 'Movie'];
            break;
        case 'normal':
            animeTypes = ['TV', 'Movie', 'OVA'];
            break;
        case 'hard':
        case 'impossible':
            animeTypes = ['TV', 'Movie', 'OVA', 'ONA', 'Special'];
            break;
        default:
            animeTypes = ['TV'];
    }

    const conditions = [
        `(LOWER(unaccent(title)) LIKE '%' || unaccent($1) || '%' OR LOWER(unaccent(alt_title)) LIKE '%' || unaccent($1) || '%')`,
        `anime_type = ANY($2)`
    ];
    const values = [searchQuery, animeTypes];

    if (excludeSequels) conditions.push(`is_sequel = FALSE`);

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

    if (!validPreferences.includes(preference)) return res.status(400).json({ error: 'Préférence de genre invalide' });

    const conditions = ['image_url IS NOT NULL', "image_url != ''"];
    const values = [];
    let paramIndex = 1;

    if (preference === 'femme') {
        conditions.push(`genre = $${paramIndex++}`);
        values.push('Femme');
    } else if (preference === 'homme') {
        conditions.push(`genre = $${paramIndex++}`);
        values.push('Homme');
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
        const result = await pool.query(`SELECT id, title, REPLACE(image_url, 'C:\\Animeguesser\\images\\', '/images/') AS image_url, popularity, score, members FROM animes`);
        res.json(result.rows);
    } catch (error) {
        console.error('Erreur lors de la récupération des animes :', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des animes' });
    }
});

app.get('/get-character-game-data', async (req, res) => {
    const client = await pool.connect();
    try {
        const mainCharacterResult = await client.query(`SELECT id, name, anime, genre, image_url FROM caracteres ORDER BY RANDOM() LIMIT 1`);
        const mainCharacter = mainCharacterResult.rows[0];
        if (!mainCharacter) return res.status(404).json({ error: 'Aucun personnage principal trouvé.' });

        mainCharacter.image_url = `/caractere/${path.basename(mainCharacter.image_url)}`;

        const additionalCharactersResult = await client.query(`SELECT id, name, anime, genre FROM caracteres WHERE id != $1 ORDER BY RANDOM() LIMIT 3`, [mainCharacter.id]);
        const options = [...additionalCharactersResult.rows, {
            id: mainCharacter.id,
            name: mainCharacter.name,
            anime: mainCharacter.anime
        }];

        res.json({
            mainCharacter: mainCharacter,
            options: shuffleArray(options)
        });
    } catch (error) {
        console.error('Erreur lors de la récupération des données de jeu :', error);
        res.status(500).json({ error: 'Erreur serveur.' });
    } finally {
        client.release();
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

        const result = await pool.query(`SELECT * FROM opening WHERE id >= $1 AND id <= $2 ORDER BY RANDOM()`, [minId, maxId]);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Erreur du serveur');
    }
});

app.post('/validate', (req, res) => {
    const { userInput, correctNames } = req.body;
    const normalizedUserInput = normalizeString(userInput);
    const normalizedCorrectNames = correctNames.map(name => normalizeString(name));
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
    let imagePath = req.query.path;
    if (imagePath) {
        // Décoder le composant URI
        imagePath = decodeURIComponent(imagePath);

        // Définir le répertoire de base autorisé
        const baseDir = path.join(__dirname, 'image');

        // Normaliser le chemin pour éviter les attaques de type "path traversal"
        let normalizedPath = path.normalize(imagePath);

        // Vérifier si le chemin est absolu
        if (path.isAbsolute(normalizedPath)) {
            // Vérifier que le chemin commence par le répertoire de base autorisé
            if (!normalizedPath.startsWith(baseDir)) {
                return res.status(403).send({ error: 'Accès refusé.' });
            }
        } else {
            // Si le chemin est relatif, le résoudre par rapport au répertoire de base
            normalizedPath = path.join(baseDir, normalizedPath);
        }

        // Vérifier que le chemin final est toujours dans le répertoire de base
        if (!normalizedPath.startsWith(baseDir)) {
            return res.status(403).send({ error: 'Accès refusé.' });
        }

        // Vérifier si le fichier existe
        if (fs.existsSync(normalizedPath)) {
            res.sendFile(normalizedPath);
        } else {
            res.status(404).send({ error: 'Image introuvable.' });
        }
    } else {
        res.status(400).send({ error: 'Aucun chemin fourni.' });
    }
});



// Démarrage du serveur
const port = 3000;
app.listen(port, () => {
    console.log(`Serveur en cours d'exécution sur le port ${port}`);
});
