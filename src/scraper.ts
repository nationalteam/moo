import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

const TABELOG_SEARCH_URL = "https://tabelog.com/rstLst/";
const TABELOG_BASE_URL = "https://tabelog.com";

/** Map from radius in meters to Tabelog's "range" parameter value. */
const RANGE_MAP: Array<[number, number]> = [
  [300, 1],
  [500, 2],
  [1000, 3],
  [3000, 4],
  [5000, 5],
];

export interface Restaurant {
  name: string;
  url: string;
  score: number | null;
  genre: string;
  address: string;
  image: string;
  budget: string;
}

function tabelogRange(radiusMeters: number): number {
  for (const [threshold, rangeVal] of RANGE_MAP) {
    if (radiusMeters <= threshold) return rangeVal;
  }
  return 5;
}

function parseScore(text: string): number | null {
  const cleaned = text.trim();
  const val = parseFloat(cleaned);
  return isNaN(val) || val <= 0 ? null : val;
}

function parseCard($: cheerio.CheerioAPI, card: AnyNode): Restaurant | null {
  const $card = $(card);

  // Name & URL
  const nameTag =
    $card.find(".list-rst__rst-name-target").first() ||
    $card.find(".list-rst__rst-name a").first();
  const name = nameTag.text().trim();
  if (!name) return null;
  const href = nameTag.attr("href") ?? "";
  const url = href.startsWith("http") ? href : TABELOG_BASE_URL + href;

  // Score
  const scoreText =
    $card.find(".c-rating__val").first().text() ||
    $card.find(".list-rst__rating-val").first().text();
  const score = parseScore(scoreText);

  // Genre
  const genre =
    $card.find(".list-rst__category-item").first().text().trim() ||
    $card.find(".list-rst__cuisine-item").first().text().trim();

  // Address
  const address = $card.find(".list-rst__address").first().text().trim();

  // Thumbnail
  const imgTag = $card.find(".c-thumb img, .list-rst__image-wrap img").first();
  let image = imgTag.attr("data-src") ?? imgTag.attr("src") ?? "";
  if (image.startsWith("//")) image = "https:" + image;

  // Budget
  const budget = $card.find(".list-rst__budget-item").first().text().trim();

  return { name, url, score, genre, address, image, budget };
}

export async function fetchRestaurants(
  lat: number,
  lng: number,
  radiusMeters: number,
  minScore: number,
  maxPages = 3
): Promise<Restaurant[]> {
  const range = tabelogRange(radiusMeters);
  const results: Restaurant[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const params = new URLSearchParams({
      lat: String(lat),
      lng: String(lng),
      range: String(range),
      SrtT: "trend",
      Srt: "D",
      page: String(page),
    });

    const url = `${TABELOG_SEARCH_URL}?${params}`;

    let html: string;
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
            "AppleWebKit/537.36 (KHTML, like Gecko) " +
            "Chrome/124.0.0.0 Safari/537.36",
          "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          Referer: "https://tabelog.com/",
        },
      });
      if (!res.ok) break;
      html = await res.text();
    } catch {
      break;
    }

    const $ = cheerio.load(html);
    const cards = $("li.list-rst, .list-rst__wrap, article.list-rst").toArray();

    if (cards.length === 0) break;

    for (const card of cards) {
      const r = parseCard($, card);
      if (r && r.score !== null && r.score >= minScore) {
        results.push(r);
      }
    }

    // Stop if last page (partial result)
    if (cards.length < 20) break;

    // Polite delay between pages
    await new Promise((r) => setTimeout(r, 500));
  }

  return results;
}
