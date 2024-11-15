// Fonction pour charger et afficher les cartes d'anime
async function loadAnimeCards() {
    try {
        // Fetch des données depuis l'API (utilisez l'URL correcte ici)
        const response = await fetch('http://localhost:3000/get-animes');
        
        // Vérification du statut de la réponse
        if (!response.ok) {
            throw new Error(`Erreur lors de la récupération des données: ${response.status}`);
        }

        // Conversion en JSON
        const animes = await response.json();
        console.log("Animes chargés :", animes); // Log des données pour vérification

        // Affiche les cartes d'anime
        displayAnimeCards(animes.slice(0, 30)); // Par exemple : Charger les 30 premiers animes

    } catch (error) {
        console.error('Erreur lors du chargement des animes:', error);
    }
}

// Fonction pour afficher les cartes d'anime dans la zone sélectionnée
function displayAnimeCards(animes) {
    const animeSelectionContainer = document.querySelector('.anime-selection');
    animeSelectionContainer.innerHTML = ''; // Vider le conteneur avant d'ajouter les cartes

    animes.forEach(anime => {
        const animeCard = document.createElement('div');
        animeCard.classList.add('anime-card');
        animeCard.setAttribute('draggable', true);
        animeCard.id = `anime-${anime.id}`;

        animeCard.innerHTML = `
            <img src="${anime.image_url}" alt="${anime.title}">
            <p>${anime.title}</p>
        `;

        animeCard.addEventListener('dragstart', handleDragStart);
        animeCard.addEventListener('dragend', handleDragEnd);

        animeSelectionContainer.appendChild(animeCard);
    });
}

// Initialiser le chargement des animes
loadAnimeCards();

// Gestion du glisser-déposer (drag and drop)
let draggedItem = null;

function handleDragStart(event) {
    draggedItem = event.target;
    setTimeout(() => {
        event.target.style.display = 'none';
    }, 0);
}

function handleDragEnd(event) {
    setTimeout(() => {
        draggedItem.style.display = 'block';
        draggedItem = null;
    }, 0);
}

document.querySelectorAll('.tier-dropzone').forEach(dropzone => {
    dropzone.addEventListener('dragover', handleDragOver);
    dropzone.addEventListener('drop', handleDrop);
});

function handleDragOver(event) {
    event.preventDefault();
}

function handleDrop(event) {
    event.preventDefault();
    if (draggedItem) {
        event.target.appendChild(draggedItem);
        draggedItem.style.display = 'block';
    }
}
