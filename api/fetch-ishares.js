/**
 * Vercel Serverless Function — /api/fetch-ishares
 *
 * Risolve l'ISIN iShares nel CSV completo delle holdings aggirando il CORS.
 *
 * Flusso:
 *  1. Cerca l'ISIN nel product-list JSON di iShares.com/uk
 *  2. Ricava productPageUrl + localExchangeTicker
 *  3. Costruisce l'URL .ajax?fileType=csv e lo scarica
 *  4. Restituisce il CSV grezzo al client
 *
 * GET /api/fetch-ishares?isin=IE00B4L5Y983
 */

export default async function handler(req, res) {
  // CORS – consenti richieste dal frontend Vercel
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { isin } = req.query;
  if (!isin || !/^[A-Z]{2}[A-Z0-9]{10}$/.test(isin.trim())) {
    return res.status(400).json({ error: "ISIN non valido" });
  }

  try {
    // ── Step 1: recupera il product-list JSON di iShares UK ──
    const listUrl =
      "https://www.ishares.com/uk/individual/en/products/etf-product-list#/?isChartDate=1&isPrimary=true&startDate=20000101&endDate=&page=1&pageSize=250&type=FixedIncome,Equity,MultiAsset,Alternatives&loc=GB&idiom=en";

    const listRes = await fetch(listUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        Accept: "application/json, text/plain, */*",
        Referer: "https://www.ishares.com/uk/",
      },
    });

    // iShares restituisce HTML con JSON embedded — proviamo anche l'endpoint diretto
    let productData = null;

    // Endpoint alternativo più stabile: screener API
    const screenerUrl = `https://www.ishares.com/uk/individual/en/products/etf-product-list/1506575576011.ajax?isin=${isin.trim()}&tab=overview&fileType=json`;
    const screenerRes = await fetch(screenerUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        Accept: "application/json",
        Referer: `https://www.ishares.com/uk/individual/en/products/etf-product-list`,
      },
    });

    // ── Step 2: proviamo il screener JSON iShares ──
    let productPageUrl = null;
    let ticker = null;
    let siteTimestamp = "1521771080935"; // timestamp fisso comune agli ETF UCITS UK

    if (screenerRes.ok) {
      try {
        const json = await screenerRes.json();
        // La risposta ha struttura { aaData: [ [...cols] ] }
        const rows = json?.aaData || [];
        const row = rows.find((r) => {
          // colonna ISIN tipicamente index 4 o cerca nel record
          return JSON.stringify(r).includes(isin.trim());
        });
        if (row) {
          // productPageUrl è tipicamente index 0 in formato "/uk/individual/en/products/XXXX/name"
          productPageUrl = row[0]?.replace(/^.*href="([^"]+)".*$/, "$1");
          ticker = row[1] || "";
        }
      } catch (_) { /* ignora */ }
    }

    // ── Step 3: fallback – costruiamo URL da pattern noto ──
    // Pattern URL iShares UCITS UK:
    // https://www.ishares.com/uk/individual/en/products/{productId}/{slug}/{timestamp}.ajax?fileType=csv&fileName={TICKER}_holdings&dataType=fund
    //
    // Non conoscendo productId dall'ISIN direttamente, usiamo il mapping
    // via pagina prodotto cercando l'ISIN nel meta o nel redirect.

    if (!productPageUrl) {
      // Proviamo la ricerca full-text nella pagina prodotti
      const searchRes = await fetch(
        `https://www.ishares.com/uk/individual/en/products/etf-product-list/1506575576011.ajax?sEcho=1&iColumns=9&iDisplayStart=0&iDisplayLength=25&mDataProp_0=0&mDataProp_1=1&mDataProp_2=2&mDataProp_3=3&mDataProp_4=4&mDataProp_5=5&mDataProp_6=6&mDataProp_7=7&mDataProp_8=8&sSearch=${isin.trim()}&bRegex=false`,
        {
          headers: {
            "User-Agent": "Mozilla/5.0 Chrome/124",
            Accept: "application/json",
            Referer: "https://www.ishares.com/uk/individual/en/products/etf-product-list",
            "X-Requested-With": "XMLHttpRequest",
          },
        }
      );
      if (searchRes.ok) {
        try {
          const json = await searchRes.json();
          const rows = json?.aaData || [];
          if (rows.length > 0) {
            const row = rows[0];
            // row[0] contiene HTML con href
            const match = String(row[0]).match(/href="([^"]+)"/);
            if (match) productPageUrl = match[1];
            // ticker può essere in row[1] o row[2]
            ticker = String(row[1] || row[2] || "").replace(/<[^>]+>/g, "").trim();
          }
        } catch (_) { /* ignora */ }
      }
    }

    if (!productPageUrl) {
      return res.status(404).json({
        error: "ETF non trovato su iShares UK. Potrebbe non essere un ETF iShares o l'ISIN potrebbe essere di un altro emittente.",
        suggestion: "justetf",
      });
    }

    // Normalizza URL
    if (productPageUrl.startsWith("/")) {
      productPageUrl = "https://www.ishares.com" + productPageUrl;
    }

    // Estrai l'ID numerico dall'URL: /uk/individual/en/products/251882/ishares-...
    const productIdMatch = productPageUrl.match(/\/products\/(\d+)\//);
    if (!productIdMatch) {
      return res.status(500).json({ error: "Impossibile estrarre product ID dall'URL: " + productPageUrl });
    }
    const productId = productIdMatch[1];

    // ── Step 4: scarica il CSV ──
    // Il timestamp cambia per emittente/sito; per UK è 1521771080935
    // Per DE è 1478358465952, per US è 1467271812596
    // Proviamo UK first
    const csvUrl = `https://www.ishares.com/uk/individual/en/products/${productId}/${siteTimestamp}.ajax?fileType=csv&fileName=${ticker || isin}_holdings&dataType=fund`;

    const csvRes = await fetch(csvUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        Accept: "text/csv,*/*",
        Referer: productPageUrl,
      },
    });

    if (!csvRes.ok) {
      return res.status(502).json({
        error: `iShares ha risposto con ${csvRes.status}. L'ETF potrebbe non essere disponibile su iShares UK.`,
        suggestion: "justetf",
      });
    }

    const csvText = await csvRes.text();

    // Verifica minima che sia un CSV valido con holdings
    if (!csvText.includes("Weight") && !csvText.includes("Name") && !csvText.includes("Ticker")) {
      return res.status(502).json({
        error: "La risposta di iShares non contiene un CSV valido.",
        suggestion: "justetf",
      });
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("X-ETF-Source", "ishares-full");
    res.setHeader("X-Product-URL", productPageUrl);
    return res.status(200).send(csvText);

  } catch (err) {
    console.error("fetch-ishares error:", err);
    return res.status(500).json({ error: "Errore interno: " + err.message, suggestion: "justetf" });
  }
}
