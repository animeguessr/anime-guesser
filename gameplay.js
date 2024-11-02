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

    // Empêcher le clic droit sur l'image
    animeImage.on('contextmenu', function(event) { event.preventDefault(); });

    let blurValue = 60; // Valeur initiale du flou
    const maxBlurValue = 60; // Pour calculer le pourcentage de défloutage
    const blurStep = 10; // Réduction du flou à chaque défloutage
    let defloutageCount = 0; // Nombre de fois où l'utilisateur a déflouté
    let lives = 3; // Nombre de vies
    let score = 0; // Score total
    let round = 0; // Compteur de rounds
    const maxRounds = 10; // Nombre total de rounds

    // Fonction pour afficher les vies
    function displayLives() {
        livesContainer.empty();
        for (let i = 0; i < lives; i++) {
            livesContainer.append('<img src="https://cdn.iconscout.com/icon/free/png-256/heart-1767836-1502418.png" class="life-icon" alt="Life">');
        }
    }

    // Fonction pour révéler l'image de l'animé
    function revealAnimeImage() {
        animeImage.css('filter', 'none');
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

    // Fonction pour charger une nouvelle image
    function loadNewAnime() {
        if (round >= maxRounds) {
            showEndGamePopup(); // Afficher le popup de fin de jeu
            return;
        }
        round++;
        roundNumberElement.text(round); // Mettre à jour le numéro du round
        roundStartTime = Date.now(); // Démarrer le chronomètre au début du round
        blurValue = 60; // Réinitialiser le flou
        defloutageCount = 0; // Réinitialiser le compteur de défloutage
        lives = 3; // Réinitialiser les vies
        displayLives(); // Afficher les vies
        animeImage.css({
            'filter': `blur(${blurValue}px)`,
            'opacity': 0 // Masquer l'image pour l'animation
        });
        hideResultMessage(); // Cacher les messages précédents
        answerInput.val(''); // Vider le champ de saisie
        answerInput.data('titles', []); // Réinitialiser les titres possibles

        fetch('/anime-image')
            .then(response => response.json())
            .then(data => {
                if (data) {
                    currentAnime = data; // Stocker l'animé actuel pour le calcul du score
                    // Charger l'image
                    animeImage.off('load'); // Supprimer tout gestionnaire 'load' précédent
                    animeImage.attr('src', data.image_url);
                    animeImage.on('load', function () {
                        animeImage.animate({ 'opacity': 1 }, 500); // Animation de fondu en 500ms
                    });
                } else {
                    showResultMessage('Erreur lors du chargement de l\'animé.', '#e74c3c');
                }
            })
            .catch(err => {
                console.error('Erreur lors du chargement de l\'animé:', err);
                showResultMessage('Erreur lors du chargement de l\'animé.', '#e74c3c');
            });
    }

    // Fonction pour mettre à jour le score
    function updateScore(points) {
        score += points;
        scoreElement.text(score);
    }

    // Fonction pour calculer le score en fonction des performances
    function calculateScore(correct, timeTaken) {
        // Si la réponse est incorrecte ou le temps dépasse 30 secondes, le score est zéro
        if (!correct || timeTaken >= 30000) {
            return 0;
        }

        // Points de base par niveau de difficulté
        const levelBasePoints = {
            'very_easy': 100,
            'easy': 215,
            'normal': 350,
            'hard': 600,
            'impossible': 900
        };
        const basePoints = levelBasePoints[level] || 100;

        // Multiplicateur de temps
        const maxTime = 30000; // Temps maximum en millisecondes
        const timeFactor = Math.max(0, (maxTime - timeTaken) / maxTime); // Entre 0 et 1
        const timeMultiplier = 0.5 + (0.5 * timeFactor); // Entre 0.5 et 1.0

        // Bonus de vies
        const initialLives = 3;
        const livesBonus = lives / initialLives; // Entre 0 et 1

        // Pénalité de défloutage
        const maxDefloutages = maxBlurValue / blurStep; // Nombre maximum de défloutages possibles
        const defloutageFactor = 1 - (defloutageCount / maxDefloutages); // Entre 0 et 1
        const defloutageMultiplier = 0.5 + (0.5 * defloutageFactor); // Entre 0.5 et 1.0

        // Coefficient de popularité
        const maxPopularityRank = 10000; // Ajustez en fonction de vos données réelles
        const popularityRank = currentAnime.popularity || maxPopularityRank;
        const popularityCoefficient = 1.0 + ((popularityRank - 1) / (maxPopularityRank - 1)); // Entre 1.0 et 2.0

        // Calcul du Score Final
        let finalScore = basePoints * timeMultiplier * livesBonus * defloutageMultiplier / popularityCoefficient;

        // Vérifier si l'image est complètement défloutée
        if (blurValue === 0) {
            // Appliquer une pénalité supplémentaire de 80%
            finalScore = finalScore * 0.2; // Garde seulement 20% du score
        }

        // Arrondir le score final
        finalScore = Math.round(finalScore);

        return finalScore;
    }

    // Fonction pour ajuster la difficulté en fonction des performances
    function adjustDifficulty(correct) {
        fetch('/adjust-difficulty', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ correct: correct })
        });
    }

    // Fonction pour afficher le popup de fin de jeu
    function showEndGamePopup() {
        $('#final-score').text(score);
        $('#rounds-played').text(round);
        $('#total-rounds').text(maxRounds);
        $('#end-game-modal').css('display', 'flex');
    }

    // Événement pour le bouton "Recommencer"
    $('#restart-button').on('click', () => {
        // Réinitialiser les variables du jeu
        score = 0;
        round = 0;
        $('#score').text(score);
        $('#round-number').text(round);
        $('#end-game-modal').css('display', 'none');
        // Réinitialiser les IDs des animés utilisés
        fetch('/reset-used-animes');
        loadNewAnime();
    });

    // Événement pour le bouton "Menu Principal"
    $('#menu-button').on('click', () => {
        window.location.href = 'index.html';
    });

    // Événement pour le bouton "Valider"
    submitButton.on('click', () => {
        const userAnswer = answerInput.val().trim();
        if (userAnswer === '') return;

        const possibleTitles = answerInput.data('titles') || [userAnswer];
        const timeTaken = Date.now() - roundStartTime; // Calcul du temps écoulé

        fetch('/check-answer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ answer: userAnswer, possibleTitles: possibleTitles })
        })
            .then(response => response.json())
            .then(data => {
                if (data.correct) {
                    const pointsEarned = calculateScore(true, timeTaken);
                    updateScore(pointsEarned);
                    showResultMessage(`Bonne réponse ! Vous gagnez ${pointsEarned} points.`, '#2ecc71');

                    // Ajuster la difficulté
                    adjustDifficulty(true);

                    // Charger un nouvel animé après un délai
                    setTimeout(loadNewAnime, 2000);
                } else {
                    lives--;
                    displayLives();
                    if (lives > 0) {
                        showResultMessage(`Mauvaise réponse ! Il vous reste ${lives} vies.`, '#e74c3c');
                    } else {
                        const correctAnswer = data.correctAnswer;
                        showResultMessage('Vous avez perdu toutes vos vies. La réponse était : ' + correctAnswer, '#e74c3c');

                        // Ajuster la difficulté
                        adjustDifficulty(false);

                        // Charger un nouvel animé après un délai
                        setTimeout(loadNewAnime, 3000);
                    }
                }
            });
    });

    // Événement pour le bouton "Déflouter"
    deflouterButton.on('click', () => {
        if (blurValue > 0) {
            blurValue -= blurStep;
            defloutageCount++;
            animeImage.css('filter', `blur(${blurValue}px)`);
        }
    });

    // Événement pour le bouton "Je ne sais pas"
    skipButton.on('click', () => {
        fetch('/current-anime-answer')
            .then(response => response.json())
            .then(data => {
                if (data.correctAnswer) {
                    showResultMessage('La réponse était : ' + data.correctAnswer, '#e67e22');
                } else {
                    showResultMessage('Erreur lors de la récupération de la réponse.', '#e74c3c');
                }
                adjustDifficulty(false);
                setTimeout(loadNewAnime, 3000); // Attendre 3 secondes avant de charger le nouvel animé
            });
    });

    // Fonction pour obtenir les suggestions
    function getSuggestions(request, response) {
        $.ajax({
            url: '/anime-suggestions',
            data: { query: request.term },
            success: function(data) {
                const suggestions = data.map(item => {
                    const title = item.title || '';
                    const altTitle = item.alt_title || '';

                    let label = '';
                    let value = '';
                    let titles = [];

                    if (altTitle && altTitle.trim() !== '' && altTitle !== title) {
                        label = `${altTitle} (${title})`;
                        value = altTitle;
                        titles = [title, altTitle];
                    } else {
                        label = title;
                        value = title;
                        titles = [title];
                    }

                    return {
                        label: label,
                        value: value,
                        titles: titles
                    };
                });
                response(suggestions);
            },
            error: function(err) {
                console.error('Erreur lors de la récupération des suggestions:', err);
            }
        });
    }

    // Initialisation de l'autocomplétion
    answerInput.autocomplete({
        source: getSuggestions,
        minLength: 2,
        delay: 100,
        select: function(event, ui) {
            // Stocker les titres possibles pour la validation
            answerInput.data('titles', ui.item.titles);
        }
    });

    // Charger l'image initiale
    loadNewAnime();
});
