// worker/src/geocoding.ts
// Geocoding via Nominatim (OpenStreetMap) -- gratuito, sem chave de API,
// mas com limite estrito de 1 pedido/segundo e exigência de User-Agent
// identificável (ver https://operations.osmfoundation.org/policies/nominatim/).
// O Worker chama isto pontualmente (registo de novo concessionário, ou
// admin a pedir manualmente), nunca em lote automático -- por isso o
// limite de 1 req/s nunca chega a ser um problema real aqui.

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "pecas-renault/1.0 (https://github.com/rubsil/pecas-renault)";

export interface GeocodeResult {
  lat: number;
  lon: number;
  displayName: string;
}

/**
 * Tenta geocodificar uma morada portuguesa. Sem chave de API, sem
 * custo. Devolve null se não encontrar nada -- é normal para moradas
 * mal formatadas ou muito específicas (ex: "Zona Industrial Lote 7");
 * nesse caso vale tentar com menos detalhe (só cidade + código postal).
 *
 * companyName é opcional -- quando dado, tenta "nome da empresa,
 * cidade" logo a seguir à morada completa. Nomes de empresas às vezes
 * estão indexados no OSM como pontos de interesse (POI) e dão um
 * resultado mais preciso do que a morada em texto livre, sobretudo
 * para moradas tipo "Zona Industrial X, Lote Y" que o OSM não indexa
 * ao pormenor do lote.
 */
export async function geocodeAddress(
  address: string | null,
  postalCode: string | null,
  city: string | null,
  companyName: string | null = null
): Promise<GeocodeResult | null> {
  const attempts: string[] = [];

  if (address && postalCode && city) {
    attempts.push(`${address}, ${postalCode} ${city}, Portugal`);
  }
  if (companyName && city) {
    attempts.push(`${companyName}, ${city}, Portugal`);
  }
  if (postalCode && city) {
    attempts.push(`${postalCode} ${city}, Portugal`);
  }
  if (city) {
    attempts.push(`${city}, Portugal`);
  }

  for (const query of attempts) {
    const result = await tryGeocode(query);
    if (result) return result;
  }

  return null;
}

async function tryGeocode(query: string): Promise<GeocodeResult | null> {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("countrycodes", "pt");
  url.searchParams.set("limit", "1");

  try {
    const response = await fetch(url.toString(), {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!response.ok) return null;

    const rows = await response.json<any[]>();
    if (!rows || rows.length === 0) return null;

    const row = rows[0];
    const lat = parseFloat(row.lat);
    const lon = parseFloat(row.lon);
    if (isNaN(lat) || isNaN(lon)) return null;

    return { lat, lon, displayName: row.display_name || query };
  } catch {
    return null;
  }
}

/**
 * Distância em linha reta entre duas coordenadas, em km (fórmula de
 * Haversine). Não é distância de estrada -- é aproximação suficiente
 * para "concessionário mais perto", não para navegação GPS.
 */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // raio médio da Terra em km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Pausa simples, usada entre pedidos consecutivos ao Nominatim para
 *  respeitar o limite de 1 pedido/segundo da política de uso deles. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
