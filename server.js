const express = require('express');
const path = require('path');
const app = express();
const { Pool } = require('pg');
const session = require('express-session');
const fs = require('fs');
const levenshtein = require('fast-levenshtein');
const unaccent = require('unaccent');

// Connexion à la base de données
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'animeguesse',
    password: '2fG^cFx$#f7N@', // Remplacez par votre mot de passe
    port: 5432
});

// Middleware pour traiter le JSON envoyé par le client
app.use(express.json());

// Configuration des sessions
app.use(session({
    secret: 'votre_cle_secrete', // Remplacez par une clé secrète robuste
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Passez à true si vous utilisez HTTPS
}));

// Servir les fichiers statiques depuis le répertoire courant
app.use(express.static(path.join(__dirname)));

// Serveur principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Endpoint pour la sélection du niveau
app.get('/game.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'game.html'));
});

// Endpoint pour le gameplay
app.get('/gameplay.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'gameplay.html'));
});

// Fonction pour normaliser les chaînes de caractères
function normalizeString(str) {
    // Supprimer les accents et convertir en minuscules
    let normalized = str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

    // Supprimer la ponctuation et les caractères spéciaux
    normalized = normalized.replace(/[^a-z0-9\s]/g, "");

    // Supprimer les espaces multiples
    normalized = normalized.replace(/\s+/g, " ").trim();

    // Supprimer les articles définis en début de phrase
    normalized = normalized.replace(/^(le|la|les|l|un|une|des)\s+/i, "");

    return normalized;
}

// Fonction pour obtenir les critères en fonction du niveau
function getLevelCriteria(level, modifier = 0) {
    let baseCriteria;
    switch (level) {
        case 'very_easy':
            baseCriteria = {
                maxPopularity: 350,
                types: ['TV'],
                includeSequels: false,
                excludeTop: null
            };
            break;
        case 'easy':
            baseCriteria = {
                maxPopularity: 650,
                types: ['TV', 'Movie'],
                includeSequels: false,
                excludeTop: null
            };
            break;
        case 'normal':
            baseCriteria = {
                maxPopularity: 900,
                types: ['TV', 'Movie'],
                includeSequels: false,
                excludeTop: null
            };
            break;
        case 'hard':
            baseCriteria = {
                maxPopularity: 2000,
                types: ['TV', 'Movie', 'OVA'],
                includeSequels: true,
                excludeTop: 400
            };
            break;
        case 'impossible':
            baseCriteria = {
                maxPopularity: 5000,
                types: ['Movie', 'OVA', 'ONA', 'Special'],
                includeSequels: true,
                excludeTop: 1000 // Exclut les animés du top 1000
            };
            break;
        default:
            baseCriteria = {
                maxPopularity: 550,
                types: ['TV'],
                includeSequels: false,
                excludeTop: null
            };
            break;
    }

    // Ajuster la popularité maximale en fonction du modificateur
    baseCriteria.maxPopularity += modifier;

    // S'assurer que la popularité maximale reste dans des limites raisonnables
    if (baseCriteria.maxPopularity < 100) baseCriteria.maxPopularity = 100;
    if (baseCriteria.maxPopularity > 5000) baseCriteria.maxPopularity = 5000;

    return baseCriteria;
}

// Endpoint pour définir le niveau dans la session
app.get('/set-level', (req, res) => {
    const level = req.query.level;
    req.session.level = level;
    req.session.difficultyModifier = 0; // Réinitialiser le modificateur
    res.redirect('/gameplay.html');
});

// Endpoint pour obtenir une image d'animé depuis la base de données en fonction du niveau
// Endpoint pour obtenir une image d'animé depuis la base de données en fonction du niveau
app.get('/anime-image', async (req, res) => {
    try {
        const level = req.session.level || 'very_easy'; // Niveau par défaut

        // Obtenir le modificateur de difficulté
        const difficultyModifier = req.session.difficultyModifier || 0;

        // Obtenir les critères en fonction du niveau et du modificateur
        const criteria = getLevelCriteria(level, difficultyModifier);

        // Récupérer la liste des IDs des animés déjà utilisés dans la session
        if (!req.session.usedAnimeIds) {
            req.session.usedAnimeIds = [];
        }

        // Construire la requête SQL en fonction des critères
        let query = `
            SELECT * FROM animes
            WHERE popularity <= $1
            AND anime_type = ANY($2)
            ${criteria.includeSequels ? '' : 'AND is_sequel = FALSE'}
            ${criteria.excludeTop ? 'AND popularity > $3' : ''}
            AND id NOT IN (${req.session.usedAnimeIds.join(',') || 'NULL'})
            ORDER BY RANDOM()
            LIMIT 1
        `;

        const values = [criteria.maxPopularity, criteria.types];
        if (criteria.excludeTop) {
            values.push(criteria.excludeTop);
        }

        let { rows } = await pool.query(query, values);

        if (rows.length === 0) {
            // Si aucun animé n'est trouvé (tous ont été utilisés), réinitialiser la liste
            req.session.usedAnimeIds = [];
            // Relancer la requête sans exclure les IDs
            query = `
                SELECT * FROM animes
                WHERE popularity <= $1
                AND anime_type = ANY($2)
                ${criteria.includeSequels ? '' : 'AND is_sequel = FALSE'}
                ${criteria.excludeTop ? 'AND popularity > $3' : ''}
                ORDER BY RANDOM()
                LIMIT 1
            `;
            const result = await pool.query(query, values);
            rows = result.rows;
            if (rows.length === 0) {
                res.status(404).send('Aucun animé trouvé');
                return;
            }
        }

        const currentAnime = rows[0];
        req.session.currentAnime = currentAnime;

        // Ajouter l'ID de l'animé utilisé à la liste
        req.session.usedAnimeIds.push(currentAnime.id);

        // Construire l'URL de l'image
        const imageFileName = path.basename(currentAnime.image_url); // Récupère le nom de fichier
        const imageUrl = `/images/${imageFileName}`;

        // Vérifier si le fichier image existe
        const imagePath = path.join(__dirname, 'images', imageFileName);
        if (!fs.existsSync(imagePath)) {
            console.error('Image non trouvée :', imagePath);
            res.status(404).send('Image non trouvée');
            return;
        }

        // Inclure l'URL de l'image dans les données de l'animé
        const animeData = {
            id: currentAnime.id,
            title: currentAnime.title,
            alt_title: currentAnime.alt_title,
            popularity: currentAnime.popularity,
            image_url: imageUrl,
            // Ajoutez ici d'autres champs nécessaires pour le calcul du score
        };

        // Envoyer les données de l'animé au client
        res.json(animeData);
    } catch (error) {
        console.error('Erreur lors de la récupération de l\'image :', error);
        res.status(500).send('Erreur lors de la récupération de l\'image');
    }
});

// Endpoint pour réinitialiser les IDs des animés utilisés
app.get('/reset-used-animes', (req, res) => {
    req.session.usedAnimeIds = [];
    res.sendStatus(200);
});

// Endpoint pour vérifier la réponse de l'utilisateur
app.post('/check-answer', (req, res) => {
    const userAnswer = normalizeString(req.body.answer.trim());
    const possibleTitles = req.body.possibleTitles.map(title => normalizeString(title.trim()));

    const currentAnime = req.session.currentAnime;
    const level = req.session.level || 'very_easy';

    if (!currentAnime) {
        res.json({ correct: false });
        return;
    }

    const correctTitles = [
        normalizeString(currentAnime.title.trim()),
        normalizeString(currentAnime.alt_title.trim())
    ];

    function isSimilar(a, b) {
        const distance = levenshtein.get(a, b);
        const maxLength = Math.max(a.length, b.length);
        const similarity = (maxLength - distance) / maxLength;
        return similarity >= 0.8; // Seuil de similarité (80%)
    }

    let correct = false;
    for (const userTitle of possibleTitles) {
        for (const correctTitle of correctTitles) {
            if (isSimilar(userTitle, correctTitle)) {
                correct = true;
                break;
            }
        }
        if (correct) break;
    }

    if (correct) {
        res.json({ correct: true });
    } else {
        // Formatage du titre correct
        let correctAnswerFormatted;
        if (currentAnime.title !== currentAnime.alt_title) {
            correctAnswerFormatted = `${currentAnime.alt_title} (${currentAnime.title})`;
        } else {
            correctAnswerFormatted = currentAnime.title;
        }

        res.json({ correct: false, correctAnswer: correctAnswerFormatted });
    }
});

// Endpoint pour ajuster la difficulté
app.post('/adjust-difficulty', (req, res) => {
    const correct = req.body.correct;
    if (!req.session.difficultyModifier) {
        req.session.difficultyModifier = 0;
    }

    if (correct) {
        // Augmenter la difficulté
        req.session.difficultyModifier -= 50;
    } else {
        // Diminuer la difficulté
        req.session.difficultyModifier += 50;
    }

    res.sendStatus(200);
});

// Endpoint pour obtenir des suggestions d'animés
app.get('/anime-suggestions', async (req, res) => {
    const searchQuery = req.query.query.toLowerCase();
    const level = req.session.level || 'very_easy';

    // Déterminer les types d'animés à inclure en fonction du niveau
    let animeTypes;
    let excludeSequels = false; // Nouveau drapeau pour exclure les séquelles

    switch (level) {
        case 'very_easy':
            animeTypes = ['TV']; // Inclure uniquement les séries TV
            excludeSequels = true; // Exclure les séquelles en mode Très Simple
            break;
        case 'easy':
            animeTypes = ['TV', 'Movie']; // Inclure séries TV et films
            break;
        case 'normal':
            animeTypes = ['TV', 'Movie', 'OVA']; // Ajouter les OVA
            break;
        case 'hard':
        case 'impossible':
            animeTypes = ['TV', 'Movie', 'OVA', 'ONA', 'Special']; // Inclure tous les types
            break;
        default:
            animeTypes = ['TV'];
    }

    // Construire la condition SQL pour exclure les séquelles si nécessaire
    let sequelCondition = '';
    if (excludeSequels) {
        sequelCondition = 'AND is_sequel = false';
    }

    // Requête SQL pour les suggestions avec filtrage des types et des séquelles
    const query = `
        SELECT title, alt_title
        FROM animes
        WHERE (LOWER(unaccent(title)) LIKE '%' || unaccent($1) || '%'
            OR LOWER(unaccent(alt_title)) LIKE '%' || unaccent($1) || '%')
            AND anime_type = ANY($2)
            ${sequelCondition}
        LIMIT 10
    `;

    try {
        const result = await pool.query(query, [searchQuery, animeTypes]);
        res.json(result.rows);
    } catch (err) {
        console.error("Erreur lors de la récupération des suggestions", err);
        res.status(500).send('Erreur serveur');
    }
});

// Démarrer le serveur
const port = 3000;
app.listen(port, () => {
    console.log(`Serveur en cours d'exécution sur le port ${port}`);
});

// Endpoint pour obtenir la réponse correcte de l'animé actuel
app.get('/current-anime-answer', (req, res) => {
    const currentAnime = req.session.currentAnime;
    if (currentAnime) {
        let correctAnswerFormatted;
        if (currentAnime.title !== currentAnime.alt_title) {
            correctAnswerFormatted = `${currentAnime.alt_title} (${currentAnime.title})`;
        } else {
            correctAnswerFormatted = currentAnime.title;
        }
        res.json({ correctAnswer: correctAnswerFormatted });
    } else {
        res.status(404).json({ error: 'Aucun animé en cours' });
    }
});

