// Scarica tutte le carte da pokemontcg.io e salva prezzi + anagrafica su Supabase.
// Pensato per girare una volta al giorno via GitHub Actions (Node 18+, fetch nativo).

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const POKEMONTCG_API_KEY = process.env.POKEMONTCG_API_KEY; // opzionale ma consigliata

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mancano SUPABASE_URL o SUPABASE_SERVICE_KEY nelle variabili d'ambiente.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const PAGE_SIZE = 250;
const BASE_URL = "https://api.pokemontcg.io/v2/cards";
const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

// Sceglie il primo prezzo TCGPlayer disponibile tra le varianti (holofoil, normal, ecc.)
function extractUsdPrice(card) {
  const prices = card.tcgplayer?.prices;
  if (!prices) return null;
  for (const variant of Object.values(prices)) {
    if (variant?.market != null) return variant.market;
  }
  return null;
}

// Cardmarket: trendPrice è il riferimento standard usato dalla community per il "valore attuale"
function extractEurPrice(card) {
  return card.cardmarket?.prices?.trendPrice ?? null;
}

async function fetchPage(page) {
  const url = `${BASE_URL}?page=${page}&pageSize=${PAGE_SIZE}`;
  const headers = POKEMONTCG_API_KEY ? { "X-Api-Key": POKEMONTCG_API_KEY } : {};

  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, { headers });
    if (res.ok) return res.json();
    if (res.status === 429) {
      console.warn(`Rate limit alla pagina ${page}, riprovo tra ${attempt * 2}s...`);
      await new Promise((r) => setTimeout(r, attempt * 2000));
      continue;
    }
    throw new Error(`Errore HTTP ${res.status} alla pagina ${page}`);
  }
  throw new Error(`Troppi tentativi falliti alla pagina ${page}`);
}

async function run() {
  let page = 1;
  let totalCards = 0;
  let totalWithPrice = 0;

  while (true) {
    const data = await fetchPage(page);
    const cards = data.data;
    if (!cards || cards.length === 0) break;

    const cardRows = [];
    const priceRows = [];

    for (const card of cards) {
      cardRows.push({
        card_id: card.id,
        name: card.name,
        number: card.number,
        set_name: card.set?.name ?? null,
        set_total: card.set?.printedTotal?.toString() ?? null,
        image_small: card.images?.small ?? null,
        updated_at: new Date().toISOString(),
      });

      const usd = extractUsdPrice(card);
      const eur = extractEurPrice(card);
      if (usd != null || eur != null) {
        priceRows.push({
          card_id: card.id,
          snapshot_date: today,
          price_usd: usd,
          price_eur: eur,
        });
        totalWithPrice++;
      }
    }

    const { error: cardsError } = await supabase.from("trend_cards").upsert(cardRows);
    if (cardsError) console.error("Errore upsert trend_cards:", cardsError.message);

    const { error: pricesError } = await supabase.from("trend_prices").upsert(priceRows);
    if (pricesError) console.error("Errore upsert trend_prices:", pricesError.message);

    totalCards += cards.length;
    console.log(`Pagina ${page}: ${cards.length} carte processate (totale finora: ${totalCards})`);

    if (page * PAGE_SIZE >= data.totalCount) break;
    page++;
  }

  console.log(`Fatto. Carte totali: ${totalCards}, con almeno un prezzo: ${totalWithPrice}, data snapshot: ${today}`);
}

run().catch((err) => {
  console.error("Errore fatale:", err);
  process.exit(1);
});
