$(document).ready(function () {
    const levelNameElement = $('#level-name');
    const urlParams = new URLSearchParams(window.location.search);
    const level = urlParams.get('level') || 'very_easy';

    // Afficher le nom du niveau
    const levelNames = {
        'very_easy': 'Très Simple',
        'easy': 'Simple',
        'normal': 'Normal',
        'hard': 'Difficile',
        'impossible': 'Impossible'
    };
    levelNameElement.text(levelNames[level]);

    // Définir le niveau sur le serveur
    fetch(`/set-level?level=${level}`);

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
    let currentAnime; // Variable pour stocker l'animé actuel

    let blurValue = 60; // Valeur initiale du flou
    const maxBlurValue = 60;
    const blurStep = 10;
    let defloutageCount = 0;
    let lives = 3;
    let score = 0;
    let round = 0;
    const maxRounds = 10;
    let gameOver = false; // Variable pour suivre l'état du jeu
    let errorCount = 0; // Pour gérer les erreurs consécutives

    // Fonction pour initialiser une nouvelle partie
    function resetGame() {
        score = 0;
        round = 0;
        gameOver = false;
        lives = 3;
        blurValue = 60;
        defloutageCount = 0;
        $('#end-game-modal').hide();
        displayLives();
        scoreElement.text(score);
        loadNewAnime();
    }

    // Fonction pour afficher les vies
    function displayLives() {
        livesContainer.empty();
        for (let i = 0; i < lives; i++) {
            livesContainer.append('<img src="https://cdn.iconscout.com/icon/free/png-256/heart-1767836-1502418.png" class="life-icon" alt="Life">');
        }
    }

    // Fonction pour afficher le message de résultat avec animation
    function showResultMessage(text, color) {
        resultMessage.css('color', color);
        resultMessage.text(text);
        resultMessage.addClass('show');
    }

    // Fonction pour cacher le message de résultat
    function hideResultMessage() {
        resultMessage.removeClass('show');
    }

    // Gestion des erreurs d'image
    function handleImageError() {
        animeImage.attr('src', '/path/to/backup-image.jpg'); // Image par défaut
        showResultMessage('Image non trouvée. Passons au suivant.', '#e67e22');
        setTimeout(loadNewAnime, 3000);
    }
    animeImage.on('error', handleImageError);

    // Fonction pour charger une nouvelle image
    function loadNewAnime() {
        if (gameOver) return; // Empêcher le chargement de nouvelles images si le jeu est terminé

        // Vérification si le jeu doit se terminer
        if (round >= maxRounds) {
            gameOver = true;
            showEndGamePopup();
            return;
        }

        // Préparation du nouveau round
        round++;
        roundNumberElement.text(round);
        roundStartTime = Date.now();
        blurValue = 60;
        defloutageCount = 0;
        lives = 3;
        displayLives();
        animeImage.css({
            'filter': `blur(${blurValue}px)`,
            'opacity': 0
        });
        hideResultMessage();
        answerInput.val('');
        answerInput.data('titles', []);

        // Charger une nouvelle image d'animé
        fetch('/anime-image')
            .then(response => {
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                return response.json();
            })
            .then(data => {
                if (!data.image_url || !data.title) throw new Error('Données invalides reçues');
                animeImage.attr('src', data.image_url).css('opacity', 1);
                currentAnime = data;
                errorCount = 0; // Réinitialiser le compteur d'erreurs
            })
            .catch(error => {
                console.error('Erreur lors du chargement de l\'animé :', error.message);
                errorCount++;
                if (errorCount >= 3) {
                    showResultMessage('Trop d\'erreurs consécutives. Veuillez réessayer plus tard.', '#e74c3c');
                } else {
                    setTimeout(loadNewAnime, 3000);
                }
            });
    }

    // Fonction pour afficher le popup de fin de jeu
    function showEndGamePopup() {
        $('#final-score').text(score);
        $('#rounds-played').text(round);
        $('#total-rounds').text(maxRounds);
        $('#end-game-modal').css('display', 'flex');
    }

    // Initialisation de l'autocomplétion
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
                    console.error('Erreur lors de la récupération des suggestions:', err);
                }
            });
        },
        minLength: 2,
        select: function (event, ui) {
            answerInput.data('titles', ui.item.titles);
        }
    });

    // Événements des boutons
    submitButton.on('click', () => {
        if (gameOver) return; // Ignorer si le jeu est terminé

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
                    const pointsEarned = calculateScore(true, Date.now() - roundStartTime);
                    score += pointsEarned;
                    scoreElement.text(score);
                    showResultMessage(`Bonne réponse ! Vous gagnez ${pointsEarned} points.`, '#2ecc71');
                    setTimeout(loadNewAnime, 2000);
                } else {
                    lives--;
                    displayLives();
                    if (lives > 0) {
                        showResultMessage(`Mauvaise réponse ! Il vous reste ${lives} vies.`, '#e74c3c');
                    } else {
                        showResultMessage(`Perdu ! La bonne réponse était : ${data.correctAnswer}`, '#e74c3c');
                        setTimeout(loadNewAnime, 3000);
                    }
                }
            });
    });

    deflouterButton.on('click', () => {
        if (blurValue > 0) {
            blurValue -= blurStep;
            defloutageCount++;
            animeImage.css('filter', `blur(${blurValue}px)`);
        }
    });

    skipButton.on('click', () => {
        if (gameOver) return; // Ignorer si le jeu est terminé

        fetch('/current-anime-answer')
            .then(response => response.json())
            .then(data => {
                showResultMessage(`La réponse était : ${data.correctAnswer}`, '#e67e22');
                setTimeout(loadNewAnime, 3000);
            });
    });

    $('#restart-button').on('click', resetGame);

    $('#menu-button').on('click', () => {
        window.location.href = 'index.html';
    });

    // Charger la première image d'animé
    resetGame();
});
 