/* ==========================================================================
   DICTIONNAIRE DE BASE
   --------------------------------------------------------------------------
   Liste des thèmes et paires de mots [civil, undercover].
   Les mots de la communauté sont ajoutés dynamiquement par-dessus dans
   online.js (via la branche Firebase `mots_communautes`).

   Le mode solo (solo.js) importe également ce dictionnaire directement
   pour fonctionner totalement hors-ligne.
   ========================================================================== */

export const dictionnaireBase = {
    "🎲 Aléatoire (tous thèmes)": [],
    "Nourriture & Boissons 🍔": [
        // Plats & Fast Food
        ["PIZZA", "QUICHE"], ["BURGER", "HOT-DOG"], ["KÉBAB", "TACOS"], ["BURGER", "PIZZA"],
        ["PÂTES", "RIZ"], ["PURÉE", "COMPOTE"],
        // Viandes & Poissons
        ["SAUMON", "THON"], ["HUÎTRE", "MOULE"], ["JAMBON", "BACON"], ["JAMBON", "SALAMI"],
        // Spécialités Réunionnaises
        ["ROUGAIL LA MORUE", "ROUGAIL SAUCISSE"], ["CARRY POULET", "ROUGAIL SAUCISSE"],
        // Condiments & Sauces
        ["SUCRE", "SEL"], ["POIVRE", "PIMENT"], ["OIGNON", "AIL"], ["VINAIGRE", "HUILE"], 
        ["MAYONNAISE", "KETCHUP"], ["MAYONNAISE", "MOUTARDE"], ["PIMENT CHINOIS (SAUCE)", "SAMOURAÏ (SAUCE)"], ["GRAISSE", "HUILE"],
        // Fruits & Légumes
        ["POMME", "POIRE"], ["CITRON", "PAMPLEMOUSSE"], ["TOMATE", "POIVRON"], ["CAROTTE", "COURGETTE"], 
        ["MELON", "PASTÈQUE"], ["FRAISE", "CERISE"], ["ANANAS", "MANGUE"], ["MANGUE", "PAPAYE"], 
        ["FRUIT DE LA PASSION", "MANGUE"], ["AUBERGINE", "BROCOLI"],
        // Sucré & Laitier
        ["CROISSANT", "GAUFRE"], ["LAIT", "PAIN"], ["FROMAGE", "YAOURT"], ["FROMAGE", "LAIT"], ["LAIT", "YAOURT"], 
        ["CONFITURE", "MIEL"], ["MIEL", "SUCRE"], ["NUTELLA", "BEURRE DE CACAHUÈTE"], ["GÂTEAU", "TARTE"], 
        ["BONBON", "CHEWING-GUM"], ["CACAO", "CHOCOLAT"], ["DESSERT", "ENTRÉE"],
        // Apéritif
        ["CHIPS", "CACAHUÈTES"],
        // Boissons sans alcool
        ["CAFÉ", "THÉ"], ["CAFÉ", "CAPPUCCINO"], ["CAFÉ", "CHOCOLAT"],
        // Alcools
        ["BIÈRE", "CIDRE"], ["VIN", "CHAMPAGNE"], ["VODKA", "WHISKY"], ["VIN", "RHUM"], 
        ["VIN", "VODKA"], ["COCA", "WHISKY"], ["PUNCH", "ANISETTE (ALCOOL)"]
    ],

    "Animaux Sauvages & Compagnie 🐺": [
        // Domestiques & Ferme
        ["CHIEN", "LOUP"], ["CHAT", "TIGRE"], ["POULE", "COQ"], ["TAUREAU", "VACHE"], 
        ["COCHON", "SANGLIER"], ["CANARD", "OIE"], ["CYGNE", "CANARD"],
        // Marins
        ["DAUPHIN", "BALEINE"], ["SARDINE", "SAUMON"], ["REQUIN", "ORQUE"], ["HOMARD", "CRABE"],
        // Sauvages
        ["SINGE", "GORILLE"], ["OURS", "PANDA"], ["LION", "PANTHÈRE"], ["ÉLÉPHANT", "RHINOCÉROS"], 
        ["GIRAFE", "ZÈBRE"], ["ÉCUREUIL", "LOUTRE"], ["KANGOUROU", "LAPIN"], ["HÉRISSON", "TAUPE"],
        // Reptiles & Insectes
        ["TORTUE", "LÉZARD"], ["SERPENT", "TORTUE"], ["SERPENT", "CROCODILE"], ["GÉCKO", "LÉZARD"], 
        ["ARAIGNÉE", "SCORPION"], ["ARAIGNÉE", "CAFARD"], ["CAFARD", "LÉZARD"], ["CAFARD", "MILLES-PATTES"],
        // Dinosaures
        ["POULET", "T-REX"], ["MAMMOUTH", "T-REX"]
    ],

    "Lieux & Bâtiments 🏥": [
        // Géographie Réunion & Océan Indien
        ["L'ÎLE MAURICE", "LA RÉUNION"], ["ÎLE RODRIGUE", "ÎLE MAURICE"], 
        ["SAINT PIERRE", "SAINTE MARIE"], ["SAINT PAUL", "SAINT PIERRE"], ["ETANG SALÉ", "SAINT PAUL"], 
        ["SAINT LOUIS", "SAINT ROSE"], ["LE PORT", "SAINT DENIS"], ["LE PORT", "SAINT GILLES"],
        // Bâtiments Célèbres
        ["TOUR EIFFEL", "TOUR DE PISE"], ["BURJ KHALIFA", "EMPIRE STATE BUILDING"], 
        ["TOUR DE BABEL", "TOUR EIFFEL"], ["TOUR DE BABEL", "TOUR DE PISE"],
        // Villes & Lieux Publics
        ["VILLAGE", "VILLE"], ["CINÉMA", "THÉÂTRE"], ["AÉROPORT", "GARE"], ["PRISON", "COMMISSARIAT"], 
        ["PRISON", "ÉCOLE"], ["BANQUE", "POSTE"], ["PHARE", "MOULIN"], ["BAR", "BOÎTE DE NUIT"],
        // Infrastructures
        ["TROTTOIR", "ROUTE"], ["RAIL", "TUNNEL"], ["GARAGE", "PARKING"],
        // Pièces & Habitation
        ["MAISON", "APPARTEMENT"], ["CHAMBRE", "SALON"], ["CUISINE", "GARAGE"], ["CAVE", "GRENIER"],
        // Extérieur & Nature
        ["FORÊT", "JUNGLE"], ["DÉSERT", "SAVANE"], ["MONTAGNE", "COLLINE"], ["CAVE", "GROTTE"], 
        ["PISCINE", "BAIGNOIRE"], ["FONTAINE", "PUITS"], ["TENTE", "CABANE"]
    ],

    "Objets du Quotidien 🕰️": [
        // Accessoires personnels
        ["LUNETTES", "LENTILLES"], ["MONTRE", "HORLOGE"], ["VALISE", "SAC À DOS"], ["PARAPLUIE", "PARASOL"], 
        ["BROSSE", "PEIGNE"], ["DÉ", "PIÈCE"],
        // Papeterie & Bureau
        ["STYLO", "CRAYON"], ["STYLO", "FEUTRE"], ["CRAYON À PAPIER", "CRITÉRIUM"], ["4 COULEUR (STYLO)", "CRITÉRIUM"], 
        ["LIVRE", "CAHIER"], ["ENVELOPPE", "TIMBRE"], ["ENVELOPPE", "LETTRE (COURRIER)"],
        // Maison & Mobilier
        ["LIT", "MATELAS"], ["FAUTEUIL", "LIT"], ["PORTE", "FENÊTRE"], ["CLÉ", "SERRURE"], ["ASCENSEUR", "ESCALIER"], 
        ["ASCENSEUR", "ÉLÉVATEUR"], ["BOUGIE", "LAMPE"], ["HORLOGE", "RÉVEIL"],
        // Cuisine & Repas
        ["FOURCHETTE", "CUILLÈRE"], ["VERRE", "TASSE"], ["ASSIETTE", "BOL"], ["FOUR", "MICRO-ONDE"],
        // Sanitaires
        ["LAVABO", "ÉVIER"], ["TUYAU", "ÉVIER"], ["TOILETTE JAPONAISE", "TOILETTE TURC"],
        // Outils & Entretien
        ["MARTEAU", "TOURNEVIS"], ["CISEAUX", "COUTEAU"], ["COUTEAU", "SCALPEL"], ["COUTEAU", "FOURCHETTE"], 
        ["BALAI", "ASPIRATEUR"], ["LOUPE", "MICROSCOPE"],
        // High Tech
        ["TÉLÉPHONE", "TABLETTE"], ["ÉCRAN", "CLAVIER"], ["SOURIS", "MANETTE"], ["CARTE BANCAIRE", "CHÈQUE"],
        // Armes
        ["COUTEAU", "KATANA"], ["BOUCLIER", "ÉPÉE"], ["GRENADE", "MISSILE"], ["MITRAILLEUSE", "PISTOLET"], 
        ["ARC", "PISTOLET"], ["ARC", "FLÈCHE"]
    ],

    "Métiers & Personnes 👨‍⚕️": [
        // Famille & Âge
        ["BÉBÉ", "VIEUX"], ["MAMAN", "PAPA"], ["GRAND-PÈRE", "PAPA"], ["GRAND-MÈRE", "MAMAN"],
        // Métiers & Statuts
        ["MÉDECIN", "INFIRMIER"], ["CHIRURGIEN", "DENTISTE"], ["POMPIER", "MILITAIRE"], ["CHAUFFEUR", "PILOTE"], 
        ["AVOCAT", "JUGE"], ["NOTAIRE", "HUISSIER"], ["ARCHITECTE", "MAÇON"], ["PLOMBIER", "ÉLECTRICIEN"], 
        ["PEINTRE", "SCULPTEUR"], ["CHANTEUR", "MUSICIEN"], ["RÉALISATEUR", "PRODUCTEUR"], ["PHOTOGRAPHE", "CAMÉRAMAN"], 
        ["SERVEUR", "CUISINIER"], ["BOUCHERE", "PÂTISSERIE"], ["BOULANGERE", "PÂTISSERIE"],
        // Internet & Médias
        ["STREAMEUR", "YOUTUBEUR"], ["LA PRESSE", "LA TÉLÉ"], ["LA DÉSINFORMATION", "LA PRESSE"],
        // Société
        ["CHÔMEUR", "SDF"], ["MAIRE", "PRÉSIDENT"], ["SOLITAIRE", "TIMIDE"],
        // Identités & Genres
        ["FEMME", "HOMME"], ["GAY", "LESBIENNE"], ["BISEXUEL", "LESBIENNE"], ["BISEXUEL", "GAY"], 
        ["TRANSSEXUEL", "TRAVESTIS"], ["BISEXUEL", "TRANSSEXUEL"],
        // Figures Politiques & Historiques
        ["DONALD TRUMP", "VLADIMIR POUTINE"], ["DONALD TRUMP", "KIM JONG-UN"], ["EMMANUELLE MACRON", "NICOLAS SARKOZY"], 
        ["MARINE LEPEN", "EMMANUEL MACRON"], ["ADAM", "EVE"],
        // Guerriers & Divers
        ["SAMOURAÏ", "NINJA"]
    ],

    "Transports & Véhicules 🚀": [
        // Routier
        ["VOITURE", "CAMION"], ["VÉLO", "TROTINETTE"], ["MÉTRO", "BUS"], ["BUS", "TRAIN"], 
        ["AMBULANCE", "CAMION DE POMPIER"], ["TRACTEUR", "PELLETEUSE"],
        // Marques
        ["LAMBORGHINI", "FERRARI"], ["TOYOTA", "PEUGEOT"],
        // Aérien
        ["AVION", "HÉLICOPTÈRE"], ["PARACHUTE", "DELTAPLANE"], ["HÉLICOPTÈRE DE COMBAT", "TANK"],
        // Nautique
        ["YACHT", "VOILIER"], ["PÉDALO", "CANOË"], ["BATEAU", "SOUS MARIN"],
        // Mobilité urbaine & autres
        ["TRAIN", "TRAMWAY"], ["SKATEBOARD", "ROLLER"], ["OVERBOARD", "FAUTEUIL ROULANT"]
    ],

    "Vêtements & Accessoires 🎩": [
        ["CHEMISE", "T-SHIRT"], ["PANTALON", "JEANS"], ["ROBE", "JUPE"], 
        ["SOUTIEN GORGE", "BRASSIÈRE"], ["MAILLOT", "STRING"],
        ["CHAPEAU", "CASQUETTE"], ["BONNET", "CAGOULE"], ["BONNET", "CASQUETTE"],
        ["ÉCHARPE", "MANTEAU"],
        ["CHAUSSETTE", "COLLANT"], ["CHAUSSETTE", "GANT"], ["CHAUSSETTE", "CHAUSSURES"],
        ["CEINTURE", "BRETELLE"], ["CRAVATE", "NŒUD PAPILLON"],
        ["BAGUE", "BRACELET"], ["MONTRE", "BRACELET"],
        ["LUNETTES DE SOLEIL", "LUNETTES DE VUE"]
    ],

    "Corps Humain & Santé 🧠": [
        // Anatomie Générale
        ["MAIN", "PIED"], ["BRAS", "JAMBE"], ["ÉPAULE", "HANCHE"], ["DOS", "VENTRE"], 
        ["GENOU", "COUDE"], ["CHEVILLE", "POIGNET"],
        // Visage
        ["ŒIL", "OREILLE"], ["NEZ", "BOUCHE"], ["DENT", "LANGUE"], ["LÈVRE", "LANGUE"], ["CIL", "SOURCILS"],
        // Doigts
        ["POUCE", "INDEX"], ["INDEX", "MAJEUR"], ["INDEX", "POUCE"], ["AURICULAIRE", "POUCE"], ["AURICULAIRE", "ANNULAIRE"], ["ANNULAIRE", "POUCE"],
        // Cheveux & Peau
        ["CHEVEUX", "POILS"], ["BARBE", "MOUSTACHE"], ["CALVITIE", "CHAUVE"], ["ONGLE", "GRIFFE"], ["BOUTON", "GRAIN DE BEAUTÉ"],
        // Interne
        ["CŒUR", "CERVEAU"], ["SANG", "VEINE"], ["MUSCLE", "OS"], ["ESTOMAC", "INTESTIN"], 
        ["FOIE", "REIN"], ["SQUELETTE", "CRÂNE"], ["SALIVE", "SANG"], ["CELLULE", "SANG"],
        // États & Fluides
        ["LARMES", "SUEUR"], ["EAU", "SUEUR"], ["COMA", "SOMMEIL"], ["INSOMNIAQUE", "SOMNAMBULE"],
        // Maladies & Soins
        ["TOUX", "ÉTERNUEMENT"], ["FIÈVRE", "FRISSON"], ["MÉDICAMENT", "VACCIN"], ["SIROP", "PILULE"], 
        ["SOURD", "AVEUGLE"], ["BÉQUILLE", "FAUTEUIL ROULANT"],
        // Cycle de vie
        ["BÉBÉ", "ENFANT"], ["ACCOUCHER", "TUER"], ["JUMEAUX", "TRIPLET"], ["JUMEAUX", "SIAMOIS (JUMEAUX)"]
    ],

    "Nature, Éléments & Climat 🌪️": [
        // Espace
        ["SOLEIL", "LUNE"], ["ÉTOILE", "PLANÈTE"], ["PLANÈTE", "ASTÉROÏDE"], ["CIEL", "ESPACE"], 
        ["MER", "CIEL"], ["MARS", "VÉNUS"], ["LUNE", "PLUTON"], ["NEPTUNE", "URANUS"], ["JUPITER", "SOLEIL"],
        // Temps & Climat
        ["AUBE", "CRÉPUSCULE"], ["PLUIE", "NEIGE"], ["VENT", "TEMPÊTE"], ["NUAGE", "BROUILLARD"], 
        ["INONDATION", "PLUIE"], ["OURAGAN", "PLUIE"], ["CHAUD", "FROID"], ["CHAUD", "TIÈDE"],
        // Terre & Végétation
        ["ARBRE", "FLEUR"], ["FEUILLE", "BRANCHE"], ["TRONC", "RACINE"], ["ÉCORCE", "SÈVE"], 
        ["MOUSSE", "LIERRE"], ["ROSE", "TULIPE"], ["SABLE", "TERRE"], ["INONDATION", "ÉROSION"],
        // Éléments Purs
        ["VOLCAN", "CRATÈRE"], ["EAU", "LAVE"], ["SOLEIL", "ÉRUPTION"],
        ["CUIVRE", "FER"], ["CUIVRE", "OR"], ["CALCIUM", "FER"]
    ],

    "Sports & Jeux 🎾": [
        // Sports Physiques
        ["FOOTBALL", "RUGBY"], ["BASKET", "HANDBALL"], ["BASEBALL", "FOOTBALL AMÉRICAIN"], ["BASKETBALL", "FOOTBALL"],
        ["TENNIS", "PING-PONG"], ["BADMINTON", "PING-PONG"], ["TENNIS", "BADMINTON"], ["BADMINTON", "SQUASH"],
        ["NATATION", "PLONGEON"], ["VOLLEYBALL", "WATER-POLO"], ["VOILE", "AVIRON"], ["SURF", "KITESURF"],
        ["BOXE", "CATCH"], ["ESCRIME", "LUTTE"], ["DANSE", "GYMNASTIQUE"],
        ["SKI", "SNOWBOARD"], ["PATINAGE", "HOCKEY"],
        ["MARATHON", "SPRINT"], ["SAUT EN HAUTEUR", "SAUT À LA PERCHE"], ["PARACHUTISME", "SAUT À L'ÉLASTIQUE"],
        // Loisirs
        ["PÉTANQUE", "BOWLING"], ["BILLARD", "FLIPPER"], ["BABY FOOT", "BILLARD"], ["BOWLING", "BILLARD"],
        ["FLÉCHETTES", "TIR À L'ARC"], ["KARTING", "QUAD"],
        // Jeux de Société & Échecs
        ["JEUX VIDÉO", "JEUX DE SOCIÉTÉ"], ["POKER", "TAROT"], ["MONOPOLY", "SCRABBLE"], ["CACHE-CACHE", "LOUP-GLACÉ"],
        ["ÉCHECS", "DAMES"], ["DAME (ÉCHEC)", "ROI (ÉCHEC)"], ["PION (ÉCHEC)", "ROI (ÉCHEC)"], ["CAVALIER (ÉCHEC)", "FOU (ÉCHEC)"],
        ["CODENAMES (JEU)", "GARTIC PHONE (JEU)"]
    ],

    "Technologie & Pop Culture 💻": [
        // Matériel & Tech
        ["ORDINATEUR", "SERVEUR"], ["SMARTPHONE", "TÉLÉPHONE FIXE"], ["SWITCH", "TABLETTE"], 
        ["BATTERIE", "CHARGEUR"], ["CLÉ USB", "DISQUE DUR"],
        // Marques Tech
        ["IPHONE", "SAMSUNG"], ["NOKIA", "HUAWEI"], ["HUAWEI", "IPHONE"], ["SAMSUNG", "NOKIA"], ["PLAYSTATION", "SWITCH"],
        // Web & Logiciel
        ["WIFI", "BLUETOOTH"], ["MOT DE PASSE", "CODE PIN"], ["HACKER", "PIRATE"], ["ANTIVIRUS", "PARE-FEU"], 
        ["AZERTY", "QWERTY"], ["CHATGPT", "GOOGLE"], ["CHATGPT", "GEMINI"],
        // Communication & Réseaux
        ["EMAIL", "SMS"], ["APPEL", "MESSAGE"], ["MESSAGE", "NOTIFICATION"], ["EMOJI", "GIF"], 
        ["RÉSEAU SOCIAL", "FORUM"], ["SITE", "BLOG"], ["HASHTAG", "AROBASE"], ["STREAMING", "DIRECT"],
        ["NETFLIX", "YOUTUBE"], ["TIKTOK", "YOUTUBE"], ["INSTAGRAM", "SNAPCHAT"], ["ONLYFAN", "TINDER"],
        // Jeux Vidéos (Univers)
        ["FORTNITE", "MINECRAFT"], ["CANDY CRUSH", "TETRIS"], ["ANGRY BIRD", "PLANTE VS ZOMBIES"],
        ["LUIGI", "MARIO"], ["MARIO", "PEACH"], ["LUIGI", "PEACH"], ["HARMONIE", "PEACH"],
        ["ENFER", "NETHER"], ["CRAFTER", "MINER"], ["CREUSER", "MINER"], ["NOYÉ", "ZOMBIE"], ["SQUELETTE", "ZOMBIE"],
        // Fiction & Cartoons
        ["INTELLIGENCE ARTIFICIELLE", "ROBOT"], ["HARRY POTTER", "STRANGER THINGS"], ["BACKROOM", "UPSIDE DOWN"], 
        ["EXTRATERRESTRE 👽", "MONSTRE"], ["DONALD", "MICKEY"], ["AVATAR (BLEU)", "AVATAR (FLÈCHE)"],
        ["GRAVITY FALLS", "WAKFU"], ["TOTALLY SPIES", "WINX"], ["GRAVITY FALLS", "SCOOBY DOO"]
    ],

    "Arts, Musique & Divertissement 🎨": [
        // Lecture & Écriture
        ["ROMAN", "BANDE DESSINÉE"], ["LIVRE", "DICTIONNAIRE"], ["LETTRES", "MOTS"], ["FABLE", "HISTOIRE"], ["FABLE", "FONTAINE"],
        // Arts Visuels
        ["PEINTURE", "AQUARELLE"], ["SCULPTURE", "POTERIE"], ["MUSÉES", "TABLEAU"], ["BIBLIOTHÈQUE", "MUSÉE"], 
        ["BLEU CLAIR", "BLEU FONCÉ"],
        // Musique
        ["CONCERT", "FESTIVAL"], ["PLAYLIST", "ALBUM"], ["OPÉRA", "CHORÉGRAPHIE"], ["BERCEUSE", "HISTOIRE"],
        ["GUITARE", "BASSE"], ["PIANO", "SYNTHÉTISEUR"], ["FLÛTE", "TROMPETTE"], ["BATTERIE", "PERCUSSION"], ["TAMBOUR", "CYMBALE"],
        // Cinéma & Scène
        ["FILM", "SÉRIE"], ["ANIMÉ", "SÉRIE"], ["COMÉDIE", "TRAGÉDIE"], ["THRILLER", "DRAME"], 
        ["SCIENCE-FICTION", "FANTASTIQUE"], ["PLATEAU", "SCÈNE"], ["MICRO", "MÉGAPHONE"],
        // Autres divertissements
        ["UNDERCOVER", "LOUP-GAROU (JEU)"]
    ],

    "Concepts & Abstrait 🌌": [
        // Émotions & Relations
        ["AMOUR", "AMITIÉ"], ["PEUR", "ANGOISSE"], ["TRISTESSE", "COLÈRE"], ["JOIE", "BONHEUR"], 
        ["RIRE", "SOURIRE"], ["BEAUTÉ", "CHARME"],
        // Temps & États
        ["PASSÉ", "FUTUR"], ["JOUR", "NUIT"], ["MORT", "VIE"], ["ENFANT", "ADULTE"], 
        ["RESSUSCITÉ", "TUER"], ["JOUR DE L'AN", "NOËL"],
        // Philosophie & Valeurs
        ["JUSTICE", "LOI"], ["VÉRITÉ", "MENSONGE"], ["FORCE", "FAIBLESSE"], ["COURAGE", "LÂCHETÉ"], 
        ["INTELLIGENCE", "SAGESSE"], ["GÉNIE", "TALENT"], ["BIEN", "MAL"], ["RAISON", "FOLIE"], 
        ["PAIX", "GUERRE"], ["VICTOIRE", "DÉFAITE"], ["ALTRUISME", "ÉGOCENTRISME"], ["ALTRUISME", "BONHEUR"],
        // Surnaturel & Croyances
        ["RÊVE", "CAUCHEMAR"], ["DIEU", "DIABLE"], ["ANGE", "DÉMON"], ["PARADIS", "ENFER"], 
        ["ENFER", "PURGATOIRE"], ["PURGATOIRE", "PARADIS"], ["SECRET", "MYSTÈRE"],
        // Physique & Mathématiques
        ["CHAUD", "FROID"], ["SILENCE", "BRUIT"], ["CUBE", "PYRAMIDE"], ["CARRÉ", "RECTANGLE"],
        // Hasard & Destin
        ["CHANCE", "HASARD"], ["PROBABILITÉ", "HASARD"], ["CHANCE", "KARMA"], ["KARMA", "MALCHANCE"],
        // Organisation & Sociétal
        ["HOMME", "FEMME"], ["GENRE", "SEXE"], ["ABSTINENCE (PG18)", "SEXE"], ["IMMIGRATION", "VOYAGE"], 
        ["CENSURE", "DÉSINFORMATION"], ["PROBLÈME", "SOLUTION"],
        // Langues & Cultures
        ["CHINOIS", "JAPONAIS"], ["GREC", "LATIN"], ["ARABE (LANGUE)", "LATIN"], ["ARABE", "JUIF"],
        // Repères & Oppositions
        ["BLANC", "NOIR"], ["ARGENT", "OR"], ["DROITE", "GAUCHE"], ["FICTIF", "RÉEL"], 
        ["DERNIER", "PREMIER"], ["DERNIÈRE", "DEUXIÈME"], ["DEUXIÈME", "PREMIER"],
        // Astrologie
        ["BÉLIER", "TAUREAU"], ["BÉLIER", "CAPRICORNE"]
    ],

    "Délires & Inside Jokes 🤪": [
        ["ROMAN", "SERGINE"], ["ELIAS", "MIGUEL"], ["LES PIEDS DE MIGUEL", "ODEUR AGRÉABLE"],
        ["LA MER", "MÈRE"], ["MAÎTRE", "MÈTRE"], ["PAIRE", "PÈRE"], 
        ["CHIER", "PÉTER"], ["CACA", "PIPI"],
        ["FAUTEUIL ROULANT", "BÉQUILLE"], ["BURJ KHALIFA", "MIA KHALIFA"], ["MIA KHALIFA", "DORA L'EXPLORATRICE"], 
        ["OUI OUI", "DORA L'EXPLORATRICE"], ["PHINEAS", "FERB"], ["DR HEINZ DOOFENSHMIRTZ", "MAJOR FRANCIS MONOGRAM"], 
        ["FIN DU MONDE", "GRAND TERRASSEMENT"], ["BOUTON ROUGE", "SOUS MARIN NUCLÉAIRE"]
    ]
};
