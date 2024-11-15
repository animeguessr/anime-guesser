// anime_tierlist_step.js

document.addEventListener('DOMContentLoaded', () => {
    const animeImage = document.getElementById('anime-image');
    const animeName = document.getElementById('anime-name');
    let currentAnimeIndex = 0;
    let animes = [];

    // Fonction pour charger les animes depuis le serveur
    async function loadAnimes() {
        try {
            const response = await fetch('/get-tier-list-elements?type=anime');
            animes = await response.json();
            displayAnime();
        } catch (error) {
            console.error('Erreur lors du chargement des animes:', error);
        }
    }

    // Fonction pour afficher l'anime actuel
    function displayAnime() {
        if (currentAnimeIndex < animes.length) {
            const anime = animes[currentAnimeIndex];
            animeImage.src = anime.cover_image_url;
            animeName.textContent = anime.name;
        } else {
            alert('Vous avez classé tous les animes !');
        }
    }

    // Fonction de classement pour chaque bouton
    window.classifyAnime = function(tier) {
        console.log(`Anime classé dans le tier ${tier}: ${animes[currentAnimeIndex].name}`);
        currentAnimeIndex++;
        displayAnime();
    };

    loadAnimes();
});
