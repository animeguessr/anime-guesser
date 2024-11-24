// Récupération des éléments
const audioPlayer = document.getElementById('op-audio');
const videoPlayer = document.getElementById('op-video');
const unlockVideoButton = document.querySelector('.op-unlock-video');
const deflutterButton = document.querySelector('.op-deflutter');

// Gestion de l'état initial
audioPlayer.style.display = 'block';
videoPlayer.style.display = 'none';
deflutterButton.style.display = 'none';

// Clic sur le bouton "Débloquer la vidéo"
unlockVideoButton.addEventListener('click', () => {
    // Masquer le lecteur audio
    audioPlayer.style.display = 'none';

    // Afficher le lecteur vidéo
    videoPlayer.style.display = 'block';

    // Masquer le bouton "Débloquer la vidéo"
    unlockVideoButton.style.display = 'none';

    // Afficher le bouton "Déflouter la vidéo"
    deflutterButton.style.display = 'block';
});

// Clic sur le bouton "Déflouter la vidéo"
deflutterButton.addEventListener('click', () => {
    // Retirer l'effet de flou (par défaut, aucun flou appliqué ici, mais vous pouvez ajouter un filtre si besoin)
    videoPlayer.style.filter = 'none';

    // Désactiver le bouton après utilisation
    deflutterButton.disabled = true;
});
