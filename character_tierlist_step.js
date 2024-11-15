// character_tierlist_step.js

document.addEventListener('DOMContentLoaded', () => {
    const characterImage = document.getElementById('character-image');
    const characterName = document.getElementById('character-name');
    let currentCharacterIndex = 0;
    let characters = [];

    async function loadCharacters() {
        try {
            const response = await fetch('/get-tier-list-elements?type=personnage');
            characters = await response.json();
            displayCharacter();
        } catch (error) {
            console.error('Erreur lors du chargement des personnages:', error);
        }
    }

    function displayCharacter() {
        if (currentCharacterIndex < characters.length) {
            const character = characters[currentCharacterIndex];
            characterImage.src = character.image_url;
            characterName.textContent = character.name;
        } else {
            alert('Vous avez classé tous les personnages !');
        }
    }

    window.classifyCharacter = function(tier) {
        console.log(`Personnage classé dans le tier ${tier}: ${characters[currentCharacterIndex].name}`);
        currentCharacterIndex++;
        displayCharacter();
    };

    loadCharacters();
});
