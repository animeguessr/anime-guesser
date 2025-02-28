$(document).ready(function () {
    const levelNameElement = $('#level-name');
    const urlParams = new URLSearchParams(window.location.search);
    let level = urlParams.get('level') || 'very_easy'; // Utilisation de 'let' au lieu de 'const'

    // Niveaux de difficulté
    const levelNames = {
        'very_easy': 'Très Simple',
        'easy': 'Simple',
        'normal': 'Normal',
        'hard': 'Difficile',
        'impossible': 'Impossible'
    };
    levelNameElement.text(levelNames[level]);

    // Paramètres du système de points
    const difficultyPoints = {
        'very_easy': 5,
        'easy': 10,
        'normal': 20,
        'hard': 30,
        'impossible': 50
    };

    const maxTime = 30; // Temps maximum en secondes pour un bonus complet
    const timeBonusPerSecond = 1; // Bonus par seconde restante

    const hintPenalty = 5; // Pénalité par utilisation d'un indice (déflouter)
    const skipPenalty = 10; // Pénalité si le joueur choisit de passer
    const streakBonus = 10; // Bonus pour chaque bonne réponse consécutive au-delà de 3

    // Variables du jeu
    const animeImage = $('#anime-image');
    const resultMessage = $('#result-message');
    const submitButton = $('#submit-button');
    const deflouterButton = $('#deflouter-button');
    const skipButton = $('#skip-button');
    const answerInput = $('#answer-input');
    const livesContainer = $('#lives-container');
    const scoreElement = $('#score');
    const roundNumberElement = $('#round-number');
    const streakCountElement = $('#streak-count');
    const endGameModal = $('#end-game-modal');
    const finalScoreElement = $('#final-score');
    const roundsPlayedElement = $('#rounds-played');
    const totalRoundsElement = $('#total-rounds');
    const restartButton = $('#restart-button');
    const menuButton = $('#menu-button');
    let roundStartTime = 0;
    let currentAnime = null;

    let blurValue = 60; // Valeur initiale du flou
    const maxBlurValue = 60;
    const blurStep = 10;
    let defloutageCount = 0;
    let totalHintsUsed = 0;
    let lives = 3;
    let score = 0;
    let round = 0;
    let streak = 0;
    const maxRounds = 10;
    let gameOver = false;
    let cooldown = false; // Variable pour gérer le verrouillage après une bonne réponse

    // Initialisation du jeu
    function resetGame() {
        score = 0;
        round = 0;
        gameOver = false;
        lives = 3;
        blurValue = maxBlurValue;
        defloutageCount = 0;
        totalHintsUsed = 0;
        streak = 0;
        cooldown = false;
        endGameModal.hide();
        displayLives();
        scoreElement.text(score);
        streakCountElement.text(streak);
        loadNewAnime();
    }

    // Afficher les vies
    function displayLives() {
        livesContainer.empty();
        let livesHtml = '';
        for (let i = 0; i < lives; i++) {
            livesHtml += '<img src="https://cdn.iconscout.com/icon/free/png-256/heart-1767836-1502418.png" class="life-icon" alt="Life">';
        }
        livesContainer.append(livesHtml);
    }

    // Afficher un message temporaire
    function showResultMessage(text, color) {
        resultMessage.text(text).css('color', color).addClass('show');
    }

    // Cacher le message de résultat
    function hideResultMessage() {
        resultMessage.removeClass('show');
    }

    // Gestion des erreurs d'image
    animeImage.on('error', () => {
        animeImage.attr('src', '/path/to/backup-image.jpg'); // Image par défaut
        showResultMessage('Image non trouvée. Passons au suivant.', '#e67e22');
        setTimeout(loadNewAnime, 3000);
    });

    // Charger un nouvel animé
    function loadNewAnime() {
        if (gameOver) return;

        if (round >= maxRounds) {
            showEndGamePopup();
            return;
        }

        // Préparation du round
        round++;
        roundNumberElement.text(round);
        blurValue = maxBlurValue;
        defloutageCount = 0;
        cooldown = false; // Réinitialiser le cooldown
        animeImage.css({
            'filter': `blur(${blurValue}px)`,
            'opacity': 0
        });
        hideResultMessage();
        answerInput.val('');
        answerInput.data('titles', []);
        streakCountElement.text(streak);

        roundStartTime = Date.now(); // Démarrer le timer

        fetch('/anime-images')
            .then(response => {
                if (!response.ok) throw new Error(`Erreur HTTP : ${response.status}`);
                return response.json();
            })
            .then(data => {
                animeImage.attr('src', data.image_url).css('opacity', 1);
                currentAnime = data;
            })
            .catch(error => {
                console.error('Erreur lors du chargement de l\'animé :', error.message);
                showResultMessage('Erreur de chargement. Veuillez réessayer.', '#e74c3c');
            });
    }

    // Afficher le popup de fin de jeu
    function showEndGamePopup() {
        gameOver = true;
        finalScoreElement.text(score);
        roundsPlayedElement.text(round);
        totalRoundsElement.text(maxRounds);
        endGameModal.show();
    }

    // Autocomplétion
    answerInput.autocomplete({
        source: function (request, response) {
            $.ajax({
                url: '/anime-suggestions',
                data: { query: request.term },
                success: function (data) {
                    const suggestions = data.map(item => ({
                        label: item.alt_title ? `${item.alt_title} (${item.title})` : item.title,
                        value: item.title,
                        titles: [item.title, item.alt_title].filter(Boolean)
                    }));
                    response(suggestions);
                },
                error: function (err) {
                    console.error('Erreur lors de la récupération des suggestions :', err);
                }
            });
        },
        minLength: 2,
        select: function (event, ui) {
            answerInput.data('titles', ui.item.titles);
        }
    });

    // Gestion du bouton "Valider"
    submitButton.on('click', () => {
        if (gameOver || cooldown) return;

        const userAnswer = answerInput.val().trim();
        if (!userAnswer) return;

        const roundEndTime = Date.now();
        const timeTaken = Math.floor((roundEndTime - roundStartTime) / 1000); // Temps pris en secondes

        fetch('/check-answer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ answer: userAnswer, possibleTitles: answerInput.data('titles') || [] })
        })
            .then(response => response.json())
            .then(data => {
                if (data.correct) {
                    cooldown = true; // Activer le cooldown

                    // Calcul des points
                    let pointsEarned = difficultyPoints[level];

                    // Bonus de temps
                    const timeBonus = Math.max(maxTime - timeTaken, 0) * timeBonusPerSecond;
                    pointsEarned += timeBonus;

                    // Pénalité pour les indices utilisés
                    const hintPenaltyTotal = defloutageCount * hintPenalty;
                    pointsEarned = Math.max(pointsEarned - hintPenaltyTotal, 1); // Assurer au moins 1 point

                    // Bonus de streak
                    streak++;
                    if (streak > 3) {
                        pointsEarned += streakBonus;
                        showResultMessage(`Bonne réponse ! Combo de ${streak} bonnes réponses ! Vous gagnez ${pointsEarned} points.`, '#2ecc71');
                    } else {
                        showResultMessage(`Bonne réponse ! Vous gagnez ${pointsEarned} points.`, '#2ecc71');
                    }

                    streakCountElement.text(streak);
                    score += pointsEarned;
                    scoreElement.text(score);
                    setTimeout(loadNewAnime, 3000);
                } else {
                    // Réinitialiser le streak en cas de mauvaise réponse
                    streak = 0;
                    streakCountElement.text(streak);

                    lives--;
                    displayLives();
                    if (lives > 0) {
                        showResultMessage(`Mauvaise réponse. Réessayez.`, '#e74c3c');
                    } else {
                        showResultMessage(`Game Over. La bonne réponse était : ${data.correctAnswer}`, '#e74c3c');
                        setTimeout(showEndGamePopup, 3000);
                    }
                }
            })
            .catch(error => {
                console.error('Erreur lors de la vérification de la réponse :', error.message);
                showResultMessage('Erreur lors de la vérification. Veuillez réessayer.', '#e74c3c');
            });
    });

    // Gestion du bouton "Déflouter"
    deflouterButton.on('click', () => {
        if (blurValue > 0) {
            blurValue -= blurStep;
            defloutageCount++;
            totalHintsUsed++;
            animeImage.css('filter', `blur(${blurValue}px)`);
        }
    });

    // Gestion du bouton "Je sais pas"
    skipButton.on('click', () => {
        if (gameOver || cooldown) return;

        cooldown = true; // Activer le cooldown
        streak = 0; // Réinitialiser le streak
        streakCountElement.text(streak);

        score = Math.max(score - skipPenalty, 0); // Appliquer la pénalité et assurer que le score ne soit pas négatif
        scoreElement.text(score);

        fetch('/current-anime-answer')
            .then(response => response.json())
            .then(data => {
                showResultMessage(`La réponse était : ${data.correctAnswer}. Vous perdez ${skipPenalty} points.`, '#e67e22');
                setTimeout(loadNewAnime, 3000);
            })
            .catch(error => {
                console.error('Erreur lors de la récupération de la réponse :', error.message);
                showResultMessage('Erreur lors de la récupération de la réponse. Veuillez réessayer.', '#e74c3c');
                setTimeout(loadNewAnime, 3000);
            });
    });

    // Bouton "Recommencer"
    restartButton.on('click', resetGame);

    // Bouton "Menu"
    menuButton.on('click', () => {
        window.location.href = 'index.html';
    });

    // Démarrage de la partie
    resetGame();
});
