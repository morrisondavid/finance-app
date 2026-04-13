/**
 * Maps normalized merchant display names to their website domains,
 * enabling logo fetching via the Clearbit Logo API.
 *
 * The list is tested against the normalized names produced by
 * merchant-normalizer.ts (not raw bank descriptions).
 */

interface DomainRule {
  pattern: RegExp;
  domain: string;
}

const MERCHANT_DOMAINS: readonly DomainRule[] = [
  // Utilities
  { pattern: /^Scottish Power$/i, domain: 'scottishpower.co.uk' },
  { pattern: /^Octopus Energy$/i, domain: 'octopusenergy.com' },
  { pattern: /^British Gas$/i, domain: 'britishgas.co.uk' },
  { pattern: /^Thames Water$/i, domain: 'thameswater.co.uk' },
  { pattern: /^Virgin Media$/i, domain: 'virginmedia.com' },
  { pattern: /^EE$/i, domain: 'ee.co.uk' },
  { pattern: /^TV Licence$/i, domain: 'tvlicensing.co.uk' },
  { pattern: /^1pMobile$/i, domain: '1pmobile.com' },
  { pattern: /^Ring Security$/i, domain: 'ring.com' },
  { pattern: /^Water Plus$/i, domain: 'water-plus.co.uk' },
  { pattern: /^Severn Trent$/i, domain: 'stwater.co.uk' },

  // Insurance
  { pattern: /^Churchill/i, domain: 'churchill.com' },
  { pattern: /^LV Insurance$/i, domain: 'lv.com' },
  { pattern: /^AIG/i, domain: 'aig.co.uk' },
  { pattern: /^Aviva$/i, domain: 'aviva.co.uk' },
  { pattern: /^AXA Insurance$/i, domain: 'axa.co.uk' },
  { pattern: /^Direct Line$/i, domain: 'directline.com' },
  { pattern: /^Admiral$/i, domain: 'admiral.com' },
  { pattern: /^Kingsbridge/i, domain: 'kingsbridge.co.uk' },

  // Groceries
  { pattern: /^Tesco$/i, domain: 'tesco.com' },
  { pattern: /^Asda$/i, domain: 'asda.com' },
  { pattern: /^Sainsbury/i, domain: 'sainsburys.co.uk' },
  { pattern: /^Lidl$/i, domain: 'lidl.co.uk' },
  { pattern: /^Aldi$/i, domain: 'aldi.co.uk' },
  { pattern: /^Morrisons$/i, domain: 'morrisons.com' },
  { pattern: /^Co-op$/i, domain: 'coop.co.uk' },
  { pattern: /^Costco$/i, domain: 'costco.co.uk' },
  { pattern: /^Waitrose$/i, domain: 'waitrose.com' },
  { pattern: /^B&M$/i, domain: 'bmstores.co.uk' },
  { pattern: /^Ocado$/i, domain: 'ocado.com' },
  { pattern: /^Amazon Fresh$/i, domain: 'amazon.co.uk' },
  { pattern: /^M&S Food$/i, domain: 'marksandspencer.com' },
  { pattern: /^Iceland$/i, domain: 'iceland.co.uk' },
  { pattern: /^Budgens$/i, domain: 'budgens.co.uk' },

  // Eating Out
  { pattern: /^Deliveroo$/i, domain: 'deliveroo.co.uk' },
  { pattern: /^Just Eat$/i, domain: 'just-eat.co.uk' },
  { pattern: /^Uber Eats$/i, domain: 'ubereats.com' },
  { pattern: /^McDonald/i, domain: 'mcdonalds.com' },
  { pattern: /^KFC$/i, domain: 'kfc.co.uk' },
  { pattern: /^Nando/i, domain: 'nandos.co.uk' },
  { pattern: /^Wagamama$/i, domain: 'wagamama.com' },
  { pattern: /^Domino/i, domain: 'dominos.co.uk' },
  { pattern: /^Greggs$/i, domain: 'greggs.co.uk' },
  { pattern: /^Starbucks$/i, domain: 'starbucks.co.uk' },
  { pattern: /^Costa Coffee$/i, domain: 'costa.co.uk' },
  { pattern: /^Pret A Manger$/i, domain: 'pret.co.uk' },
  { pattern: /^Five Guys$/i, domain: 'fiveguys.co.uk' },
  { pattern: /^Papa John/i, domain: 'papajohns.co.uk' },
  { pattern: /^Slim Chickens$/i, domain: 'slimchickens.co.uk' },
  { pattern: /^Taco Bell$/i, domain: 'tacobell.co.uk' },
  { pattern: /^Krispy Kreme$/i, domain: 'krispykreme.co.uk' },
  { pattern: /^Cake Box$/i, domain: 'eggfreecake.co.uk' },
  { pattern: /^Beefeater$/i, domain: 'beefeater.co.uk' },
  { pattern: /^Joe & The Juice$/i, domain: 'joejuice.com' },
  { pattern: /^Chicken Cottage$/i, domain: 'chickencottage.com' },
  { pattern: /^Talabat$/i, domain: 'talabat.com' },
  { pattern: /^Zomato$/i, domain: 'zomato.com' },
  { pattern: /^Careem Food$/i, domain: 'careem.com' },
  { pattern: /^Careem Delivery$/i, domain: 'careem.com' },
  { pattern: /^Careem Quick$/i, domain: 'careem.com' },

  // Transport
  { pattern: /^Shell$/i, domain: 'shell.co.uk' },
  { pattern: /^BP$/i, domain: 'bp.com' },
  { pattern: /^Esso$/i, domain: 'esso.co.uk' },
  { pattern: /^Uber$/i, domain: 'uber.com' },
  { pattern: /^AA$/i, domain: 'theaa.com' },
  { pattern: /^RAC$/i, domain: 'rac.co.uk' },
  { pattern: /^TfL$/i, domain: 'tfl.gov.uk' },
  { pattern: /^Bolt$/i, domain: 'bolt.eu' },
  { pattern: /^Careem$/i, domain: 'careem.com' },

  // Travel
  { pattern: /^Emirates$/i, domain: 'emirates.com' },
  { pattern: /^Airbnb$/i, domain: 'airbnb.co.uk' },
  { pattern: /^Booking\.com$/i, domain: 'booking.com' },
  { pattern: /^Premier Inn$/i, domain: 'premierinn.com' },
  { pattern: /^easyJet$/i, domain: 'easyjet.com' },
  { pattern: /^Ryanair$/i, domain: 'ryanair.com' },
  { pattern: /^British Airways$/i, domain: 'britishairways.com' },
  { pattern: /^Aegean Airlines$/i, domain: 'aegeanair.com' },
  { pattern: /^Expedia$/i, domain: 'expedia.co.uk' },

  // Health & Personal
  { pattern: /^David Lloyd$/i, domain: 'davidlloyd.co.uk' },
  { pattern: /^Boots$/i, domain: 'boots.com' },
  { pattern: /^Specsavers$/i, domain: 'specsavers.co.uk' },
  { pattern: /^Superdrug$/i, domain: 'superdrug.com' },
  { pattern: /^PureGym$/i, domain: 'puregym.com' },
  { pattern: /^Pets at Home$/i, domain: 'petsathome.com' },

  // Entertainment
  { pattern: /^Netflix$/i, domain: 'netflix.com' },
  { pattern: /^Spotify$/i, domain: 'spotify.com' },
  { pattern: /^Disney\+$/i, domain: 'disneyplus.com' },
  { pattern: /^Apple$/i, domain: 'apple.com' },
  { pattern: /^Amazon Prime$/i, domain: 'amazon.co.uk' },
  { pattern: /^DAZN$/i, domain: 'dazn.com' },
  { pattern: /^YouTube Premium$/i, domain: 'youtube.com' },
  { pattern: /^PlayStation$/i, domain: 'playstation.com' },
  { pattern: /^Star Stable$/i, domain: 'starstable.com' },
  { pattern: /^Patreon$/i, domain: 'patreon.com' },
  { pattern: /^X \(Twitter\)$/i, domain: 'x.com' },
  { pattern: /^URLTV$/i, domain: 'urltv.tv' },
  { pattern: /^Steam Games$/i, domain: 'store.steampowered.com' },

  // Shopping
  { pattern: /^Amazon$/i, domain: 'amazon.co.uk' },
  { pattern: /^Primark$/i, domain: 'primark.com' },
  { pattern: /^eBay$/i, domain: 'ebay.co.uk' },
  { pattern: /^Argos$/i, domain: 'argos.co.uk' },
  { pattern: /^John Lewis$/i, domain: 'johnlewis.com' },
  { pattern: /^IKEA$/i, domain: 'ikea.com' },
  { pattern: /^Smyths Toys$/i, domain: 'smythstoys.com' },
  { pattern: /^Currys$/i, domain: 'currys.co.uk' },
  { pattern: /^Dunelm$/i, domain: 'dunelm.com' },
  { pattern: /^Hugo Boss$/i, domain: 'hugoboss.com' },
  { pattern: /^JD Sports$/i, domain: 'jdsports.co.uk' },
  { pattern: /^TK Maxx$/i, domain: 'tkmaxx.com' },
  { pattern: /^Sports Direct$/i, domain: 'sportsdirect.com' },
  { pattern: /^B&Q$/i, domain: 'diy.com' },
  { pattern: /^Screwfix$/i, domain: 'screwfix.com' },
  { pattern: /^Poundland$/i, domain: 'poundland.co.uk' },
  { pattern: /^WHSmith$/i, domain: 'whsmith.co.uk' },
  { pattern: /^Schuh$/i, domain: 'schuh.co.uk' },
  { pattern: /^Clarks$/i, domain: 'clarks.co.uk' },
  { pattern: /^Foot Locker$/i, domain: 'footlocker.co.uk' },
  { pattern: /^River Island$/i, domain: 'riverisland.com' },
  { pattern: /^Lacoste$/i, domain: 'lacoste.com' },
  { pattern: /^Timberland$/i, domain: 'timberland.co.uk' },
  { pattern: /^M&S$/i, domain: 'marksandspencer.com' },
  { pattern: /^Post Office$/i, domain: 'postoffice.co.uk' },
  { pattern: /^The Range$/i, domain: 'therange.co.uk' },
  { pattern: /^Wickes$/i, domain: 'wickes.co.uk' },

  // Debt Repayment
  { pattern: /^Halifax Mortgage$/i, domain: 'halifax.co.uk' },
  { pattern: /^Coventry Building/i, domain: 'coventrybuildingsociety.co.uk' },
  { pattern: /^Novuna/i, domain: 'novunapersonalfinance.com' },
  { pattern: /^Funding Circle$/i, domain: 'fundingcircle.com' },
  { pattern: /^Capital on Tap$/i, domain: 'capitalontap.com' },
  { pattern: /^Barclaycard$/i, domain: 'barclaycard.co.uk' },
  { pattern: /^Santander$/i, domain: 'santander.co.uk' },

  // Business / Tech
  { pattern: /^AWS$/i, domain: 'aws.amazon.com' },
  { pattern: /^GitHub$/i, domain: 'github.com' },
  { pattern: /^GoDaddy$/i, domain: 'godaddy.com' },
  { pattern: /^OpenAI$/i, domain: 'openai.com' },
  { pattern: /^Cloudflare$/i, domain: 'cloudflare.com' },
  { pattern: /^DigitalOcean$/i, domain: 'digitalocean.com' },
  { pattern: /^Cursor$/i, domain: 'cursor.com' },
  { pattern: /^Anthropic$/i, domain: 'anthropic.com' },
  { pattern: /^Adobe$/i, domain: 'adobe.com' },
  { pattern: /^Microsoft$/i, domain: 'microsoft.com' },
  { pattern: /^Google Cloud$/i, domain: 'cloud.google.com' },
  { pattern: /^Shopify$/i, domain: 'shopify.com' },
  { pattern: /^Proton$/i, domain: 'proton.me' },
  { pattern: /^Twilio$/i, domain: 'twilio.com' },
  { pattern: /^Veo Technologies$/i, domain: 'veo.co' },

  // Tax / Government
  { pattern: /^HMRC/i, domain: 'gov.uk' },
  { pattern: /^Companies House$/i, domain: 'gov.uk' },
  { pattern: /^Council Tax$/i, domain: 'gov.uk' },
];

const CLEARBIT_BASE = 'https://logo.clearbit.com';

export function getMerchantLogoUrl(merchantName: string): string | null {
  for (const rule of MERCHANT_DOMAINS) {
    if (rule.pattern.test(merchantName)) {
      return `${CLEARBIT_BASE}/${rule.domain}`;
    }
  }
  return null;
}
