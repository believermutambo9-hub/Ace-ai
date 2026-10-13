/**
 * Worldwide Football Team Alias and Canonical Mapping Dictionary
 * Maps diverse provider naming variants to a stable canonical club representation.
 */

export interface CanonicalTeamSeed {
  canonicalName: string;
  shortName: string;
  tla: string;
  country: string;
  venueName?: string;
  aliases: string[];
}

export const CANONICAL_TEAMS_DATA: CanonicalTeamSeed[] = [
  // --- Premier League (England) ---
  {
    canonicalName: 'Arsenal FC',
    shortName: 'Arsenal',
    tla: 'ARS',
    country: 'England',
    venueName: 'Emirates Stadium',
    aliases: ['Arsenal', 'Arsenal FC', 'The Gunners', 'AFC Arsenal', 'Arsenal London'],
  },
  {
    canonicalName: 'Chelsea FC',
    shortName: 'Chelsea',
    tla: 'CHE',
    country: 'England',
    venueName: 'Stamford Bridge',
    aliases: ['Chelsea', 'Chelsea FC', 'The Blues', 'CFC Chelsea', 'Chelsea London'],
  },
  {
    canonicalName: 'Manchester City FC',
    shortName: 'Man City',
    tla: 'MCI',
    country: 'England',
    venueName: 'Etihad Stadium',
    aliases: ['Manchester City', 'Man City', 'Man. City', 'Manchester City FC', 'MCFC'],
  },
  {
    canonicalName: 'Manchester United FC',
    shortName: 'Man United',
    tla: 'MUN',
    country: 'England',
    venueName: 'Old Trafford',
    aliases: ['Manchester United', 'Man Utd', 'Man United', 'Man. United', 'Manchester United FC', 'MUFC'],
  },
  {
    canonicalName: 'Liverpool FC',
    shortName: 'Liverpool',
    tla: 'LIV',
    country: 'England',
    venueName: 'Anfield',
    aliases: ['Liverpool', 'Liverpool FC', 'LFC', 'Liverpool Football Club'],
  },
  {
    canonicalName: 'Tottenham Hotspur FC',
    shortName: 'Tottenham',
    tla: 'TOT',
    country: 'England',
    venueName: 'Tottenham Hotspur Stadium',
    aliases: ['Tottenham Hotspur', 'Tottenham', 'Spurs', 'Tottenham Hotspur FC', 'THFC'],
  },
  {
    canonicalName: 'Aston Villa FC',
    shortName: 'Aston Villa',
    tla: 'AVL',
    country: 'England',
    venueName: 'Villa Park',
    aliases: ['Aston Villa', 'Aston Villa FC', 'Villa', 'AVFC'],
  },
  {
    canonicalName: 'Newcastle United FC',
    shortName: 'Newcastle',
    tla: 'NEW',
    country: 'England',
    venueName: "St. James' Park",
    aliases: ['Newcastle United', 'Newcastle', 'Newcastle Utd', 'Newcastle United FC', 'NUFC'],
  },
  {
    canonicalName: 'Brighton & Hove Albion FC',
    shortName: 'Brighton',
    tla: 'BHA',
    country: 'England',
    venueName: 'Amex Stadium',
    aliases: ['Brighton & Hove Albion', 'Brighton', 'Brighton and Hove Albion', 'BHAFC', 'Brighton & Hove Albion FC'],
  },
  {
    canonicalName: 'West Ham United FC',
    shortName: 'West Ham',
    tla: 'WHU',
    country: 'England',
    venueName: 'London Stadium',
    aliases: ['West Ham United', 'West Ham', 'West Ham Utd', 'West Ham United FC', 'WHUFC'],
  },

  // --- La Liga (Spain) ---
  {
    canonicalName: 'Real Madrid CF',
    shortName: 'Real Madrid',
    tla: 'RMA',
    country: 'Spain',
    venueName: 'Santiago Bernabéu',
    aliases: ['Real Madrid', 'Real Madrid CF', 'R. Madrid', 'Madrid', 'Los Blancos'],
  },
  {
    canonicalName: 'FC Barcelona',
    shortName: 'Barcelona',
    tla: 'FCB',
    country: 'Spain',
    venueName: 'Camp Nou',
    aliases: ['FC Barcelona', 'Barcelona', 'Barca', 'Barça', 'Futbol Club Barcelona'],
  },
  {
    canonicalName: 'Atlético de Madrid',
    shortName: 'Atlético',
    tla: 'ATM',
    country: 'Spain',
    venueName: 'Metropolitano',
    aliases: ['Atlético de Madrid', 'Atletico Madrid', 'Atlético Madrid', 'Atletico de Madrid', 'Atleti', 'ATM'],
  },
  {
    canonicalName: 'Real Sociedad de Fútbol',
    shortName: 'Real Sociedad',
    tla: 'RSO',
    country: 'Spain',
    venueName: 'Reale Arena',
    aliases: ['Real Sociedad', 'Real Sociedad de Fútbol', 'R. Sociedad', 'Sociedad'],
  },
  {
    canonicalName: 'Athletic Club',
    shortName: 'Athletic',
    tla: 'ATH',
    country: 'Spain',
    venueName: 'San Mamés',
    aliases: ['Athletic Club', 'Athletic Bilbao', 'Bilbao', 'Athletic Club Bilbao'],
  },

  // --- Serie A (Italy) ---
  {
    canonicalName: 'FC Internazionale Milano',
    shortName: 'Inter',
    tla: 'INT',
    country: 'Italy',
    venueName: 'San Siro',
    aliases: ['Inter Milan', 'Internazionale', 'FC Internazionale Milano', 'Inter', 'Inter Milano'],
  },
  {
    canonicalName: 'AC Milan',
    shortName: 'Milan',
    tla: 'MIL',
    country: 'Italy',
    venueName: 'San Siro',
    aliases: ['AC Milan', 'Milan', 'A.C. Milan', 'Associazione Calcio Milan'],
  },
  {
    canonicalName: 'Juventus FC',
    shortName: 'Juventus',
    tla: 'JUV',
    country: 'Italy',
    venueName: 'Allianz Stadium',
    aliases: ['Juventus', 'Juventus FC', 'Juve', 'Juventus Football Club'],
  },
  {
    canonicalName: 'SSC Napoli',
    shortName: 'Napoli',
    tla: 'NAP',
    country: 'Italy',
    venueName: 'Stadio Diego Armando Maradona',
    aliases: ['SSC Napoli', 'Napoli', 'S.S.C. Napoli'],
  },
  {
    canonicalName: 'AS Roma',
    shortName: 'Roma',
    tla: 'ROM',
    country: 'Italy',
    venueName: 'Stadio Olimpico',
    aliases: ['AS Roma', 'Roma', 'A.S. Roma'],
  },

  // --- Bundesliga (Germany) ---
  {
    canonicalName: 'FC Bayern München',
    shortName: 'Bayern',
    tla: 'FCB',
    country: 'Germany',
    venueName: 'Allianz Arena',
    aliases: ['Bayern Munich', 'FC Bayern München', 'Bayern München', 'FC Bayern Munich', 'Bayern'],
  },
  {
    canonicalName: 'Borussia Dortmund',
    shortName: 'Dortmund',
    tla: 'BVB',
    country: 'Germany',
    venueName: 'Signal Iduna Park',
    aliases: ['Borussia Dortmund', 'Dortmund', 'BVB 09', 'BVB Borussia Dortmund', 'BVB'],
  },
  {
    canonicalName: 'Bayer 04 Leverkusen',
    shortName: 'Leverkusen',
    tla: 'B04',
    country: 'Germany',
    venueName: 'BayArena',
    aliases: ['Bayer Leverkusen', 'Bayer 04 Leverkusen', 'Leverkusen', 'Bayer 04'],
  },
  {
    canonicalName: 'RB Leipzig',
    shortName: 'Leipzig',
    tla: 'RBL',
    country: 'Germany',
    venueName: 'Red Bull Arena',
    aliases: ['RB Leipzig', 'Leipzig', 'RasenBallsport Leipzig'],
  },

  // --- Ligue 1 (France) ---
  {
    canonicalName: 'Paris Saint-Germain FC',
    shortName: 'PSG',
    tla: 'PSG',
    country: 'France',
    venueName: 'Parc des Princes',
    aliases: ['Paris Saint-Germain', 'Paris SG', 'PSG', 'Paris Saint-Germain FC'],
  },
  {
    canonicalName: 'Olympique de Marseille',
    shortName: 'Marseille',
    tla: 'OM',
    country: 'France',
    venueName: 'Orange Vélodrome',
    aliases: ['Olympique de Marseille', 'Marseille', 'OM Marseille', 'OM'],
  },
  {
    canonicalName: 'AS Monaco FC',
    shortName: 'Monaco',
    tla: 'ASM',
    country: 'Monaco',
    venueName: 'Stade Louis II',
    aliases: ['AS Monaco', 'Monaco', 'AS Monaco FC', 'A.S. Monaco'],
  },

  // --- Worldwide / South America / MLS / Africa / Asia ---
  {
    canonicalName: 'CR Flamengo',
    shortName: 'Flamengo',
    tla: 'FLA',
    country: 'Brazil',
    venueName: 'Maracanã',
    aliases: ['Flamengo', 'CR Flamengo', 'Clube de Regatas do Flamengo'],
  },
  {
    canonicalName: 'SE Palmeiras',
    shortName: 'Palmeiras',
    tla: 'PAL',
    country: 'Brazil',
    venueName: 'Allianz Parque',
    aliases: ['Palmeiras', 'SE Palmeiras', 'Sociedade Esportiva Palmeiras'],
  },
  {
    canonicalName: 'CA River Plate',
    shortName: 'River Plate',
    tla: 'RIV',
    country: 'Argentina',
    venueName: 'El Monumental',
    aliases: ['River Plate', 'CA River Plate', 'Club Atlético River Plate'],
  },
  {
    canonicalName: 'CA Boca Juniors',
    shortName: 'Boca Juniors',
    tla: 'BOC',
    country: 'Argentina',
    venueName: 'La Bombonera',
    aliases: ['Boca Juniors', 'CA Boca Juniors', 'Club Atlético Boca Juniors'],
  },
  {
    canonicalName: 'Inter Miami CF',
    shortName: 'Inter Miami',
    tla: 'MIA',
    country: 'USA',
    venueName: 'Chase Stadium',
    aliases: ['Inter Miami', 'Inter Miami CF', 'Club Internacional de Fútbol Miami'],
  },
  {
    canonicalName: 'Al Ahly SC',
    shortName: 'Al Ahly',
    tla: 'AHL',
    country: 'Egypt',
    venueName: 'Cairo International Stadium',
    aliases: ['Al Ahly', 'Al Ahly SC', 'Al Ahly Cairo', 'Al-Ahly'],
  },
  {
    canonicalName: 'Mamelodi Sundowns FC',
    shortName: 'Sundowns',
    tla: 'SUN',
    country: 'South Africa',
    venueName: 'Loftus Versfeld',
    aliases: ['Mamelodi Sundowns', 'Mamelodi Sundowns FC', 'Sundowns'],
  },
  {
    canonicalName: 'Al Hilal SFC',
    shortName: 'Al Hilal',
    tla: 'HIL',
    country: 'Saudi Arabia',
    venueName: 'Kingdom Arena',
    aliases: ['Al Hilal', 'Al Hilal SFC', 'Al-Hilal', 'Al Hilal Saudi'],
  },
];
