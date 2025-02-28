import os
import json

def generate_image_json(root_dir, output_file):
    """
    Parcourt les sous-dossiers de root_dir et collecte les chemins des images.
    Génère un fichier JSON avec un identifiant unique pour chaque dossier.
    
    Args:
        root_dir (str): Chemin du répertoire racine contenant les dossiers d'images.
        output_file (str): Nom du fichier JSON de sortie.
    """
    data = []
    folder_id = 1  # Initialisation de l'ID à 1
    
    # Parcourt tous les éléments dans le répertoire racine
    for folder_name in os.listdir(root_dir):
        folder_path = os.path.join(root_dir, folder_name)
        if os.path.isdir(folder_path):
            folder_data = {"id": folder_id, "Name": folder_name}
            image_counter = 1
            # Parcourt tous les fichiers dans le sous-dossier
            for file_name in os.listdir(folder_path):
                file_path = os.path.join(folder_path, file_name)
                if os.path.isfile(file_path):
                    # Vérifie si le fichier est une image en se basant sur l'extension
                    if file_name.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff')):
                        # Convertit le chemin en absolu et remplace les antislashs par des slashs
                        abs_path = os.path.abspath(file_path).replace('\\', '/')
                        key = f"image{image_counter}"
                        folder_data[key] = abs_path
                        image_counter += 1
            data.append(folder_data)
            folder_id += 1  # Incrémente l'ID pour le prochain dossier
    
    # Écrit les données dans le fichier JSON avec une indentation pour la lisibilité
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=4)
    
    print(f"Les données JSON ont été écrites dans le fichier : {output_file}")

if __name__ == "__main__":
    # Définissez le chemin vers votre répertoire d'images
    root_directory = r"C:\\Animeguesser\\image"
    # Définissez le nom du fichier JSON de sortie
    output_json = "images_data.json"
    generate_image_json(root_directory, output_json)
