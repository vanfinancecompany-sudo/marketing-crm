// Rent2Buy coverage for Facebook group discovery.
// Rent2Buy is available within 100 driving miles of the base postcode SO40 2NN
// (the Rent2Buy site's /api/rent2buy-distance check). Road miles below were measured
// with that endpoint (OSRM) on 28 Nov 2026 for every place near the edge; places
// without a figure are comfortably inside (under ~70 straight-line miles).
// Discovery searches every place within the same 100-mile eligibility limit, and any
// place in this list counts as local when matching.

export const RENT2BUY_BASE = Object.freeze({ postcode: "SO40 2NN", lat: 50.935, lon: -1.509 });
export const RENT2BUY_MAX_ROAD_MILES = 100;
export const DISCOVERY_MAX_ROAD_MILES = RENT2BUY_MAX_ROAD_MILES;

// [place, latitude, longitude, county, measured road miles or null, extra match words]
const PLACES = [
  ["Southampton", 50.9097, -1.4044, "Hampshire", 11.5], ["Eastleigh", 50.967, -1.350, "Hampshire"],
  ["Chandler's Ford", 50.984, -1.385, "Hampshire"], ["Totton", 50.918, -1.490, "Hampshire"],
  ["Romsey", 50.989, -1.497, "Hampshire"], ["Hedge End", 50.912, -1.300, "Hampshire"],
  ["Bishop's Waltham", 50.955, -1.212, "Hampshire"], ["Winchester", 51.063, -1.308, "Hampshire"],
  ["Fareham", 50.852, -1.179, "Hampshire"], ["Gosport", 50.795, -1.124, "Hampshire"],
  ["Portsmouth", 50.819, -1.088, "Hampshire", null, ["pompey"]], ["Havant", 50.856, -0.982, "Hampshire"],
  ["Waterlooville", 50.880, -1.030, "Hampshire"], ["Petersfield", 51.003, -0.938, "Hampshire"],
  ["Andover", 51.211, -1.492, "Hampshire"], ["Basingstoke", 51.266, -1.087, "Hampshire"],
  ["Alton", 51.149, -0.973, "Hampshire"], ["Farnborough", 51.294, -0.756, "Hampshire"],
  ["Aldershot", 51.248, -0.763, "Hampshire"], ["Fleet", 51.281, -0.840, "Hampshire"],
  ["Lymington", 50.758, -1.541, "Hampshire"], ["New Milton", 50.756, -1.665, "Hampshire"],
  ["Ringwood", 50.847, -1.789, "Hampshire"], ["Fordingbridge", 50.927, -1.791, "Hampshire"],
  ["New Forest", 50.870, -1.600, "Hampshire"],
  ["Isle of Wight", 50.700, -1.292, "Isle of Wight", null, ["iow", "newport iow"]], ["Ryde", 50.730, -1.160, "Isle of Wight"],
  ["Cowes", 50.762, -1.298, "Isle of Wight"], ["Sandown", 50.651, -1.161, "Isle of Wight", null, ["shanklin"]],
  ["Bournemouth", 50.720, -1.880, "Dorset"], ["Poole", 50.715, -1.987, "Dorset"],
  ["Christchurch", 50.735, -1.778, "Dorset"], ["Wimborne", 50.800, -1.988, "Dorset"],
  ["Ferndown", 50.807, -1.900, "Dorset"], ["Wareham", 50.686, -2.110, "Dorset"],
  ["Swanage", 50.608, -1.960, "Dorset"], ["Blandford", 50.856, -2.165, "Dorset"],
  ["Dorchester", 50.715, -2.437, "Dorset"], ["Weymouth", 50.614, -2.457, "Dorset", 52.2, ["portland"]],
  ["Shaftesbury", 51.005, -2.198, "Dorset"], ["Gillingham Dorset", 51.038, -2.276, "Dorset"],
  ["Sherborne", 50.947, -2.517, "Dorset"], ["Bridport", 50.733, -2.758, "Dorset", 59.4],
  ["Lyme Regis", 50.725, -2.937, "Dorset", 70],
  ["Salisbury", 51.069, -1.795, "Wiltshire"], ["Amesbury", 51.173, -1.780, "Wiltshire"],
  ["Tidworth", 51.237, -1.663, "Wiltshire"], ["Warminster", 51.205, -2.181, "Wiltshire"],
  ["Westbury", 51.260, -2.185, "Wiltshire"], ["Trowbridge", 51.319, -2.208, "Wiltshire"],
  ["Devizes", 51.350, -1.994, "Wiltshire"], ["Melksham", 51.373, -2.138, "Wiltshire"],
  ["Chippenham", 51.458, -2.116, "Wiltshire", 53.5], ["Calne", 51.438, -2.004, "Wiltshire"],
  ["Marlborough", 51.420, -1.729, "Wiltshire"], ["Swindon", 51.558, -1.781, "Wiltshire", 69.6],
  ["Bath", 51.381, -2.359, "Somerset", 58], ["Frome", 51.229, -2.320, "Somerset"],
  ["Yeovil", 50.942, -2.633, "Somerset", 63.5], ["Shepton Mallet", 51.190, -2.546, "Somerset"],
  ["Wells", 51.209, -2.647, "Somerset"], ["Glastonbury", 51.148, -2.714, "Somerset", 67.2, ["street somerset"]],
  ["Midsomer Norton", 51.285, -2.484, "Somerset", null, ["radstock"]], ["Keynsham", 51.413, -2.497, "Somerset"],
  ["Bristol", 51.454, -2.588, "Bristol", 70.4], ["Weston-super-Mare", 51.346, -2.977, "Somerset", 85.5, ["weston super mare", "wsm"]],
  ["Bridgwater", 51.128, -3.003, "Somerset", 82.2], ["Taunton", 51.015, -3.103, "Somerset", 88.5],
  ["Chard", 50.872, -2.966, "Somerset", 72.9], ["Wellington Somerset", 50.979, -3.225, "Somerset", 93.2],
  ["Reading", 51.454, -0.978, "Berkshire"], ["Newbury", 51.401, -1.323, "Berkshire"],
  ["Thatcham", 51.403, -1.261, "Berkshire"], ["Hungerford", 51.414, -1.515, "Berkshire"],
  ["Wokingham", 51.411, -0.833, "Berkshire"], ["Bracknell", 51.416, -0.751, "Berkshire"],
  ["Maidenhead", 51.522, -0.719, "Berkshire"], ["Windsor", 51.483, -0.604, "Berkshire"],
  ["Slough", 51.510, -0.595, "Berkshire"],
  ["Guildford", 51.236, -0.570, "Surrey"], ["Woking", 51.319, -0.558, "Surrey"],
  ["Camberley", 51.337, -0.742, "Surrey"], ["Farnham", 51.215, -0.799, "Surrey"],
  ["Godalming", 51.186, -0.615, "Surrey"], ["Haslemere", 51.090, -0.712, "Surrey"],
  ["Epsom", 51.336, -0.268, "Surrey"], ["Redhill", 51.240, -0.170, "Surrey"],
  ["Reigate", 51.237, -0.206, "Surrey"], ["Dorking", 51.232, -0.331, "Surrey"],
  ["Leatherhead", 51.296, -0.329, "Surrey"], ["Staines", 51.434, -0.511, "Surrey"],
  ["Weybridge", 51.372, -0.457, "Surrey"],
  ["Chichester", 50.837, -0.780, "West Sussex"], ["Bognor Regis", 50.783, -0.674, "West Sussex"],
  ["Littlehampton", 50.811, -0.540, "West Sussex"], ["Worthing", 50.818, -0.372, "West Sussex", 64.3],
  ["Horsham", 51.062, -0.325, "West Sussex"], ["Crawley", 51.109, -0.187, "West Sussex", 87.1],
  ["Haywards Heath", 51.000, -0.105, "West Sussex"], ["Burgess Hill", 50.955, -0.130, "West Sussex"],
  ["Midhurst", 50.986, -0.738, "West Sussex"], ["East Grinstead", 51.125, -0.007, "West Sussex", 99.4],
  ["Brighton", 50.822, -0.137, "East Sussex", 75.9], ["Hove", 50.827, -0.169, "East Sussex"],
  ["Lewes", 50.874, 0.009, "East Sussex", 82.5], ["Newhaven", 50.795, 0.055, "East Sussex", 89.1],
  ["Uckfield", 50.969, 0.096, "East Sussex", 91.3], ["Eastbourne", 50.768, 0.290, "East Sussex", 99.7],
  ["Oxford", 51.752, -1.258, "Oxfordshire", 72.5], ["Abingdon", 51.671, -1.283, "Oxfordshire"],
  ["Didcot", 51.608, -1.241, "Oxfordshire"], ["Wantage", 51.588, -1.426, "Oxfordshire"],
  ["Wallingford", 51.600, -1.125, "Oxfordshire"], ["Henley-on-Thames", 51.536, -0.903, "Oxfordshire", null, ["henley"]],
  ["Witney", 51.786, -1.485, "Oxfordshire", 79.7], ["Bicester", 51.900, -1.154, "Oxfordshire", 86],
  ["Thame", 51.745, -0.976, "Oxfordshire"], ["Banbury", 52.063, -1.340, "Oxfordshire", 99.8],
  ["Cirencester", 51.718, -1.968, "Gloucestershire"], ["Stroud", 51.745, -2.217, "Gloucestershire", 95.6],
  ["Cheltenham", 51.899, -2.078, "Gloucestershire", 98.1],
  ["High Wycombe", 51.628, -0.748, "Buckinghamshire", 74.8], ["Marlow", 51.571, -0.776, "Buckinghamshire"],
  ["Beaconsfield", 51.611, -0.644, "Buckinghamshire"], ["Amersham", 51.674, -0.607, "Buckinghamshire"],
  ["Aylesbury", 51.816, -0.812, "Buckinghamshire", 95.1],
  ["London", 51.507, -0.128, "London", 85.4], ["Croydon", 51.376, -0.098, "London", 88.7],
  ["Kingston", 51.412, -0.300, "London"], ["Richmond", 51.461, -0.303, "London"],
  ["Hounslow", 51.468, -0.361, "London"], ["Ealing", 51.513, -0.305, "London"],
  ["Uxbridge", 51.546, -0.479, "London", 77.7], ["Sutton", 51.361, -0.193, "London"],
  ["Wimbledon", 51.421, -0.206, "London"], ["Harrow", 51.580, -0.341, "London", 80.2],
  ["Watford", 51.656, -0.390, "Hertfordshire", 88.3], ["St Albans", 51.752, -0.336, "Hertfordshire", 92.7],
  ["Exeter", 50.718, -3.534, "Devon", 99.4],
];

// Whole counties that sit inside the coverage area for search purposes.
export const RENT2BUY_COVERAGE_COUNTIES = Object.freeze([
  "Hampshire", "Isle of Wight", "Dorset", "Wiltshire", "Berkshire", "Surrey", "West Sussex", "Somerset", "Oxfordshire",
]);

const R = 3958.8;
const rad = (degrees) => (degrees * Math.PI) / 180;
export function straightLineMiles(lat, lon, from = RENT2BUY_BASE) {
  const dLat = rad(lat - from.lat);
  const dLon = rad(lon - from.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(from.lat)) * Math.cos(rad(lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const RENT2BUY_COVERAGE_PLACES = Object.freeze(PLACES.map(([name, lat, lon, county, roadMiles = null, aliases = []]) => Object.freeze({
  name, lat, lon, county, roadMiles, aliases: Object.freeze(aliases),
  straightMiles: Math.round(straightLineMiles(lat, lon) * 10) / 10,
})));

function matchText(value) {
  return ` ${String(value ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;
}

function placeTerms(place) {
  const base = place.name.replace(/ (?:Dorset|Somerset)$/, "");
  return [base, ...place.aliases].map((term) => matchText(term).trim()).filter(Boolean);
}

const COVERAGE_TERMS = [...new Set([
  ...RENT2BUY_COVERAGE_PLACES.flatMap(placeTerms),
  ...RENT2BUY_COVERAGE_COUNTIES.map((county) => matchText(county).trim()),
  "solent", "south coast", "sussex", "hants",
])];

// Clearly outside the 100-mile area (or not in the UK). Used only to reject a search
// result whose own name/description places it elsewhere.
const OUTSIDE_TERMS = [
  "birmingham", "west midlands", "midlands", "manchester", "salford", "liverpool", "merseyside", "leeds", "sheffield",
  "newcastle", "sunderland", "hull", "nottingham", "leicester", "coventry", "wolverhampton", "stoke", "derby", "bradford",
  "york", "yorkshire", "lancashire", "preston", "blackpool", "cumbria", "cheshire", "wales", "welsh", "cardiff", "swansea",
  "newport wales", "pembrokeshire", "scotland", "glasgow", "edinburgh", "aberdeen", "dundee", "ireland", "belfast", "dublin",
  "cornwall", "plymouth", "torquay", "norfolk", "norwich", "suffolk", "ipswich", "essex", "chelmsford", "colchester",
  "cambridge", "peterborough", "northampton", "milton keynes", "bedford", "luton", "kent", "maidstone", "canterbury", "medway",
  "gloucester", "worcester", "hereford", "shropshire", "lincoln", "lincolnshire", "durham", "teesside", "middlesbrough",
  "new zealand", "nz", "australia", "usa", "canada", "cyprus", "spain", "portugal", "malta", "dubai", "nigeria", "ghana",
  "kenya", "india", "pakistan", "south africa",
].map((term) => matchText(term).trim());

const NATIONAL_TERMS = ["uk", "united kingdom", "nationwide", "uk wide", "all over uk", "england", "britain", "gb"]
  .map((term) => matchText(term).trim());

function containsTerm(text, terms) {
  return terms.some((term) => text.includes(` ${term} `));
}

export function mentionsCoveragePlace(...values) {
  return containsTerm(matchText(values.filter(Boolean).join(" ")), COVERAGE_TERMS);
}

export function mentionsOutsidePlace(...values) {
  return containsTerm(matchText(values.filter(Boolean).join(" ")), OUTSIDE_TERMS);
}

export function looksNational(...values) {
  return containsTerm(matchText(values.filter(Boolean).join(" ")), NATIONAL_TERMS);
}

// Group types searched in every place, broadest local audiences first.
export const RENT2BUY_DISCOVERY_CATEGORIES = Object.freeze([
  { term: "buy and sell", segment: "Local Marketplace" },
  { term: "vans for sale", segment: "Van/Vehicle" },
  { term: "marketplace", segment: "Local Marketplace" },
  { term: "cars and vans for sale", segment: "Van/Vehicle" },
  { term: "buy sell swap", segment: "Local Marketplace" },
  { term: "classifieds", segment: "Classifieds" },
  { term: "for sale and wanted", segment: "Local Marketplace" },
  { term: "trades", segment: "Trades" },
  { term: "local business", segment: "Local Business" },
]);

function discoveryPlaces() {
  return RENT2BUY_COVERAGE_PLACES
    .filter((place) => (place.roadMiles ?? place.straightMiles * 1.25) <= DISCOVERY_MAX_ROAD_MILES)
    .sort((a, b) => (a.roadMiles ?? a.straightMiles * 1.25) - (b.roadMiles ?? b.straightMiles * 1.25));
}

const searchName = (place) => place.name;

// County searches first, then each group type across every place, nearest first.
export function buildRent2BuyDiscoveryQueries() {
  const queries = [];
  for (const county of RENT2BUY_COVERAGE_COUNTIES) {
    for (const category of RENT2BUY_DISCOVERY_CATEGORIES.slice(0, 4)) {
      queries.push({ query: `${county} ${category.term}`, segment: category.segment, area: county });
    }
  }
  const places = discoveryPlaces();
  for (const category of RENT2BUY_DISCOVERY_CATEGORIES) {
    for (const place of places) {
      queries.push({ query: `${searchName(place)} ${category.term}`, segment: category.segment, area: place.name });
    }
  }
  return queries;
}
