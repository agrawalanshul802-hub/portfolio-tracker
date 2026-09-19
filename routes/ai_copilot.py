# routes/ai_copilot.py
# AI portfolio analyst and news feed:
#   GET  /api/news    - Financial news for user's holdings (RSS + Yahoo)
#   POST /api/ask-ai  - Ask AI questions about your portfolio
#                       (Gemini API primary, rule-based fallback)

import os, json, re, time, urllib.parse, urllib.request
from flask import Blueprint, jsonify, request, session
from routes import supabase, DIRECTORY

ai_bp = Blueprint('ai_copilot', __name__)

def run_local_analysis(message, holdings):

    msg_lower = (message or "").lower().strip()

    

    # Simple greeting / casual conversation

    if msg_lower in ['hello', 'hi', 'hey', 'help', 'who are you', 'what can you do', 'good morning', 'good evening']:

        if not holdings:

            return """### ðŸ‘‹ Hello! I am your AI Investment Analyst.

Welcome to **Portfolio Tracker**! 

* Your portfolio is currently empty.

* To get started, go to the **Portfolio** tab and tap **+ Add holding** to track your Indian stocks (NSE/BSE), ETFs, or crypto.

* Once you add holdings, ask me questions about **diversification**, **risk profile**, **sector allocation**, or **performance**!"""

        else:

            return f"""### ðŸ‘‹ Hello! I am your AI Investment Analyst.

I am ready to help you analyze your portfolio of **{len(holdings)} holding(s)**!

#### You can ask me:

* **"Is my portfolio diversified?"** - Evaluates asset concentration & single-stock risk.

* **"What is my asset class distribution?"** - Breaks down Equity, ETF, and other asset weights.

* **"Which is my best performing stock?"** - Audits your highest gainers, laggards, and unrealized returns.

* **"How can I reduce risk?"** - Practical suggestions for portfolio balance."""

    if not holdings:

        return "Your portfolio is currently empty. Please add some stock or crypto holdings first, and I will analyze your diversification, asset allocation, and performance!"

    # Calculate basic stats

    total_cost = 0

    total_value = 0

    holdings_by_class = {}

    highest_gainer = None

    highest_gainer_pct = -999999

    highest_loser = None

    highest_loser_pct = 999999

    largest_holding = None

    largest_holding_val = 0

    for h in holdings:

        qty = float(h.get('qty', 0) or 0)

        buy_price = float(h.get('buyPrice', 0) or 0)

        curr_price = float(h.get('price', 0) or 0)

        cost = qty * buy_price

        val = qty * curr_price

        gain = val - cost

        gain_pct = (gain / cost * 100) if cost > 0 else 0

        asset_class = h.get('assetClass', 'Equity') or 'Equity'

        total_cost += cost

        total_value += val

        # Group by asset class

        holdings_by_class[asset_class] = holdings_by_class.get(asset_class, 0) + val

        # Gainer/Loser tracking

        if highest_gainer is None or gain_pct > highest_gainer_pct:

            highest_gainer_pct = gain_pct

            highest_gainer = h

        if highest_loser is None or gain_pct < highest_loser_pct:

            highest_loser_pct = gain_pct

            highest_loser = h

        # Largest holding tracking

        if largest_holding is None or val >= largest_holding_val:

            largest_holding_val = val

            largest_holding = h

    total_gain = total_value - total_cost

    total_gain_pct = (total_gain / total_cost * 100) if total_cost > 0 else 0

    safe_total_value = max(total_value, 1.0)

    

    # 1. Diversification analysis

    if "diversi" in msg_lower or "risk" in msg_lower or "concentr" in msg_lower:

        num_holdings = len(holdings)

        top_pct = (largest_holding_val / safe_total_value * 100)

        if num_holdings == 1:

            div_status = "âš ï¸ **High Concentration Risk** (1 holding)"

            div_desc = f"Your entire portfolio is concentrated in **{holdings[0].get('symbol')}** ({top_pct:.1f}% of total value). This exposes you to company-specific risk. Consider diversifying across other sectors or index ETFs (e.g., NIFTYBEES)."

        elif num_holdings < 4:

            div_status = "âš¡ **Moderate Concentration Risk** (few holdings)"

            div_desc = f"You hold {num_holdings} assets. The largest holding is **{largest_holding.get('symbol')}** representing {top_pct:.1f}% of your book. To optimize risk-adjusted returns, aim to add at least 5-10 non-correlated holdings across different industries."

        else:

            div_status = "âœ… **Well Diversified Portfolio**"

            div_desc = f"You hold {num_holdings} assets. Your largest exposure is **{largest_holding.get('symbol')}** at {top_pct:.1f}% of portfolio value. This allocation keeps single-stock risk manageable."

        

        return f"""### ðŸ” Portfolio Diversification & Risk Analysis

**Diversification Rating**: {div_status}

* **Asset Count**: {num_holdings} active asset(s).

* **Top Exposure**: {largest_holding.get('symbol')} ({top_pct:.1f}% of assets).

* **Summary**: {div_desc}

#### Recommended Action Items:

1. **Explore Exchange Traded Funds (ETFs)**: Low-cost diversification across NIFTY 50 or Gold.

2. **Limit Single Stocks**: Keep single stock allocations under 10-15% of your total net worth.

3. **Sector check**: Make sure your equities are spread across multiple sectors (banking, IT, pharma, FMCG)."""

    # 2. Allocation analysis

    elif "allocat" in msg_lower or "class" in msg_lower or "distrib" in msg_lower or "pie" in msg_lower:

        alloc_rows = ""

        for ac, val in holdings_by_class.items():

            pct = (val / safe_total_value * 100)

            alloc_rows += f"* **{ac}**: â‚¹{val:,.2f} ({pct:.1f}%)\n"

        return f"""### ðŸ“Š Asset Class Allocation Analysis

Here is the current breakdown of your investments across different asset classes:

{alloc_rows}

* **Total Portfolio Value**: â‚¹{total_value:,.2f}

#### Insights:

* **Equities**: Ideal core for long-term compounding growth.

* **ETFs**: Provide broad benchmark stability.

* **Alternative / Crypto**: Keep speculative assets under 1-5% of total wealth."""

    # 3. Performance questions

    elif "gainer" in msg_lower or "loser" in msg_lower or "best" in msg_lower or "worst" in msg_lower or "perform" in msg_lower:

        gain_sign = "+" if total_gain >= 0 else ""

        return f"""### ðŸ“ˆ Portfolio Performance Audit

Your overall portfolio return is **{total_gain_pct:+.2f}%** (net gain of **{gain_sign}â‚¹{total_gain:,.2f}**).

* **Top Performer**: **{highest_gainer.get('symbol')}** ({highest_gainer_pct:+.2f}%).

* **Laggard**: **{highest_loser.get('symbol')}** ({highest_loser_pct:+.2f}%).

* **Largest Asset**: **{largest_holding.get('symbol')}** (Current Value: â‚¹{largest_holding_val:,.2f}).

#### Recommendations:

* **Rebalance Winners**: If a position exceeds target allocation, consider booking partial profits.

* **Review Laggards**: Periodically assess underperformers like {highest_loser.get('symbol')} to verify fundamental strength."""

    # 4. Default portfolio overview response

    else:

        gain_sign = "+" if total_gain >= 0 else ""

        top_pct = (largest_holding_val / safe_total_value * 100)

        return f"""### ðŸ‘‹ Portfolio AI Analyst Overview

Here is a quick snapshot of your active portfolio:

* **Portfolio Net Worth**: **â‚¹{total_value:,.2f}** (Invested: â‚¹{total_cost:,.2f})

* **Total Returns**: **{total_gain_pct:+.2f}%** ({gain_sign}â‚¹{total_gain:,.2f} unrealised)

* **Holdings Count**: {len(holdings)} holdings.

* **Largest Position**: **{largest_holding.get('symbol')}** (â‚¹{largest_holding_val:,.2f}, representing {top_pct:.1f}%)

* **Top Gainer**: **{highest_gainer.get('symbol')}** ({highest_gainer_pct:+.2f}%)

* **Top Loser**: **{highest_loser.get('symbol')}** ({highest_loser_pct:+.2f}%)

#### Ask me questions like:

* *"Is my portfolio diversified?"*

* *"What is my asset class distribution?"*

* *"Which of my stocks is performing best?"*

*Disclaimer: Automatically generated from holdings data for informational purposes only.*"""

# Upgraded High-Performance Multi-Source Market & Portfolio News Cache
news_cache = {
    'market_articles': None,  # (timestamp, list_of_articles)
    'yahoo_articles': {}      # symbol -> (timestamp, list_of_yahoo_articles)
}

CACHE_DURATION_SEC = 300  # 5 minutes

NEWS_FEED_SOURCES = [
    {
        'type': 'BUZZING',
        'publisher': 'Economic Times',
        'url': 'https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms'
    },
    {
        'type': 'RECOS',
        'publisher': 'ET Recos',
        'url': 'https://economictimes.indiatimes.com/markets/stocks/recos/rssfeeds/2146843.cms'
    },
    {
        'type': 'LATEST',
        'publisher': 'LiveMint',
        'url': 'https://www.livemint.com/rss/markets'
    },
    {
        'type': 'OUTLOOK',
        'publisher': 'Economic Times',
        'url': 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms'
    },
    {
        'type': 'LATEST',
        'publisher': 'Google News India',
        'url': 'https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-IN&gl=IN&ceid=IN:en'
    }
]

@ai_bp.route('/api/news', methods=['GET'])
def get_portfolio_news():
    import time
    import email.utils
    import xml.etree.ElementTree as ET
    import re
    from concurrent.futures import ThreadPoolExecutor

    symbols_arg = request.args.get('symbols', '')
    email = session.get('email')

    # 1. Resolve symbols from query args and/or user holdings in Supabase
    holdings_data = []
    if email:
        try:
            res = supabase.table('holdings').select('symbol, name, "yahooSymbol"').eq('user_email', email).execute()
            holdings_data = res.data or []
        except Exception as e:
            print(f"Error fetching holdings from DB for news: {e}")

    symbols = []
    if symbols_arg:
        symbols.extend([s.strip().upper() for s in symbols_arg.split(',') if s.strip()])
    for h in holdings_data:
        ysym = (h.get('yahooSymbol') or h.get('symbol') or '').strip().upper()
        if ysym and ysym not in symbols:
            symbols.append(ysym)

    # 2. Build Symbol Matchers for keyword tagging
    symbol_matchers = []
    for sym in symbols:
        clean_code = sym.split('.')[0].upper()
        keywords = {sym, clean_code}
        for h in holdings_data:
            if (h.get('yahooSymbol') or '').upper() == sym or (h.get('symbol') or '').upper() == sym:
                name = h.get('name', '')
                words = [w.strip().upper() for w in re.split(r'\s+|,|\.|\&|\-', name) if len(w.strip()) >= 4]
                if words:
                    keywords.add(words[0])
                    if len(words) > 1:
                        keywords.add(f"{words[0]} {words[1]}")
        symbol_matchers.append({
            'symbol': sym,
            'keywords': [k for k in keywords if len(k) >= 3]
        })

    current_time = time.time()
    cached_market = news_cache.get('market_articles')
    market_articles = []

    # 3. Fetch/Cache Multi-Source RSS Market Feeds
    if cached_market and (current_time - cached_market[0] < CACHE_DURATION_SEC):
        market_articles = cached_market[1]
    else:
        req_headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'application/rss+xml, application/xml, text/xml, */*'
        }

        def fetch_single_feed(cfg):
            feed_type = cfg['type']
            publisher = cfg['publisher']
            url = cfg['url']
            feed_items = []
            try:
                req = urllib.request.Request(url, headers=req_headers)
                with urllib.request.urlopen(req, timeout=4.0) as res:
                    raw_xml = res.read()
                    root = ET.fromstring(raw_xml)
                    for item in root.findall('.//item'):
                        title = item.find('title')
                        link = item.find('link')
                        desc = item.find('description')
                        pub_date = item.find('pubDate')
                        guid = item.find('guid')
                        enclosure = item.find('enclosure')
                        media = item.find('{http://search.yahoo.com/mrss/}content')

                        title_text = (title.text or '').strip() if title is not None else ''
                        link_text = (link.text or '').strip() if link is not None else ''
                        desc_text = (desc.text or '').strip() if desc is not None else ''
                        pub_date_text = (pub_date.text or '').strip() if pub_date is not None else ''
                        guid_text = (guid.text or '').strip() if guid is not None else link_text

                        if not title_text or not link_text:
                            continue

                        img_url = None
                        if enclosure is not None and enclosure.get('url'):
                            img_url = enclosure.get('url')
                        elif media is not None and media.get('url'):
                            img_url = media.get('url')
                        elif desc_text:
                            m = re.search(r'src=["\']([^"\'\s]+\.(?:jpg|jpeg|png|webp)[^"\'\s]*)["\']', desc_text, re.IGNORECASE)
                            if m:
                                img_url = m.group(1)

                        clean_desc = re.sub(r'<[^>]+>', ' ', desc_text).strip()
                        clean_desc = re.sub(r'\s+', ' ', clean_desc)

                        target_price = None
                        if feed_type == 'RECOS' or 'target' in title_text.lower():
                            tgt_m = re.search(r'(?:target|tp)\s*(?:of\s*)?(?:rs\.?\s*|₹\s*|inr\s*)?([\d,]+)', title_text, re.IGNORECASE)
                            if tgt_m:
                                target_price = f"₹{tgt_m.group(1)}"

                        pub_time = int(current_time)
                        if pub_date_text:
                            try:
                                pub_time = int(email.utils.parsedate_to_datetime(pub_date_text).timestamp())
                            except Exception:
                                pass

                        feed_items.append({
                            'uuid': guid_text,
                            'title': title_text,
                            'publisher': publisher,
                            'link': link_text,
                            'providerPublishTime': pub_time,
                            'summary': clean_desc[:280],
                            'thumbnail': {'resolutions': [{'url': img_url}]} if img_url else None,
                            'type': feed_type,
                            'targetPrice': target_price,
                            'relatedTickers': []
                        })
            except Exception as e:
                print(f"Error reading feed {url}: {e}")
            return feed_items

        with ThreadPoolExecutor(max_workers=min(len(NEWS_FEED_SOURCES), 6)) as executor:
            futs = [executor.submit(fetch_single_feed, cfg) for cfg in NEWS_FEED_SOURCES]
            for f in futs:
                market_articles.extend(f.result())

        # Deduplicate
        seen_feed_links = set()
        dedup_market = []
        for art in market_articles:
            l = art['link']
            if l not in seen_feed_links:
                seen_feed_links.add(l)
                dedup_market.append(art)
        market_articles = dedup_market
        news_cache['market_articles'] = (current_time, market_articles)

    # 4. Keyword Match Market Articles to User Portfolio Symbols
    for art in market_articles:
        t_up = art['title'].upper()
        s_up = art['summary'].upper()
        matched = []
        for m in symbol_matchers:
            for kw in m['keywords']:
                pat = r'\b' + re.escape(kw) + r'\b'
                if re.search(pat, t_up) or re.search(pat, s_up):
                    matched.append(m['symbol'])
                    break
        art['relatedTickers'] = list(set(matched))

    # 5. Fetch Yahoo Finance Specific News for Portfolio Symbols
    yahoo_cache = news_cache.setdefault('yahoo_articles', {})
    symbols_to_fetch = []
    for s in symbols:
        y_c = yahoo_cache.get(s)
        if not y_c or (current_time - y_c[0] > CACHE_DURATION_SEC):
            symbols_to_fetch.append(s)

    def fetch_single_yahoo_news(symbol):
        url = f"https://query2.finance.yahoo.com/v1/finance/search?q={urllib.parse.quote(symbol)}&newsCount=8"
        req = urllib.request.Request(
            url,
            headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
            }
        )
        items = []
        try:
            with urllib.request.urlopen(req, timeout=4.0) as res:
                data = json.loads(res.read().decode('utf-8'))
                for it in data.get('news', []):
                    title = it.get('title', '')
                    link = it.get('link', '')
                    if not title or not link:
                        continue
                    img_url = None
                    resols = it.get('thumbnail', {}).get('resolutions', [])
                    if resols:
                        img_url = resols[0].get('url')
                    items.append({
                        'uuid': it.get('uuid', link),
                        'title': title,
                        'publisher': it.get('publisher', 'Yahoo Finance'),
                        'link': link,
                        'providerPublishTime': it.get('providerPublishTime', int(current_time)),
                        'summary': (it.get('summary') or '')[:280],
                        'thumbnail': {'resolutions': [{'url': img_url}]} if img_url else None,
                        'type': 'BUZZING',
                        'targetPrice': None,
                        'symbol': symbol,
                        'relatedTickers': [symbol]
                    })
        except Exception as e:
            print(f"Error fetching Yahoo news for {symbol}: {e}")
        return symbol, items

    if symbols_to_fetch:
        with ThreadPoolExecutor(max_workers=min(len(symbols_to_fetch), 5)) as executor:
            y_results = executor.map(fetch_single_yahoo_news, symbols_to_fetch)
            for sym, items in y_results:
                yahoo_cache[sym] = (current_time, items)

    # 6. Merge All Articles (Symbol-Specific Yahoo News + Market News)
    all_articles = []
    seen_ids = set()

    for s in symbols:
        y_c = yahoo_cache.get(s)
        if y_c:
            for art in y_c[1]:
                ident = art.get('uuid') or art.get('link')
                if ident not in seen_ids:
                    seen_ids.add(ident)
                    all_articles.append(art)

    for art in market_articles:
        ident = art.get('uuid') or art.get('link')
        if ident not in seen_ids:
            seen_ids.add(ident)
            all_articles.append(art)

    all_articles.sort(key=lambda x: x.get('providerPublishTime', 0), reverse=True)
    return jsonify(all_articles)

# -----------------------------------------------------------------------------

# Fallback Heuristic Financial Analysis Engine
# ─────────────────────────────────────────────────────────────────────────────

def extract_and_fetch_stock_quote(query):
    query_clean = query.strip()
    m = re.search(r'\b([A-Za-z0-9_-]{2,12})\.(NSE|NS|BSE|BO|MCX)\b', query_clean, re.I)
    ticker = None
    exchange = 'NSE'
    if m:
        ticker = m.group(1).upper()
        ex = m.group(2).upper()
        exchange = 'MCX' if ex == 'MCX' else ('BSE' if ex in ('BSE', 'BO') else 'NSE')
    else:
        words = re.findall(r'\b[A-Za-z0-9_-]{2,12}\b', query_clean)
        stopwords = {
            'WHAT', 'HOW', 'VIEW', 'VIEWS', 'MY', 'ON', 'THE', 'IS', 'OF', 'FOR', 'AND', 
            'ABOUT', 'SHOULD', 'BUY', 'SELL', 'HOLD', 'GIVE', 'ME', 'ANALYSIS', 'PORTFOLIO',
            'STOCKS', 'STOCK', 'SHARE', 'SHARES', 'PRICE', 'TELL', 'PLEASE', 'GOOD', 'BAD'
        }
        candidates = [w.upper() for w in words if w.upper() not in stopwords and not w.isdigit()]
        if candidates:
            ticker = candidates[-1]

    if not ticker:
        return None

    if exchange == 'MCX':
        yahoo_sym = f"{ticker}.MCX"
    elif exchange == 'BSE':
        yahoo_sym = f"{ticker}.BO"
    else:
        yahoo_sym = f"{ticker}.NS"

    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{yahoo_sym}?range=1d&interval=1m"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'})
    try:
        with urllib.request.urlopen(req, timeout=4) as res:
            data = json.loads(res.read().decode('utf-8'))
            meta = data.get('chart', {}).get('result', [{}])[0].get('meta', {})
            p = meta.get('regularMarketPrice')
            prev = meta.get('chartPreviousClose') or p
            if p is not None:
                chg = p - prev if prev else 0
                chg_pct = (chg / prev * 100) if prev else 0
                return {
                    'symbol': ticker,
                    'yahooSymbol': yahoo_sym,
                    'exchange': exchange,
                    'currentMarketPrice': round(float(p), 2),
                    'previousClose': round(float(prev), 2),
                    'dayChangeINR': round(float(chg), 2),
                    'dayChangePct': f"{chg_pct:+.2f}%",
                    'fiftyTwoWeekHigh': meta.get('fiftyTwoWeekHigh'),
                    'fiftyTwoWeekLow': meta.get('fiftyTwoWeekLow'),
                    'currency': meta.get('currency', 'INR')
                }
    except Exception as e:
        return None

def generate_fallback_analysis(holdings_summary, total_val, total_inv, total_pnl, total_pnl_pct, message, stock_quote=None):
    msg_lower = message.lower()
    lines = []

    # 1. If user asked about a specific stock (e.g. RAIN.NSE)
    if stock_quote:
        sym = stock_quote['symbol']
        cmp_val = stock_quote['currentMarketPrice']
        lines.append(f"### 📈 Analysis: {sym} ({stock_quote['exchange']})")
        lines.append(f"- **Current Market Price (CMP):** ₹{cmp_val:,.2f} ({stock_quote['dayChangePct']} today)")
        lines.append(f"- **Previous Close:** ₹{stock_quote['previousClose']:,.2f}")
        if stock_quote.get('fiftyTwoWeekHigh') and stock_quote.get('fiftyTwoWeekLow'):
            lines.append(f"- **52-Week Range:** ₹{stock_quote['fiftyTwoWeekLow']:,.2f} – ₹{stock_quote['fiftyTwoWeekHigh']:,.2f}")
        
        # Check if in user's portfolio
        match_h = next((h for h in holdings_summary if h.get('symbol', '').upper() == sym.upper()), None)
        if match_h:
            lines.append("")
            lines.append(f"#### 💼 Position in Your Portfolio:")
            lines.append(f"- **Quantity Held:** {match_h['qty']} shares")
            lines.append(f"- **Average Buy Price:** ₹{match_h['buyPrice']:,.2f}")
            lines.append(f"- **Unrealized P&L:** {match_h['gainPct']:+.2f}% (₹{match_h['gain']:+,.2f})")
            lines.append(f"- **Actionable Insight:** Maintain trailing stop-loss; position is currently {'profitable' if match_h['gain'] >= 0 else 'underwater'}.")
        else:
            lines.append("")
            lines.append("#### 💼 Portfolio Integration View:")
            lines.append(f"- `{sym}` is **not currently in your portfolio**.")
            lines.append(f"- Adding `{sym}` at CMP ₹{cmp_val:,.2f} will introduce sector exposure. Ensure single-stock allocation stays below 10-15% of your total net worth (₹{total_val:,.2f}).")
        
        lines.append("")
        lines.append("---")
        lines.append("*Disclaimer: Market data from live feeds. For academic and portfolio tracking purposes only.*")
        return "\n".join(lines)

    # 2. If user asked about overall portfolio review / view
    total_gain_str = f"+₹{total_pnl:,.2f}" if total_pnl >= 0 else f"-₹{abs(total_pnl):,.2f}"
    sorted_holdings = sorted(holdings_summary, key=lambda x: x.get('gain', 0), reverse=True)
    top_winner = sorted_holdings[0] if sorted_holdings else None
    top_loser  = sorted_holdings[-1] if sorted_holdings else None

    lines.append("### 📊 Comprehensive Portfolio Review")
    lines.append(f"- **Total Net Worth:** ₹{total_val:,.2f}")
    lines.append(f"- **Invested Capital:** ₹{total_inv:,.2f}")
    lines.append(f"- **Total Unrealized P&L:** **{total_gain_str} ({total_pnl_pct:+.2f}%)**")
    lines.append(f"- **Active Positions:** {len(holdings_summary)} instruments")
    lines.append("")

    # Asset class breakdown
    equity_val = sum(h['value'] for h in holdings_summary if 'mcx' not in (h.get('yahooSymbol') or '').lower() and h.get('assetClass') != 'COMMODITY')
    comm_val = sum(h['value'] for h in holdings_summary if 'mcx' in (h.get('yahooSymbol') or '').lower() or h.get('assetClass') == 'COMMODITY')
    if total_val > 0:
        lines.append("#### ⚖️ Asset Allocation Breakdown:")
        lines.append(f"- **Equities (NSE/BSE):** ₹{equity_val:,.2f} ({equity_val / total_val * 100:.1f}%)")
        lines.append(f"- **Commodities (MCX):** ₹{comm_val:,.2f} ({comm_val / total_val * 100:.1f}%)")
        lines.append("")

    if top_winner and top_loser:
        lines.append("#### 🏆 Performance Highlights:")
        lines.append(f"- **Top Performer:** `{top_winner['symbol']}` ({top_winner['gainPct']:+.2f}%, P&L: ₹{top_winner['gain']:+,.2f})")
        lines.append(f"- **Underperformer:** `{top_loser['symbol']}` ({top_loser['gainPct']:+.2f}%, P&L: ₹{top_loser['gain']:+,.2f})")
        lines.append("")

    lines.append("#### 💡 Key Takeaways & Action Plan:")
    if comm_val > equity_val:
        lines.append("1. **Commodity Concentration:** Your portfolio has high commodity exposure. Consider balancing with large-cap index funds or defensive equities.")
    else:
        lines.append("1. **Growth vs Defensive Balance:** Consider maintaining a 10-15% hedge in gold or liquid ETFs to smooth equity drawdown.")
    lines.append("2. **Stop-Loss Discipline:** Review underperforming holdings down >25% to prevent compounding drawdowns.")

    lines.append("")
    lines.append("---")
    lines.append("*Disclaimer: Generated for educational & tracking purposes. Not certified SEBI investment advice.*")
    return "\n".join(lines)

@ai_bp.route('/api/ask-ai', methods=['POST'])
def ask_ai():
    load_env_file()
    email = session.get('email')
    if not email:
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.get_json() or {}
    message = data.get('message', '').strip()
    holdings = data.get('holdings', []) or []
    preferred_model = (data.get('model') or 'groq').lower()
    effort = (data.get('effort') or 'medium').lower()

    if not message:
        return jsonify({'error': 'Message is required'}), 400

    effort_token_map = {'low': 600, 'medium': 1200, 'high': 1800, 'extra': 2400, 'max': 3200}
    ai_max_tokens = effort_token_map.get(effort, 1200)

    if preferred_model == 'local':
        # User explicitly requested local rules engine
        groq_key = None
        gemini_key = None
        openrouter_key = None
    else:
        groq_key   = os.getenv('GROQ_API_KEY')
    gemini_key = os.getenv('GEMINI_API_KEY')
    openrouter_key = os.getenv('OPENROUTER_API_KEY')

    if groq_key:
        groq_key = groq_key.strip().replace('"', '').replace("'", "")
        if groq_key.lower() in ('none', 'null', 'false', ''):
            groq_key = None

    if gemini_key:
        gemini_key = gemini_key.strip().replace('"', '').replace("'", "")
        if gemini_key.lower() in ('none', 'null', 'false', '') or not gemini_key.startswith('AIza'):
            gemini_key = None

    if openrouter_key:
        openrouter_key = openrouter_key.strip().replace('"', '').replace("'", "")
        if openrouter_key.lower() in ('none', 'null', 'false', ''):
            openrouter_key = None

    # Format holdings context
    holdings_summary = []
    total_val = 0
    total_inv = 0
    for h in holdings:
        qty = float(h.get('qty', 0) or h.get('shares', 0) or 0)
        buy_price = float(h.get('buyPrice', 0) or 0)
        price = float(h.get('price', 0) or buy_price)
        val = qty * price
        inv = qty * buy_price
        gain = val - inv
        total_val += val
        total_inv += inv
        holdings_summary.append({
            'symbol': h.get('symbol'),
            'yahooSymbol': h.get('yahooSymbol') or f"{h.get('symbol')}.NS",
            'assetClass': h.get('assetClass') or 'Equity',
            'qty': qty,
            'buyPrice': buy_price,
            'currentPrice': price,
            'value': round(val, 2),
            'gain': round(gain, 2),
            'gainPct': round((gain / inv * 100) if inv > 0 else 0, 2)
        })

    total_pnl = total_val - total_inv
    total_pnl_pct = (total_pnl / total_inv * 100) if total_inv > 0 else 0

    portfolio_context = {
        'totalNetWorth': round(total_val, 2),
        'investedCapital': round(total_inv, 2),
        'totalGainLoss': round(total_pnl, 2),
        'overallReturnPct': round(total_pnl_pct, 2),
        'holdingsCount': len(holdings_summary),
        'holdings': holdings_summary
    }

    # Extract queried stock and fetch live quote
    stock_quote = extract_and_fetch_stock_quote(message)

    system_prompt = (
        "You are an expert Senior Financial Analyst & Portfolio Advisor for the Portfolio Tracker application. "
        "Your role is to answer user queries with precise financial facts, real-time market data, and actionable advice.\n\n"
        "Core Guidelines:\n"
        "1. SPECIFIC STOCK QUESTIONS (e.g., RAIN, RAIN.NSE, RELIANCE, TCS, INFY, etc.):\n"
        "   - Identify the exact company (e.g. Rain Industries Ltd, listed on NSE/BSE) and describe its real-world business model.\n"
        "   - Cite its Current Market Price (CMP), day change, and 52-week range from the live market data provided below.\n"
        "   - Explicitly note whether the user already owns it in their portfolio. If owned, evaluate their specific position and P&L. If not owned, advise on how it fits into their portfolio diversification.\n\n"
        "2. PORTFOLIO REVIEW QUESTIONS (e.g., 'view on portfolio', 'review my portfolio', 'is my portfolio good?'):\n"
        "   - Provide a comprehensive, structured portfolio review: Total Net Worth, Unrealized P&L, asset allocation (Equities vs MCX Commodities), top winners, underperformers, concentration risks, and strategic rebalancing suggestions.\n\n"
        "3. FORMATTING:\n"
        "   - Format your response in clean, professional GitHub Markdown with Markdown tables, bullet points, bold numbers, and clean sections. Never hallucinate or give generic boilerplate."
    )

    stock_quote_context = f"\nLive Real-Time Market Data for Queried Stock:\n{json.dumps(stock_quote, indent=2)}\n" if stock_quote else ""

    user_prompt = f"""User Portfolio Context:
{json.dumps(portfolio_context, indent=2)}
{stock_quote_context}
User Question: "{message}"

Please provide your expert financial analysis directly answering this question:"""

    # 1. Primary: Groq Cloud (Verified Active Models & Browser Headers)
    if groq_key:
        groq_models = ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b", "qwen/qwen3.6-27b"]
        for g_model in groq_models:
            try:
                groq_payload = json.dumps({
                    "model": g_model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt}
                    ],
                    "temperature": 0.4,
                    "max_tokens": 1200
                }).encode('utf-8')

                req = urllib.request.Request(
                    "https://api.groq.com/openai/v1/chat/completions",
                    data=groq_payload,
                    headers={
                        "Authorization": f"Bearer {groq_key}",
                        "Content-Type": "application/json",
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
                        "Accept": "application/json"
                    }
                )

                with urllib.request.urlopen(req, timeout=12) as resp:
                    if resp.status == 200:
                        res_json = json.loads(resp.read().decode('utf-8'))
                        text = res_json['choices'][0]['message']['content']
                        text = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL).strip()
                        if text:
                            return jsonify({'reply': text, 'response': text, 'mode': 'ai', 'provider': f'Groq ({g_model})'})
            except Exception as e:
                print(f"Groq API error on model {g_model}: {e}")
                continue

    # 2. Secondary: OpenRouter
    if openrouter_key:
        or_models = ["deepseek/deepseek-r1:free", "meta-llama/llama-3.3-70b-instruct:free"]
        for or_model in or_models:
            try:
                or_payload = json.dumps({
                    "model": or_model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt}
                    ]
                }).encode('utf-8')
                req = urllib.request.Request(
                    "https://openrouter.ai/api/v1/chat/completions",
                    data=or_payload,
                    headers={
                        "Authorization": f"Bearer {openrouter_key}",
                        "Content-Type": "application/json",
                        "HTTP-Referer": "http://localhost:8080",
                        "X-Title": "Portfolio Tracker",
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                    }
                )
                with urllib.request.urlopen(req, timeout=12) as resp:
                    if resp.status == 200:
                        res_json = json.loads(resp.read().decode('utf-8'))
                        text = res_json['choices'][0]['message']['content']
                        text = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL).strip()
                        if text:
                            return jsonify({'reply': text, 'response': text, 'mode': 'ai', 'provider': f'OpenRouter ({or_model})'})
            except Exception as e:
                print(f"OpenRouter error: {e}")

    # 3. Tertiary: Google Gemini API
    if gemini_key:
        models_to_try = ["gemini-2.0-flash", "gemini-1.5-flash"]
        for model_name in models_to_try:
            try:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={gemini_key}"
                req_data = json.dumps({
                    "contents": [{"parts": [{"text": f"{system_prompt}\n\n{user_prompt}"}]}],
                    "generationConfig": {"temperature": 0.4, "maxOutputTokens": 1200}
                }).encode('utf-8')
                req = urllib.request.Request(url, data=req_data, headers={'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=10) as resp:
                    if resp.status == 200:
                        result = json.loads(resp.read().decode('utf-8'))
                        text = result.get('candidates', [{}])[0].get('content', {}).get('parts', [{}])[0].get('text')
                        if text:
                            return jsonify({'reply': text, 'response': text, 'mode': 'ai', 'provider': f'Gemini ({model_name})'})
            except Exception as e:
                print(f"Gemini error on {model_name}: {e}")

    # 4. Fallback: Intelligent Heuristic Engine
    analysis = generate_fallback_analysis(holdings_summary, total_val, total_inv, total_pnl, total_pnl_pct, message, stock_quote)
    return jsonify({'reply': analysis, 'response': analysis, 'mode': 'local', 'provider': 'Portfolio Analytics Engine (Rule-Based)'})


# ─────────────────────────────────────────────────────────────────────────────
# IPO Data Route  - NSE (Live Sub) + Groww (Open/Upcoming/Listed) + IPOWatch (Live GMP)

# Cache: 10 minutes in-memory

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

_ipo_cache = {'data': None, 'ts': 0}

_IPO_CACHE_TTL = 600  # 10 minutes

