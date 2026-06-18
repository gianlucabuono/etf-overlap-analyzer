/**
 * Vercel Serverless Function — /api/fetch-justetf
 *
 * Scrapa la pagina JustETF per un dato ISIN ed estrae:
 *  - nome ETF, emittente, numero totale holdings
 *  - top 10 holdings con peso (unico dato disponibile gratuitamente)
 *  - allocazione geografica (top paesi con %)
 *  - allocazione settoriale (top settori con %)
 *  - peso totale coperto dalle top 10 holdings (coverage %)
 *
 * GET /api/fetch-justetf?isin=IE00B4L5Y983
 */

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
    // ── Scarica la pagina ETF da JustETF (versione EN) ──
    const url = `https://www.justetf.com/en/etf-profile.html?isin=${cleanIsin}`;
    const pageRes = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-GB,en;q=0.9",
        Referer: "https://www.justetf.com/en/find-etf.html",
      },
    });

    if (!pageRes.ok) {
      return res.status(502).json({ error: `JustETF ha risposto con ${pageRes.status}` });
    }

    const html = await pageRes.text();

    // ── Verifica che la pagina esista ──
    if (html.includes("No ETF found") || html.includes("not found") || !html.includes(cleanIsin)) {
      return res.status(404).json({ error: `ETF con ISIN ${cleanIsin} non trovato su JustETF` });
    }

    // ── Helper: estrai testo tra due stringhe ──
    function between(str, start, end, fromIndex = 0) {
      const s = str.indexOf(start, fromIndex);
      if (s === -1) return "";
      const e = str.indexOf(end, s + start.length);
      if (e === -1) return "";
      return str.substring(s + start.length, e).trim();
    }

    function stripTags(str) {
      return str.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }

    function decodeHtml(str) {
      return str
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ");
    }

    // ── Nome ETF ──
    let name = "";
    const titleMatch = html.match(/<h1[^>]*class="[^"]*h1[^"]*"[^>]*>([^<]+)<\/h1>/);
    if (titleMatch) name = decodeHtml(titleMatch[1].trim());
    if (!name) {
      const ogTitle = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/);
      if (ogTitle) name = decodeHtml(ogTitle[1].trim());
    }

    // ── Emittente ──
    let issuer = "";
    const issuerMatch = html.match(/Fund\s+provider[^<]*<[^>]+>([^<]+)<\/a>/i);
    if (issuerMatch) issuer = decodeHtml(issuerMatch[1].trim());
    if (!issuer) {
      // fallback: cerca "iShares", "Vanguard", "Amundi" ecc. nel nome
      const knownIssuers = ["iShares","Vanguard","Amundi","Xtrackers","SPDR","Invesco","WisdomTree","HSBC","Lyxor","BNP","Fidelity","PIMCO","Ossiam","VanEck"];
      for (const iss of knownIssuers) {
        if (name.includes(iss)) { issuer = iss; break; }
      }
    }

    // ── Numero totale holdings ──
    let totalHoldings = null;
    const holdingsCountMatch = html.match(/(\d[\d,]+)\s+(?:Holdings|components|securities)/i);
    if (holdingsCountMatch) totalHoldings = parseInt(holdingsCountMatch[1].replace(/,/g, ""), 10);
    // fallback: cerca nel blocco "Number of holdings"
    if (!totalHoldings) {
      const nhMatch = html.match(/Number of holdings[^<]*<[^>]*>(\d[\d,.]+)/i);
      if (nhMatch) totalHoldings = parseInt(nhMatch[1].replace(/[,. ]/g, ""), 10);
    }

    // ── Top 10 Holdings ──
    const holdings = [];

    // JustETF mostra le holdings in una tabella con classe "table"
    // Cerchiamo la sezione holdings
    const holdingsSection = (() => {
      // Cerca la tabella dopo "Top Holdings" o "Holdings"
      const markers = ["Top Holdings", "top-holdings", "holdings-table", "Fund holdings"];
      for (const marker of markers) {
        const idx = html.indexOf(marker);
        if (idx !== -1) return html.substring(idx, idx + 20000);
      }
      return "";
    })();

    if (holdingsSection) {
      // Estrai righe <tr> dalla tabella holdings
      const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let rowMatch;
      let rowCount = 0;
      while ((rowMatch = rowRegex.exec(holdingsSection)) !== null && rowCount < 12) {
        const row = rowMatch[1];
        // Estrai celle <td>
        const cells = [];
        const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let cellMatch;
        while ((cellMatch = cellRegex.exec(row)) !== null) {
          cells.push(decodeHtml(stripTags(cellMatch[1])));
        }
        if (cells.length >= 2) {
          // Prima cella: nome holding, ultima (o seconda): percentuale
          const name = cells[0].trim();
          // Cerca una cella con formato percentuale
          const pctCell = cells.find(c => /^\d+[.,]\d+\s*%?$/.test(c.trim())) || cells[cells.length - 1];
          const pctStr = pctCell.replace("%", "").replace(",", ".").trim();
          const weight = parseFloat(pctStr);
          if (name && !isNaN(weight) && weight > 0 && weight < 100) {
            holdings.push({ name: name.toUpperCase(), weight, sector: "N/D", country: "N/D" });
            rowCount++;
          }
        }
      }
    }

    // ── Allocazione geografica ──
    const geoAllocation = [];
    const geoSection = (() => {
      const markers = ["Country allocation", "country-allocation", "Geographic allocation", "Countries"];
      for (const marker of markers) {
        const idx = html.indexOf(marker);
        if (idx !== -1) return html.substring(idx, idx + 8000);
      }
      return "";
    })();

    if (geoSection) {
      const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let rowMatch;
      let count = 0;
      while ((rowMatch = rowRegex.exec(geoSection)) !== null && count < 15) {
        const cells = [];
        const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let cellMatch;
        while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
          cells.push(decodeHtml(stripTags(cellMatch[1])));
        }
        if (cells.length >= 2) {
          const country = cells[0].trim();
          const pctStr = (cells[1] || cells[cells.length - 1]).replace("%", "").replace(",", ".").trim();
          const weight = parseFloat(pctStr);
          if (country && !isNaN(weight) && weight > 0 && weight <= 100 && country.length > 1) {
            geoAllocation.push({ country, weight });
            count++;
          }
        }
      }
    }

    // ── Allocazione settoriale ──
    const sectorAllocation = [];
    const secSection = (() => {
      const markers = ["Sector allocation", "sector-allocation", "Sectors"];
      for (const marker of markers) {
        const idx = html.indexOf(marker);
        if (idx !== -1) return html.substring(idx, idx + 6000);
      }
      return "";
    })();

    if (secSection) {
      const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let rowMatch;
      let count = 0;
      while ((rowMatch = rowRegex.exec(secSection)) !== null && count < 12) {
        const cells = [];
        const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let cellMatch;
        while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
          cells.push(decodeHtml(stripTags(cellMatch[1])));
        }
        if (cells.length >= 2) {
          const sector = cells[0].trim();
          const pctStr = (cells[1] || cells[cells.length - 1]).replace("%", "").replace(",", ".").trim();
          const weight = parseFloat(pctStr);
          if (sector && !isNaN(weight) && weight > 0 && weight <= 100 && sector.length > 1) {
            sectorAllocation.push({ sector, weight });
            count++;
          }
        }
      }
    }

    // ── Coverage % ──
    const coveredWeight = holdings.reduce((s, h) => s + h.weight, 0);

    // ── Risposta ──
    return res.status(200).json({
      source: "justetf-partial",
      isin: cleanIsin,
      name,
      issuer,
      totalHoldings,
      holdings,               // max 10, con peso
      coveredWeight: parseFloat(coveredWeight.toFixed(2)),
      uncoveredWeight: parseFloat(Math.max(0, 100 - coveredWeight).toFixed(2)),
      geoAllocation,          // top paesi con %
      sectorAllocation,       // top settori con %
      url,
      warning: `⚠️ Dati parziali: JustETF fornisce solo le top ${holdings.length} holdings (${coveredWeight.toFixed(1)}% del peso totale). Il restante ${(100 - coveredWeight).toFixed(1)}% (circa ${totalHoldings ? totalHoldings - holdings.length : "N/D"} titoli) non è disponibile gratuitamente e non è incluso nell'analisi overlap.`,
    });

  } catch (err) {
    console.error("fetch-justetf error:", err);
    return res.status(500).json({ error: "Errore interno: " + err.message });
  }
}
