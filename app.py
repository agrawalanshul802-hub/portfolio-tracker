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
    env_path = os.path.join(DIRECTORY, '.env')
    if os.path.exists(env_path):
        with open(env_path, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#'):
                    key_val = line.split('=', 1)
                    if len(key_val) == 2:
                        k, v = key_val
                        os.environ[k.strip()] = v.strip().strip('"').strip("'")

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
                password_hash TEXT NOT NULL
            )
        ''')
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
            conn.execute('INSERT INTO users (email, password_hash) VALUES (?, ?)', (email, pw_hash))
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

    api_key = os.getenv('GEMINI_API_KEY')
    
    # If API key is present, attempt live query to Gemini API
    if api_key:
        try:
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

            # Call Gemini API
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
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
            
            with urllib.request.urlopen(req) as response:
                res_body = json.loads(response.read().decode('utf-8'))
                text_response = res_body['candidates'][0]['content']['parts'][0]['text']
                return jsonify({
                    'response': text_response,
                    'mode': 'ai'
                })
        except Exception as e:
            # On error, fall back to rules-based analyzer with warning
            print(f"Gemini API Error: {str(e)}")

    # Rules-based local analyzer
    res_text = run_local_analysis(message, holdings)
    return jsonify({
        'response': res_text,
        'mode': 'local',
        'warning': 'Running in Local Analysis mode. Add a valid GEMINI_API_KEY to your .env file to enable full AI capabilities.'
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
