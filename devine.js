let lives = 3;
let score = 0;
const characterImage = document.getElementById('character-image');
const options = Array.from(document.getElementsByClassName('option-button'));
const livesDisplay = document.getElementById('lives');
const scoreDisplay = document.getElementById('score');
const gameOverScreen = document.querySelector('.game-over-screen');
const finalScoreDisplay = document.getElementById('final-score');
const restartButton = document.getElementById('restart-button');
const menuButton = document.getElementById('menu-button');

// Fonction pour charger un nouveau personnage
async function loadCharacter() {
    try {
        // Récupérer un personnage aléatoire
        const res = await fetch('/get-character');
        const character = await res.json();

        // Mettre à jour l'image
        characterImage.src = character.image_url;

        // Générer des noms aléatoires pour les options
        const optionsRes = await fetch('/get-random-characters?exclude=' + character.id);
        const otherCharacters = await optionsRes.json();

        const allOptions = [...otherCharacters, character];
        shuffleArray(allOptions); // Mélanger les options

        // Afficher les options
        options.forEach((button, index) => {
            button.textContent = allOptions[index].name;
            button.classList.remove('correct', 'wrong');
            button.disabled = false;

            // Assigner l'événement au bouton
            if (allOptions[index].id === character.id) {
                button.onclick = () => handleCorrectAnswer(button);
            } else {
                button.onclick = () => handleWrongAnswer(button);
            }
        });
    } catch (error) {
        console.error('Erreur lors du chargement du personnage :', error);
    }
}

// Gestion des bonnes réponses
function handleCorrectAnswer(button) {
    button.classList.add('correct');
    score++;
    scoreDisplay.textContent = score;

    setTimeout(loadCharacter, 1000);
}

// Gestion des mauvaises réponses
function handleWrongAnswer(button) {
    button.classList.add('wrong');
    lives--;
    livesDisplay.textContent = lives;

    // Mettre en surbrillance la bonne réponse
    options.forEach(btn => {
        if (btn.textContent === characterImage.alt) {
            btn.classList.add('correct');
        }
    });

    if (lives === 0) {
        endGame();
    } else {
        setTimeout(loadCharacter, 1000);
    }
}

// Terminer le jeu
function endGame() {
    finalScoreDisplay.textContent = score;
    gameOverScreen.classList.remove('hidden');
}

// Recommencer
restartButton.onclick = () => {
    lives = 3;
    score = 0;
    livesDisplay.textContent = lives;
    scoreDisplay.textContent = score;
    gameOverScreen.classList.add('hidden');
    loadCharacter();
};

// Retour au menu principal
menuButton.onclick = () => {
    window.location.href = 'index.html';
};

// Mélanger un tableau
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

// Charger le premier personnage
loadCharacter();
