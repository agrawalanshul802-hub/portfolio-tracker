import http.server

import urllib.request
import urllib.parse
import os
import sys
import socket
import hashlib
import json
import re
import datetime
import time
from flask import Flask, jsonify, request, session, send_from_directory, redirect
from werkzeug.middleware.proxy_fix import ProxyFix

PORT = 8080

DIRECTORY = os.path.dirname(os.path.abspath(__file__))

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

app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)

# Cryptographically sign the session cookie securely

app.secret_key = os.getenv('SECRET_KEY', 'super-secret-key-for-portfolio-tracker-production')

app.config['SESSION_COOKIE_HTTPONLY'] = True

app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'

app.config['PERMANENT_SESSION_LIFETIME'] = datetime.timedelta(days=30)

from supabase import create_client, Client as SupabaseClient

SUPABASE_URL = os.getenv('SUPABASE_URL', '')

SUPABASE_KEY = os.getenv('SUPABASE_KEY', '')

if not SUPABASE_URL or not SUPABASE_KEY:

    raise RuntimeError('SUPABASE_URL and SUPABASE_KEY must be set in environment variables.')

supabase: SupabaseClient = create_client(SUPABASE_URL, SUPABASE_KEY)

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

# Static files fallback moved to bottom of file

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

        users_res = supabase.table('users').select('id, email').execute()

        holdings_res = supabase.table('holdings').select('id, user_email, symbol, exchange, name, qty, "buyPrice", price').execute()

        users = users_res.data or []

        holdings = holdings_res.data or []

    except Exception as e:

        return f"Database error: {str(e)}"

    

    users_rows = "".join(f"<tr><td>{u['id']}</td><td>{u['email']}</td></tr>" for u in users)

    holdings_rows = "".join(f"<tr><td>{h['user_email']}</td><td>{h['symbol']}</td><td>{h['exchange']}</td><td>{h['name']}</td><td>{h['qty']}</td><td>â‚¹{h['buyPrice']}</td><td>â‚¹{h['price']}</td></tr>" for h in holdings)

    

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

# REST API: Session Sync (Resilient OAuth & Tab Restore)

@app.route('/api/auth/sync', methods=['POST'])

def auth_sync():

    data = request.get_json() or {}

    email = data.get('email', '').strip().lower()

    if not email:

        return jsonify({'error': 'Email is required'}), 400

    try:

        import uuid

        res = supabase.table('users').select('email').eq('email', email).execute()

        if not res.data:

            placeholder_hash = "oauth-google:" + hashlib.sha256(uuid.uuid4().bytes).hexdigest()

            supabase.table('users').upsert({'email': email, 'password_hash': placeholder_hash}).execute()

        session.permanent = True

        session['email'] = email

        return jsonify({'success': True, 'email': email})

    except Exception as e:

        return jsonify({'error': f'Database sync error: {str(e)}'}), 500

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

        existing = supabase.table('users').select('email').eq('email', email).execute()

        if existing.data:

            return jsonify({'error': 'An account with that email already exists'}), 400

        pw_hash = hash_password(password)

        supabase.table('users').insert({'email': email, 'password_hash': pw_hash}).execute()

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

        res = supabase.table('users').select('password_hash').eq('email', email).execute()

        row = res.data[0] if res.data else None

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

# REST API: Google OAuth 2.0 Login Redirect

@app.route('/api/login/google')

def google_login():

    host = request.host

    if 'localhost' in host:

        new_host = host.replace('localhost', '127.0.0.1')

        scheme = 'https' if request.is_secure or request.headers.get('X-Forwarded-Proto') == 'https' else 'http'

        return redirect(f"{scheme}://{new_host}/api/login/google")

    client_id = os.getenv('GOOGLE_CLIENT_ID')

    if not client_id:

        return "GOOGLE_CLIENT_ID is not configured in your environment.", 400

    

    state = hashlib.sha256(os.urandom(1024)).hexdigest()

    session['oauth_state'] = state

    

    scheme = 'https' if request.is_secure or request.headers.get('X-Forwarded-Proto') == 'https' else 'http'

    host = request.host

    if 'localhost' in host:

        host = host.replace('localhost', '127.0.0.1')

    redirect_uri = f"{scheme}://{host}/api/login/google/callback"

    

    params = {

        'client_id': client_id,

        'redirect_uri': redirect_uri,

        'response_type': 'code',

        'scope': 'openid email profile',

        'state': state,

        'prompt': 'select_account'

    }

    

    auth_url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(params)

    return redirect(auth_url)

# REST API: Google OAuth 2.0 Callback

@app.route('/api/login/google/callback')

def google_callback():

    code = request.args.get('code')

    if not code:

        return redirect('/?error=no_auth_code')

    

    client_id = os.getenv('GOOGLE_CLIENT_ID')

    client_secret = os.getenv('GOOGLE_CLIENT_SECRET')

    if not client_id or not client_secret:

        return "Google credentials not fully configured in your environment.", 400

        

    scheme = 'https' if request.is_secure or request.headers.get('X-Forwarded-Proto') == 'https' else 'http'

    host = request.host

    if 'localhost' in host:

        host = host.replace('localhost', '127.0.0.1')

    redirect_uri = f"{scheme}://{host}/api/login/google/callback"

    

    # Exchange authorization code for token

    token_url = "https://oauth2.googleapis.com/token"

    token_data = urllib.parse.urlencode({

        'code': code,

        'client_id': client_id,

        'client_secret': client_secret,

        'redirect_uri': redirect_uri,

        'grant_type': 'authorization_code'

    }).encode('utf-8')

    

    req = urllib.request.Request(

        token_url,

        data=token_data,

        headers={'Content-Type': 'application/x-www-form-urlencoded'}

    )

    

    try:

        with urllib.request.urlopen(req) as res:

            res_body = json.loads(res.read().decode('utf-8'))

            access_token = res_body.get('access_token')

    except Exception as e:

        return f"Token exchange failed: {str(e)}", 500

        

    # Get user info

    userinfo_url = f"https://www.googleapis.com/oauth2/v3/userinfo?access_token={access_token}"

    req_info = urllib.request.Request(userinfo_url)

    try:

        with urllib.request.urlopen(req_info) as res_info:

            info_body = json.loads(res_info.read().decode('utf-8'))

            email = info_body.get('email', '').strip().lower()

    except Exception as e:

        return f"Fetching user info failed: {str(e)}", 500

        

    if not email:

        return "Failed to retrieve email address from Google.", 400

        

    # Check if user exists, otherwise create

    try:

        import uuid

        res = supabase.table('users').select('email').eq('email', email).execute()

        if not res.data:

            placeholder_hash = "oauth-google:" + hashlib.sha256(uuid.uuid4().bytes).hexdigest()

            supabase.table('users').insert({'email': email, 'password_hash': placeholder_hash}).execute()

    except Exception as e:

        return f"Database error: {str(e)}", 500

        

    session.permanent = True

    session['email'] = email

    return redirect(f"/?login_email={urllib.parse.quote(email)}")

# REST API: Get Holdings (Supports session and explicit email parameter)

@app.route('/api/holdings', methods=['GET'])

def get_holdings():

    email = session.get('email') or request.args.get('email')

    if not email:

        return jsonify({'error': 'Unauthorized'}), 401

    try:

        res = supabase.table('holdings').select('id, symbol, exchange, name, "yahooSymbol", "assetClass", qty, "buyPrice", price').eq('user_email', email).execute()

        holdings = []

        for row in (res.data or []):

            h = dict(row)

            h['amount'] = float(h.get('buyPrice') or 0) * float(h.get('qty') or 0)

            holdings.append(h)

        return jsonify(holdings)

    except Exception as e:

        return jsonify({'error': f'Database error: {str(e)}'}), 500

# REST API: Save Holdings (Sync full list from UI state, supports session & explicit email)

@app.route('/api/holdings', methods=['POST'])

def save_holdings():

    payload = request.get_json(silent=True)

    if payload is None:

        return jsonify({'error': 'Invalid holdings payload'}), 400

    email = None

    holdings = []

    if isinstance(payload, dict):

        email = payload.get('email') or session.get('email') or request.args.get('email')

        holdings = payload.get('holdings', [])

    elif isinstance(payload, list):

        email = session.get('email') or request.args.get('email')

        holdings = payload

    else:

        return jsonify({'error': 'Invalid payload format'}), 400

    if not email:

        return jsonify({'error': 'Unauthorized'}), 401

    try:

        supabase.table('holdings').delete().eq('user_email', email).execute()

        if holdings:

            rows = [{

                'id': h.get('id'),

                'user_email': email,

                'symbol': h.get('symbol'),

                'exchange': h.get('exchange'),

                'name': h.get('name'),

                'yahooSymbol': h.get('yahooSymbol'),

                'assetClass': h.get('assetClass'),

                'qty': float(h.get('qty', 0)),

                'buyPrice': float(h.get('buyPrice', 0)),

                'price': float(h.get('price', 0))

            } for h in holdings]

            supabase.table('holdings').insert(rows).execute()

        return jsonify({'success': True})

    except Exception as e:

        return jsonify({'error': f'Database error: {str(e)}'}), 500

# REST API: High-performance concurrent live stock and crypto price fetcher

@app.route('/api/live-prices', methods=['GET', 'POST'])

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

    

    def fetch_single_quote(sym):

        sym_clean = sym.strip().upper()

        candidates = []

        if sym_clean in ['BTC', 'BTC-INR', 'BTCINR']:

            candidates.append('BTC-INR')

        elif sym_clean in ['ETH', 'ETH-INR', 'ETHINR']:

            candidates.append('ETH-INR')

        elif sym_clean.endswith('.NS') or sym_clean.endswith('.BO'):

            candidates.append(sym_clean)

            alt = sym_clean[:-3] + ('.BO' if sym_clean.endswith('.NS') else '.NS')

            candidates.append(alt)

        else:

            candidates.append(f'{sym_clean}.NS')

            candidates.append(f'{sym_clean}.BO')

            candidates.append(sym_clean)

        

        for target in candidates:

            url = f'https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(target)}?range=1d&interval=1m'

            req = urllib.request.Request(

                url,

                headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}

            )

            try:

                with urllib.request.urlopen(req, timeout=4) as res:

                    data = json.loads(res.read().decode('utf-8'))

                    meta = data.get('chart', {}).get('result', [{}])[0].get('meta', {})

                    price = meta.get('regularMarketPrice')

                    prev = meta.get('chartPreviousClose') or price

                    base = sym_clean.replace('.NS', '').replace('.BO', '').replace('-INR', '')

                    if price is not None and float(price) > 0:

                        return base, {

                            'price': round(float(price), 2),

                            'prevClose': round(float(prev), 2),

                            'symbol': target,

                            'live': True

                        }

            except Exception:

                continue

        return sym_clean, None

    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=min(16, max(len(symbols), 1))) as executor:

        results = dict(filter(lambda x: x[1] is not None, executor.map(fetch_single_quote, symbols)))

    return jsonify({

        'success': True,

        'prices': results,

        'count': len(results)

    })

@app.route('/proxy/<path:target>')

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

        res = supabase.table('holdings').select('symbol, name, "yahooSymbol"').eq('user_email', email).execute()

        holdings_data = res.data or []

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

            'OUTLOOK': 'https://www.moneycontrol.com/rss/business.xml'

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

                                target_price = f"â‚¹{tgt_match.group(1)}"

                                

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

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

# Fallback Heuristic Financial Analysis Engine

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def generate_fallback_analysis(holdings_summary, total_val, total_inv, total_pnl, total_pnl_pct, message):

    msg_lower = message.lower()

    total_gain_str = f"+â‚¹{total_pnl:,.2f}" if total_pnl >= 0 else f"-â‚¹{abs(total_pnl):,.2f}"

    

    # Identify top winners & losers

    sorted_holdings = sorted(holdings_summary, key=lambda x: x.get('gain', 0), reverse=True)

    top_winner = sorted_holdings[0] if sorted_holdings else None

    top_loser  = sorted_holdings[-1] if sorted_holdings else None

    lines = []

    lines.append("### ðŸ“Š Portfolio Executive Summary")

    lines.append(f"- **Total Valuation:** â‚¹{total_val:,.2f}")

    lines.append(f"- **Total Capital Invested:** â‚¹{total_inv:,.2f}")

    lines.append(f"- **Unrealized Gain / Loss:** **{total_gain_str} ({total_pnl_pct:+.2f}%)**")

    lines.append(f"- **Total Holdings:** {len(holdings_summary)} active positions")

    lines.append("")

    if "risk" in msg_lower:

        lines.append("### ðŸ›¡ï¸ Risk Profile & Concentration Analysis")

        if len(holdings_summary) <= 3:

            lines.append("âš ï¸ **High Concentration Risk:** You hold 3 or fewer assets. A sharp drop in any single stock will significantly impact total net worth.")

        else:

            lines.append("âœ… **Moderate Diversification:** Your capital is spread across multiple holdings, reducing single-stock volatility.")

        if top_winner:

            winner_weight = (top_winner['value'] / total_val * 100) if total_val > 0 else 0

            lines.append(f"- **Dominant Holding:** `{top_winner['symbol']}` accounts for **{winner_weight:.1f}%** of your total portfolio weight.")

        lines.append("")

    elif "recommend" in msg_lower or "suggest" in msg_lower or "buy" in msg_lower:

        lines.append("### ðŸ’¡ Strategic Portfolio Recommendations")

        lines.append("1. **Rebalancing:** Consider locking in partial gains on positions showing returns >50% and rotating into defensive large-caps.")

        lines.append("2. **Asset Diversification:** Balance high-growth mid/small caps with index stability (NIFTY 50 / Gold ETFs).")

        lines.append("3. **Stop-Loss Discipline:** Maintain a trailing stop-loss (e.g. 8-10%) on high-beta tech holdings.")

        lines.append("")

    else:

        lines.append("### ðŸ“ˆ Asset Performance Breakdown")

        for h in sorted_holdings[:5]:

            pnl_badge = f"+â‚¹{h['gain']:,.2f} (+{h['gainPct']:.2f}%)" if h['gain'] >= 0 else f"-â‚¹{abs(h['gain']):,.2f} ({h['gainPct']:.2f}%)"

            lines.append(f"- **{h['symbol']}**: Invested â‚¹{h['buyPrice'] * h['qty']:,.2f} â†’ Value â‚¹{h['value']:,.2f} | **{pnl_badge}**")

        lines.append("")

    lines.append("---")

    lines.append("*Disclaimer: This analysis is generated for academic and portfolio tracking purposes. Not certified SEBI financial advice.*")

    return "\n".join(lines)

@app.route('/api/ask-ai', methods=['POST'])

def ask_ai():

    load_env_file()

    email = session.get('email')

    if not email:

        return jsonify({'error': 'Unauthorized'}), 401

    data = request.get_json() or {}

    message = data.get('message', '').strip()

    holdings = data.get('holdings', []) or []

    if not message:

        return jsonify({'error': 'Message is required'}), 400

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

    system_prompt = (

        "You are an expert AI Portfolio & Financial Analyst for the Portfolio Tracker application. "

        "Provide direct, high-quality, professional financial analysis, risk evaluation, and diversification advice. "

        "Format your answer in clean GitHub Markdown with clear bullet points, bold numbers, and structured sections. "

        "Always tailor your advice to the user's exact stocks and return metrics. Keep advice realistic and grounded."

    )

    user_prompt = f"""User Portfolio Context:

{json.dumps(portfolio_context, indent=2)}

User Question: "{message}"

Please provide a structured, insightful analysis answering the user's question."""

    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    # 1. Primary: Groq Cloud (Verified Active Models)

    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    if groq_key:

        groq_models = ["openai/gpt-oss-120b", "groq/compound", "openai/gpt-oss-20b", "groq/compound-mini", "qwen/qwen3.6-27b"]

        for g_model in groq_models:

            try:

                groq_payload = json.dumps({

                    "model": g_model,

                    "messages": [

                        {"role": "system", "content": system_prompt},

                        {"role": "user", "content": user_prompt}

                    ],

                    "temperature": 0.5,

                    "max_tokens": 1200

                }).encode('utf-8')

                req = urllib.request.Request(

                    "https://api.groq.com/openai/v1/chat/completions",

                    data=groq_payload,

                    headers={

                        "Authorization": f"Bearer {groq_key}",

                        "Content-Type": "application/json",

                        "User-Agent": "PortfolioTracker/2.0"

                    }

                )

                with urllib.request.urlopen(req, timeout=10) as resp:

                    if resp.status == 200:

                        res_json = json.loads(resp.read().decode('utf-8'))

                        text = res_json['choices'][0]['message']['content']

                        # Strip thinking tags if any

                        text = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL).strip()

                        if text:

                            return jsonify({'reply': text, 'response': text, 'mode': 'ai', 'provider': f'Groq ({g_model})'})

            except Exception as e:

                print(f"Groq API error on model {g_model}: {e}")

                continue

    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    # 2. Secondary: OpenRouter (DeepSeek R1 / Llama 3 Free)

    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

                        "X-Title": "Portfolio Tracker"

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

    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    # 3. Tertiary: Google Gemini API (if valid AIza key)

    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    if gemini_key:

        models_to_try = ["gemini-2.0-flash", "gemini-1.5-flash"]

        for model_name in models_to_try:

            try:

                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={gemini_key}"

                req_data = json.dumps({

                    "contents": [{"parts": [{"text": f"{system_prompt}\n\n{user_prompt}"}]}],

                    "generationConfig": {"temperature": 0.5, "maxOutputTokens": 1200}

                }).encode('utf-8')

                req = urllib.request.Request(url, data=req_data, headers={'Content-Type': 'application/json'})

                with urllib.request.urlopen(req, timeout=10) as resp:

                    if resp.status == 200:

                        result = json.loads(resp.read().decode('utf-8'))

                        text = result.get('candidates', [{}])[0].get('content', {}).get('parts', [{}])[0].get('text')

                        if text:

                            return jsonify({'reply': text, 'response': text, 'mode': 'ai', 'provider': f'Gemini ({model_name})'})

            except Exception as e:

                print(f"Gemini error on {model_name}: {e}")

    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    # 4. Fallback: Heuristic Financial Rule & Valuation Engine

    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    analysis = generate_fallback_analysis(holdings_summary, total_val, total_inv, total_pnl, total_pnl_pct, message)

    return jsonify({'reply': analysis, 'response': analysis, 'mode': 'local', 'provider': 'Portfolio Analytics Engine (Rule-Based)'})

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

# IPO Data Route  - NSE (Live Sub) + Groww (Open/Upcoming/Listed) + IPOWatch (Live GMP)

# Cache: 10 minutes in-memory

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

_ipo_cache = {'data': None, 'ts': 0}

_IPO_CACHE_TTL = 600  # 10 minutes

def _strip_tags(s):

    return re.sub(r'<[^>]+>', '', s).strip()

def _fmt_date(ts_ms):

    if not ts_ms:

        return 'TBA'

    try:

        dt = datetime.datetime.fromtimestamp(ts_ms / 1000, tz=datetime.timezone.utc)

        return dt.strftime('%d %b %Y')

    except Exception:

        return 'TBA'

def _scrape_nse_open():

    """Fetch live open IPO subscriptions from NSE official API."""

    ipos = []

    try:

        hdrs = {

            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',

            'Referer': 'https://www.nseindia.com/market-data/ipo',

            'Accept': 'application/json',

        }

        req = urllib.request.Request('https://www.nseindia.com/api/ipo-current-issue', headers=hdrs)

        with urllib.request.urlopen(req, timeout=6) as resp:

            data = json.loads(resp.read().decode('utf-8', errors='replace'))

        seen = set()

        for item in data:

            if item.get('category') != 'Total':

                continue

            name = item.get('companyName', '')

            if not name or name in seen:

                continue

            seen.add(name)

            price_raw  = item.get('issuePrice', '')

            price_band = re.sub(r'Rs\.', 'Rs.', price_raw)

            sub_x      = item.get('noOfTime')

            sub_str    = ('{:.2f}x'.format(float(sub_x)) if sub_x else '-')

            ipos.append({

                'name':          name,

                'symbol':        item.get('symbol', ''),

                'open_date':     item.get('issueStartDate', '-'),

                'close_date':    item.get('issueEndDate', '-'),

                'price_band':    price_band,

                'lot_size':      '-',

                'issue_size':    '-',

                'exchange':      'NSE',

                'type':          'Mainboard',

                'gmp':           None,

                'gmp_pct':       None,

                'registrar':     'Link Intime',

                'allotment_url': 'https://linkintime.co.in/MIPO/Ipoallotment.html',

                'sub_total':     sub_str,

                'status':        'open',

                'logo_url':      '',

            })

    except Exception as e:

        print('NSE IPO API note:', e)

    return ipos

def _scrape_groww_all():

    """Fetch Open, Upcoming, and Recently Listed IPOs from Groww."""

    open_list, upcoming_list, listed_list = [], [], []

    try:

        hdrs = {

            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120',

            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',

        }

        req = urllib.request.Request('https://groww.in/ipo', headers=hdrs)

        with urllib.request.urlopen(req, timeout=8) as resp:

            html = resp.read().decode('utf-8', errors='replace')

        m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.DOTALL)

        if not m:

            return open_list, upcoming_list, listed_list

        nd = json.loads(m.group(1))

        pp = nd.get('props', {}).get('pageProps', {})

        # 1. Open IPOs

        for item in pp.get('openDataList', []):

            cats    = item.get('categories', [{}])

            ind_cat = next((c for c in cats if c.get('category') == 'IND'), cats[0] if cats else {})

            min_p   = ind_cat.get('minPrice', 0)

            max_p   = ind_cat.get('maxPrice', 0)

            lot     = ind_cat.get('lotSize', '-')

            pb      = ('Rs.{} to Rs.{}'.format(min_p, max_p) if min_p and max_p else '-')

            sub_x   = item.get('overallSubscription')

            sub_str = ('{:.2f}x'.format(float(sub_x)) if sub_x else '-')

            open_list.append({

                'name':          item.get('companyName', ''),

                'symbol':        item.get('symbol', ''),

                'search_id':     item.get('searchId', ''),

                'open_date':     _fmt_date(item.get('bidStartTimestamp')),

                'close_date':    _fmt_date(item.get('bidEndTimestamp')),

                'price_band':    pb,

                'lot_size':      str(lot),

                'issue_size':    '-',

                'exchange':      'SME' if item.get('isSme') else 'Mainboard',

                'type':          'SME' if item.get('isSme') else 'Mainboard',

                'gmp':           None,

                'gmp_pct':       None,

                'registrar':     'Link Intime',

                'allotment_url': 'https://linkintime.co.in/MIPO/Ipoallotment.html',

                'sub_total':     sub_str,

                'status':        'open',

                'logo_url':      item.get('logoUrl', ''),

            })

        # 2. Upcoming IPOs

        for item in pp.get('upcomingDataList', []):

            upcoming_list.append({

                'name':          item.get('companyName', ''),

                'symbol':        item.get('symbol', ''),

                'search_id':     item.get('searchId', ''),

                'open_date':     _fmt_date(item.get('bidStartTimestamp')),

                'close_date':    '-',

                'price_band':    'TBA',

                'lot_size':      '-',

                'issue_size':    '-',

                'exchange':      'SME' if item.get('isSme') else 'Mainboard',

                'type':          'SME' if item.get('isSme') else 'Mainboard',

                'gmp':           None,

                'gmp_pct':       None,

                'registrar':     'Link Intime',

                'allotment_url': 'https://linkintime.co.in/MIPO/Ipoallotment.html',

                'sub_total':     '-',

                'status':        'upcoming',

                'logo_url':      item.get('logoUrl', ''),

                'document_url':  item.get('documentUrl', ''),

            })

        # 3. Recently Listed IPOs

        for item in (pp.get('closedDataList') or [])[:20]:

            lr  = item.get('listingReturn')

            ret = ('{:+.1f}%'.format(float(lr)) if lr is not None else 'Pending')

            sub_x = item.get('overallSubscription')

            listed_list.append({

                'name':           item.get('companyName', ''),

                'symbol':         item.get('symbol', ''),

                'search_id':      item.get('searchId', ''),

                'issue_price':    item.get('issuePrice', '-'),

                'listing_price':  item.get('listingPrice') or 'Pending',

                'listing_return': ret,

                'allotment_date': item.get('allotmentDate', '-'),

                'allotment_url':  item.get('rtaLink') or 'https://linkintime.co.in/MIPO/Ipoallotment.html',

                'exchange':       'SME' if item.get('isSme') else 'Mainboard',

                'sub_total':      ('{:.2f}x'.format(float(sub_x)) if sub_x else '-'),

                'status':         'listed',

                'logo_url':       item.get('logoUrl', ''),

            })

    except Exception as e:

        print('Groww IPO scrape note:', e)

    return open_list, upcoming_list, listed_list

def _scrape_gmp():

    """Fetch live GMP from IPOWatch (updated multiple times daily)."""

    gmp_map = {}

    try:

        hdrs = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120'}

        req = urllib.request.Request('https://ipowatch.in/ipo-grey-market-premium-latest-ipo-gmp/', headers=hdrs)

        with urllib.request.urlopen(req, timeout=6) as resp:

            html = resp.read().decode('utf-8', errors='replace')

        

        tables = re.findall(r'<table[^>]*>(.*?)</table>', html, re.DOTALL)

        for t in tables[:2]:

            rows = re.findall(r'<tr[^>]*>(.*?)</tr>', t, re.DOTALL)

            for r in rows[1:]:

                cells = re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', r, re.DOTALL)

                if len(cells) >= 5:

                    name_raw = re.sub(r'<[^>]+>', '', cells[0]).strip()

                    gmp_raw  = re.sub(r'<[^>]+>', '', cells[1]).strip()

                    est_raw  = re.sub(r'<[^>]+>', '', cells[4]).strip()

                    if not name_raw or name_raw.lower() in ('ipo name', 'company'):

                        continue

                    gmp_clean = re.sub(r'[^\d.\-]', '', gmp_raw)

                    gmp_val   = float(gmp_clean) if gmp_clean else 0.0

                    pct_m     = re.search(r'\(([\d.\-]+)%\)', est_raw)

                    gmp_pct   = float(pct_m.group(1)) if pct_m else 0.0

                    gmp_map[name_raw.lower()] = {

                        'gmp': gmp_val,

                        'gmp_pct': gmp_pct,

                    }

    except Exception as e:

        print('IPOWatch GMP scrape note:', e)

    return gmp_map

def _merge_gmp(ipos_flat, gmp_map):

    """Fuzzy merge GMP prices into IPO items based on company name tokens."""

    for ipo in ipos_flat:

        name_clean = re.sub(r'\b(ltd|limited|ipo|enterprises|india)\b', '', ipo['name'].lower(), flags=re.I).strip()

        name_words = [w for w in name_clean.split() if len(w) > 2]

        for gmp_key, gmp_val in gmp_map.items():

            gmp_clean = re.sub(r'\b(ltd|limited|ipo|enterprises|india)\b', '', gmp_key, flags=re.I).strip()

            gmp_words = [w for w in gmp_clean.split() if len(w) > 2]

            if any(w in gmp_clean for w in name_words) or any(w in name_clean for w in gmp_words):

                ipo['gmp']     = gmp_val['gmp']

                ipo['gmp_pct'] = gmp_val['gmp_pct']

                break

    return ipos_flat

@app.route('/api/ipos', methods=['GET'])

def get_ipos():

    load_env_file()

    email = session.get('email')

    if not email:

        return jsonify({'error': 'Unauthorized'}), 401

    global _ipo_cache

    now   = time.time()

    force = request.args.get('refresh') == '1'

    if not force and _ipo_cache['data'] and (now - _ipo_cache['ts']) < _IPO_CACHE_TTL:

        return jsonify({'data': _ipo_cache['data'], 'cached': True, 'age_seconds': int(now - _ipo_cache['ts'])})

    # Fetch live data

    nse_open                           = _scrape_nse_open()

    groww_open, groww_upcoming, listed = _scrape_groww_all()

    gmp_map                            = _scrape_gmp()

    # Merge NSE live subscriptions where symbol matches

    nse_by_symbol = {x['symbol']: x for x in nse_open if x.get('symbol')}

    for ipo in groww_open:

        sym = ipo.get('symbol', '')

        if sym in nse_by_symbol:

            ipo['sub_total']  = nse_by_symbol[sym].get('sub_total', ipo['sub_total'])

            ipo['open_date']  = nse_by_symbol[sym].get('open_date', ipo['open_date'])

            ipo['close_date'] = nse_by_symbol[sym].get('close_date', ipo['close_date'])

    # Add any NSE IPO not present in Groww

    groww_syms = {x['symbol'] for x in groww_open if x.get('symbol')}

    for ipo in nse_open:

        if ipo.get('symbol') and ipo['symbol'] not in groww_syms:

            groww_open.append(ipo)

    # Attach GMP data

    all_open     = _merge_gmp(groww_open, gmp_map)

    all_upcoming = _merge_gmp(groww_upcoming[:30], gmp_map)

    merged = {

        'open':     all_open,

        'upcoming': all_upcoming,

        'listed':   listed,

    }

    _ipo_cache['data'] = merged

    _ipo_cache['ts']   = now

    return jsonify({'data': merged, 'cached': False, 'age_seconds': 0})

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

# IPO Single Detail Route  - Category Distribution, Subscription, Financials

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

_ipo_detail_cache = {}

_DETAIL_CACHE_TTL = 900  # 15 min

@app.route('/api/ipo-detail', methods=['GET'])

def get_ipo_detail():

    email = session.get('email')

    if not email:

        return jsonify({'error': 'Unauthorized'}), 401

    search_id = request.args.get('id', '').strip()

    symbol    = request.args.get('symbol', '').strip()

    name      = request.args.get('name', '').strip()

    

    if not search_id and not symbol and not name:

        return jsonify({'error': 'Missing id, symbol, or name parameter'}), 400

    global _ipo_cache

    now = time.time()

    # 1. Smart Slug Resolution from _ipo_cache if search_id is missing or incomplete

    matched_cached_ipo = None

    if _ipo_cache.get('data'):

        all_cached = (_ipo_cache['data'].get('open', []) + 

                      _ipo_cache['data'].get('upcoming', []) + 

                      _ipo_cache['data'].get('listed', []))

        for item in all_cached:

            if search_id and item.get('search_id') == search_id:

                matched_cached_ipo = item

                break

            if symbol and item.get('symbol', '').upper() == symbol.upper():

                matched_cached_ipo = item

                if not search_id and item.get('search_id'):

                    search_id = item['search_id']

                break

            if name and item.get('name', '').lower() == name.lower():

                matched_cached_ipo = item

                if not search_id and item.get('search_id'):

                    search_id = item['search_id']

                break

    cache_key = (search_id or symbol or name).lower()

    if cache_key in _ipo_detail_cache:

        cached_entry = _ipo_detail_cache[cache_key]

        if (now - cached_entry['ts']) < _DETAIL_CACHE_TTL:

            return jsonify({'data': cached_entry['data'], 'cached': True})

    # 2. Determine potential Groww slugs to try

    slugs_to_try = []

    if search_id:

        slugs_to_try.append(search_id.lower())

        if not search_id.endswith('-ipo'):

            slugs_to_try.append(f"{search_id.lower()}-ipo")

    if symbol:

        slugs_to_try.append(f"{symbol.lower()}-ipo")

    if name:

        clean_n = re.sub(r'[^a-zA-Z0-9]+', '-', name.lower()).strip('-')

        slugs_to_try.append(f"{clean_n}-ipo")

        slugs_to_try.append(clean_n)

    # Remove duplicates preserving order

    seen_slugs = set()

    unique_slugs = []

    for s in slugs_to_try:

        if s and s not in seen_slugs:

            seen_slugs.add(s)

            unique_slugs.append(s)

    detail_data = None

    hdrs = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120'}

    for slug in unique_slugs:

        url = f'https://groww.in/ipo/{slug}'

        try:

            req = urllib.request.Request(url, headers=hdrs)

            with urllib.request.urlopen(req, timeout=6) as resp:

                html = resp.read().decode('utf-8', errors='replace')

            

            m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.DOTALL)

            if not m:

                continue

            

            data = json.loads(m.group(1))

            pp   = data.get('props', {}).get('pageProps', {})

            ipo  = pp.get('ipoData', {})

            if not ipo:

                continue

            raw_size = ipo.get('issueSize')

            issue_size_cr = f"â‚¹{raw_size / 10000000:.2f} Cr" if raw_size else "TBA"

            detail_data = {

                'symbol':               ipo.get('symbol', '') or symbol,

                'companyName':          ipo.get('companyName', '') or name or (matched_cached_ipo.get('name') if matched_cached_ipo else ''),

                'companyShortName':     ipo.get('companyShortName', ''),

                'logoUrl':              ipo.get('logoUrl', '') or (matched_cached_ipo.get('logo_url') if matched_cached_ipo else ''),

                'sector':               ipo.get('sector', 'General'),

                'isSme':                ipo.get('isSme', False),

                'status':               ipo.get('status', 'ACTIVE'),

                'minPrice':             ipo.get('minPrice'),

                'maxPrice':             ipo.get('maxPrice'),

                'lotSize':              ipo.get('lotSize') or (matched_cached_ipo.get('lot_size') if matched_cached_ipo else None),

                'minBidQty':            ipo.get('minBidQty') or ipo.get('lotSize'),

                'issueSize':            issue_size_cr,

                'faceValue':            ipo.get('faceValue', '-'),

                'startDate':            ipo.get('startDate', ''),

                'endDate':              ipo.get('endDate', ''),

                'allotmentDate':        (ipo.get('allotmentDate') or '')[:10],

                'listingDate':          (ipo.get('listingDate') or '')[:10],

                'categories':           ipo.get('categories', []),

                'subscriptionRates':    ipo.get('subscriptionRates', []),

                'aboutCompany':         ipo.get('aboutCompany') or {},

                'financials':           ipo.get('financials', []),

                'pros':                 ipo.get('pros', []),

                'cons':                 ipo.get('cons', []),

                'documentUrl':          ipo.get('documentUrl', '') or (matched_cached_ipo.get('document_url') if matched_cached_ipo else ''),

                'registrar':            ipo.get('registrar', '') or (matched_cached_ipo.get('registrar') if matched_cached_ipo else 'Link Intime'),

                'rtaLink':              ipo.get('rtaLink', '') or (matched_cached_ipo.get('allotment_url') if matched_cached_ipo else 'https://linkintime.co.in/MIPO/Ipoallotment.html'),

                'faqs':                 (ipo.get('faqs') or [])[:5],

            }

            break

        except Exception as e:

            continue

    # 3. Fallback: if Groww page was not reachable, build rich detail data from cached summary

    if not detail_data and matched_cached_ipo:

        c_name = matched_cached_ipo.get('name', name or symbol)

        c_sym = matched_cached_ipo.get('symbol', symbol)

        c_price = matched_cached_ipo.get('price_band', 'TBA')

        c_lot = matched_cached_ipo.get('lot_size', '-')

        c_open = matched_cached_ipo.get('open_date', 'TBA')

        c_close = matched_cached_ipo.get('close_date', 'TBA')

        c_allot = matched_cached_ipo.get('allotment_url', 'https://linkintime.co.in/MIPO/Ipoallotment.html')

        c_sub = matched_cached_ipo.get('sub_total', '-')

        c_gmp = matched_cached_ipo.get('gmp')

        c_gmp_pct = matched_cached_ipo.get('gmp_pct')

        # Try to parse min and max price

        p_nums = re.findall(r'\d+', str(c_price))

        min_p = int(p_nums[0]) if len(p_nums) >= 1 else None

        max_p = int(p_nums[1]) if len(p_nums) >= 2 else min_p

        sub_rate_val = float(c_sub.replace('x', '')) if c_sub and c_sub != '-' and 'x' in c_sub else None

        detail_data = {

            'symbol':               c_sym,

            'companyName':          c_name,

            'companyShortName':     c_sym,

            'logoUrl':              matched_cached_ipo.get('logo_url', ''),

            'sector':               'General Equities',

            'isSme':                'SME' in (matched_cached_ipo.get('type', '') or ''),

            'status':               'ACTIVE' if matched_cached_ipo.get('status') == 'open' else 'UPCOMING',

            'minPrice':             min_p,

            'maxPrice':             max_p,

            'lotSize':              c_lot if c_lot != '-' else None,

            'minBidQty':            c_lot if c_lot != '-' else None,

            'issueSize':            matched_cached_ipo.get('issue_size', 'TBA'),

            'faceValue':            '10',

            'startDate':            c_open,

            'endDate':              c_close,

            'allotmentDate':        matched_cached_ipo.get('allotment_date', 'TBA'),

            'listingDate':          'TBA',

            'categories':           [

                {

                    'category': 'IND',

                    'categoryLabel': 'Retail Individual',

                    'categorySubText': 'Apply upto â‚¹2,00,000',

                    'lotSize': c_lot if c_lot != '-' else '1 Lot',

                    'minBidQuantity': c_lot if c_lot != '-' else '-',

                    'minPrice': min_p,

                    'maxPrice': max_p,

                },

                {

                    'category': 'HNI',

                    'categoryLabel': 'High Networth Individual (sHNI / bHNI)',

                    'categorySubText': 'Apply between â‚¹2,00,000 - â‚¹5,00,000+',

                    'lotSize': c_lot if c_lot != '-' else '14 Lots',

                    'minBidQuantity': '-',

                    'minPrice': min_p,

                    'maxPrice': max_p,

                }

            ],

            'subscriptionRates':    [

                {'category': 'TOTAL', 'categoryName': 'Overall Subscription', 'subscriptionRate': sub_rate_val}

            ] if sub_rate_val else [],

            'aboutCompany':         {

                'aboutCompany': f"{c_name} initial public offering (IPO) on Indian stock exchanges. Check DRHP and official prospectus for detailed financial history and operational metrics.",

            },

            'financials':           [],

            'pros':                 [f"{c_name} offers investor participation in this issue with issue price band {c_price}."],

            'cons':                 ["IPO investments are subject to market risks. Read the offer document carefully before applying."],

            'documentUrl':          matched_cached_ipo.get('document_url', ''),

            'registrar':            matched_cached_ipo.get('registrar', 'Link Intime'),

            'rtaLink':              c_allot,

            'faqs':                 [],

        }

    if detail_data:

        _ipo_detail_cache[cache_key] = {'data': detail_data, 'ts': now}

        return jsonify({'data': detail_data, 'cached': False})

    return jsonify({'error': 'Detailed info not available for this IPO'}), 404

# Support serving static files (images, CSS, JS, etc.) as catch-all

@app.route('/<path:path>')

def static_files(path):

    if os.path.exists(os.path.join(DIRECTORY, path)):

        return send_from_directory(DIRECTORY, path)

    return jsonify({'error': f'Resource {path} not found'}), 404

if __name__ == '__main__':

    local_ip = get_local_ip()

    google_client_id = os.getenv('GOOGLE_CLIENT_ID')

    google_status = f"LOADED ({google_client_id[:10]}...)" if google_client_id else "NOT CONFIGURED âŒ"

    print("==================================================================")

    print("                FULL STACK FLASK & SUPABASE DATABASE SERVER        ")

    print("==================================================================")

    print(f"-> Access on your PC:           http://127.0.0.1:{PORT}/")

    print(f"-> Access on your mobile phone: http://{local_ip}:{PORT}/")

    print(f"-> Google Client ID:            {google_status}")

    print("==================================================================")

    print("(Make sure your phone and PC are connected to the same Wi-Fi network)")

    print("Press Ctrl+C to stop.")

    app.run(host='0.0.0.0', port=PORT, debug=True, use_reloader=False)