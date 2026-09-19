# app.py
# ─── App Factory ────────────────────────────────────────────────────────────
# This is the entry point. It:
#   1. Loads environment variables (API keys, secrets)
#   2. Creates the Flask app and configures sessions
#   3. Registers each feature as a Blueprint (module)
#   4. Serves static files and the main HTML page
#
# Feature modules live in the routes/ folder:
#   routes/auth.py        → Login, Register, Google OAuth
#   routes/holdings.py    → Portfolio CRUD
#   routes/prices.py      → Live prices, Chart history
#   routes/ai_copilot.py  → AI assistant, News feed
#   routes/ipo.py         → IPO tracker, PAN, Allotment

import os
import datetime
import socket

from flask import Flask, jsonify, request, session, send_from_directory
from werkzeug.middleware.proxy_fix import ProxyFix

# ─── Load environment variables from .env / env file ─────────────────────────
PORT      = 8080
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

def load_env_file():
    """Read key=value pairs from .env or env file into os.environ."""
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

# ─── Create Flask app ─────────────────────────────────────────────────────────
app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)

# Session config: cookies stay for 30 days, HTTP-only (not accessible by JS)
app.secret_key = os.getenv('SECRET_KEY', 'super-secret-key-for-portfolio-tracker-production')
app.config['SESSION_COOKIE_HTTPONLY']      = True
app.config['SESSION_COOKIE_SAMESITE']      = 'Lax'
app.config['PERMANENT_SESSION_LIFETIME']   = datetime.timedelta(days=30)

# ─── Register Feature Blueprints ──────────────────────────────────────────────
# Each blueprint is a module that handles a specific feature area
from routes.auth        import auth_bp
from routes.holdings    import holdings_bp
from routes.prices      import prices_bp
from routes.ai_copilot  import ai_bp
from routes.ipo         import ipo_bp

app.register_blueprint(auth_bp)
app.register_blueprint(holdings_bp)
app.register_blueprint(prices_bp)
app.register_blueprint(ai_bp)
app.register_blueprint(ipo_bp)

# ─── Cache-control headers for fresh content ─────────────────────────────────
@app.after_request
def add_no_cache_headers(response):
    ct = response.headers.get('Content-Type', '')
    if 'text/html' in ct or 'application/json' in ct or 'javascript' in ct or 'text/css' in ct:
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate, max-age=0'
        response.headers['Pragma']        = 'no-cache'
        response.headers['Expires']       = '0'
    return response

# ─── Serve the main frontend HTML page ───────────────────────────────────────
@app.route('/')
def index():
    for filename in ['PORTFOLIO TRACKER.html', 'PORTFOLIO.html.html', 'PORTFOLIO.html']:
        if os.path.exists(os.path.join(DIRECTORY, filename)):
            return send_from_directory(DIRECTORY, filename)
    return "HTML file not found.", 404

@app.route('/final-report')
@app.route('/final-docs')
def serve_final_report():
    return send_from_directory(DIRECTORY, 'FINAL_PROJECT_REPORT.html')

@app.route('/project-report')
def project_report():
    for name in ['FINAL_PROJECT_REPORT.html', 'project_report.html']:
        if os.path.exists(os.path.join(DIRECTORY, name)):
            return send_from_directory(DIRECTORY, name)
    return "Report not found", 404

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


# ─── Static file fallback (images, CSS, JS etc.) ─────────────────────────────
# -------------------------------------------------------------
@app.route('/favicon.ico')
def favicon():
    return send_from_directory(DIRECTORY, 'logo_icon.png', mimetype='image/png')

@app.route('/robots.txt')
def robots():
    return "User-agent: *\nAllow: /\n", 200, {'Content-Type': 'text/plain'}

@app.route('/<path:path>')

def static_files(path):

    if os.path.exists(os.path.join(DIRECTORY, path)):

        return send_from_directory(DIRECTORY, path)

    return jsonify({'error': f'Resource {path} not found'}), 404

# ---------------------------------------------------------------------------
# WELCOME EMAIL PREVIEW & TEST ENDPOINTS
# ---------------------------------------------------------------------------


# ─── Run server ───────────────────────────────────────────────────────────────
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

from routes.auth import _init_welcomed_users; _init_welcomed_users()

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

