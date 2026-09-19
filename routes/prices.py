# routes/prices.py
# Fetches real-time and historical stock/commodity prices:
#   GET/POST /api/live-prices    - Live price from Yahoo Finance (parallel)
#   GET      /api/chart-history  - OHLC chart data
#   GET      /proxy/<target>     - CORS proxy for external APIs

import json, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor
from flask import Blueprint, jsonify, request

prices_bp = Blueprint('prices', __name__)

LIVE_PRICE_CACHE  = {}   # { symbol: (timestamp, price_obj) }
CHART_HISTORY_CACHE = {} # { cache_key: (timestamp, payload) }
PRICE_CACHE_TTL_SEC  = 45   # 45-second cache
CHART_CACHE_TTL_SEC  = 300  # 5-minute cache

@prices_bp.route('/api/live-prices', methods=['GET', 'POST'])
def get_live_prices():
    symbols = []
    if request.method == 'POST':
        data = request.get_json(silent=True) or {}
        symbols = data.get('symbols', [])
    else:
        symbols_str = request.args.get('symbols', '')
        if symbols_str:
            symbols = [s.strip() for s in symbols_str.split(',') if s.strip()]

    if not symbols:
        return jsonify({'success': True, 'prices': {}, 'count': 0})

    current_time = time.time()
    results = {}
    missing_symbols = []

    # 1. Check in-memory cache first (instant response)
    for sym in symbols:
        sym_clean = sym.strip().upper()
        base = sym_clean.replace('.NS', '').replace('.BO', '').replace('-INR', '')
        cached = LIVE_PRICE_CACHE.get(base) or LIVE_PRICE_CACHE.get(sym_clean)
        if cached and (current_time - cached[0] < PRICE_CACHE_TTL_SEC):
            results[base] = cached[1]
        else:
            missing_symbols.append(sym_clean)

    # 2. Fetch missing symbols in parallel with optimized fast timeouts
    if missing_symbols:
        def fetch_single_quote(sym_clean):
            # 1. Handle MCX Commodities (Gold, Silver, Crude, Natural Gas, Copper)
            clean_upper = sym_clean.replace('.MCX', '').replace('MCX:', '').strip().upper()
            commodity_configs = {
                'GOLD': {'yahoo': 'GC=F', 'mult': 16.55, 'unit': '10g'},       # Gold ~74,000 / 10g
                'SILVER': {'yahoo': 'SI=F', 'mult': 1277.0, 'unit': '1kg'},    # Silver ~85,000 / 1kg
                'CRUDEOIL': {'yahoo': 'CL=F', 'mult': 70.0, 'unit': 'bbl'},     # Crude ~6,280 / bbl
                'NATURALGAS': {'yahoo': 'NG=F', 'mult': 66.0, 'unit': 'mmBtu'}, # Nat Gas ~199 / mmBtu
                'COPPER': {'yahoo': 'HG=F', 'mult': 183.0, 'unit': 'kg'},       # Copper ~825 / kg
            }

            if clean_upper in commodity_configs:
                cfg = commodity_configs[clean_upper]
                try:
                    url = f'https://query1.finance.yahoo.com/v8/finance/chart/{cfg["yahoo"]}?range=1d&interval=1m'
                    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                    with urllib.request.urlopen(req, timeout=3.0) as res:
                        data = json.loads(res.read().decode('utf-8'))
                        meta = data.get('chart', {}).get('result', [{}])[0].get('meta', {})
                        raw_p = meta.get('regularMarketPrice')
                        raw_prev = meta.get('chartPreviousClose') or raw_p
                        if raw_p is not None and float(raw_p) > 0:
                            calc_price = round(float(raw_p) * cfg['mult'], 2)
                            calc_prev = round(float(raw_prev) * cfg['mult'], 2)
                            price_obj = {
                                'price': calc_price,
                                'prevClose': calc_prev,
                                'symbol': f'{clean_upper}.MCX',
                                'assetClass': 'Commodity',
                                'live': True
                            }
                            LIVE_PRICE_CACHE[clean_upper] = (current_time, price_obj)
                            LIVE_PRICE_CACHE[f'{clean_upper}.MCX'] = (current_time, price_obj)
                            return clean_upper, price_obj
                except Exception as e:
                    pass

            # 2. Handle Indian Equities (NSE / BSE)
            candidates = []
            if sym_clean.endswith('.NS') or sym_clean.endswith('.BO'):
                candidates.append(sym_clean)
            else:
                candidates.append(f'{sym_clean}.NS')
                candidates.append(f'{sym_clean}.BO')
                candidates.append(sym_clean)

            for target in candidates:
                url = f'https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(target)}?range=1d&interval=1m'
                req = urllib.request.Request(
                    url,
                    headers={
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                        'Accept': 'application/json',
                        'Accept-Language': 'en-US,en;q=0.9'
                    }
                )
                try:
                    with urllib.request.urlopen(req, timeout=2.5) as res:
                        data = json.loads(res.read().decode('utf-8'))
                        meta = data.get('chart', {}).get('result', [{}])[0].get('meta', {})
                        price = meta.get('regularMarketPrice')
                        prev = meta.get('chartPreviousClose') or price
                        base = sym_clean.replace('.NS', '').replace('.BO', '').replace('-INR', '')

                        if price is not None and float(price) > 0:
                            price_obj = {
                                'price': round(float(price), 2),
                                'prevClose': round(float(prev), 2),
                                'symbol': target,
                                'live': True
                            }
                            LIVE_PRICE_CACHE[base] = (current_time, price_obj)
                            LIVE_PRICE_CACHE[sym_clean] = (current_time, price_obj)
                            return base, price_obj
                except Exception:
                    continue

            return sym_clean, None

        from concurrent.futures import ThreadPoolExecutor
        workers = min(20, max(len(missing_symbols), 1))
        with ThreadPoolExecutor(max_workers=workers) as executor:
            fetched = executor.map(fetch_single_quote, missing_symbols)
            for res_base, price_data in fetched:
                if price_data is not None:
                    results[res_base] = price_data

    return jsonify({
        'success': True,
        'prices': results,
        'count': len(results),
        'cached': len(symbols) - len(missing_symbols)
    })

# REST API: Historical Chart Data for Indian Equities (NSE/BSE) & MCX Commodities
CHART_HISTORY_CACHE = {}
CHART_CACHE_TTL_SEC = 300  # 5 minutes in-memory cache

@prices_bp.route('/api/chart-history', methods=['GET'])
def get_chart_history():
    symbol = request.args.get('symbol', '').strip().upper()
    exchange = request.args.get('exchange', 'NSE').strip().upper()
    range_val = request.args.get('range', '1mo').strip().lower()

    if not symbol:
        return jsonify({'error': 'Missing symbol parameter'}), 400

    range_map = {
        '1w': ('5d', '15m'),
        '5d': ('5d', '15m'),
        '1m': ('1mo', '1d'),
        '1mo': ('1mo', '1d'),
        '3m': ('3mo', '1d'),
        '3mo': ('3mo', '1d'),
        '6m': ('6mo', '1d'),
        '6mo': ('6mo', '1d'),
        '1y': ('1y', '1d'),
        '5y': ('5y', '1wk'),
        'all': ('max', '1mo')
    }

    y_range, y_interval = range_map.get(range_val, ('1mo', '1d'))
    cache_key = f"{symbol}_{exchange}_{y_range}_{y_interval}"
    now = time.time()
    cached = CHART_HISTORY_CACHE.get(cache_key)
    if cached and (now - cached[0] < CHART_CACHE_TTL_SEC):
        return jsonify(cached[1])

    # Commodity handling (MCX)
    commodity_configs = {
        'GOLD': {'yahoo': 'GC=F', 'mult': 16.55},
        'SILVER': {'yahoo': 'SI=F', 'mult': 1277.0},
        'CRUDEOIL': {'yahoo': 'CL=F', 'mult': 70.0},
        'NATURALGAS': {'yahoo': 'NG=F', 'mult': 66.0},
        'COPPER': {'yahoo': 'HG=F', 'mult': 183.0}
    }

    clean_sym = symbol.replace('.MCX', '').replace('MCX:', '').replace('.NS', '').replace('.BO', '').strip()
    mult = 1.0

    if exchange == 'MCX' or clean_sym in commodity_configs:
        cfg = commodity_configs.get(clean_sym)
        if cfg:
            yahoo_sym = cfg['yahoo']
            mult = cfg.get('mult', 1.0)
        else:
            yahoo_sym = f"{clean_sym}.MCX"
    elif exchange in ['BSE', 'BO'] or symbol.endswith('.BO'):
        yahoo_sym = f"{clean_sym}.BO"
    else:
        yahoo_sym = f"{clean_sym}.NS"

    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{yahoo_sym}?range={y_range}&interval={y_interval}"
    req = urllib.request.Request(
        url,
        headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}
    )

    try:
        with urllib.request.urlopen(req, timeout=6.0) as res:
            data = json.loads(res.read().decode('utf-8'))
            chart_res = data.get('chart', {}).get('result', [])
            if not chart_res:
                return jsonify({'error': 'No chart data returned from provider'}), 404

            result = chart_res[0]
            timestamps = result.get('timestamp', [])
            indicators = result.get('indicators', {})
            quotes = indicators.get('quote', [{}])[0] if indicators.get('quote') else {}

            closes = quotes.get('close', [])
            opens = quotes.get('open', [])
            highs = quotes.get('high', [])
            lows = quotes.get('low', [])
            volumes = quotes.get('volume', [])

            points = []
            for i, ts in enumerate(timestamps):
                c = closes[i] if i < len(closes) else None
                if c is not None and not (c != c):
                    o = opens[i] if i < len(opens) and opens[i] is not None else c
                    h = highs[i] if i < len(highs) and highs[i] is not None else c
                    l = lows[i] if i < len(lows) and lows[i] is not None else c
                    v = volumes[i] if i < len(volumes) and volumes[i] is not None else 0
                    points.append({
                        'time': ts,
                        'close': round(c * mult, 2),
                        'open': round(o * mult, 2),
                        'high': round(h * mult, 2),
                        'low': round(l * mult, 2),
                        'volume': int(v)
                    })

            if not points:
                return jsonify({'error': 'No valid price points found'}), 404

            first_p = points[0]['close']
            last_p = points[-1]['close']
            period_change = round(last_p - first_p, 2)
            period_pct = round((period_change / first_p * 100) if first_p else 0, 2)

            all_highs = [p['high'] for p in points]
            all_lows = [p['low'] for p in points]
            high_p = max(all_highs) if all_highs else last_p
            low_p = min(all_lows) if all_lows else last_p

            res_payload = {
                'success': True,
                'symbol': symbol,
                'exchange': exchange,
                'yahooSymbol': yahoo_sym,
                'range': range_val,
                'currentPrice': last_p,
                'periodChange': period_change,
                'periodPct': period_pct,
                'periodHigh': high_p,
                'periodLow': low_p,
                'points': points
            }

            CHART_HISTORY_CACHE[cache_key] = (now, res_payload)
            return jsonify(res_payload)
    except Exception as e:
        return jsonify({'error': f'Failed to fetch chart data: {str(e)}'}), 500


@prices_bp.route('/proxy/<path:target>')
def proxy(target):
    # Retrieve query parameters string

    query_string = request.query_string.decode('utf-8')

    full_url = target

    if query_string:

        full_url += '?' + query_string

    if full_url.startswith('https:/') and not full_url.startswith('https://'):

        full_url = 'https://' + full_url[7:]

    elif full_url.startswith('http:/') and not full_url.startswith('http://'):

        full_url = 'http://' + full_url[6:]

    if not full_url.startswith('http'):

        return jsonify({'error': 'Invalid Target URL'}), 400

    

    # Forward the request to Yahoo Finance

    req = urllib.request.Request(

        full_url,

        headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}

    )

    try:

        with urllib.request.urlopen(req) as res:

            response_data = res.read()

            return response_data, res.status, {'Content-Type': res.headers.get('Content-Type', 'application/json')}

    except Exception as e:

        return str(e), 500

# REST API: Ask AI Portfolio Analyst

