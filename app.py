import http.server
import urllib.request
import urllib.parse
import os
import sys
import socket
import sqlite3
import hashlib
import json
from flask import Flask, jsonify, request, session, send_from_directory

PORT = 8080
DIRECTORY = os.path.dirname(os.path.abspath(__file__))
DATABASE = os.path.join(DIRECTORY, 'database.db')

def load_env_file():
    for name in ['.env', 'env']:
        env_path = os.path.join(DIRECTORY, name)
        if os.path.exists(env_path):
            with open(env_path, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#'):
                        key_val = line.split('=', 1)
                        if len(key_val) == 2:
                            k, v = key_val
                            os.environ[k.strip()] = v.strip().strip('"').strip("'")
            break

load_env_file()


app = Flask(__name__)
# Cryptographically sign the session cookie securely
app.secret_key = 'super-secret-key-for-portfolio-tracker'
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'

def init_db():
    with sqlite3.connect(DATABASE) as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                security_question TEXT,
                security_answer TEXT
            )
        ''')
        # Handle migration for existing databases
        try:
            conn.execute('ALTER TABLE users ADD COLUMN security_question TEXT')
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute('ALTER TABLE users ADD COLUMN security_answer TEXT')
        except sqlite3.OperationalError:
            pass

        conn.execute('''
            CREATE TABLE IF NOT EXISTS holdings (
                id TEXT NOT NULL,
                user_email TEXT NOT NULL,
                symbol TEXT NOT NULL,
                exchange TEXT NOT NULL,
                name TEXT NOT NULL,
                yahooSymbol TEXT NOT NULL,
                assetClass TEXT NOT NULL,
                qty REAL NOT NULL,
                buyPrice REAL NOT NULL,
                price REAL NOT NULL,
                PRIMARY KEY (id, user_email),
                FOREIGN KEY(user_email) REFERENCES users(email) ON DELETE CASCADE
            )
        ''')
        conn.commit()

init_db()

def hash_password(password):
    salt = os.urandom(16)
    pw_hash = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 100000)
    return salt.hex() + ':' + pw_hash.hex()

def verify_password(stored_password, provided_password):
    try:
        salt_hex, hash_hex = stored_password.split(':')
        salt = bytes.fromhex(salt_hex)
        pw_hash = hashlib.pbkdf2_hmac('sha256', provided_password.encode(), salt, 100000)
        return pw_hash.hex() == hash_hex
    except Exception:
        return False

def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip

# Serve the static frontend index page
@app.route('/')
def index():
    for filename in ['PORTFOLIO TRACKER.html', 'PORTFOLIO.html.html', 'PORTFOLIO.html']:
        if os.path.exists(os.path.join(DIRECTORY, filename)):
            return send_from_directory(DIRECTORY, filename)
    return "HTML file not found in directory. Make sure PORTFOLIO TRACKER.html is in the same folder as app.py", 404

# Support serving any static files (images, icons, etc.)
@app.route('/<path:path>')
def static_files(path):
    return send_from_directory(DIRECTORY, path)

# Serve the PDF-ready Project Report
@app.route('/project-report')
def project_report():
    return send_from_directory(DIRECTORY, 'PROJECT_REPORT.html')

# Secure Admin Dashboard for the Owner
@app.route('/admin')
def admin_panel():
    secret = request.args.get('secret')
    # Default secret password to access panel
    if secret != 'admin123':
        return """
        <!DOCTYPE html>
        <html>
        <head>
            <title>Admin Access Denied</title>
            <style>
                body { background: #111417; color: #E9EBEE; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                .card { background: #181C21; padding: 30px; border-radius: 8px; border: 1px solid #282D34; text-align: center; max-width: 400px; }
                input { background: #111417; border: 1px solid #282D34; padding: 10px; color: #E9EBEE; width: 100%; border-radius: 4px; box-sizing: border-box; margin: 15px 0; }
                button { background: #2DD4BF; color: #04211D; border: none; padding: 10px 20px; font-weight: bold; border-radius: 4px; cursor: pointer; }
            </style>
        </head>
        <body>
            <div class="card">
                <h2>Admin Panel Access</h2>
                <p>Please enter the secret admin key:</p>
                <form method="GET" action="/admin">
                    <input type="password" name="secret" placeholder="Secret Key">
                    <button type="submit">Access Panel</button>
                </form>
            </div>
        </body>
        </html>
        """
    
    try:
        with sqlite3.connect(DATABASE) as conn:
            conn.row_factory = sqlite3.Row
            users = conn.execute('SELECT id, email FROM users').fetchall()
            holdings = conn.execute('SELECT id, user_email, symbol, exchange, name, qty, buyPrice, price FROM holdings').fetchall()
    except Exception as e:
        return f"Database error: {str(e)}"
    
    users_rows = "".join(f"<tr><td>{u['id']}</td><td>{u['email']}</td></tr>" for u in users)
    holdings_rows = "".join(f"<tr><td>{h['user_email']}</td><td>{h['symbol']}</td><td>{h['exchange']}</td><td>{h['name']}</td><td>{h['qty']}</td><td>₹{h['buyPrice']}</td><td>₹{h['price']}</td></tr>" for h in holdings)
    
    return f"""
    <!DOCTYPE html>
    <html>
    <head>
        <title>Portfolio Admin Dashboard</title>
        <style>
            body {{ background: #111417; color: #E9EBEE; font-family: sans-serif; padding: 40px; margin: 0; }}
            h1, h2 {{ color: #2DD4BF; }}
            .grid {{ display: grid; grid-template-columns: 1fr 2fr; gap: 30px; margin-top: 20px; }}
            .card {{ background: #181C21; padding: 24px; border-radius: 12px; border: 1px solid #282D34; }}
            table {{ width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 13px; }}
            th, td {{ text-align: left; padding: 12px; border-bottom: 1px solid #20242A; }}
            th {{ text-align: left; color: #98A0AC; font-size: 11px; text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em; }}
            tr:hover {{ background: rgba(255,255,255,0.02); }}
            .stats {{ display: flex; gap: 20px; margin-bottom: 30px; }}
            .stat-card {{ background: #181C21; border: 1px solid #282D34; border-radius: 8px; padding: 20px; flex: 1; }}
            .stat-val {{ font-size: 24px; font-weight: bold; color: #E9EBEE; margin-top: 5px; }}
        </style>
    </head>
    <body>
        <h1>Portfolio Tracker Admin Console</h1>
        <div class="stats">
            <div class="stat-card">
                <div>Total Registered Users</div>
                <div class="stat-val">{len(users)}</div>
            </div>
            <div class="stat-card">
                <div>Total Holdings Tracked</div>
                <div class="stat-val">{len(holdings)}</div>
            </div>
        </div>
        
        <div class="grid">
            <div class="card">
                <h2>User Accounts</h2>
                <table>
                    <thead>
                        <tr><th>ID</th><th>Email</th></tr>
                    </thead>
                    <tbody>
                        {users_rows if users_rows else "<tr><td colspan='2'>No users registered yet.</td></tr>"}
                    </tbody>
                </table>
            </div>
            <div class="card">
                <h2>All Holdings Data</h2>
                <table>
                    <thead>
                        <tr><th>User Email</th><th>Symbol</th><th>Exchange</th><th>Name</th><th>Qty</th><th>Buy Price</th><th>Current Price</th></tr>
                    </thead>
                    <tbody>
                        {holdings_rows if holdings_rows else "<tr><td colspan='7'>No holdings added yet.</td></tr>"}
                    </tbody>
                </table>
            </div>
        </div>
    </body>
    </html>
    """

# REST API: Authentication Status
@app.route('/api/session', methods=['GET'])
def get_session():
    email = session.get('email')
    if email:
        return jsonify({'email': email})
    return jsonify({'email': None}), 200

# REST API: User Signup
@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json() or {}
    email = data.get('email', '').strip().lower()
    password = data.get('password', '')

    if not email or not password:
        return jsonify({'error': 'Email and password are required'}), 400
    if len(password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters'}), 400

    try:
        with sqlite3.connect(DATABASE) as conn:
            # Check if user already exists
            cursor = conn.cursor()
            cursor.execute('SELECT email FROM users WHERE email = ?', (email,))
            if cursor.fetchone():
                return jsonify({'error': 'An account with that email already exists'}), 400

            # Create user
            pw_hash = hash_password(password)
            conn.execute(
                'INSERT INTO users (email, password_hash) VALUES (?, ?)',
                (email, pw_hash)
            )
            conn.commit()

        session['email'] = email
        return jsonify({'success': True, 'email': email})
    except Exception as e:
        return jsonify({'error': f'Database error: {str(e)}'}), 500

# REST API: User Login
@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json() or {}
    email = data.get('email', '').strip().lower()
    password = data.get('password', '')

    if not email or not password:
        return jsonify({'error': 'Email and password are required'}), 400

    try:
        with sqlite3.connect(DATABASE) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute('SELECT password_hash FROM users WHERE email = ?', (email,))
            row = cursor.fetchone()
            if not row or not verify_password(row['password_hash'], password):
                return jsonify({'error': 'Incorrect email or password'}), 400

        session['email'] = email
        return jsonify({'success': True, 'email': email})
    except Exception as e:
        return jsonify({'error': f'Database error: {str(e)}'}), 500

# REST API: User Logout
@app.route('/api/logout', methods=['POST'])
def logout():
    session.pop('email', None)
    return jsonify({'success': True})

# REST API: Get Holdings
@app.route('/api/holdings', methods=['GET'])
def get_holdings():
    email = session.get('email')
    if not email:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        with sqlite3.connect(DATABASE) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute('''
                SELECT id, symbol, exchange, name, yahooSymbol, assetClass, qty, buyPrice, price 
                FROM holdings WHERE user_email = ?
            ''', (email,))
            rows = cursor.fetchall()
            
            holdings = []
            for row in rows:
                h = dict(row)
                # Compute amounts
                h['amount'] = h['buyPrice'] * h['qty']
                holdings.append(h)
            return jsonify(holdings)
    except Exception as e:
        return jsonify({'error': f'Database error: {str(e)}'}), 500

# REST API: Save Holdings (Sync full list from UI state)
@app.route('/api/holdings', methods=['POST'])
def save_holdings():
    email = session.get('email')
    if not email:
        return jsonify({'error': 'Unauthorized'}), 401

    holdings = request.get_json()
    if not isinstance(holdings, list):
        return jsonify({'error': 'Invalid holdings payload'}), 400

    try:
        with sqlite3.connect(DATABASE) as conn:
            # Delete existing holdings for user
            conn.execute('DELETE FROM holdings WHERE user_email = ?', (email,))
            
            # Batch insert new ones
            for h in holdings:
                conn.execute('''
                    INSERT INTO holdings (id, user_email, symbol, exchange, name, yahooSymbol, assetClass, qty, buyPrice, price)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    h.get('id'),
                    email,
                    h.get('symbol'),
                    h.get('exchange'),
                    h.get('name'),
                    h.get('yahooSymbol'),
                    h.get('assetClass'),
                    float(h.get('qty', 0)),
                    float(h.get('buyPrice', 0)),
                    float(h.get('price', 0))
                ))
            conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': f'Database error: {str(e)}'}), 500

# REST API: Proxy Yahoo Finance requests to bypass CORS
@app.route('/proxy/<path:target>')
def proxy(target):
    # Retrieve query parameters string
    query_string = request.query_string.decode('utf-8')
    full_url = target
    if query_string:
        full_url += '?' + query_string

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
def run_local_analysis(message, holdings):
    if not holdings:
        return "Your portfolio is currently empty. Please add some stock or crypto holdings first, and I will be able to analyze your diversification, asset allocation, and performance!"

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

    msg_lower = message.lower()
    
    # 1. Diversification analysis
    if "diversi" in msg_lower or "risk" in msg_lower or "concentr" in msg_lower:
        num_holdings = len(holdings)
        if num_holdings == 1:
            div_status = "⚠️ **High Concentration Risk** (1 holding)"
            div_desc = f"Your entire portfolio is concentrated in **{holdings[0].get('symbol')}** ({largest_holding_val/total_value*100:.1f}% of total value). This exposes you to severe company-specific risk. Consider diversifying across other sectors or index ETFs (e.g., NIFTYBEES)."
        elif num_holdings < 4:
            div_status = "⚡ **Moderate Concentration Risk** (few holdings)"
            div_desc = f"You hold {num_holdings} assets. The largest holding is **{largest_holding.get('symbol')}** representing {largest_holding_val/total_value*100:.1f}% of your book. To optimize risk-adjusted returns, aim to add at least 5-10 non-correlated holdings across different industries."
        else:
            div_status = "✅ **Well Diversified Portfolio**"
            div_desc = f"You hold {num_holdings} assets. Your largest exposure is **{largest_holding.get('symbol')}** at {largest_holding_val/total_value*100:.1f}% of portfolio value. This allocation keeps company-specific risk relatively low."
        
        return f"""### 🔍 Portfolio Diversification & Risk Analysis

**Diversification Rating**: {div_status}

* **Asset Count**: {num_holdings} active asset(s).
* **Top Exposure**: {largest_holding.get('symbol')} ({largest_holding_val/total_value*100:.1f}% of assets).
* **Summary**: {div_desc}

#### Recommended Action Items:
1. **Explore Mutual Funds/ETFs**: They provide instant diversification across hundreds of companies.
2. **Limit Single Stocks**: Keep single stock allocations under 10-15% of your total net worth.
3. **Sector check**: Make sure your equities are not all in the same sector (e.g., banking or technology)."""

    # 2. Allocation analysis
    elif "allocat" in msg_lower or "class" in msg_lower or "distrib" in msg_lower or "pie" in msg_lower:
        alloc_rows = ""
        for ac, val in holdings_by_class.items():
            pct = (val / total_value * 100) if total_value > 0 else 0
            alloc_rows += f"* **{ac}**: ₹{val:,.2f} ({pct:.1f}%)\n"

        return f"""### 📊 Asset Class Allocation Analysis

Here is the current breakdown of your investments across different asset classes:

{alloc_rows}
* **Total Portfolio Value**: ₹{total_value:,.2f}

#### Insights:
* If you have a long time horizon, **Equity** should make up the core of your growth portfolio.
* **ETFs** (like NIFTYBEES or GOLDBEES) offer low-cost tracking of broader markets.
* Highly speculative assets (like **Crypto**) should generally occupy a smaller portion (e.g., 1-5%) of your total net worth."""

    # 3. Performance questions
    elif "gainer" in msg_lower or "loser" in msg_lower or "best" in msg_lower or "worst" in msg_lower or "perform" in msg_lower:
        gain_sign = "+" if total_gain >= 0 else ""
        return f"""### 📈 Portfolio Performance Audit

Your overall portfolio return is **{total_gain_pct:+.2f}%** (net gain of **{gain_sign}₹{total_gain:,.2f}**).

* **Top Performer**: **{highest_gainer.get('symbol')}** with a return of **{highest_gainer_pct:+.2f}%**.
* **Laggard**: **{highest_loser.get('symbol')}** returning **{highest_loser_pct:+.2f}%**.
* **Largest Asset**: **{largest_holding.get('symbol')}** (Current Value: ₹{largest_holding_val:,.2f}).

#### Recommendations:
* **Rebalance Winners**: If a single asset grows to dominate your portfolio, consider taking partial profits to restore your target allocation.
* **Review Laggards**: Periodically check if the investment thesis for your underperforming assets (like {highest_loser.get('symbol')}) still holds true."""

    # 4. Default portfolio overview response
    else:
        gain_sign = "+" if total_gain >= 0 else ""
        return f"""### 👋 Hello! I am your Portfolio AI Analyst.

Here is a quick snapshot and analysis of your portfolio:

* **Portfolio Net Worth**: **₹{total_value:,.2f}** (Invested: ₹{total_cost:,.2f})
* **Total Returns**: **{total_gain_pct:+.2f}%** ({gain_sign}₹{total_gain:,.2f} unrealised)
* **Holdings Count**: {len(holdings)} holdings.
* **Largest Position**: **{largest_holding.get('symbol')}** (₹{largest_holding_val:,.2f}, representing {largest_holding_val/total_value*100:.1f}%)
* **Top Gainer**: **{highest_gainer.get('symbol')}** ({highest_gainer_pct:+.2f}%)
* **Top Loser**: **{highest_loser.get('symbol')}** ({highest_loser_pct:+.2f}%)

#### Ask me questions like:
* *"Is my portfolio diversified?"*
* *"What is my asset class distribution?"*
* *"Which of my stocks is performing best?"*

*Disclaimer: This analysis is automatically generated from your holdings list and is for informational purposes only. It is not certified financial advice.*"""

# Upgraded Hybrid News Cache: 
# 'mc_articles' -> (timestamp, list_of_mc_articles)
# 'yahoo_articles' -> { symbol -> (timestamp, list_of_yahoo_articles) }
news_cache = {
    'mc_articles': None,
    'yahoo_articles': {}
}
CACHE_DURATION_SEC = 600

@app.route('/api/news', methods=['GET'])
def get_portfolio_news():
    email = session.get('email')
    if not email:
        return jsonify({'error': 'Unauthorized'}), 401

    symbols_arg = request.args.get('symbols', '')
    
    # 1. Fetch holdings details to build symbol matching keywords
    holdings_data = []
    try:
        with sqlite3.connect(DATABASE) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute('SELECT symbol, name, yahooSymbol FROM holdings WHERE user_email = ?', (email,))
            holdings_data = [dict(row) for row in cursor.fetchall()]
    except Exception as e:
        return jsonify({'error': f'Database error: {str(e)}'}), 500

    if symbols_arg:
        symbols = [s.strip().upper() for s in symbols_arg.split(',') if s.strip()]
    else:
        symbols = [h['yahooSymbol'].strip().upper() for h in holdings_data if h['yahooSymbol']]

    if not symbols and not symbols_arg:
        return jsonify([])

    import time
    import email.utils
    import xml.etree.ElementTree as ET
    import re
    from concurrent.futures import ThreadPoolExecutor

    # 2. Build Symbol Matchers for Moneycontrol (matches by ticker symbol or parts of stock name)
    symbol_matchers = []
    for h in holdings_data:
        sym = h.get('symbol', '').upper()
        name = h.get('name', '')
        yahoo_sym = h.get('yahooSymbol', '').upper()
        
        name_words = [w.strip() for w in re.split(r'\s+|,|\.|\&|\-', name) if len(w.strip()) >= 4]
        keywords = {sym, yahoo_sym}
        if name_words:
            keywords.add(name_words[0].upper())
            if len(name_words) > 1:
                keywords.add(f"{name_words[0]} {name_words[1]}".upper())
                
        symbol_matchers.append({
            'symbol': sym,
            'yahooSymbol': yahoo_sym,
            'keywords': list(keywords)
        })

    # 3. Fetch/Cache Moneycontrol RSS feeds
    current_time = time.time()
    mc_cache = news_cache.get('mc_articles')
    mc_articles = []
    
    if mc_cache and (current_time - mc_cache[0] < CACHE_DURATION_SEC):
        mc_articles = mc_cache[1]
    else:
        mc_feeds = {
            'BUZZING': 'https://www.moneycontrol.com/rss/buzzingstocks.xml',
            'RECOS': 'https://www.moneycontrol.com/rss/brokeragerecos.xml',
            'LATEST': 'https://www.moneycontrol.com/rss/latestnews.xml',
            'OUTLOOK': 'https://www.moneycontrol.com/rss/marketoutlook.xml'
        }
        
        def fetch_mc_feed(feed_type, url):
            req = urllib.request.Request(
                url,
                headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
            )
            try:
                with urllib.request.urlopen(req, timeout=8) as res:
                    xml_data = res.read()
                    root = ET.fromstring(xml_data)
                    items = root.findall('.//item')
                    feed_articles = []
                    for item in items:
                        title = item.find('title')
                        link = item.find('link')
                        desc = item.find('description')
                        pub_date = item.find('pubDate')
                        guid = item.find('guid')
                        
                        title_text = title.text if title is not None else ''
                        link_text = link.text if link is not None else ''
                        desc_text = desc.text if desc is not None else ''
                        pub_date_text = pub_date.text if pub_date is not None else ''
                        guid_text = guid.text if guid is not None else link_text
                        
                        # Extract image & description from description tag HTML
                        img_url = None
                        clean_desc = desc_text
                        if desc_text:
                            img_match = re.search(r'src="([^"]+)"', desc_text)
                            if img_match:
                                img_url = img_match.group(1)
                            clean_desc = re.sub(r'<[^>]+>', '', desc_text).strip()
                            
                        # Parse target price if it is a brokerage recommendation
                        target_price = None
                        if feed_type == 'RECOS' or 'target' in title_text.lower():
                            tgt_match = re.search(r'target\s*(?:of\s*)?(?:Rs\.?\s*|Rs\s*)?([\d,]+)', title_text, re.IGNORECASE)
                            if tgt_match:
                                target_price = f"₹{tgt_match.group(1)}"
                                
                        pub_time = 0
                        if pub_date_text:
                            try:
                                pub_time = int(email.utils.parsedate_to_datetime(pub_date_text).timestamp())
                            except Exception:
                                pass
                                
                        feed_articles.append({
                            'uuid': guid_text,
                            'title': title_text,
                            'publisher': 'Moneycontrol',
                            'link': link_text,
                            'providerPublishTime': pub_time,
                            'summary': clean_desc,
                            'thumbnail': {'resolutions': [{'url': img_url}]} if img_url else None,
                            'type': feed_type,
                            'targetPrice': target_price,
                            'relatedTickers': []
                        })
                    return feed_articles
            except Exception as e:
                print(f"Error fetching Moneycontrol {feed_type} feed: {str(e)}")
                return []

        with ThreadPoolExecutor(max_workers=4) as executor:
            futures = [executor.submit(fetch_mc_feed, name, url) for name, url in mc_feeds.items()]
            for f in futures:
                mc_articles.extend(f.result())
                
        # Deduplicate
        mc_dedup = []
        seen_links = set()
        for art in mc_articles:
            l = art['link']
            if l not in seen_links:
                seen_links.add(l)
                mc_dedup.append(art)
        mc_articles = mc_dedup
        
        # Save to cache
        news_cache['mc_articles'] = (current_time, mc_articles)

    # 4. Map symbols to Moneycontrol articles
    for art in mc_articles:
        title_upper = art['title'].upper()
        summary_upper = art['summary'].upper()
        matched_symbols = []
        for matcher in symbol_matchers:
            matched = False
            for kw in matcher['keywords']:
                pattern = r'\b' + re.escape(kw) + r'\b'
                if re.search(pattern, title_upper) or re.search(pattern, summary_upper):
                    matched = True
                    break
            if matched:
                matched_symbols.append(matcher['yahooSymbol'])
        art['relatedTickers'] = matched_symbols

    # 5. Fetch/Cache Yahoo Finance news for active symbols
    yahoo_cache = news_cache.setdefault('yahoo_articles', {})
    symbols_to_fetch = []
    
    for s in symbols:
        y_cache = yahoo_cache.get(s)
        if not y_cache or (current_time - y_cache[0] > CACHE_DURATION_SEC):
            symbols_to_fetch.append(s)
            
    def fetch_single_yahoo_news(symbol):
        url = f"https://query2.finance.yahoo.com/v1/finance/search?q={urllib.parse.quote(symbol)}&newsCount=8"
        req = urllib.request.Request(
            url,
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        )
        try:
            with urllib.request.urlopen(req, timeout=8) as res:
                data = json.loads(res.read().decode('utf-8'))
                news_list = data.get('news', [])
                for item in news_list:
                    item['symbol'] = symbol
                    item['type'] = 'YAHOO'
                    img_url = None
                    resols = item.get('thumbnail', {}).get('resolutions', [])
                    if resols:
                        img_url = resols[0].get('url')
                    item['thumbnail'] = {'resolutions': [{'url': img_url}]} if img_url else None
                    item['summary'] = item.get('summary', '') or ''
                return symbol, news_list
        except Exception as e:
            print(f"Error fetching Yahoo news for {symbol}: {str(e)}")
            return symbol, []

    if symbols_to_fetch:
        with ThreadPoolExecutor(max_workers=min(len(symbols_to_fetch), 5)) as executor:
            fetched = executor.map(fetch_single_yahoo_news, symbols_to_fetch)
            for symbol, news_list in fetched:
                yahoo_cache[symbol] = (current_time, news_list)

    # 6. Merge, filter, and sort all articles
    all_articles = []
    seen_uuids = set()
    
    if symbols_arg:
        requested_symbols = [s.upper() for s in symbols]
        for art in mc_articles:
            if any(t in requested_symbols for t in art.get('relatedTickers', [])):
                uuid = art.get('uuid') or art.get('link')
                if uuid not in seen_uuids:
                    seen_uuids.add(uuid)
                    all_articles.append(art)
    else:
        for art in mc_articles:
            uuid = art.get('uuid') or art.get('link')
            if uuid not in seen_uuids:
                seen_uuids.add(uuid)
                all_articles.append(art)

    for s in symbols:
        y_cache = yahoo_cache.get(s)
        if y_cache:
            for art in y_cache[1]:
                uuid = art.get('uuid') or art.get('link')
                if uuid not in seen_uuids:
                    seen_uuids.add(uuid)
                    tickers = art.setdefault('relatedTickers', [])
                    if s not in tickers:
                        tickers.append(s)
                    all_articles.append(art)

    all_articles.sort(key=lambda x: x.get('providerPublishTime', 0), reverse=True)
    return jsonify(all_articles)

@app.route('/api/ask-ai', methods=['POST'])
def ask_ai():
    email = session.get('email')
    if not email:
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.get_json() or {}
    message = data.get('message', '').strip()
    holdings = data.get('holdings', []) or []

    if not message:
        return jsonify({'error': 'Message is required'}), 400

    gemini_key = os.getenv('GEMINI_API_KEY')
    xai_key = os.getenv('XAI_API_KEY') or os.getenv('GROK_API_KEY')

    if gemini_key:
        gemini_key = gemini_key.strip().replace('"', '').replace("'", "")
        if gemini_key.lower() in ('none', 'null', 'false', ''):
            gemini_key = None
            
    if xai_key:
        xai_key = xai_key.strip().replace('"', '').replace("'", "")
        if xai_key.lower() in ('none', 'null', 'false', ''):
            xai_key = None

    # Format holdings context
    holdings_summary = []
    for h in holdings:
        qty = float(h.get('qty', 0) or 0)
        buy_price = float(h.get('buyPrice', 0) or 0)
        price = float(h.get('price', 0) or 0)
        holdings_summary.append({
            'symbol': h.get('symbol'),
            'exchange': h.get('exchange'),
            'name': h.get('name'),
            'assetClass': h.get('assetClass') or 'Equity',
            'qty': qty,
            'buyPrice': buy_price,
            'price': price,
            'value': qty * price,
            'gain': (price - buy_price) * qty
        })

    prompt = f"""You are an AI investment analyst for the Portfolio Tracker application.
Analyze the user's portfolio and answer their question. Be professional, direct, and helpful. Focus on financial analysis, risk, diversification, and asset allocation based ONLY on the holdings data provided.

User's Portfolio Holdings:
{json.dumps(holdings_summary, indent=2)}

User Question: "{message}"

Provide a detailed response in clean Markdown. Keep paragraphs short. Do not provide speculative certified financial advice. Add a standard disclaimer at the very end."""

    # 1. Try Gemini API first if configured
    if gemini_key:
        try:
            models_to_try = [
                "gemini-3.6-flash",
                "gemini-3.5-flash",
                "gemini-3.1-flash-lite",
                "gemini-2.0-flash-lite",
                "gemini-2.0-flash"
            ]
            text_response = None
            used_model = None
            last_err = None
            
            for model_name in models_to_try:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={gemini_key}"
                req_data = json.dumps({
                    "contents": [{
                        "parts": [{
                            "text": prompt
                        }]
                    }]
                }).encode('utf-8')
                
                req = urllib.request.Request(
                    url,
                    data=req_data,
                    headers={'Content-Type': 'application/json'}
                )
                try:
                    with urllib.request.urlopen(req) as response:
                        res_body = json.loads(response.read().decode('utf-8'))
                        text_response = res_body['candidates'][0]['content']['parts'][0]['text']
                        used_model = model_name
                        break
                except urllib.error.HTTPError as e:
                    last_err = e
                    # Fallback to next model for any model-specific availability, auth, or quota issues
                    if e.code in (404, 400, 401, 403, 429):
                        continue
                    else:
                        raise e
                except Exception as e:
                    last_err = e
                    raise e
            
            if text_response:
                return jsonify({
                    'response': text_response,
                    'mode': 'ai',
                    'provider': 'gemini',
                    'model': used_model
                })
            else:
                if last_err:
                    raise last_err
        except Exception as e:
            masked_key = gemini_key[:6] + "..." if gemini_key else "None"
            gemini_err = f"{str(e)} (Key: {masked_key})"
            print(f"Gemini API Error: {gemini_err}")

    # 2. Try Grok API if configured and Gemini key not present (or failed)
    if xai_key and not ('text_response' in locals() and text_response):
        try:
            models_to_try = ["grok-2", "grok-beta"]
            text_response = None
            used_model = None
            last_err = None
            
            for model_name in models_to_try:
                url = "https://api.x.ai/v1/chat/completions"
                req_payload = {
                    "messages": [{"role": "user", "content": prompt}],
                    "model": model_name,
                    "stream": False,
                    "temperature": 0.2
                }
                req_data = json.dumps(req_payload).encode('utf-8')
                
                req = urllib.request.Request(
                    url,
                    data=req_data,
                    headers={
                        'Content-Type': 'application/json',
                        'Authorization': f'Bearer {xai_key}'
                    }
                )
                try:
                    with urllib.request.urlopen(req) as response:
                        res_body = json.loads(response.read().decode('utf-8'))
                        text_response = res_body['choices'][0]['message']['content']
                        used_model = model_name
                        break
                except urllib.error.HTTPError as e:
                    last_err = e
                    if e.code in (404, 400):
                        continue
                    else:
                        raise e
                except Exception as e:
                    last_err = e
                    raise e
            
            if text_response:
                return jsonify({
                    'response': text_response,
                    'mode': 'ai',
                    'provider': 'grok',
                    'model': used_model
                })
            else:
                if last_err:
                    raise last_err
        except Exception as e:
            masked_key = xai_key[:6] + "..." if xai_key else "None"
            grok_err = f"{str(e)} (Key: {masked_key})"
            print(f"Grok API Error: {grok_err}")

    # Rules-based local analyzer
    res_text = run_local_analysis(message, holdings)
    
    # Check if there was an active key error
    active_err = None
    if gemini_key and 'gemini_err' in locals():
        active_err = f"Gemini connection failed: {gemini_err}"
    elif xai_key and 'grok_err' in locals():
        active_err = f"Grok connection failed: {grok_err}"

    return jsonify({
        'response': res_text,
        'mode': 'local',
        'warning': 'Running in Local Analysis mode. Add a free GEMINI_API_KEY to your env file to enable full Live AI.',
        'api_error': active_err
    })

if __name__ == '__main__':
    init_db()
    local_ip = get_local_ip()
    print("==================================================================")
    print("                FULL STACK FLASK & SQLITE DATABASE SERVER        ")
    print("==================================================================")
    print(f"-> Access on your PC:           http://127.0.0.1:{PORT}/")
    print(f"-> Access on your mobile phone: http://{local_ip}:{PORT}/")
    print("==================================================================")
    print("(Make sure your phone and PC are connected to the same Wi-Fi network)")
    print("Press Ctrl+C to stop.")
    app.run(host='0.0.0.0', port=PORT, debug=True, use_reloader=False)
