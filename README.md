# StayScout

Type a country (or a city), pick the cities you like, give a rough date window and a trip length.
StayScout shows:

- **The cheapest plan:** which order to visit your cities and the best start date. You can change how many nights you spend in each city, and it recalculates instantly.
- **When to go where:** a grid of cities × nights, colored by hotel price
- **Each city in detail:** price calendar, cheapest areas, hotel map and list

Prices come from **Google Hotels via SerpApi**. Google Hotels pulls in Booking.com, Agoda, Expedia and others. With no key, it runs on **demo data**: fake prices for every city in `lib/countries.js`.
Hotel and area names are shown in English. Google and OpenStreetMap are asked for English, and anything still in another script is translated with MyMemory's free API.

## Run it

Requires Node 22+. There are no npm dependencies.

```bash
cp .env.example .env     # then paste your SerpApi key into .env
npm start                # → http://localhost:3000
npm run dev              # same, restarts on file changes
```

## Deploy to Vercel (free)

The `api/` folder holds Vercel serverless functions and `public/` is served as static files. `server.js` is only for local use.

1. Push this repo to GitHub, then on vercel.com click **Add New → Project** and import it. No build settings are needed.
2. Under **Settings → Environment Variables**, add:
   - `SERPAPI_KEY`: your key
   - `ACCESS_CODE`: any password. **Strongly recommended:** without it, anyone with your URL can use up your 250 free searches.
3. Redeploy (Deployments → ⋯ → Redeploy) so the variables take effect.

Every `git push` to `main` then deploys automatically.

Notes: on Vercel the cache lives in `/tmp`, which gets wiped now and then, so repeat searches are only *sometimes* free. Each function may run for up to 60s.

## How it works (and why prices are "semi-accurate")

The free SerpApi tier gives 250 searches/month (and 50/hour). So:

1. **Country → cities.** `lib/countries.js` has curated city lists for about 20 popular countries. For any other country it asks Wikidata (free) for its largest cities.
2. **Sample.** For each picked city, about 5 nights spread across your window are checked, roughly 1 in 3 on Fri/Sat. Each check is one API search. 4 cities × 5 = 20 searches.
3. **Estimate the rest.** The weekend premium is measured, then a straight line is drawn between the checked nights to get the trend, and the premium is added back on Fri/Sat nights.
4. **Plan the route** (in the browser, `public/itinerary.js`). It tries every city order × every start date and picks the cheapest. Zig-zag routes get a small distance penalty, so near-ties go to the route that makes geographic sense. Train/flight costs between cities are **not** included.
5. **City detail.** Opening a city tab reuses the cached samples (no new searches) and names the cheapest areas using OpenStreetMap (free).
6. **Cache.** Every lookup is saved in `.cache/` for 24h.

"Typical" = median hotel price that night. "Budget" = cheapest quarter. Prices are per room per night, before taxes.

**Limits:** a short price spike, like a festival, is only caught if a checked night lands on it. Use "More options → Accuracy" for important trips. Google returns about 20 hotels per search, not every hotel in the city.

## Files

| File | What it does |
|---|---|
| `server.js` | Local dev server: static files + API |
| `api/*.js` | Vercel serverless functions (thin wrappers) |
| `lib/routes.js` | API handlers shared by both, plus the optional access code |
| `lib/plan.js` | Sampling + estimating each city's nightly prices; hotel aggregation |
| `lib/countries.js` | Country → cities (curated list + Wikidata fallback) |
| `lib/serpapi.js` | Live provider (Google Hotels via SerpApi) |
| `lib/demo.js` | Fake provider with weekends + each country's peak seasons |
| `lib/translate.js` | Translates non-English names (MyMemory, cached) |
| `lib/areas.js` | Groups hotels into areas and names them (OpenStreetMap) |
| `lib/cache.js` | Disk cache in `.cache/` |
| `public/app.js` | UI: search, tabs, plan, grid, calendar, maps |
| `public/itinerary.js` | Route + start-date optimiser |

To add another data source, write a module with `fetchNight({ city, date, adults, currency, minStars })` that returns `{ hotels: [{ id, name, lat, lng, price, stars, rating, link }] }` and wire it up in `lib/providers.js`.

## Ideas for next

- Add train/flight costs between cities to the route optimiser
- Flights
- Price alerts (re-check a saved search daily)
