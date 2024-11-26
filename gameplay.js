$(document).ready(function () {
    const levelNameElement = $('#level-name');
    const urlParams = new URLSearchParams(window.location.search);
    const level = urlParams.get('level') || 'very_easy';

    // Niveaux de difficulté
    const levelNames = {
        'very_easy': 'Très Simple',
        'easy': 'Simple',
        'normal': 'Normal',
        'hard': 'Difficile',
        'impossible': 'Impossible'
    };
    levelNameElement.text(levelNames[level]);

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
    let roundStartTime = 0;
    let currentAnime = null;

    let blurValue = 60; // Valeur initiale du flou
    const maxBlurValue = 60;
    const blurStep = 10;
    let defloutageCount = 0;
    let lives = 3;
    let score = 0;
    let round = 0;
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
        cooldown = false;
        $('#end-game-modal').hide();
        displayLives();
        scoreElement.text(score);
        loadNewAnime();
    }

    // Afficher les vies
    function displayLives() {
        livesContainer.empty();
        for (let i = 0; i < lives; i++) {
            livesContainer.append('<img src="https://cdn.iconscout.com/icon/free/png-256/heart-1767836-1502418.png" class="life-icon" alt="Life">');
        }
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
        $('#final-score').text(score);
        $('#rounds-played').text(round);
        $('#total-rounds').text(maxRounds);
        $('#end-game-modal').show();
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

        fetch('/check-answer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ answer: userAnswer, possibleTitles: answerInput.data('titles') || [] })
        })
            .then(response => response.json())
            .then(data => {
                if (data.correct) {
                    cooldown = true; // Activer le cooldown
                    const pointsEarned = Math.max(10 - Math.floor((Date.now() - roundStartTime) / 1000), 1); // Exemple de calcul de points
                    score += pointsEarned;
                    scoreElement.text(score);
                    showResultMessage(`Bonne réponse ! Vous gagnez ${pointsEarned} points.`, '#2ecc71');
                    setTimeout(loadNewAnime, 3000);
                } else {
                    lives--;
                    displayLives();
                    if (lives > 0) {
                        showResultMessage(`Mauvaise réponse. Réessayez.`, '#e74c3c');
                    } else {
                        showResultMessage(`Game Over. La bonne réponse était : ${data.correctAnswer}`, '#e74c3c');
                        setTimeout(showEndGamePopup, 3000);
                    }
                }
            });
    });

    // Gestion du bouton "Déflouter"
    deflouterButton.on('click', () => {
        if (blurValue > 0) {
            blurValue -= blurStep;
            defloutageCount++;
            animeImage.css('filter', `blur(${blurValue}px)`);
        }
    });

    // Gestion du bouton "Je sais pas"
    skipButton.on('click', () => {
        if (gameOver || cooldown) return;

        cooldown = true; // Activer le cooldown
        fetch('/current-anime-answer')
            .then(response => response.json())
            .then(data => {
                showResultMessage(`La réponse était : ${data.correctAnswer}`, '#e67e22');
                setTimeout(loadNewAnime, 3000);
            });
    });

    // Bouton "Recommencer"
    $('#restart-button').on('click', resetGame);

    // Bouton "Menu"
    $('#menu-button').on('click', () => {
        window.location.href = 'index.html';
    });

    // Démarrage de la partie
    resetGame();
});
