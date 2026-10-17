// Live prices from Google Hotels via SerpApi (free tier: 250 searches/month, 50/hour).
// Google Hotels aggregates Booking.com, Agoda, Expedia, hotel sites, etc.
// Docs: https://serpapi.com/google-hotels-api
import { addDays } from './dates.js';
import { translateHotels } from './translate.js';

export function serpapiProvider(apiKey) {
  return {
    name: 'Google Hotels (SerpApi)',
    live: true,

    // One night (used for sampling prices across the calendar).
    async fetchNight({ city, date, ...rest }) {
      return this.fetchStay({ city, checkin: date, checkout: addDays(date, 1), ...rest });
    },

    // A whole stay: only hotels with rooms for every night come back with a price,
    // and total = the real price for the full stay. area narrows it (e.g. "Ueno").
    async fetchStay({ city, area, checkin, checkout, adults, currency, minStars }) {
      const params = new URLSearchParams({
        engine: 'google_hotels',
        q: area ? `hotels in ${area}, ${city}` : `hotels in ${city}`,
        check_in_date: checkin,
        check_out_date: checkout,
        adults: String(adults),
        currency,
        gl: 'us',
        hl: 'en', // ask Google for English names/descriptions
        api_key: apiKey,
      });
      if (minStars >= 2) {
        params.set('hotel_class', [2, 3, 4, 5].filter((s) => s >= minStars).join(','));
      }

      const res = await fetch(`https://serpapi.com/search.json?${params}`);
      const data = await res.json();
      if (!res.ok || data.error) {
        const err = new Error(`SerpApi: ${data.error || res.statusText}`);
        err.status = 502;
        throw err;
      }

      const hotels = (data.properties || [])
        .map((p) => ({
          id: p.property_token || p.name,
          name: p.name,
          lat: p.gps_coordinates?.latitude,
          lng: p.gps_coordinates?.longitude,
          price: p.rate_per_night?.extracted_lowest,
          total: p.total_rate?.extracted_lowest ?? null,
          stars: p.extracted_hotel_class || null,
          rating: p.overall_rating || null,
          type: p.type || 'hotel',
          link: p.link || null,
        }))
        .filter((h) => Number.isFinite(h.price) && Number.isFinite(h.lat));

      // A few names still come back in local script; translate those.
      await translateHotels(hotels);
      return { hotels };
    },
  };
}
