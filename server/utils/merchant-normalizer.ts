/**
 * Merchant name normalizer -- converts raw transaction descriptions into
 * clean, human-readable merchant display names.
 *
 * Handles multiple bank formats:
 * - Barclays: "SCOTTISH POWER         	DIRECT DEBIT"
 * - Monzo:    "SAINSBURYS T U0569     BECKTON       GBR"
 * - NatWest:  "VIRGIN MEDIA PYMTS     REF: 12345"
 *
 * Kept separate from the categorizer: the categorizer decides which category,
 * the normalizer decides what to call the merchant.
 */

// ─── Well-known merchant display names ───────────────────────────────────────
// Maps a regex (tested against the raw description) to a clean display name.
// Checked top-to-bottom; first match wins.

interface MerchantRule {
  pattern: RegExp;
  displayName: string;
}

const MERCHANT_RULES: readonly MerchantRule[] = [
  // Housing
  { pattern: /HALIFAX/i, displayName: 'Halifax Mortgage' },
  { pattern: /COVENTRY BUILDING/i, displayName: 'Coventry Building Society' },
  { pattern: /\bNATWEST\b/i, displayName: 'NatWest Mortgage' },
  { pattern: /HAVERING COUNCIL|LONDON BOROUGH/i, displayName: 'Council Tax' },

  // Utilities
  { pattern: /SCOTTISH POWER/i, displayName: 'Scottish Power' },
  { pattern: /OCTOPUS ENERGY/i, displayName: 'Octopus Energy' },
  { pattern: /BRITISH GAS/i, displayName: 'British Gas' },
  { pattern: /THAMES WATER/i, displayName: 'Thames Water' },
  { pattern: /NORTHUMBRIAN WATER/i, displayName: 'Northumbrian Water' },
  { pattern: /ANGLIAN WATER/i, displayName: 'Anglian Water' },
  { pattern: /SOUTHERN WATER/i, displayName: 'Southern Water' },
  { pattern: /SEVERN TRENT/i, displayName: 'Severn Trent' },
  { pattern: /WATER PLUS/i, displayName: 'Water Plus' },
  { pattern: /TONIK ENERGY/i, displayName: 'Tonik Energy' },
  { pattern: /VIRGIN MEDIA/i, displayName: 'Virgin Media' },
  { pattern: /EE LIMITED/i, displayName: 'EE' },
  { pattern: /TV LICEN/i, displayName: 'TV Licence' },
  { pattern: /1PMOBILE/i, displayName: '1pMobile' },
  { pattern: /RING BASIC PLAN/i, displayName: 'Ring Security' },
  { pattern: /DU F09DB/i, displayName: 'du (UAE)' },

  // Insurance
  { pattern: /CHURCHILL/i, displayName: 'Churchill Insurance' },
  { pattern: /LIVERPOOL VICTORIA|\bLV\b/i, displayName: 'LV Insurance' },
  { pattern: /AIG LIFE/i, displayName: 'AIG Life' },
  { pattern: /\bAIG\b/i, displayName: 'AIG' },
  { pattern: /AVIVA/i, displayName: 'Aviva' },
  { pattern: /AXA INSURANCE/i, displayName: 'AXA Insurance' },
  { pattern: /DIRECT LINE/i, displayName: 'Direct Line' },
  { pattern: /ADMIRAL/i, displayName: 'Admiral' },
  { pattern: /KINGSBRIDGE/i, displayName: 'Kingsbridge Insurance' },
  { pattern: /D&G.*CARE|CARE PLAN|AO RETAIL/i, displayName: 'Appliance Care Plan' },

  // Groceries
  { pattern: /TESCO/i, displayName: 'Tesco' },
  { pattern: /ASDA/i, displayName: 'Asda' },
  { pattern: /SAINSBURY/i, displayName: "Sainsbury's" },
  { pattern: /LIDL/i, displayName: 'Lidl' },
  { pattern: /ALDI/i, displayName: 'Aldi' },
  { pattern: /MORRISONS/i, displayName: 'Morrisons' },
  { pattern: /CO[\s,-]?OP.*FOOD/i, displayName: 'Co-op' },
  { pattern: /CO[\s,-]?OP(?!.*BANK)/i, displayName: 'Co-op' },
  { pattern: /COSTCO/i, displayName: 'Costco' },
  { pattern: /WAITROSE/i, displayName: 'Waitrose' },
  { pattern: /\bB&M\b/i, displayName: 'B&M' },
  { pattern: /OCADO/i, displayName: 'Ocado' },
  { pattern: /AMAZON FRESH/i, displayName: 'Amazon Fresh' },
  { pattern: /M&S FOOD/i, displayName: 'M&S Food' },
  { pattern: /ICELAND/i, displayName: 'Iceland' },
  { pattern: /MODERN MILKMAN/i, displayName: 'Modern Milkman' },
  { pattern: /CARREFOUR/i, displayName: 'Carrefour' },
  { pattern: /UNION COOP/i, displayName: 'Union Coop' },
  { pattern: /NEW W MART/i, displayName: 'New W Mart' },
  { pattern: /HOO HING/i, displayName: 'Hoo Hing' },
  { pattern: /BUDGENS/i, displayName: 'Budgens' },
  { pattern: /OXLOW FOOD|OXLANE FOOD/i, displayName: 'Oxlow Food Centre' },
  { pattern: /STATION ROAD CONVENIEN/i, displayName: 'Station Road Convenience' },
  { pattern: /GNANAM AND SON/i, displayName: 'Gnanam & Son' },
  { pattern: /ROMFORD MINI MARKET/i, displayName: 'Romford Mini Market' },

  // Eating Out
  { pattern: /DELIVEROO/i, displayName: 'Deliveroo' },
  { pattern: /JUST EAT/i, displayName: 'Just Eat' },
  { pattern: /UBER EAT/i, displayName: 'Uber Eats' },
  { pattern: /TALABAT/i, displayName: 'Talabat' },
  { pattern: /ZOMATO/i, displayName: 'Zomato' },
  { pattern: /MCDONALD/i, displayName: "McDonald's" },
  { pattern: /KFC/i, displayName: 'KFC' },
  { pattern: /NANDOS/i, displayName: "Nando's" },
  { pattern: /WAGAMAMA/i, displayName: 'Wagamama' },
  { pattern: /DOMINO/i, displayName: "Domino's" },
  { pattern: /GREGGS/i, displayName: 'Greggs' },
  { pattern: /STARBUCKS/i, displayName: 'Starbucks' },
  { pattern: /COSTA COFFEE/i, displayName: 'Costa Coffee' },
  { pattern: /PRET A MANGER/i, displayName: 'Pret A Manger' },
  { pattern: /FIVE GUYS/i, displayName: 'Five Guys' },
  { pattern: /PAPA JOHN/i, displayName: "Papa John's" },
  { pattern: /CAREEM FOOD/i, displayName: 'Careem Food' },
  { pattern: /CAREEM DELIVERIES/i, displayName: 'Careem Delivery' },
  { pattern: /CAREEM QUIK/i, displayName: 'Careem Quick' },
  { pattern: /SLIM CHICKEN/i, displayName: 'Slim Chickens' },
  { pattern: /TACO BELL/i, displayName: 'Taco Bell' },
  { pattern: /HOT & TASTY/i, displayName: 'Hot & Tasty' },
  { pattern: /NAKED CHIPS/i, displayName: 'Naked Chips' },
  { pattern: /MILLI.?S COFFEE/i, displayName: "Milli's Coffee" },
  { pattern: /SIZZLIN STEAK/i, displayName: 'Sizzlin Steak' },
  { pattern: /TRILL JERK/i, displayName: 'Trill Jerk & Grill' },
  { pattern: /LIGHTHOUSE FISH/i, displayName: 'Lighthouse Fish & Chips' },
  { pattern: /DU.?A FOODS/i, displayName: "Du'a Foods" },
  { pattern: /HAOZHAN/i, displayName: 'Haozhan' },
  { pattern: /CAKE BOX/i, displayName: 'Cake Box' },
  { pattern: /WENZEL/i, displayName: "Wenzel's" },
  { pattern: /CHICKEN COTTAGE/i, displayName: 'Chicken Cottage' },
  { pattern: /KRISPY KREME/i, displayName: 'Krispy Kreme' },
  { pattern: /IVY TREE|IVYTREE/i, displayName: 'Ivy Tree' },
  { pattern: /BEEFEATER/i, displayName: 'Beefeater' },
  { pattern: /JOE AND THE JUICE/i, displayName: 'Joe & The Juice' },
  { pattern: /ROSSI ICES/i, displayName: 'Rossi Ices' },
  { pattern: /HAMILTON HALL/i, displayName: 'Hamilton Hall' },
  { pattern: /OPUZ KITCHEN/i, displayName: 'Opuz Kitchen' },
  { pattern: /MAZING BISTRO/i, displayName: 'Mazing Bistro Cafe' },
  { pattern: /GOOD HOOD KITCHEN/i, displayName: 'Good Hood Kitchen' },
  { pattern: /DRILL HOTEL/i, displayName: 'Drill Hotel' },
  { pattern: /BRICK LANE BAGEL/i, displayName: 'Brick Lane Bagel' },
  { pattern: /SHUBH SHAGUN/i, displayName: 'Shubh Shagun' },
  { pattern: /CHINATOWN BAKERY/i, displayName: 'Chinatown Bakery' },
  { pattern: /VENDEASE/i, displayName: 'Vendease' },
  { pattern: /PASTA RASTA/i, displayName: 'Pasta Rasta' },
  { pattern: /MISTER SOFTY/i, displayName: 'Mister Softy' },
  { pattern: /NINO.?S RESTAURANT/i, displayName: "Nino's Restaurant" },
  { pattern: /COMBAT2COFFEE/i, displayName: 'Combat2Coffee' },
  { pattern: /HARDEES/i, displayName: "Hardee's" },
  { pattern: /CREAMS\b/i, displayName: 'Creams Cafe' },
  { pattern: /FLIGHT CLUB/i, displayName: 'Flight Club' },
  { pattern: /ARAMARK/i, displayName: 'Aramark' },
  { pattern: /BREW\w*\s*ROMFORD/i, displayName: 'Brewery Romford' },

  // Transport
  { pattern: /\bSHELL\b/i, displayName: 'Shell' },
  { pattern: /\bBP\b/i, displayName: 'BP' },
  { pattern: /\bESSO\b/i, displayName: 'Esso' },
  { pattern: /TEXACO/i, displayName: 'Texaco' },
  { pattern: /UBER(?! EAT)/i, displayName: 'Uber' },
  { pattern: /\bTHE AA\b/i, displayName: 'AA' },
  { pattern: /ALLEN FORD/i, displayName: 'Allen Ford' },
  { pattern: /\bRAC\b/i, displayName: 'RAC' },
  { pattern: /CONGESTION/i, displayName: 'Congestion Charge' },
  { pattern: /ULEZ/i, displayName: 'ULEZ' },
  { pattern: /DART CHARGE/i, displayName: 'Dart Charge' },
  { pattern: /\bTFL\b|OYSTER|TRANSPORT FOR LONDON/i, displayName: 'TfL' },
  { pattern: /CAREEM HALA|CAREEM RIDE|CAREEM TIP/i, displayName: 'Careem' },
  { pattern: /BOLT\.EU/i, displayName: 'Bolt' },
  { pattern: /ELITE AUTOCARE/i, displayName: 'Elite Autocare' },
  { pattern: /EURO CAR PARKS/i, displayName: 'Euro Car Parks' },
  { pattern: /MAYFIELD SERVICE/i, displayName: 'Mayfield Service Station' },
  { pattern: /COTTON STREET SERVICE/i, displayName: 'Cotton Street Petrol' },
  { pattern: /CANARY WHARF CARPARK/i, displayName: 'Canary Wharf Parking' },
  { pattern: /MIPERMIT/i, displayName: 'MiPermit Parking' },

  // Travel
  { pattern: /EMIRATES/i, displayName: 'Emirates' },
  { pattern: /AIRBNB/i, displayName: 'Airbnb' },
  { pattern: /BOOKING\.COM/i, displayName: 'Booking.com' },
  { pattern: /PREMIER INN/i, displayName: 'Premier Inn' },
  { pattern: /EASYJET/i, displayName: 'easyJet' },
  { pattern: /RYANAIR/i, displayName: 'Ryanair' },
  { pattern: /BRITISH AIRWAYS/i, displayName: 'British Airways' },
  { pattern: /WARNER LEISURE/i, displayName: 'Warner Leisure' },
  { pattern: /AE?GEAN\s?AIR|AEGAN\s?AIR/i, displayName: 'Aegean Airlines' },
  { pattern: /EXPEDIA/i, displayName: 'Expedia' },
  { pattern: /STANSTED AIRPORT/i, displayName: 'Stansted Airport' },
  { pattern: /NOMADESIM/i, displayName: 'Nomad eSIM' },
  { pattern: /VIRGIN MONEY TRAVEL/i, displayName: 'Virgin Money Travel' },

  // Childcare & Education
  { pattern: /HEADSTART/i, displayName: 'Headstart' },
  { pattern: /MONTESSORI/i, displayName: 'Montessori' },
  { pattern: /EASTMINSTER/i, displayName: 'Eastminster School' },
  { pattern: /STAGES PERFORMER/i, displayName: 'Stagecoach Performing Arts' },
  { pattern: /LITTLE KICKER/i, displayName: 'Little Kickers' },
  { pattern: /KIDZ CAMP/i, displayName: 'Kidz Camp' },
  { pattern: /SCOOTY WOOTY/i, displayName: 'Scooty Wooty' },
  { pattern: /CHILDCARE GOV/i, displayName: 'Childcare (Gov)' },
  { pattern: /FUNTASTIC FOOTBALL/i, displayName: 'Funtastic Football' },
  { pattern: /CHECKMAT/i, displayName: 'Checkmat BJJ' },
  { pattern: /GIDEA PARK COACHING/i, displayName: 'Gidea Park Coaching' },

  // Health & Personal
  { pattern: /DAVID LLOYD/i, displayName: 'David Lloyd' },
  { pattern: /\bBOOTS\b/i, displayName: 'Boots' },
  { pattern: /SPECSAVERS/i, displayName: 'Specsavers' },
  { pattern: /SUPERDRUG/i, displayName: 'Superdrug' },
  { pattern: /VETS4PETS|PETS AT HOME/i, displayName: 'Pets at Home' },
  { pattern: /PURE GYM/i, displayName: 'PureGym' },
  { pattern: /FADES AND BLADES/i, displayName: 'Fades & Blades' },
  { pattern: /HEALTHPOINT/i, displayName: 'Healthpoint' },
  { pattern: /OXLOW CHEMIST/i, displayName: 'Oxlow Chemist' },
  { pattern: /BEAUTY WORLD/i, displayName: 'Beauty World' },
  { pattern: /COMPANION CARE/i, displayName: 'Companion Care Vets' },
  { pattern: /TOM AND JERRY PET/i, displayName: 'Tom & Jerry Pets' },
  { pattern: /ORIGIN HEALTH/i, displayName: 'Origin Health' },

  // Entertainment
  { pattern: /NETFLIX/i, displayName: 'Netflix' },
  { pattern: /SPOTIFY/i, displayName: 'Spotify' },
  { pattern: /DISNEY/i, displayName: 'Disney+' },
  { pattern: /APPLE\.COM/i, displayName: 'Apple' },
  { pattern: /AMAZON PRIME/i, displayName: 'Amazon Prime' },
  { pattern: /MERLIN/i, displayName: 'Merlin Entertainments' },
  { pattern: /DAZN/i, displayName: 'DAZN' },
  { pattern: /YOUTUBE\s?PREMIUM/i, displayName: 'YouTube Premium' },
  { pattern: /PLAYSTATION/i, displayName: 'PlayStation' },
  { pattern: /STAR\s?STABLE/i, displayName: 'Star Stable' },
  { pattern: /PATREON/i, displayName: 'Patreon' },
  { pattern: /PAYPAL \*X\./i, displayName: 'X (Twitter)' },
  { pattern: /CHESSINGTON/i, displayName: 'Chessington' },
  { pattern: /FLIP OUT/i, displayName: 'Flip Out' },
  { pattern: /NINJA WARRIOR/i, displayName: 'Ninja Warrior UK' },
  { pattern: /OXYGEN ACTIVEPLAY/i, displayName: 'Oxygen Activeplay' },
  { pattern: /ROMFORD LEISURE/i, displayName: 'Romford Leisure Centre' },
  { pattern: /GIDEA PARK L/i, displayName: 'Gidea Park Tennis' },
  { pattern: /KIDSPACE/i, displayName: 'Kidspace' },
  { pattern: /AXS TICKETS/i, displayName: 'AXS Tickets' },
  { pattern: /POWERLEAGUE/i, displayName: 'Powerleague' },
  { pattern: /SEA LIFE/i, displayName: 'Sea Life' },
  { pattern: /UFS MAGIC/i, displayName: 'UFS Magic Booking' },
  { pattern: /HORNCHURCH ATHLETIC/i, displayName: 'Hornchurch Athletic' },
  { pattern: /STEEL YARD/i, displayName: 'The Steel Yard' },
  { pattern: /BOOM BATTLE/i, displayName: 'Boom Battle Bar' },
  { pattern: /ACTION ROOM/i, displayName: 'The Action Room' },
  { pattern: /LEGOLAND/i, displayName: 'Legoland' },
  { pattern: /URLTV/i, displayName: 'URLTV' },
  { pattern: /WARNER\s?BROS/i, displayName: 'Warner Bros' },
  { pattern: /AIRTIME HOTEL/i, displayName: 'Airtime Hotel Movies' },

  // Shopping (before Amazon to avoid greedy match)
  { pattern: /AMAZON FRESH/i, displayName: 'Amazon Fresh' },
  { pattern: /AMAZON PRIME/i, displayName: 'Amazon Prime' },
  { pattern: /AMZNMKTPLACE|AMAZON/i, displayName: 'Amazon' },
  { pattern: /PRIMARK/i, displayName: 'Primark' },
  { pattern: /EBAY/i, displayName: 'eBay' },
  { pattern: /ARGOS/i, displayName: 'Argos' },
  { pattern: /JOHN LEWIS/i, displayName: 'John Lewis' },
  { pattern: /IKEA/i, displayName: 'IKEA' },
  { pattern: /WICKES/i, displayName: 'Wickes' },
  { pattern: /SMYTHS/i, displayName: 'Smyths Toys' },
  { pattern: /CURRYS/i, displayName: 'Currys' },
  { pattern: /DUNELM/i, displayName: 'Dunelm' },
  { pattern: /HUGO BOSS/i, displayName: 'Hugo Boss' },
  { pattern: /JD SPORTS/i, displayName: 'JD Sports' },
  { pattern: /TK MAXX/i, displayName: 'TK Maxx' },
  { pattern: /SPORTS\s?DIRECT/i, displayName: 'Sports Direct' },
  { pattern: /MOL\*PROKIT|PROKIT/i, displayName: 'Prokit UK' },
  { pattern: /B&Q|B & Q/i, displayName: 'B&Q' },
  { pattern: /SCREWFIX/i, displayName: 'Screwfix' },
  { pattern: /POUNDLAND/i, displayName: 'Poundland' },
  { pattern: /WHSMITH/i, displayName: 'WHSmith' },
  { pattern: /SCHUH/i, displayName: 'Schuh' },
  { pattern: /\bCLARKS\b/i, displayName: 'Clarks' },
  { pattern: /CARD FACTORY/i, displayName: 'Card Factory' },
  { pattern: /THE RANGE\b/i, displayName: 'The Range' },
  { pattern: /ONEBEYOND/i, displayName: 'OneBeyond' },
  { pattern: /FOOT LOCKER/i, displayName: 'Foot Locker' },
  { pattern: /RIVER ISLAND/i, displayName: 'River Island' },
  { pattern: /LACOSTE/i, displayName: 'Lacoste' },
  { pattern: /TIMBERLAND/i, displayName: 'Timberland' },
  { pattern: /HVP RETAIL/i, displayName: 'HVP Retail' },
  { pattern: /TROPHIES? PLUS|TROPHY STORE/i, displayName: 'Trophy Store' },
  { pattern: /POST OFFICE/i, displayName: 'Post Office' },
  { pattern: /M&S\b/i, displayName: 'M&S' },
  { pattern: /SPORTSWEAR MARKET/i, displayName: 'Sportswear Market' },
  { pattern: /LIBERTY SHOPP/i, displayName: 'Liberty Shopping Centre' },
  { pattern: /FATSOMA/i, displayName: 'Fatsoma' },
  { pattern: /PLATFORM 9/i, displayName: 'Platform 9 3/4 Shop' },

  // Debt Repayment
  { pattern: /NOVUNA/i, displayName: 'Novuna Finance' },
  { pattern: /FUNDING CIRCLE/i, displayName: 'Funding Circle' },
  { pattern: /BOUNCE BACK/i, displayName: 'Bounce Back Loan' },
  { pattern: /CAPITAL ON TAP/i, displayName: 'Capital on Tap' },
  { pattern: /WWW\.BARCLAYCARD|BCARD/i, displayName: 'Barclaycard' },
  { pattern: /SANTANDER/i, displayName: 'Santander' },
  { pattern: /MBNA/i, displayName: 'MBNA' },
  { pattern: /BANK OF IRELAND/i, displayName: 'Bank of Ireland' },
  { pattern: /FORD CREDIT/i, displayName: 'Ford Credit' },
  { pattern: /CREDIT STYLE/i, displayName: 'Credit Style' },
  { pattern: /BARCLAYS PARTNER/i, displayName: 'Barclays Partner Finance' },
  { pattern: /INTEREST CHARGE/i, displayName: 'Interest Charges' },

  // Tax
  { pattern: /HMRC/i, displayName: 'HMRC' },
  { pattern: /TAX SAVINGS/i, displayName: 'Tax Savings' },
  { pattern: /CUMBERNAULD/i, displayName: 'HMRC Cumbernauld' },

  // Business
  { pattern: /\bAWS\b/i, displayName: 'AWS' },
  { pattern: /GITHUB/i, displayName: 'GitHub' },
  { pattern: /GODADDY/i, displayName: 'GoDaddy' },
  { pattern: /SWELL/i, displayName: 'Swell' },
  { pattern: /MCE ADVISO/i, displayName: 'MCE Advisors' },
  { pattern: /PROTON/i, displayName: 'Proton' },
  { pattern: /OPENAI|CHATGPT/i, displayName: 'OpenAI' },
  { pattern: /CLOUDFLARE/i, displayName: 'Cloudflare' },
  { pattern: /DIGITALOCEAN|DIGITAL OCEAN/i, displayName: 'DigitalOcean' },
  { pattern: /CURSOR/i, displayName: 'Cursor' },
  { pattern: /ANTHROPIC/i, displayName: 'Anthropic' },
  { pattern: /ADOBE/i, displayName: 'Adobe' },
  { pattern: /MICROSOFT/i, displayName: 'Microsoft' },
  { pattern: /GOOGLE CLOUD/i, displayName: 'Google Cloud' },
  { pattern: /PLURALSIGHT/i, displayName: 'Pluralsight' },
  { pattern: /FIVERR/i, displayName: 'Fiverr' },
  { pattern: /SMARTERASP/i, displayName: 'SmarterASP' },
  { pattern: /LOVABLE/i, displayName: 'Lovable' },
  { pattern: /SHOPIFY/i, displayName: 'Shopify' },
  { pattern: /COMPANIESHOUSE|COMPANIES\s?HOUSE/i, displayName: 'Companies House' },
  { pattern: /VEO TECHNOLOGIES/i, displayName: 'Veo Technologies' },
  { pattern: /TWILIO/i, displayName: 'Twilio' },
  { pattern: /CHARGES COMMISSION|CHARGES\*.*TFR/i, displayName: 'Bank Charges' },
  { pattern: /\b\d{2}(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+A[\s/]C\b/i, displayName: 'NatWest Account Fee' },
  { pattern: /UNPAID TRANSAC FEE/i, displayName: 'Unpaid Transaction Fee' },
  { pattern: /INTEREST CHARGED/i, displayName: 'Interest Charged' },
  { pattern: /PAYPAL \*STEAM/i, displayName: 'Steam Games' },
  { pattern: /PAYPAL \*SEGPAY/i, displayName: 'Segpay Subscription' },
  { pattern: /BYRON REDSTAR HAWK/i, displayName: 'Byron Redstar Sponsorship' },
  { pattern: /PLAN FEE/i, displayName: 'Plan Fee' },

  // Property
  { pattern: /EDU-LETTIN/i, displayName: 'Edu-Lettings' },
  { pattern: /J SMITH WOOD/i, displayName: 'J Smith Woodwork' },
  { pattern: /TJ LANDSCAP/i, displayName: 'TJ Landscaping' },
  { pattern: /SHURGARD|STORAGE/i, displayName: 'Storage' },
  { pattern: /PROSPECT HOLDING/i, displayName: 'Prospect Holdings' },
  { pattern: /DISPUTE SERVICE/i, displayName: 'The Dispute Service' },

  // Travel - foreign merchants
  { pattern: /PIRAEUS BANK/i, displayName: 'Piraeus Bank ATM' },
  { pattern: /AKROTIRI/i, displayName: 'Akrotiri (Greece)' },
  { pattern: /IBN BATTUTA/i, displayName: 'Ibn Battuta Mall' },
  { pattern: /SOUDA BR/i, displayName: 'Souda (Greece)' },
  { pattern: /PETRAKIS/i, displayName: 'Petrakis (Greece)' },
  { pattern: /AFOI KALOTERAKI/i, displayName: 'Afoi Kaloteraki (Greece)' },
  { pattern: /AFOI G PAPADAKI/i, displayName: 'Papadaki (Greece)' },
  { pattern: /VIVLIOTHIKI/i, displayName: 'Vivliothiki (Greece)' },
  { pattern: /ELLESTIA/i, displayName: 'Ellestia Mall (Greece)' },
  { pattern: /LABIRYNTH/i, displayName: 'Labirynth (Greece)' },
  { pattern: /BARRIO.*GREECE/i, displayName: 'Barrio (Greece)' },
  { pattern: /NIKOLAKAKIS/i, displayName: 'Nikolakakis (Greece)' },
  { pattern: /STYLIANOS BIKAKIS/i, displayName: 'Bikakis (Greece)' },
  { pattern: /KAASLAND/i, displayName: 'Kaasland (Netherlands)' },
  { pattern: /STACH LOUNGE/i, displayName: 'Stach Lounge (Netherlands)' },
  { pattern: /STICHTING PATRONA/i, displayName: 'Stichting Patronaat (Netherlands)' },
  { pattern: /SYNKA/i, displayName: 'Synka (Greece)' },
  { pattern: /KAPOU KAFE/i, displayName: 'Kapou Kafe (Greece)' },

  // Eating Out - additional
  { pattern: /QUEENS ARMS/i, displayName: 'Queens Arms' },
  { pattern: /RESTAURANT ISTANBU/i, displayName: 'Restaurant Istanbul' },
  { pattern: /DELAWARE NORTH/i, displayName: 'Delaware North' },
  { pattern: /ZETTLE|MJ S CATERING/i, displayName: 'MJ\'s Catering' },
  { pattern: /PHOTO MAGIC/i, displayName: 'Photo Magic' },

  // Entertainment - additional
  { pattern: /ZONE AMUSEMENT/i, displayName: 'The Zone' },
  { pattern: /JUMP IN/i, displayName: 'Jump In' },
  { pattern: /MAIDSTONE UNITED/i, displayName: 'Maidstone United FC' },
  { pattern: /BALLERZ/i, displayName: 'Ballerz' },
  { pattern: /OJAS PLAY/i, displayName: 'Ojas Play Cafe' },
  { pattern: /SODEXO/i, displayName: 'Sodexo' },
  { pattern: /WELCOME BREAK/i, displayName: 'Welcome Break' },
  { pattern: /OVO ARENA/i, displayName: 'OVO Arena Wembley' },
  { pattern: /IPSWICH T\w+ FOUNDATION/i, displayName: 'Ipswich Town Foundation' },
  { pattern: /HAPPY FACE/i, displayName: 'Happy Face' },
  { pattern: /WB STUDIO TOUR/i, displayName: 'WB Studio Tour' },
  { pattern: /ZONE AMUSEMENT/i, displayName: 'The Zone' },
  { pattern: /JUMP IN/i, displayName: 'Jump In' },
  { pattern: /MAIDSTONE UNITED/i, displayName: 'Maidstone United FC' },
  { pattern: /BALLERZ/i, displayName: 'Ballerz' },
  { pattern: /OJAS PLAY/i, displayName: 'Ojas Play Cafe' },
  { pattern: /SODEXO/i, displayName: 'Sodexo' },
  { pattern: /WELCOME BREAK/i, displayName: 'Welcome Break' },
  { pattern: /OVO ARENA/i, displayName: 'OVO Arena Wembley' },
  { pattern: /IPSWICH T\w+ FOUNDATION/i, displayName: 'Ipswich Town Foundation' },
  { pattern: /HAPPY FACE/i, displayName: 'Happy Face' },
  { pattern: /DUOZOULU/i, displayName: 'Duozoulu' },
  { pattern: /BYRON RED\s?STAR/i, displayName: 'Byron Red Star' },
  { pattern: /ADVENTURE POINT/i, displayName: 'Adventure Point' },
  { pattern: /PHOTO MAGIC/i, displayName: 'Photo Magic' },
  { pattern: /STN WDF/i, displayName: 'Stansted Airport WDF' },
  { pattern: /BALFOUR KINGSTON/i, displayName: 'Balfour Kingston' },
  { pattern: /BIRD NETHERLANDS/i, displayName: 'Bird (e-scooter)' },
  { pattern: /ROMFORD ESSEX/i, displayName: 'Romford Market' },

  // Shopping - additional
  { pattern: /BLACK OUD/i, displayName: 'Black Oud Perfumes' },
  { pattern: /POMVOM/i, displayName: 'Pomvom UK' },
  { pattern: /MOTHER GROUP/i, displayName: 'Mother Group' },

  // Property - additional
  { pattern: /JS-LAW/i, displayName: 'JS Law' },
  { pattern: /CLEANSATION/i, displayName: 'Cleansation' },

  // Transfers
  { pattern: /DAVID MORRISON/i, displayName: 'David Morrison' },
  { pattern: /HEENA TAILOR|HEENA MORRISON/i, displayName: 'Heena Tailor' },
  { pattern: /MONZO JOINT/i, displayName: 'Monzo Joint' },
  { pattern: /NATWEST/i, displayName: 'NatWest' },
  { pattern: /AUTONIZE/i, displayName: 'Autonize IT' },
  { pattern: /TRANSFERWISE/i, displayName: 'Wise (TransferWise)' },
  { pattern: /OPTIONAL FT/i, displayName: 'Internal Transfer' },
  { pattern: /VIA MOBILE.*PYMT|VIA MOBILE.*LVP/i, displayName: 'Mobile Transfer' },
  { pattern: /ROYAL BANK \d{2}/i, displayName: 'Royal Bank Transfer' },
  { pattern: /BMACH \d{2}/i, displayName: 'BMACH Transfer' },
  { pattern: /BALANCE TRANSACTION/i, displayName: 'Balance Transaction' },

  // Income sources
  { pattern: /\bRENTAL\b|\bRENT\b(?!.*WOOD)/i, displayName: 'Rental Income' },
  { pattern: /SALARY|DIVIDEND/i, displayName: 'Salary / Dividends' },
];

// ─── Fallback cleanup ────────────────────────────────────────────────────────
// For descriptions that don't match any known merchant, strip noise and title-case.

const NOISE_PATTERNS = [
  /\s{2,}/g,                          // collapse whitespace
  /\b\d{4,}\b/g,                      // card/reference numbers (4+ digits)
  /\bREF[:\s]?\S+/gi,                 // REF: xxxxx
  /\b(GBR|GBP|USD|EUR|AED)\b/gi,     // currency/country codes
  /\b(DIRECT DEBIT|FASTER PAYMENT|STANDING ORDER|CARD PAYMENT)\b/gi,
  /\b(DD|STO|FP|CR|DR|BGC)\b/g,      // common banking abbreviations at word boundary
  /[,\/\\]+/g,                        // stray punctuation
];

function cleanFallback(description: string): string {
  let cleaned = description;
  for (const pat of NOISE_PATTERNS) {
    cleaned = cleaned.replace(pat, ' ');
  }
  cleaned = cleaned.trim().replace(/\s+/g, ' ');

  if (cleaned.length === 0) return description.trim();

  // Take the first meaningful segment (before location info)
  const segments = cleaned.split(/\s{2,}/);
  const core = segments[0] ?? cleaned;

  return toTitleCase(core.slice(0, 40));
}

function toTitleCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/(?:^|\s)\S/g, c => c.toUpperCase())
    .trim();
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Strip NatWest-style commas so multi-word merchant patterns
 * (e.g. "SUMUP *BYRON RED , STAR") match correctly.
 */
function normalizeForMatching(raw: string): string {
  return raw
    .replace(/[,\/\\]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function normalizeMerchant(description: string): string {
  const normalized = normalizeForMatching(description);
  for (const rule of MERCHANT_RULES) {
    if (rule.pattern.test(normalized)) {
      return rule.displayName;
    }
  }
  return cleanFallback(description);
}
