import os
import json

def get_images_data(base_path):
    images_data = []
    anime_names = os.listdir(base_path)
    for anime_name in anime_names:
        anime_dir = os.path.join(base_path, anime_name)
        if os.path.isdir(anime_dir):
            anime_dict = {'Name': anime_name}
            image_files = [f for f in os.listdir(anime_dir) if os.path.isfile(os.path.join(anime_dir, f))]
            image_files.sort()  # Pour avoir un ordre cohérent
            for idx, image_file in enumerate(image_files):
                image_key = f'image{idx+1}'
                image_path = os.path.join(anime_dir, image_file)
                anime_dict[image_key] = image_path
            images_data.append(anime_dict)
    return images_data

def main():
    base_path = 'anime-guesser/image'
    images_data = get_images_data(base_path)
    with open('images_data.json', 'w', encoding='utf-8') as f:
        json.dump(images_data, f, ensure_ascii=False, indent=4)

if __name__ == '__main__':
    main()
