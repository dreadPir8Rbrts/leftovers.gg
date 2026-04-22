#!/usr/bin/env python3
"""
OnTreasure.com production scraper.

Scrapes card show listings and detail pages, parses all available fields,
and outputs structured JSON ready to insert into the card_shows table.

Usage:
    python scrape_ontreasure.py                  # next 90 days, all Non-Sports
    python scrape_ontreasure.py --days 180       # next 180 days
    python scrape_ontreasure.py --output shows.json

Output shape per event:
    {
        "source_id":      str,   # ontreasure slug — stable unique ID
        "source_url":     str,   # full ontreasure detail URL
        "name":           str,
        "date_start":     str,   # ISO date YYYY-MM-DD
        "date_end":       str,   # ISO date YYYY-MM-DD (same as start for 1-day shows)
        "time_start":     str|None,  # "11:00 AM"
        "time_end":       str|None,  # "4:00 PM"
        "venue_name":     str|None,
        "address":        str|None,  # full address string
        "street":         str|None,  # parsed from address
        "city":           str|None,
        "state":          str|None,  # 2-letter abbreviation
        "zip_code":       str|None,  # 5-digit
        "description":    str|None,
        "tags":           list[str], # e.g. ["Pokemon", "One-Piece", "TCG"]
        "organizer_name": str|None,
        "organizer_handle": str|None,
        "ticket_price":   str|None,  # e.g. "$4.00"
        "table_price":    str|None,  # e.g. "$70.00"
        "poster_url":     str|None,
        "scraped_at":     str,   # ISO datetime
    }
"""

import argparse
import asyncio
import json
import re
import sys
from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Optional, Set, Tuple
from urllib.parse import unquote

import httpx
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright, Page

BASE_URL = "https://www.ontreasure.com"

LISTING_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# Tags that indicate Pokemon / TCG relevance — used for optional filtering
TCG_TAGS = {
    "Pokemon", "One-Piece", "TCG", "Yu-Gi-Oh!", "Magic: The Gathering",
    "Non-Sports", "Lorcana", "Collectibles",
}

# ── Address parsing ──────────────────────────────────────────────────────────

STATE_ABBREVS = {
    "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN",
    "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV",
    "NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN",
    "TX","UT","VT","VA","WA","WV","WI","WY","DC",
}

def parse_address(full_address: Optional[str]) -> Dict[str, Optional[str]]:
    """
    Parse a full address string into components.

    Handles both standard 3-part US addresses and Google Maps format addresses
    that prepend the venue name as an extra leading component:

      "151 Webster Square Rd, Berlin, CT 06037, USA"                   → 3 parts
      "Embassy Suites ..., Centennial Ave, Piscataway, NJ, USA"        → 4 parts

    Strategy: locate the state abbreviation searching from the END of the
    comma-separated parts, then assign city and street by working backwards.
    This is robust regardless of how many leading components appear before the
    street address.
    """
    if not full_address:
        return {"street": None, "city": None, "state": None, "zip_code": None}

    # Strip trailing ", USA" or ", United States"
    addr = re.sub(r",?\s*(USA|United States)\s*$", "", full_address.strip())

    # Extract ZIP code (5 digits, optionally followed by -4 digits)
    zip_match = re.search(r"\b(\d{5})(?:-\d{4})?\b", addr)
    zip_code = zip_match.group(1) if zip_match else None

    parts = [p.strip() for p in addr.split(",")]

    street, city, state = None, None, None

    # Find state working backwards from the last part
    state_idx = None
    for i in range(len(parts) - 1, -1, -1):
        for token in parts[i].split():
            if token.upper() in STATE_ABBREVS:
                state = token.upper()
                state_idx = i
                break
        if state_idx is not None:
            break

    if state_idx is not None:
        # City is immediately before the state part
        if state_idx >= 1:
            city = parts[state_idx - 1]
        # Street is immediately before city
        if state_idx >= 2:
            street = parts[state_idx - 2]
    else:
        # No state found — fall back to positional assignment
        if len(parts) >= 2:
            street = parts[0]
            city = parts[1]
        elif len(parts) == 1:
            street = parts[0]

    return {
        "street": street,
        "city": city,
        "state": state,
        "zip_code": zip_code,
    }


# ── Date parsing ─────────────────────────────────────────────────────────────

MONTH_MAP = {
    "Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6,
    "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12,
}

def parse_date_range(date_str: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    """
    Parse "Sat, Apr 11" or "Sat, Apr 11 - Sun, Apr 12" to ISO date strings.
    Assumes current or next year based on month.
    """
    if not date_str:
        return None, None

    today = datetime.today()
    year = today.year

    parts = re.split(r"\s*[-–]\s*", date_str)

    def parse_single(s: str) -> Optional[str]:
        s = re.sub(r"^[A-Za-z]+,?\s*", "", s.strip())
        m = re.match(r"([A-Za-z]+)\s+(\d+)", s)
        if not m:
            return None
        month = MONTH_MAP.get(m.group(1)[:3])
        day = int(m.group(2))
        if not month:
            return None
        d = date(year, month, day)
        if d < today.date():
            d = date(year + 1, month, day)
        return d.isoformat()

    start = parse_single(parts[0])
    end = parse_single(parts[1]) if len(parts) > 1 else start
    return start, end


def parse_price(text: Optional[str]) -> Optional[str]:
    """Extract a dollar amount from a price string. Returns '$X.XX' or None."""
    if not text:
        return None
    m = re.search(r"\$[\d,]+(?:\.\d{2})?", text)
    return m.group(0) if m else None


# ── Zip code enrichment ──────────────────────────────────────────────────────

def enrich_zip_codes(events: List[Dict]) -> List[Dict]:
    """
    Fill in missing zip_code, latitude, and longitude for scraped events using
    Nominatim (OpenStreetMap). All three fields come from the same geocode call
    so there is no additional API cost for lat/lon.

    Strategy (in priority order):
      1. Skip events that already have zip_code AND latitude AND longitude.
      2. If address is present → geocode full address → exact postcode + coords.
      3. If city + state present (no address) → geocode "City, ST, USA".
      4. If neither → leave fields as None.

    Within each geocode attempt a three-query fallback chain is used:
      a. Full address / city query (primary)
      b. "{street}, {city}, {state}, USA" — strips leading venue-name noise
      c. "{city}, {state}, USA" — city-level last resort

    Nominatim is rate-limited to 1 req/sec per OSM usage policy. A 1.1s sleep
    is inserted between calls.
    """
    import time
    from geopy.geocoders import Nominatim
    from geopy.exc import GeocoderTimedOut, GeocoderServiceError

    def _needs_geocode(e: Dict) -> bool:
        return not (e.get("zip_code") and e.get("latitude") and e.get("longitude"))

    needs_address_geocode = [e for e in events if _needs_geocode(e) and e.get("address")]
    needs_city_geocode = [
        e for e in events
        if _needs_geocode(e) and not e.get("address")
        and e.get("city") and e.get("state")
    ]
    already_have = len(events) - len(needs_address_geocode) - len(needs_city_geocode)

    print(
        f"[GEO] {already_have} already complete | "
        f"{len(needs_address_geocode)} need address geocode | "
        f"{len(needs_city_geocode)} need city geocode",
        flush=True,
    )

    to_geocode: List[Dict] = []
    # Build list of (event, query_string) pairs
    geocode_jobs: List[tuple] = []
    for e in needs_address_geocode:
        geocode_jobs.append((e, e["address"]))
    for e in needs_city_geocode:
        geocode_jobs.append((e, f"{e['city']}, {e['state']}, USA"))

    if not geocode_jobs:
        return events

    geolocator = Nominatim(user_agent="cardops-show-scraper/1.0")

    def _geocode_with_fallback(event: Dict, primary_query: str) -> None:
        """
        Try up to three Nominatim queries for one event, sleeping 1.1s between
        each attempt to respect the 1 req/sec rate limit.

        Attempt order:
          1. Primary query (full address or "City, ST, USA")
          2. "{street}, {city}, {state}, USA"  — strips leading venue-name noise
          3. "{city}, {state}, USA"             — city-level last resort
        """
        city = event.get("city")
        state = event.get("state")
        street = event.get("street")

        fallbacks: List[str] = [primary_query]
        if street and city and state:
            street_query = f"{street}, {city}, {state}, USA"
            if street_query != primary_query:
                fallbacks.append(street_query)
        if city and state:
            city_query = f"{city}, {state}, USA"
            if city_query not in fallbacks:
                fallbacks.append(city_query)

        for attempt, query in enumerate(fallbacks):
            if attempt > 0:
                time.sleep(1.1)  # rate limit between attempts
            try:
                location = geolocator.geocode(
                    query,
                    addressdetails=True,
                    language="en",
                    timeout=10,
                )
                if location:
                    postcode = location.raw.get("address", {}).get("postcode")
                    if postcode and not event.get("zip_code"):
                        event["zip_code"] = postcode[:5]
                    if not event.get("latitude"):
                        event["latitude"] = location.latitude
                    if not event.get("longitude"):
                        event["longitude"] = location.longitude
                    label = ["full", "street", "city"][min(attempt, 2)]
                    print(
                        f"  [GEO:{label}] {query[:55]:<55} "
                        f"zip={event.get('zip_code', '—')} "
                        f"lat={round(location.latitude, 4)} "
                        f"lon={round(location.longitude, 4)}",
                        flush=True,
                    )
                    return
            except (GeocoderTimedOut, GeocoderServiceError) as exc:
                print(f"  [ZIP] Error on attempt {attempt + 1} for {query[:60]}: {exc}", flush=True)

        print(f"  [GEO] No result for: {primary_query[:65]}", flush=True)

    for i, (event, query) in enumerate(geocode_jobs):
        _geocode_with_fallback(event, query)
        # Rate limit between events (attempts within an event already sleep)
        if i < len(geocode_jobs) - 1:
            time.sleep(1.1)

    return events


# ── Listing page scraping ────────────────────────────────────────────────────

def parse_event_anchors(html: str, exclude_slugs: Optional[Set[str]] = None) -> List[Dict]:
    """
    Parse event anchor tags from listing page HTML into partial event dicts.
    Shared between the static fetch path and the Playwright scroll path.

    exclude_slugs: set of slugs to skip (used to filter the featured banner event).
    """
    soup = BeautifulSoup(html, "lxml")
    seen = set(exclude_slugs or [])
    events = []

    anchors = soup.find_all("a", href=re.compile(r"^/events/[^?]+$"))
    for a in anchors:
        slug = a["href"].replace("/events/", "").strip("/")
        if not slug or slug in seen:
            continue
        seen.add(slug)

        texts = [t.strip() for t in a.stripped_strings if t.strip()]

        date_str = next(
            (t for t in texts if re.search(r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b", t)),
            None
        )

        # Skip anchors with no date — these are nav/featured links, not event cards
        if not date_str:
            continue

        state_str = next(
            (t for t in texts if re.search(r",\s*[A-Z]{2}$", t)),
            None
        )
        state = None
        if state_str:
            m = re.search(r",\s*([A-Z]{2})$", state_str)
            if m and m.group(1) in STATE_ABBREVS:
                state = m.group(1)

        img = a.find("img")
        poster_url = None
        if img:
            src = img.get("src", "")
            m = re.search(r"url=([^&]+)", src)
            poster_url = unquote(m.group(1)) if m else src

        name = texts[0] if texts else slug
        date_start, date_end = parse_date_range(date_str)

        events.append({
            "source_id": slug,
            "source_url": f"{BASE_URL}/events/{slug}",
            "name": name,
            "date_str_raw": date_str,
            "date_start": date_start,
            "date_end": date_end,
            "state": state,
            "poster_url": poster_url,
        })

    return events


async def scrape_listing(
    from_date: date,
    until_date: date,
    playwright_context=None,
    window_days: int = 7,
) -> List[Dict]:
    """
    Scrape the events listing by splitting the date range into smaller windows.

    OnTreasure's infinite scroll only loads ~12 events per scroll trigger and
    is difficult to drive programmatically. Instead we request multiple smaller
    date windows (default 7 days each) where the full result set renders on
    initial page load without needing to scroll.

    Example: a 30-day range becomes 5 requests of 6-7 days each.
    """
    # Build list of (window_start, window_end) pairs
    windows = []
    cursor = from_date
    while cursor < until_date:
        window_end = min(cursor + timedelta(days=window_days - 1), until_date)
        windows.append((cursor, window_end))
        cursor = window_end + timedelta(days=1)

    print(f"[LISTING] {len(windows)} date windows × {window_days} days each", flush=True)

    all_events = []
    seen_slugs = set()

    async def _fetch_window(page, w_start: date, w_end: date):
        url = (
            f"{BASE_URL}/events?seetags=true&tag=Non-Sports"
            f"&from={w_start.isoformat()}&until={w_end.isoformat()}"
        )
        print(f"  [WINDOW] {w_start} → {w_end}", flush=True)
        await page.goto(url, wait_until="networkidle", timeout=30000)

        window_seen = set()
        no_new_count = 0
        scroll_attempt = 0
        max_scroll = 10  # 7-day window won't need more than 2-3 in practice

        while scroll_attempt < max_scroll:
            html = await page.content()
            batch = parse_event_anchors(html, exclude_slugs=seen_slugs | window_seen)
            new_count = sum(1 for e in batch if e["source_id"] not in window_seen)
            for e in batch:
                window_seen.add(e["source_id"])

            if new_count == 0:
                no_new_count += 1
                if no_new_count >= 2:
                    break
            else:
                no_new_count = 0

            # Count real event cards currently in DOM
            current_count = await page.evaluate("""
                () => [...document.querySelectorAll('a[href^="/events/"]')]
                    .filter(a => /Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/.test(a.textContent))
                    .length
            """)

            # Scroll last card into view to trigger intersection observer
            await page.evaluate("""
                () => {
                    const links = [...document.querySelectorAll('a[href^="/events/"]')]
                        .filter(a => /Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/.test(a.textContent));
                    if (links.length > 0)
                        links[links.length - 1].scrollIntoView({ behavior: 'instant', block: 'end' });
                    window.scrollTo(0, document.body.scrollHeight);
                }
            """)
            await page.keyboard.press("End")

            # Poll for DOM growth
            waited = 0.0
            while waited < 6.0:
                await asyncio.sleep(0.4)
                waited += 0.4
                new_dom_count = await page.evaluate("""
                    () => [...document.querySelectorAll('a[href^="/events/"]')]
                        .filter(a => /Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/.test(a.textContent))
                        .length
                """)
                if new_dom_count > current_count:
                    print(f"    [SCROLL] {current_count} → {new_dom_count} cards after {waited:.1f}s", flush=True)
                    await asyncio.sleep(0.3)
                    break
            else:
                # DOM didn't grow — no more pages for this window
                break

            scroll_attempt += 1

        # Final parse of fully loaded window
        html = await page.content()
        return parse_event_anchors(html, exclude_slugs=seen_slugs)

    async def _run_windows(context):
        page = await context.new_page()
        try:
            for w_start, w_end in windows:
                batch = await _fetch_window(page, w_start, w_end)
                new = 0
                for e in batch:
                    if e["source_id"] not in seen_slugs:
                        seen_slugs.add(e["source_id"])
                        all_events.append(e)
                        new += 1
                print(f"  [WINDOW] {new} new events (running total: {len(all_events)})", flush=True)
                await asyncio.sleep(1.0)  # polite pause between requests
        finally:
            await page.close()

    if playwright_context is not None:
        await _run_windows(playwright_context)
    else:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(
                user_agent=LISTING_HEADERS["User-Agent"],
                viewport={"width": 1280, "height": 900},
            )
            try:
                await _run_windows(context)
            finally:
                await browser.close()

    print(f"[LISTING] Found {len(all_events)} total events across all windows", flush=True)
    return all_events


# ── Detail page scraping (Playwright) ────────────────────────────────────────

# Selectors derived from DOM inspection output
SELECTORS = {
    # Event title (large h1 at top of detail page)
    "name": "h1.text-2xl",
    # Venue name — span immediately before the address div
    # We'll extract this via JS since there's no unique class on the span itself
    # Address div has class 'text-xs text-muted-foreground'
    "address": "div.text-xs.text-muted-foreground",
    # Date string
    "date": "h3.font-medium.text-foreground.text-sm",
    # Times — two consecutive divs with this class
    "times": "div.flex.items-center.text-sm.text-muted-foreground",
    # Description — bare <p> tag in the About section
    # Tags — span elements with rounded-full class
    "tags": "span.inline-flex.items-center.rounded-full.border",
    # Organizer handle
    "organizer_handle": "p.text-sm.text-muted-foreground.mt-0\\.5",
    # Organizer name
    "organizer_name": "p.font-semibold.text-base",
}

DETAIL_EXTRACT_JS = """
() => {
    const getText = (selector, index = 0) => {
        const els = document.querySelectorAll(selector);
        return els[index] ? els[index].textContent.trim() : null;
    };
    const getAllText = (selector) => {
        return [...document.querySelectorAll(selector)].map(el => el.textContent.trim());
    };

    // Venue name + address extraction.
    //
    // The address appears in a div with class 'text-xs text-muted-foreground'.
    // It always ends with a US state abbreviation and/or "USA".
    // We previously filtered on /\d/ (digits) which breaks for named roads like
    // "Centennial Avenue, Piscataway, NJ, USA" that have no street number.
    //
    // New strategy: match any div whose text ends with a known pattern:
    //   ", ST"  |  ", ST, USA"  |  ", USA"  |  contains ", USA"
    // This is more reliable than requiring digits.
    const STATE_ABBREVS = new Set([
        'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN',
        'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV',
        'NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN',
        'TX','UT','VT','VA','WA','WV','WI','WY','DC',
    ]);

    const looksLikeAddress = (text) => {
        if (!text || text.length < 5) return false;
        if (text.includes(', USA') || text.includes(',USA')) return true;
        // ends with ", ST" or ", ST ZIPCODE"
        const m = text.match(/,\\s*([A-Z]{2})(?:\\s+\\d{5})?\\s*$/);
        if (m && STATE_ABBREVS.has(m[1])) return true;
        return false;
    };

    const addressDivs = [...document.querySelectorAll('div.text-xs.text-muted-foreground')]
        .filter(el => looksLikeAddress(el.textContent.trim()));

    // Also check 'div.text-sm.text-muted-foreground' used in the Event Location section
    const addressDivsFallback = [...document.querySelectorAll('div.text-sm.text-muted-foreground')]
        .filter(el => looksLikeAddress(el.textContent.trim()));

    const addressDiv = addressDivs[0] || addressDivsFallback[0] || null;
    const address = addressDiv ? addressDiv.textContent.trim() : null;

    // Venue name: look for a <span> that is a sibling or near-sibling of the address div.
    // The venue span has no unique class — we find it by proximity.
    let venueName = null;
    if (addressDiv) {
        const parent = addressDiv.parentElement;
        if (parent) {
            // Prefer a direct child span of the same parent
            const spans = [...parent.querySelectorAll(':scope > span')]
                .filter(s => s.textContent.trim().length > 0);
            if (spans.length > 0) {
                venueName = spans[0].textContent.trim();
            }
            // Fallback: any span in the parent that isn't the address itself
            if (!venueName) {
                const anySpan = [...parent.querySelectorAll('span')]
                    .find(s => s.textContent.trim().length > 0
                              && !looksLikeAddress(s.textContent.trim()));
                if (anySpan) venueName = anySpan.textContent.trim();
            }
        }
        // Fallback: walk back through previous siblings looking for a <span>
        if (!venueName) {
            let prev = addressDiv.previousElementSibling;
            while (prev) {
                if (prev.tagName === 'SPAN' && prev.textContent.trim().length > 0) {
                    venueName = prev.textContent.trim();
                    break;
                }
                prev = prev.previousElementSibling;
            }
        }
        // Last resort: check the parent's previous sibling for a span
        if (!venueName && addressDiv.parentElement) {
            let prevParent = addressDiv.parentElement.previousElementSibling;
            if (prevParent) {
                const s = prevParent.querySelector('span');
                if (s && s.textContent.trim().length > 0) {
                    venueName = s.textContent.trim();
                }
            }
        }
    }

    // Date — first h3 with the date class (contains month abbreviation)
    const dateEls = [...document.querySelectorAll('h3')]
        .filter(el => /Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/.test(el.textContent));
    const dateStr = dateEls[0] ? dateEls[0].textContent.trim() : null;

    // Times — divs containing AM/PM
    const timeEls = [...document.querySelectorAll('div')]
        .filter(el => /\\b(AM|PM)\\b/.test(el.textContent.trim()) && el.textContent.trim().length < 20);
    const timeStart = timeEls[0] ? timeEls[0].textContent.trim() : null;
    const timeEnd = timeEls[1] ? timeEls[1].textContent.trim() : null;

    // Description — look for <p> tags with substantial text that aren't nav items
    const descCandidates = [...document.querySelectorAll('p')]
        .filter(el => {
            const text = el.textContent.trim();
            return text.length > 50
                && !el.closest('nav')
                && !el.closest('footer')
                && !el.className.includes('font-semibold')
                && !el.className.includes('font-medium');
        });
    const description = descCandidates[0] ? descCandidates[0].textContent.trim() : null;

    // Tags — span elements with rounded-full styling
    const tagEls = [...document.querySelectorAll('span')]
        .filter(el => el.className && el.className.includes('rounded-full'));
    // Deduplicate (page renders tags twice — mobile + desktop)
    const tags = [...new Set(tagEls.map(el => el.textContent.trim()).filter(t => t.length > 0))];

    // Prices — look for text containing "$" near "Tickets from" and "Tables from"
    const priceEls = [...document.querySelectorAll('p')]
        .filter(el => /\\$[\\d.]+/.test(el.textContent));
    let ticketPrice = null, tablePrice = null;

    // Find "Tickets from" context
    const allText = document.body.innerText;
    const ticketMatch = allText.match(/Tickets from\\s+\\$([\\d.]+)/);
    const tableMatch = allText.match(/Tables from\\s+\\$([\\d.]+)/);
    if (ticketMatch) ticketPrice = '$' + ticketMatch[1];
    if (tableMatch) tablePrice = '$' + tableMatch[1];

    // Organizer — look for the @handle text
    const handleEl = [...document.querySelectorAll('p')]
        .find(el => el.textContent.trim().startsWith('@') ||
                    (el.className && el.className.includes('text-muted-foreground') && /^[a-z0-9]+$/.test(el.textContent.trim())));
    const organizerHandle = handleEl ? handleEl.textContent.trim().replace(/^@/, '') : null;

    // Organizer name — font-semibold p near the handle
    const organizerNameEl = [...document.querySelectorAll('p.font-semibold')]
        .find(el => el.textContent.trim().length > 0 && el.textContent.trim().length < 80);
    const organizerName = organizerNameEl ? organizerNameEl.textContent.trim() : null;

    return {
        name: getText('h1.text-2xl, h1.text-4xl'),
        venue_name: venueName,
        address: address,
        date_str: dateStr,
        time_start: timeStart,
        time_end: timeEnd,
        description: description,
        tags: tags,
        ticket_price: ticketPrice,
        table_price: tablePrice,
        organizer_name: organizerName,
        organizer_handle: organizerHandle,
    };
}
"""


async def scrape_detail(page: Page, slug: str) -> dict:
    """
    Render one event detail page and extract all fields.
    Reuses an existing Playwright page object for efficiency.
    """
    url = f"{BASE_URL}/events/{slug}"
    try:
        await page.goto(url, wait_until="networkidle", timeout=25000)
        data = await page.evaluate(DETAIL_EXTRACT_JS)
        data["source_id"] = slug
        data["source_url"] = url
        return data
    except Exception as e:
        print(f"  [ERROR] {slug}: {e}", flush=True)
        return {"source_id": slug, "source_url": url, "error": str(e)}


def merge_event(listing: dict, detail: dict) -> dict:
    """
    Merge listing page data (dates, state, poster) with detail page data.
    Detail page takes precedence for overlapping fields.
    """
    # Parse address into components
    address = detail.get("address")
    addr_parts = parse_address(address)

    # Parse date from detail page if available, fall back to listing
    date_str = detail.get("date_str") or listing.get("date_str_raw")
    date_start, date_end = parse_date_range(date_str)
    if not date_start:
        date_start = listing.get("date_start")
        date_end = listing.get("date_end")

    # State: prefer parsed from full address, fall back to listing
    state = addr_parts.get("state") or listing.get("state")

    return {
        "source_id": listing["source_id"],
        "source_url": listing["source_url"],
        "name": detail.get("name") or listing.get("name"),
        "date_start": date_start,
        "date_end": date_end,
        "time_start": detail.get("time_start"),
        "time_end": detail.get("time_end"),
        "venue_name": detail.get("venue_name"),
        "address": address,
        "street": addr_parts.get("street"),
        "city": addr_parts.get("city"),
        "state": state,
        "zip_code": addr_parts.get("zip_code"),
        "description": detail.get("description"),
        "tags": detail.get("tags") or [],
        "organizer_name": detail.get("organizer_name"),
        "organizer_handle": detail.get("organizer_handle"),
        "ticket_price": detail.get("ticket_price"),
        "table_price": detail.get("table_price"),
        "poster_url": listing.get("poster_url"),
        "scraped_at": datetime.now(timezone.utc).isoformat(),
    }


# ── Main ──────────────────────────────────────────────────────────────────────

async def scrape(
    days: int = 90,
    output_file: Optional[str] = "card_shows.json",
    tcg_only: bool = False,
    concurrency: int = 3,
    delay_seconds: float = 1.0,
):
    today = date.today()
    from_date = today
    until_date = today + timedelta(days=days)

    results = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent=LISTING_HEADERS["User-Agent"],
            viewport={"width": 1280, "height": 900},
        )

        # Step 1: Scrape listing page with scroll — reuse the same browser context
        listings = await scrape_listing(from_date, until_date, playwright_context=context)
        if not listings:
            print("[SCRAPER] No events found. Exiting.")
            await browser.close()
            return []

        # Step 2: Scrape detail pages
        print(f"\n[SCRAPER] Fetching detail pages for {len(listings)} events...", flush=True)

        # Process in small batches to be polite
        batch_size = concurrency
        for i in range(0, len(listings), batch_size):
            batch = listings[i:i + batch_size]
            pages = [await context.new_page() for _ in batch]

            tasks = [
                scrape_detail(pages[j], batch[j]["source_id"])
                for j in range(len(batch))
            ]
            details = await asyncio.gather(*tasks)

            for page in pages:
                await page.close()

            for listing, detail in zip(batch, details):
                merged = merge_event(listing, detail)
                results.append(merged)

                status = "OK" if "error" not in detail else "ERROR"
                print(
                    f"  [{status}] {merged['name'][:50]:<50} "
                    f"{merged['city'] or ''}, {merged['state'] or ''} "
                    f"| {merged['date_start']}",
                    flush=True
                )

            # Polite delay between batches
            if i + batch_size < len(listings):
                await asyncio.sleep(delay_seconds)

        await browser.close()

    # Step 3: Optional TCG filter
    if tcg_only:
        before = len(results)
        results = [
            r for r in results
            if any(tag in TCG_TAGS for tag in r.get("tags", []))
        ]
        print(f"\n[FILTER] TCG filter: {before} → {len(results)} events")

    # Step 4: Save output (skipped when output_file is None — e.g. Celery task runs)
    if output_file is not None:
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2, ensure_ascii=False)
        print(f"\n[DONE] {len(results)} events saved to {output_file}")
    else:
        print(f"\n[DONE] {len(results)} events scraped (not written to file)")

    # Print summary
    print("\n[SUMMARY] Sample output:")
    for event in results[:3]:
        print(json.dumps(event, indent=2))

    return results


def scrape_and_save(days: int = 90) -> Dict:
    """
    Sync entry point for the Celery task and manual runs.

    Drives the async Playwright scraper via asyncio.run(), then writes results
    to the database using the sync SQLAlchemy session. Safe to call from a
    Celery worker thread (no existing event loop).

    Manual usage:
        cd backend
        source .venv/bin/activate
        python -c "from scripts.scrape_card_shows import scrape_and_save; print(scrape_and_save())"
    """
    from app.db.session import SessionLocal
    from app.services.shows import upsert_shows

    events = asyncio.run(scrape(days=days, output_file=None))

    if not events:
        return {"scraped": 0, "upserted": 0, "skipped": 0}

    events = enrich_zip_codes(events)

    with SessionLocal() as session:
        result = upsert_shows(events, session)

    return {"scraped": len(events), **result}


def main():
    parser = argparse.ArgumentParser(description="Scrape card shows from OnTreasure.com")
    parser.add_argument("--days", type=int, default=90, help="Days ahead to scrape (default: 90)")
    parser.add_argument("--output", type=str, default="card_shows.json", help="Output JSON file")
    parser.add_argument("--tcg-only", action="store_true", help="Filter to TCG-tagged events only")
    parser.add_argument("--concurrency", type=int, default=3, help="Parallel detail page fetches (default: 3)")
    parser.add_argument("--delay", type=float, default=1.0, help="Seconds between batches (default: 1.0)")
    args = parser.parse_args()

    asyncio.run(scrape(
        days=args.days,
        output_file=args.output,
        tcg_only=args.tcg_only,
        concurrency=args.concurrency,
        delay_seconds=args.delay,
    ))


if __name__ == "__main__":
    main()
