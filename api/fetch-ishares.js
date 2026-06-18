/**
 * Vercel Serverless Function — /api/fetch-ishares
 *
 * Strategia multi-sito:
 *  1. Cerca l'ISIN nel product screener su UK, DE, CH in parallelo
 *  2. Prova anche una ricerca diretta tramite il product finder globale BlackRock
 *  3. Una volta trovato il productId, prova a scaricare il CSV da tutti i siti
 *  4. Restituisce il CSV grezzo al client
 *
 * GET /api/fetch-ishares?isin=IE00B4L5Y983
 */

const ISHARES_SITES = [
  {
    locale: "uk",
    base: "https://www.ishares.com/uk/individual/en",
    timestamp: "1521771080935",
    referer: "https://www.ishares.com/uk/",
  },
  {
    locale: "de",
    base: "https://www.ishares.com/de/individual/de",
    timestamp: "1478358465952",
    referer: "https://www.ishares.com/de/",
  },
  {
    locale: "ch",
    base: "https://www.ishares.com/ch/individual/en",
    timestamp: "1480581303174",
    referer: "https://www.ishares.com/ch/",
  },
  {
    locale: "it",
    base: "https://www.ishares.com/it/individual/it",
    timestamp: "1488816304069",
    referer: "https://www.ishares.com/it/",
  },
];

const HEADERS_BASE = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-GB,en;q=0.9",
};

async function searchScreener(site, isin) {
  // Endpoint screener DataTables iShares
  const url = `${site.base}/products/etf-product-list/1506575576011.ajax?sEcho=1&iColumns=9&iDisplayStart=0&iDisplayLength=25&sSearch=${encodeURIComponent(isin)}&bRegex=false`;
  try {
    const res = await fetch(url, {
      headers: { ...HEADERS_BASE, Referer: site.referer, "X-Requested-With": "XMLHttpRequest" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    // Potrebbe rispondere HTML se non autenticato — verifica
    if (!text.trim().startsWith("{")) return null;
    const json = JSON.parse(text);
    const rows = json?.aaData || [];
    for (const row of rows) {
      const rowStr = JSON.stringify(row);
      if (rowStr.includes(isin)) {
        // row[0] ha formato <a href="/uk/individual/en/products/XXXXX/...">NAME</a>
        const match = String(row[0]).match(/href="([^"]+)"/);
        if (match) {
          const productUrl = match[1].startsWith("http") ? match[1] : `https://www.ishares.com${match[1]}`;
          const idMatch = productUrl.match(/\/products\/(\d+)/);
          const ticker = String(row[1] || row[2] || "").replace(/<[^>]+>/g, "").trim();
          if (idMatch) return { productId: idMatch[1], productUrl, ticker, site };
        }
      }
    }
  } catch (_) {}
  return null;
}

async function tryDownloadCsv(productId, site, ticker, isin) {
  // Prova con il timestamp del sito corrente
  const csvUrl = `${site.base}/products/${productId}/${site.timestamp}.ajax?fileType=csv&fileName=${ticker || isin}_holdings&dataType=fund`;
  try {
    const res = await fetch(csvUrl, {
      headers: { ...HEADERS_BASE, Accept: "text/csv,*/*", Referer: `${site.base}/products/${productId}/` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (isValidCsv(text)) return text;
  } catch (_) {}
  return null;
}

function isValidCsv(text) {
  if (!text || text.length < 100) return false;
  const lower = text.toLowerCase();
  return (lower.includes("weight") || lower.includes("name") || lower.includes("ticker")) &&
         (lower.includes(",") || lower.includes(";"));
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { isin } = req.query;
  if (!isin || !/^[A-Z]{2}[A-Z0-9]{10}$/.test(isin.trim())) {
    return res.status(400).json({ error: "ISIN non valido" });
  }
  const cleanIsin = isin.trim().toUpperCase();

  try {
    // ── Step 1: cerca su tutti i siti iShares in parallelo ──
    console.log(`[fetch-ishares] Searching for ISIN ${cleanIsin} across ${ISHARES_SITES.length} sites...`);

    const searchResults = await Promise.all(ISHARES_SITES.map(site => searchScreener(site, cleanIsin)));
    const found = searchResults.find(r => r !== null);

    if (!found) {
      console.log(`[fetch-ishares] ISIN ${cleanIsin} not found on any iShares screener`);
      return res.status(404).json({
        error: `ETF non trovato su nessun sito iShares (UK, DE, CH, IT). Potrebbe essere un ETF di altro emittente.`,
        suggestion: "justetf",
      });
    }

    const { productId, productUrl, ticker, site: foundSite } = found;
    console.log(`[fetch-ishares] Found on ${foundSite.locale}: productId=${productId}, ticker=${ticker}`);

    // ── Step 2: scarica il CSV — prova prima il sito dove abbiamo trovato il prodotto,
    //           poi gli altri in ordine ──
    const sitesToTry = [foundSite, ...ISHARES_SITES.filter(s => s.locale !== foundSite.locale)];

    for (const site of sitesToTry) {
      console.log(`[fetch-ishares] Trying CSV download from ${site.locale}...`);
      const csvText = await tryDownloadCsv(productId, site, ticker, cleanIsin);
      if (csvText) {
        console.log(`[fetch-ishares] CSV downloaded from ${site.locale}, length=${csvText.length}`);
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("X-ETF-Source", "ishares-full");
        res.setHeader("X-Product-URL", productUrl);
        res.setHeader("X-iShares-Locale", site.locale);
        return res.status(200).send(csvText);
      }
    }

    // Nessun sito ha restituito un CSV valido
    return res.status(502).json({
      error: `Prodotto iShares trovato (ID: ${productId}) ma il CSV delle holdings non è disponibile. Prova a scaricare manualmente da iShares.`,
      productUrl,
      suggestion: "justetf",
    });

  } catch (err) {
    console.error("[fetch-ishares] error:", err);
    return res.status(500).json({ error: "Errore interno: " + err.message, suggestion: "justetf" });
  }
}