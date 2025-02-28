const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;

// Définir les chemins
const imagesRootPath = __dirname; // Correction ici
const imagesDataPath = path.join(__dirname, 'images_data.json');

// Charger les données JSON
let imagesData = [];
if (fs.existsSync(imagesDataPath)) {
    imagesData = JSON.parse(fs.readFileSync(imagesDataPath, 'utf-8'));
} else {
    console.error('Le fichier images_data.json est introuvable. Veuillez exécuter instantjson.py pour le générer.');
    process.exit(1);
}

// Middleware pour servir les fichiers statiques
app.use(express.static('public'));
app.use(express.json());

// *** Suppression ou déplacement du middleware conflictuel ***
// app.use('/images', express.static(imagesRootPath)); // Ceci causait un conflit avec les routes dynamiques

// Route pour afficher la liste des animés
app.get('/list', (req, res) => {
    const animés = imagesData.map(anime => anime.Name);
    res.send({ success: true, animés });
});

// Route pour afficher les images d'un animé
app.get('/images/:animeName', (req, res) => {
    const animeName = decodeURIComponent(req.params.animeName);
    const anime = imagesData.find(a => a.Name === animeName);

    if (!anime) {
        return res.status(404).send({ error: 'Animé non trouvé.' });
    }

    const images = Object.keys(anime)
        .filter(key => key.startsWith('image'))
        .map(key => path.basename(anime[key])); // Récupérer uniquement les noms des fichiers
    res.send({ success: true, images });
});

// Route pour vérifier et servir les images dynamiquement
app.get('/images/:animeName/:imageName', (req, res) => {
    const animeName = decodeURIComponent(req.params.animeName);
    const imageName = decodeURIComponent(req.params.imageName);
    const imagePath = path.join(imagesRootPath, animeName, imageName);

    if (fs.existsSync(imagePath)) {
        res.sendFile(imagePath);
    } else {
        res.status(404).send({ error: `Image introuvable : ${imagePath}` });
    }
});

// Route pour attribuer une difficulté à une image
app.post('/set-difficulty', (req, res) => {
    const { animeName, imageName, difficulty } = req.body;

    const anime = imagesData.find(a => a.Name === animeName);
    if (!anime) {
        return res.status(404).send({ error: 'Animé non trouvé.' });
    }

    const oldImagePath = path.join(imagesRootPath, animeName, imageName);
    const newImageName = `${difficulty}_${imageName}`;
    const newImagePath = path.join(imagesRootPath, animeName, newImageName);

    if (!fs.existsSync(oldImagePath)) {
        return res.status(404).send({ error: 'Image non trouvée.' });
    }

    try {
        fs.renameSync(oldImagePath, newImagePath);
        res.send({ success: true, newImageName });
    } catch (error) {
        console.error('Erreur lors du renommage de l\'image :', error);
        res.status(500).send({ error: 'Erreur lors du renommage de l\'image.' });
    }
});

// Route pour supprimer une image
app.post('/delete-image', (req, res) => {
    const { animeName, imageName } = req.body;

    const imagePath = path.join(imagesRootPath, animeName, imageName);
    if (!fs.existsSync(imagePath)) {
        return res.status(404).send({ error: 'Image non trouvée.' });
    }

    try {
        fs.unlinkSync(imagePath);
        res.send({ success: true });
    } catch (error) {
        console.error('Erreur lors de la suppression de l\'image :', error);
        res.status(500).send({ error: 'Erreur lors de la suppression de l\'image.' });
    }
});

// Route pour servir l'interface principale
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Route pour favicon (pour éviter l'erreur 404)
app.get('/favicon.ico', (req, res) => {
    res.status(204); // Réponse vide pour éviter l'erreur
});

// Lancer le serveur
app.listen(PORT, () => {
    console.log(`Serveur démarré sur http://localhost:${PORT}`);
});
