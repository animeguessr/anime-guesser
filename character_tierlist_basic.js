// character_tierlist_basic.js

document.addEventListener('DOMContentLoaded', () => {
    const tierColumns = document.querySelectorAll('.tier-column');
    const characterContainer = document.querySelector('.character-selection');

    async function loadCharacters() {
        try {
            const response = await fetch('/get-tier-list-elements?type=personnage');
            const characters = await response.json();
            displayCharacters(characters);
        } catch (error) {
            console.error('Erreur lors du chargement des personnages:', error);
        }
    }

    function displayCharacters(characters) {
        characterContainer.innerHTML = '';
        characters.forEach(character => {
            const characterItem = document.createElement('div');
            characterItem.classList.add('character-item');
            characterItem.setAttribute('draggable', true);
            characterItem.innerHTML = `<img src="${character.image_url}" alt="${character.name}"><p>${character.name}</p>`;
            characterContainer.appendChild(characterItem);
        });

        addDragAndDropListeners();
    }

    function addDragAndDropListeners() {
        const characterItems = document.querySelectorAll('.character-item');
        characterItems.forEach(item => {
            item.addEventListener('dragstart', handleDragStart);
        });
        tierColumns.forEach(column => {
            column.addEventListener('dragover', handleDragOver);
            column.addEventListener('drop', handleDrop);
        });
    }

    function handleDragStart(e) {
        e.dataTransfer.setData('text/plain', e.target.innerHTML);
        e.dataTransfer.effectAllowed = 'move';
    }

    function handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    }

    function handleDrop(e) {
        e.preventDefault();
        const data = e.dataTransfer.getData('text/plain');
        e.target.innerHTML += data;
    }

    loadCharacters();
});
