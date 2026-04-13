/**
 * Transaction categorizer -- maps transaction descriptions to spending categories
 * using regex pattern matching. Each category has a single precompiled regex
 * with alternation for all its known merchants/keywords.
 *
 * Categories are checked top-to-bottom; first match wins.
 * "Transfers" is deliberately first so inter-account movements are caught
 * before they could accidentally match more specific categories.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

interface CategoryRule {
  name: string;
  pattern: RegExp;
}

// ─── Category Rules ──────────────────────────────────────────────────────────
// Order matters: first match wins. Keep "Transfers" and "Tax" near the top
// so that HMRC payments and inter-account moves are classified before
// they accidentally match "Business" or "Debt Repayment".

const CATEGORIES: readonly CategoryRule[] = [
  {
    name: 'Transfers',
    pattern: /DAVID MORRISON|HEENA TAILOR|MONZO JOINT|AUTONIZE|AUTONIZEITLIMITED|MORRISON DD|TAILOR HEENA|HEENA MORRISON|D MORRISON|BARCLAYS .*STO|BUSINESS PREMIUM STO|MORRISON H\b|TRANSFERWISE|OPTIONAL FT|VIA MOBILE|ROYAL BANK \d{2}|BMACH \d{2}|SULEIMAN OMAR|GENERAL REGISTER|EMMA ALLEN|THOMAS\s+HIGGINS|GENEVIC|ENRIQUEZ|RISHI TAILOR/i,
  },
  {
    name: 'Tax',
    pattern: /HMRC|TAX SAVINGS|CUMBERNAULD/i,
  },
  {
    name: 'Housing',
    pattern: /HALIFAX|COVENTRY BUILDING|NATWEST|MORTGAGE|HAVERING COUNCIL|COUNCIL TAX|LONDON BOROUGH/i,
  },
  {
    name: 'Debt Repayment',
    pattern: /NOVUNA|SANTANDER|MBNA|FUNDING CIRCLE|BARCLAYS PARTNER|BOUNCE BACK|CAPITAL ON TAP|BCARD|BANK OF IRELAND|FORD CREDIT|CREDIT STYLE|WWW\.BARCLAYCARD|BARCLAYS\s+\d{4}|INTEREST CHARGE|BALANCE.*TRANSACTION/i,
  },
  {
    name: 'Childcare & Education',
    pattern: /HEADSTART|MONTESSORI|EASTMINSTER|STAGES PERFORMER|LITTLE KICKER|SCHOOLHIRE|SCHOOL|KIDZ CAMP|SCOOTY WOOTY|CHILDCARE GOV|FUNTASTIC FOOTBALL|CHECKMAT|GIDEA PARK COACHING/i,
  },
  {
    name: 'Insurance',
    pattern: /CHURCHILL|LIVERPOOL VICTORIA|\bLV\b|AIG LIFE|AIG\b|D&G.*CARE|CARE PLAN|AO RETAIL|AVIVA|AXA INSURANCE|DIRECT LINE|ADMIRAL|KINGSBRIDGE/i,
  },
  {
    name: 'Utilities',
    pattern: /SCOTTISH POWER|OCTOPUS ENERGY|BRITISH GAS|THAMES WATER|VIRGIN MEDIA|EE LIMITED|TV LICEN|WATER PLUS|SOUTHERN WATER|TONIK ENERGY|NORTHUMBRIAN WATER|ANGLIAN WATER|SEVERN TRENT|1PMOBILE|RING BASIC PLAN|DU F09DB/i,
  },
  {
    name: 'Groceries',
    pattern: /TESCO|ASDA|SAINSBURY|LIDL|ALDI|MORRISONS|CO[\s,-]?OP(?!.*BANK)|COSTCO|WAITROSE|B&M\b|OCADO|AMAZON FRESH|M&S FOOD|ICELAND|MODERN MILKMAN|LULU\b|CARREFOUR|UNION COOP|NEW W MART|HOO HING|BUDGENS|OXLOW FOOD|OXLANE FOOD|STATION ROAD CONVENIEN|BALGORES LANE|ROMFORD MINI|GNANAM/i,
  },
  {
    name: 'Eating Out',
    pattern: /DELIVEROO|JUST EAT|UBER EAT|TALABAT|ZOMATO|MCDONALD|KFC|NANDOS|PIZZA|BURGER|WAGAMAMA|SUBWAY|DOMINO|GREGGS|STARBUCKS|COSTA COFFEE|PRET A MANGER|FIVE GUYS|PAPA JOHN|CAREEM FOOD|CAREEM DELIVERIES|CAREEM QUIK|SLIM CHICKEN|TACO BELL|HOT & TASTY|NAKED CHIPS|MILLI.?S COFFEE|SIZZLIN STEAK|TRILL JERK|LIGHTHOUSE FISH|DU.?A FOODS|HAOZHAN|CAKE BOX|WENZEL|CHICKEN COTTAGE|KRISPY KREME|IVY TREE|IVYTREE|BEEFEATER|JOE AND THE JUICE|ROSSI ICES|HAMILTON HALL|OPUZ KITCHEN|MAZING BISTRO|GOOD HOOD KITCHEN|DRILL HOTEL|BRICK LANE BAGEL|SHUBH SHAGUN|PASTRY|CHINATOWN BAKERY|VENDEASE|PASTA RASTA|MISTER SOFTY|DUA FOODS|BREW\w*\s*ROMFORD|NINO.?S RESTAURANT|COMBAT2COFFEE|BODSON WINE|CREAMS\b|FLIGHT CLUB|HARDEES|ARAMARK|CWOA ADV|QUEENS ARMS|RESTAURANT ISTANBU|DELAWARE NORTH|MJ S CATERING|ZETTLE|THE GRILL\b|SUMUP \*THE GRILL|LIGHT HOUSE FISH|BALFOUR KINGSTON|TOY MOY|PASTURE TRADING|MNK\*LA CAFE|LA CAFE|KAPOU KAFE/i,
  },
  {
    name: 'Transport',
    pattern: /SHELL\b|BP\b|\bJET\b|ESSO\b|TEXACO|UBER(?! EAT)|THE AA\b|ALLEN FORD|RAC\b|CONGESTION|PARKING|ULEZ|DART CHARGE|TFL\b|OYSTER|TRANSPORT FOR LONDON|CAREEM(?! FOOD| DELIVERIES| QUIK)|BOLT\.EU|ELITE AUTOCARE|EURO CAR PARKS|MAYFIELD SERVICE|COTTON STREET SERVICE|CANARY WHARF CARPARK|MIPERMIT|SERVICE STA\w*/i,
  },
  {
    name: 'Travel',
    pattern: /EMIRATES|AIRBNB|BOOKING\.COM|PREMIER INN|TRAVELODGE|HOLIDAY INN|CROWNE PLAZA|ENTERPRISE RENT|HERTZ|EASYJET|RYANAIR|BRITISH AIRWAYS|STARHOLIDAYS|RIXOS|WARNER LEISURE|ANYVAN|PAN PACIFIC|AE?GEAN\s?AIR|AEGAN\s?AIR|EXPEDIA|STANSTED|NOMADESIM|VIRGIN MONEY TRAVEL|PIRAEUS BANK|AKROTIRI|IBN BATTUTA|SOUDA BR|PETRAKIS|AFOI|BARRIO.*GREECE|VIVLIOTHIKI|ELLESTIA|LABIRYNTH|STYLIANOS BIKAKIS|NIKOLAKAKIS|KAASLAND|STACH LOUNGE|STICHTING PATRONA|SCHIPHOL|MULTI1|SYNKA|GREECE\b|STN WDF|BIRD NETHERLANDS/i,
  },
  {
    name: 'Health & Personal',
    pattern: /DAVID LLOYD|BOOTS\b|PHARMACY|MEDICAL|HOSPITAL|CLINIC|DENTIST|OPTICIAN|SPECSAVERS|SUPERDRUG|DENTAL|VETS4PETS|PETS AT HOME|PURE GYM|FADES AND BLADES|BARBER|HEALTHPOINT|OXLOW CHEMIST|BEAUTY WORLD|COMPANION CARE|TOM AND JERRY PET|ORIGIN HEALTH/i,
  },
  {
    name: 'Entertainment',
    pattern: /NETFLIX|SPOTIFY|DISNEY|APPLE\.COM|AMAZON PRIME|MERLIN|WARNER\s?BROS|CINEMA|THEATRE|TICKETMASTER|VUE\b|ODEON|MAT CODE|DAZN|YOUTUBE\s?PREMIUM|PLAYSTATION|STAR\s?STABLE|PATREON|PAYPAL \*X\.|CHESSINGTON|FLIP OUT|NINJA WARRIOR|OXYGEN ACTIVEPLAY|ROMFORD LEISURE|GIDEA PARK L|GIDEA PARK LAWN|KIDSPACE|AXS TICKETS|POWERLEAGUE|SEA LIFE|UFS MAGIC|HORNCHURCH ATHLETIC|STEEL YARD|BOOM BATTLE|ACTION ROOM|LEGOLAND|NOTEMACHINE ATM|ATM\b|BOOMBAT|RUSSC CLUB|NOTTING HILL|URLTV|AIRTIME HOTEL|ZONE AMUSEMENT|JUMP IN|MAIDSTONE UNITED|BALLERZ|OJAS PLAY|SODEXO|WELCOME BREAK|OVO ARENA|IPSWICH T\w+ FOUNDATION|HAPPY FACE|LLDC BIRMINGHAM|SUPERCUPS VENDING|SHACK EVENTS|WB STUDIO TOUR|TOUCHAR|BPHEVENTSLTD|ROMFORD[\s-]+ESSEX|ME GROUP INTERNATIONAL|BYRON RED\s?STAR|ADVENTURE POINT|DUOZOULU|PHOTO MAGIC|SOCIETY OF OLD/i,
  },
  {
    name: 'Shopping',
    pattern: /AMAZON(?! FRESH)(?! PRIME)|PRIMARK|EBAY|ARGOS|JOHN LEWIS|IKEA|WICKES|TOPPS TILES|BUGABOO|SMYTHS|NEXT\b|ZARA|H&M\b|TK MAXX|CURRYS|DUNELM|AO\.COM|GEORGE\b|HUGO BOSS|JD SPORTS|SPORTS\s?DIRECT|PROKIT|B&Q|B & Q|SCREWFIX|POUNDLAND|WHSMITH|SCHUH|CLARKS\b|CARD FACTORY|THE RANGE\b|ONEBEYOND|FOOT LOCKER|RIVER ISLAND|LACOSTE|TIMBERLAND|HVP RETAIL|TROPH|POST OFFICE|M&S\b|SPORTSWEAR MARKET|LIBERTY SHOPP|THE MEADOWS RETAIL|AMZNMKTPLACE|PLATFORM 9|LAKESIDE\b|MOL\*PROKIT|FATSOMA|BLACK OUD|POMVOM|MOTHER GROUP|UK031 ROMFORD|^Romford$|ROMFORD ON \d{2}/i,
  },
  {
    name: 'Business',
    pattern: /AWS\b|GITHUB|GODADDY|SWELL|MCE ADVISO|PROTON|OPENAI|CHATGPT|CLOUDFLARE|DIGITALOCEAN|DIGITAL OCEAN|VERCEL|NETLIFY|CURSOR|ANTHROPIC|ADOBE|MICROSOFT|GOOGLE CLOUD|PLURALSIGHT|FIVERR|SMARTERASP|LOVABLE|SHOPIFY|COMPANIESHOUSE|COMPANIES\s?HOUSE|VEO TECHNOLOGIES|TWILIO|PLAN FEE|CHARGES COMMISSION|CHARGES\*.*TFR|UNPAID TRANSAC FEE|\d{2}(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC) A\/C|INTEREST CHARGED|PAYPAL \*STEAM|PAYPAL \*SEGPAY|PAYPAL \*LONDONLOUIS|PAYPAL \*LAZZDA|BYRON REDSTAR HAWK|IGB HOLDINGS|SUMUP \*IGB/i,
  },
  {
    name: 'Property',
    pattern: /EDU-LETTIN|LETTING|ESTATE AGENT|J SMITH WOOD|TJ LANDSCAP|FLOOR REPAIR|STONESHAW|PROSPECT HOLDING|SHURGARD|STORAGE|ALBO PLUMBING|RM2 FLOORING|GLASSMASTER|FENSOME ELECTRICAL|PLUMB|DISPUTE SERVICE|JS-LAW|CLEANSATION/i,
  },
];

// ─── Categorizer Function ────────────────────────────────────────────────────

/**
 * Strip NatWest-style formatting noise before pattern matching.
 * NatWest descriptions use commas as field separators (e.g.
 * "5120 08APR26 , PAYPAL , *STEAM GAMES , 35314369001 GB")
 * and 4-digit card prefixes that would break multi-word patterns.
 */
function normalizeForMatching(description: string): string {
  return description
    .replace(/,/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function categorizeTransaction(description: string): string {
  const normalized = normalizeForMatching(description);
  for (const rule of CATEGORIES) {
    if (rule.pattern.test(normalized)) {
      return rule.name;
    }
  }
  return 'Other';
}

// ─── Category Names (for consistent ordering in charts) ──────────────────────

export const CATEGORY_NAMES = [
  'Housing',
  'Utilities',
  'Groceries',
  'Eating Out',
  'Transport',
  'Shopping',
  'Entertainment',
  'Childcare & Education',
  'Health & Personal',
  'Insurance',
  'Debt Repayment',
  'Tax',
  'Business',
  'Property',
  'Transfers',
  'Travel',
  'Other',
] as const;

// ─── Colour Map ──────────────────────────────────────────────────────────────
// One colour per category, used by both the backend response and the frontend chart.

export const CATEGORY_COLOURS: Record<string, string> = {
  'Housing':               '#6366F1', // vibrant indigo
  'Utilities':             '#06B6D4', // vibrant cyan
  'Groceries':             '#22C55E', // vibrant green
  'Eating Out':            '#F97316', // vibrant orange
  'Transport':             '#EAB308', // vibrant yellow
  'Shopping':              '#EC4899', // vibrant pink
  'Entertainment':         '#A855F7', // vibrant purple
  'Childcare & Education': '#3B82F6', // vibrant blue
  'Health & Personal':     '#10B981', // vibrant emerald
  'Insurance':             '#8B5CF6', // vibrant violet
  'Debt Repayment':        '#EF4444', // vibrant red
  'Tax':                   '#F43F5E', // vibrant rose
  'Business':              '#14B8A6', // vibrant teal
  'Property':              '#F59E0B', // vibrant amber
  'Transfers':             '#38BDF8', // vibrant sky
  'Travel':                '#FB923C', // vibrant tangerine
  'Other':                 '#C084FC', // vibrant lavender
};
