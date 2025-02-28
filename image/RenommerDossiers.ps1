# Chemin du répertoire contenant les dossiers à renommer
$directoryPath = "C:\Users\Ender\Pictures\For serveur"

# Dictionnaire des noms actuels et des noms les plus connus
$folderNameMap = @{
    "86 Eighty Six" = "86"
    "91 Days" = "91 Days"
    "A Certain Scientific Railgun" = "Toaru Kagaku no Railgun"
    "A Returner's Magic Should be Special" = "Kikansha no Mahou wa Tokubetsu desu"
    "Absolute Duo" = "Absolute Duo"
    "Accel World" = "Accel World"
    "Akame ga Kill" = "Akame ga Kill"
    "Akashic Records" = "Rokudenashi Majutsu Koushi to Akashic Records"
    "Angel Beats" = "Angel Beats"
    "Another" = "Another"
    "Arifureta" = "Arifureta Shokugyou de Sekai Saikyou"
    "Assassin's Pride" = "Assassin's Pride"
    "B.C" = "Black Clover"
    "Bakemonogatari" = "Bakemonogatari"
    "Berserk of Gluttony" = "Boushoku no Berserk"
    "Black Bullet S" = "Black Bullet"
    "Black Lagoon S" = "Black Lagoon"
    "Black Rock Shooter S" = "Black Rock Shooter"
    "Blend S" = "Blend S"
    "Blue Lock" = "Blue Lock"
    "Bocchi the Rock" = "Bocchi the Rock"
    "Bucket List of The Dead" = "Zom 100"
    "Bungou Stray Dogs" = "Bungou Stray Dogs"
    "Clannad S" = "Clannad"
    "Classroom for Heroes" = "Eiyuu Kyoushitsu"
    "Classroom of the Elite" = "Youkoso Jitsuryoku Shijou Shugi no Kyoushitsu e"
    "Code Geass" = "Code Geass"
    "Danganronpa S" = "Danganronpa"
    "DanMachi" = "Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka"
    "Darker Than Black S" = "Darker than Black"
    "Darling in the Franxx" = "Darling in the FranXX"
    "Darwin's Game" = "Darwin's Game"
    "Date a Live" = "Date A Live"
    "Dead Mount Death Play" = "Dead Mount Death Play"
    "Deadman Wonderland" = "Deadman Wonderland"
    "Death March" = "Death March kara Hajimaru Isekai Kyousoukyoku"
    "Death Note" = "Death Note"
    "Death Parade" = "Death Parade"
    "Demon Slave" = "Mato Seihei no Slave"
    "Demon Slayer" = "Kimetsu no Yaiba"
    "Domestic Girlfriend" = "Domestic na Kanojo"
    "Dororo" = "Dororo"
    "Dr. Stone New World" = "Dr. Stone"
    "Durarara S" = "Durarara"
    "Edens Zero" = "Edens Zero"
    "Elfen Lied" = "Elfen Lied"
    "Engage Kiss" = "Engage Kiss"
    "Erased" = "Boku dake ga Inai Machi"
    "Evangelion" = "Neon Genesis Evangelion"
    "Failure Frame" = "Hazure Waku no Joutai Ijou Skill de Saikyou ni Natta Ore wa Jikkyo de Isekai Musou"
    "Fairy Tail" = "Fairy Tail"
    "Farming Life in Another World" = "Isekai Nonbiri Nouka"
    "Fate Apocrypha" = "Fate/Apocrypha"
    "Fate Stay Night" = "Fate/stay night"
    "Fate Zero" = "Fate/Zero"
    "Fire Force" = "Enen no Shouboutai"
    "Frieren" = "Sousou no Frieren"
    "Gambling School" = "Kakegurui"
    "Gate" = "Gate: Jieitai Kanochi nite, Kaku Tatakaeri"
    "Gleipnir" = "Gleipnir"
    "Goblin Slayer" = "Goblin Slayer"
    "Gods' Games We Play" = "Kami wa Game ni Ueteiru"
    "Grimgar" = "Hai to Gensou no Grimgar"
    "Grisaia no Kajitsu" = "Grisaia no Kajitsu"
    "Haikyuu" = "Haikyuu"
    "Hell's Paradise" = "Jigokuraku"
    "Hunter x Hunter" = "Hunter x Hunter"
    "ID Invaded" = "ID:Invaded"
    "Ijiranaide, Nagatoro-san" = "Ijiranaide, Nagatoro-san"
    "Isekai de Cheat Skill wo Te ni Shita Ore wa, Genjitsu Sekai wo mo Musou Suru - Level Up wa Jinsei wo Kaeta" = "Isekai de Cheat Skill wo Te ni Shita Ore wa, Genjitsu Sekai wo mo Musou Suru"
    "Itai no wa Iya nano de Bougyoryoku ni Kyokufuri Shitai to Omoimasu" = "Itai no wa Iya nano de Bougyoryoku ni Kyokufuri Shitai to Omoimasu"
    "Jidou Hanbaiki ni Umarekawatta Ore wa Meikyuu wo Samayou" = "Jidou Hanbaiki ni Umarekawatta Ore wa Meikyuu wo Samayou"
    "Kaiju N°" = "Kaiju No. 8"
    "Kanojo ga Koushaku-tei ni Itta Riyuu" = "Kanojo ga Koushaku-tei ni Itta Riyuu"
    "Kanojo mo Kanojo" = "Kanojo mo Kanojo"
    "Kawaii Dake Janai Shikimori-san" = "Kawaii dake ja Nai Shikimori-san"
    "Kill la Kill" = "Kill la Kill"
    "Kimetsu no Yaiba" = "Kimetsu no Yaiba"
    "KimiSen" = "Kimi to Boku no Saigo no Senjou"
    "Kings Game S" = "Ousama Game"
    "Komi Can't Communicate" = "Komi-san wa, Comyushou desu"
    "Kumo Desu ga, Nani ka" = "Kumo Desu ga, Nani ka?"
    "Kuroko no Basket" = "Kuroko no Basuke"
    "Les Carnets de l'Apothicaire" = "Kusuriya no Hitorigoto"
    "Let This Grieving Soul Retire!" = "Nageki no Bourei wa Intai Shitai"
    "Liar Liar" = "Liar Liar"
    "Maou" = "Maou Gakuin no Futekigousha"
    "Mashle" = "Mashle"
    "Meikyuu Black Company" = "Meikyuu Black Company"
    "Mikakunin de Shinkoukei" = "Mikakunin de Shinkoukei"
    "Mirai Nikki" = "Mirai Nikki"
    "Mission - Yozakura Family" = "Yozakura-san Chi no Daisakusen"
    "Mushishi S" = "Mushishi"
    "My Dress-Up Darling" = "Sono Bisque Doll wa Koi wo Suru"
    "My Instant Death Ability Is So Overpowered" = "Sokushi Cheat ga Saikyou sugiru"
    "Ninja Kamui" = "Ninja Kamui"
    "Noble New World Adventures" = "Tensei Kizoku no Isekai Boukenroku"
    "Noragami" = "Noragami"
    "Noucome" = "Ore no Nounai Sentakushi ga, Gakuen Love Comedy wo Zenryoku de Jama Shiteiru"
    "One Punch Man" = "One Punch Man"
    "One punch man -" = "One Punch Man"
    "One Punch-Man" = "One Punch Man"
    "Orange S" = "Orange"
    "Oregairu S" = "Yahari Ore no Seishun Love Comedy wa Machigatteiru"
    "Oshi No Ko" = "Oshi no Ko"
    "Ousama Ranking" = "Ousama Ranking"
    "Overlord" = "Overlord"
    "Owari no Seraph" = "Owari no Seraph"
    "Parasite" = "Kiseijuu"
    "Plastic Memories S" = "Plastic Memories"
    "Plunderer" = "Plunderer"
    "Princess Connect! Re-Dive" = "Princess Connect! Re:Dive"
    "Prison School" = "Prison School"
    "Psycho Pass S" = "Psycho-Pass"
    "Radiant S" = "Radiant"
    "Ragna Crimson" = "Ragna Crimson"
    "Rakudai Kishi no Cavalry" = "Rakudai Kishi no Cavalry"
    "Re Monster" = "Re:Monster"
    "Re-Zero" = "Re:Zero kara Hajimeru Isekai Seikatsu"
    "Rent A Girlfriend" = "Kanojo, Okarishimasu"
    "Rokka - Braves of the Six Flowers" = "Rokka no Yuusha"
    "Rosario to Vampire S" = "Rosario to Vampire"
    "Roshidere" = "Giji Harem"
    "S..T" = "Steins;Gate"
    "Sats.no Tensh" = "Satsuriku no Tenshi"
    "Seirei Gensouki - Spirit Chronicles" = "Seirei Gensouki"
    "Seirei Tsukai no Blade Dance" = "Seirei Tsukai no Blade Dance"
    "Skeleton Knight in Another World" = "Gaikotsu Kishi-sama, Tadaima Isekai e Odekakechuu"
    "Sky High Survival S" = "Tenkuu Shinpan"
    "Solo Leveling" = "Solo Leveling"
    "Sonny Boy" = "Sonny Boy"
    "Soul Eater" = "Soul Eater"
    "Spice and Wolf - Remake" = "Ookami to Koushinryou"
    "Spy X Family" = "Spy x Family"
    "Sword Art Online" = "Sword Art Online"
    "Takt Op. Destiny" = "Takt Op. Destiny"
    "Tensei Shitara Slime Datta Ken" = "Tensei Shitara Slime Datta Ken"
    "Terror in Resonance" = "Zankyou no Terror"
    "The" = "The God of High School"
    "The Daily Life of the Immortal King S" = "Xian Wang de Richang Shenghuo"
    "The Elusive Samurai" = "Nige Jouzu no Wakagimi"
    "The Eminence in Shadow" = "Kage no Jitsuryokusha ni Naritakute!"
    "The Kingdoms of Ruin" = "Hametsu no Oukoku"
    "The Promised Neverland S" = "Yakusoku no Neverland"
    "The Quintessential Quintuplets S" = "Go-Toubun no Hanayome"
    "The Rising of the Shield Hero" = "Tate no Yuusha no Nariagari"
    "The Unwanted Undead Adventurer" = "Nozomanu Fushi no Boukensha"
    "Time Shadows" = "Summertime Render"
    "To Your Eternity S" = "Fumetsu no Anata e"
    "Toaru Kagaku no Accelerator" = "Toaru Kagaku no Accelerator"
    "Tokyo Ghoul" = "Tokyo Ghoul"
    "Tomodachi Game" = "Tomodachi Game"
    "Tsue To Tsurugi No Wistoria" = "Wistoria: Wand and Sword"
    "TSUKIMICHI Moonlight Fantasy" = "Tsuki ga Michibiku Isekai Douchuu"
    "Vanitas no Carte" = "Vanitas no Carte"
    "Vinland Saga" = "Vinland Saga"
    "Welcome To Demon School Iruma-kun" = "Mairimashita! Iruma-kun"
    "Yofukashi no Uta" = "Yofukashi no Uta"
    "Youjo Senki S" = "Youjo Senki"
}

# Fonction pour nettoyer les noms de dossiers
function CleanFolderName($name) {
    $invalidChars = [System.IO.Path]::GetInvalidFileNameChars()
    $escapedInvalidChars = [Regex]::Escape([string]::Join('', $invalidChars))
    $pattern = '[{0}]' -f $escapedInvalidChars
    return [Regex]::Replace($name, $pattern, '')
}

# Parcours de chaque entrée du dictionnaire pour renommer les dossiers
foreach ($oldName in $folderNameMap.Keys) {
    $newName = $folderNameMap[$oldName]

    # Nettoyage des noms de dossiers
    $cleanOldName = CleanFolderName($oldName)
    $cleanNewName = CleanFolderName($newName)

    $oldPath = Join-Path $directoryPath $cleanOldName
    $newPath = Join-Path $directoryPath $cleanNewName

    if (-not (Test-Path $oldPath)) {
        Write-Host "Le dossier '$cleanOldName' n'existe pas."
        continue
    }

    if ($cleanOldName -eq $cleanNewName) {
        Write-Host "Le dossier '$cleanOldName' a déjà le bon nom."
        continue
    }

    if (Test-Path $newPath) {
        Write-Host "Le dossier '$cleanNewName' existe déjà. Renommage ignoré."
        continue
    }

    try {
        Rename-Item -Path $oldPath -NewName $cleanNewName
        Write-Host "Renommé '$cleanOldName' en '$cleanNewName'"
    } catch {
        Write-Host "Erreur lors du renommage de '$cleanOldName' : $_"
    }
}
