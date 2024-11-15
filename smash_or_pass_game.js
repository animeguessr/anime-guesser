// smash_or_pass_game.js

const preference = new URLSearchParams(window.location.search).get("preference");
let currentRound = 1;
const maxRounds = 25;
let choices = {
    pass: [],
    smash: [],
    ultraSmash: []
};

// Fonction pour charger un personnage aléatoire en fonction de la préférence
function loadCharacter() {
    if (currentRound > maxRounds) {
        saveResults();
        window.location.href = "smash_or_pass_results.html";
        return;
    }

    fetch(`/get-character?preference=${preference}`)
        .then(response => response.json())
        .then(character => {
            if (character.error) { // Vérifie si la réponse contient une erreur
                console.error("Erreur du serveur :", character.error);
                alert("Erreur lors du chargement du personnage. Veuillez réessayer.");
                return;
            }
            document.getElementById("sop-character-image").src = character.image_url;
            document.getElementById("sop-character-image").alt = character.name;
            document.getElementById("sop-character-name").textContent = character.name;
            document.getElementById("sop-character-image").dataset.id = character.id;
        })
        .catch(error => console.error("Erreur lors du chargement du personnage :", error));
}

// Fonction pour enregistrer le choix de l'utilisateur
function recordChoice(choiceType) {
    const characterId = document.getElementById("sop-character-image").dataset.id;
    const characterName = document.getElementById("sop-character-name").textContent;
    const characterImage = document.getElementById("sop-character-image").src;

    choices[choiceType].push({
        id: characterId,
        name: characterName,
        image_url: characterImage
    });
    currentRound++;
    loadCharacter();
}

// Enregistrer les résultats sur le serveur
function saveResults() {
    fetch("/save-smash-pass-results", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(choices)
    })
    .catch(error => console.error("Erreur lors de l'enregistrement des résultats :", error));
}

// Charger le premier personnage lors du démarrage du jeu
loadCharacter();
