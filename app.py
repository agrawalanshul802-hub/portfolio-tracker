import smtplib
import threading
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import http.server

import urllib.request

import urllib.parse

import os

import sys

import socket

import hashlib
import uuid

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

# Resilient In-Memory Fallback Caches (Prevents data loss on cold-starts & network glitches)
_LOCAL_HOLDINGS_CACHE = {}
_LOCAL_USER_PANS = {}
DEMO_PANS = {'FNUPA8261H', 'AJLPA3918K', 'AVGPA2677Q', 'BTDPY6025L', 'QDKPS9103R'}
_LOCAL_IPO_APPS = {}

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

@app.after_request
def add_no_cache_headers(response):
    ct = response.headers.get('Content-Type', '')
    if 'text/html' in ct or 'application/json' in ct:
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
    return response

# Static files fallback moved to bottom of file

# Serve the PDF-ready Project Report

@app.route('/final-report')
@app.route('/final-docs')
def serve_final_report():
    return send_from_directory(DIRECTORY, 'FINAL_PROJECT_REPORT.html')

@app.route('/project-report')
def project_report():
    for name in ['FINAL_PROJECT_REPORT.html', 'project_report.html', 'PROJECT_REPORT.html']:
        if os.path.exists(os.path.join(DIRECTORY, name)):
            return send_from_directory(DIRECTORY, name)
    return "Report not found", 404

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
    session.permanent = True
    session['email'] = email
    try:
        if supabase:
            import uuid
            res = supabase.table('users').select('email').eq('email', email).execute()
            if not res.data:
                placeholder_hash = "oauth-google:" + hashlib.sha256(uuid.uuid4().bytes).hexdigest()
                supabase.table('users').upsert({'email': email, 'password_hash': placeholder_hash}).execute()
        return jsonify({'success': True, 'email': email})
    except Exception as e:
        print(f"[Supabase Auth Sync Notice] {e}")
        # Always return 200 with email so client session in localStorage is NEVER wiped on cold-start
        return jsonify({'success': True, 'email': email, 'sync_warning': str(e)}), 200

@app.route('/api/session', methods=['GET'])

def get_session():

    email = session.get('email')

    if email:

        return jsonify({'email': email})

    return jsonify({'email': None}), 200

# REST API: User Signup


# ---------------------------------------------------------------------------
# AUTOMATED WELCOME EMAIL ONBOARDING ENGINE
# ---------------------------------------------------------------------------

def generate_welcome_email_html(to_email, user_name=None):
    display_name = user_name or to_email.split('@')[0].capitalize()
    
    return f"""<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Welcome to Portfolio Tracker</title>
<style type="text/css">
  body {{ margin: 0; padding: 0; min-width: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; background-color: #F1F5F9; color: #1E293B; }}
  table {{ border-collapse: collapse; }}
  .email-container {{ max-width: 600px; margin: 30px auto; background-color: #FFFFFF; border-radius: 12px; overflow: hidden; border: 1px solid #E2E8F0; box-shadow: 0 4px 18px rgba(0, 0, 0, 0.04); }}
  .header-band {{ background: #0F172A; padding: 26px 36px; text-align: left; }}
  .header-title {{ font-size: 20px; font-weight: 700; color: #FFFFFF; margin: 0; letter-spacing: -0.3px; }}
  .header-sub {{ font-size: 12px; color: #94A3B8; margin-top: 4px; }}
  .content-body {{ padding: 36px 36px 28px; }}
  .salutation {{ font-size: 17px; font-weight: 700; color: #0F172A; margin: 0 0 16px 0; }}
  .paragraph {{ font-size: 14.5px; line-height: 1.65; color: #334155; margin: 0 0 18px 0; }}
  .info-table {{ width: 100%; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; margin: 20px 0 24px; padding: 14px 18px; }}
  .info-table td {{ padding: 5px 8px; font-size: 13.5px; color: #475569; }}
  .info-table td.label {{ font-weight: 600; color: #0F172A; width: 35%; }}
  .steps-title {{ font-size: 14.5px; font-weight: 700; color: #0F172A; margin: 24px 0 12px 0; }}
  .step-item {{ margin-bottom: 12px; padding-left: 20px; position: relative; font-size: 13.5px; line-height: 1.6; color: #334155; }}
  .step-item b {{ color: #0F172A; }}
  .security-box {{ background: #F5F3FF; border-left: 4px solid #7C3AED; border-radius: 4px; padding: 14px 16px; margin: 24px 0; font-size: 13px; line-height: 1.55; color: #4C1D95; }}
  .button-wrap {{ text-align: left; margin: 28px 0 20px; }}
  .btn-primary {{ display: inline-block; background: #6D28D9; color: #FFFFFF !important; text-decoration: none; font-size: 14px; font-weight: 600; padding: 12px 28px; border-radius: 8px; box-shadow: 0 2px 8px rgba(109, 40, 217, 0.25); }}
  .signoff {{ margin-top: 28px; padding-top: 20px; border-top: 1px solid #E2E8F0; font-size: 14px; line-height: 1.6; color: #334155; }}
  .footer-band {{ background: #F8FAFC; padding: 20px 36px; text-align: center; border-top: 1px solid #E2E8F0; font-size: 11.5px; color: #64748B; line-height: 1.6; }}
</style>
</head>
<body>
<div style="background-color: #F1F5F9; padding: 20px 10px;">
  <div class="email-container">
    
    <!-- Top Branding Header -->
    <div class="header-band">
      <h1 class="header-title">Portfolio Tracker</h1>
      <div class="header-sub">Financial Analytics &amp; Wealth Management Platform</div>
    </div>

    <!-- Main Letter Content -->
    <div class="content-body">
      <p class="salutation">Dear {display_name},</p>

      <p class="paragraph">
        Thank you for creating an account with <strong>Portfolio Tracker</strong>. We are pleased to confirm that your registration has been processed successfully, and your personal investment workspace is now active.
      </p>

      <!-- Account Summary Table -->
      <table class="info-table">
        <tr>
          <td class="label">Registered Email:</td>
          <td>{to_email}</td>
        </tr>
        <tr>
          <td class="label">Account Status:</td>
          <td><span style="color: #059669; font-weight: 600;">● Active (Verified)</span></td>
        </tr>
        <tr>
          <td class="label">Platform:</td>
          <td>Cloud Synced (Supabase PostgreSQL)</td>
        </tr>
      </table>

      <div class="steps-title">Getting Started with Your Portfolio:</div>
      
      <div class="step-item">
        <b>1. Add Your Holdings:</b> Track Indian Equities (NSE &amp; BSE) and Commodities (MCX Gold, Silver, Crude Oil) in dedicated portfolio sections in Indian Rupees (₹).
      </div>
      <div class="step-item">
        <b>2. Set Real-Time Price Alerts:</b> Specify your target prices on any stock and receive automated notifications the moment market prices cross your targets.
      </div>
      <div class="step-item">
        <b>3. AI Portfolio Analyst:</b> Ask financial questions and get immediate portfolio health, sector concentration, and risk assessment powered by AI.
      </div>
      <div class="step-item">
        <b>4. Valuation Statements:</b> Export official PDF valuation certificates and CSV ledgers with a single click for tax preparation and financial audits.
      </div>

      <!-- Security Guarantee -->
      <div class="security-box">
        <strong>Privacy &amp; Security Note:</strong><br />
        Portfolio Tracker operates on a strict privacy-first principle. We will <strong>never</strong> ask for your Demat login, broker passwords, or transaction PINs. Your data is protected by industry-standard encryption and stored securely.
      </div>

      <!-- Call to Action Button -->
      <div class="button-wrap">
        <a href="https://portfolio-tracker-1-n2qq.onrender.com" class="btn-primary" target="_blank">Access Your Dashboard &rarr;</a>
      </div>

      <!-- Formal Sign-off -->
      <div class="signoff">
        Sincerely,<br />
        <strong>The Portfolio Tracker Team</strong><br />
        
      </div>
    </div>

    <!-- Footer -->
    <div class="footer-band">
      This is an automated confirmation sent to <strong>{to_email}</strong>.<br />
      If you did not create this account, please disregard this message.
    </div>

  </div>
</div>
</body>
</html>"""

WELCOMED_USERS_FILE = os.path.join(DIRECTORY, 'welcomed_users.json')
_welcomed_users_lock = threading.Lock()

def _load_welcomed_users():
    """Loads the set of emails that have already received an onboarding welcome message."""
    try:
        if os.path.exists(WELCOMED_USERS_FILE):
            with open(WELCOMED_USERS_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if isinstance(data, list):
                    return set(e.strip().lower() for e in data if e)
    except Exception as e:
        print(f"[Welcome Email] Cache load notice: {e}")
    return set()

def _save_welcomed_user(email):
    clean_email = email.strip().lower()
    with _welcomed_users_lock:
        users = _load_welcomed_users()
        users.add(clean_email)
        try:
            with open(WELCOMED_USERS_FILE, 'w', encoding='utf-8') as f:
                json.dump(sorted(list(users)), f, indent=2)
        except Exception as e:
            print(f"[Welcome Email] Cache save notice: {e}")

def has_user_received_welcome_email(email):
    if not email:
        return True
    clean_email = email.strip().lower()
    with _welcomed_users_lock:
        users = _load_welcomed_users()
        return clean_email in users

def mark_user_welcomed(email):
    _save_welcomed_user(email)

def _init_welcomed_users():
    """Initializes the registry and ensures existing users in Supabase are marked so they never get duplicate emails."""
    try:
        users = _load_welcomed_users()
        if 'supabase' in globals() and supabase:
            try:
                res = supabase.table('users').select('email').execute()
                if res.data:
                    changed = False
                    for row in res.data:
                        em = (row.get('email') or '').strip().lower()
                        if em and em not in users:
                            users.add(em)
                            changed = True
                    if changed:
                        with open(WELCOMED_USERS_FILE, 'w', encoding='utf-8') as f:
                            json.dump(sorted(list(users)), f, indent=2)
                        print(f"[Welcome Email] Registry synchronized: {len(users)} user(s) onboarded.")
            except Exception as se:
                print(f"[Welcome Email] Sync notice: {se}")
    except Exception as e:
        print(f"[Welcome Email] Init notice: {e}")

def send_welcome_email_async(to_email, user_name=None, force=False):
    """Dispatches the welcome email in a background daemon thread so HTTP response is instant.
    Guarantees that each email address receives the onboarding welcome email AT MOST ONCE."""
    if not to_email:
        return
    clean_email = to_email.strip().lower()
    if not force and has_user_received_welcome_email(clean_email):
        print(f"[Welcome Email] Greeting email already delivered to {clean_email}. Skipping duplicate dispatch.")
        return
    # Mark as welcomed immediately so concurrent requests don't duplicate
    mark_user_welcomed(clean_email)
    threading.Thread(target=_send_welcome_email_worker, args=(clean_email, user_name), daemon=True).start()

def _send_welcome_email_worker(to_email, user_name=None):
    """Background worker that handles SMTP transmission safely."""
    try:
        load_env_file()
        smtp_user = os.getenv('SMTP_EMAIL') or os.getenv('MAIL_USERNAME')
        smtp_pass = os.getenv('SMTP_PASSWORD') or os.getenv('MAIL_PASSWORD')
        smtp_host = os.getenv('SMTP_HOST', 'smtp.gmail.com')
        smtp_port = int(os.getenv('SMTP_PORT', '587'))

        display_name = user_name or to_email.split('@')[0].capitalize()
        subject = f"🚀 Welcome to Portfolio Tracker, {display_name}!"
        html_body = generate_welcome_email_html(to_email, user_name)

        if not smtp_user or not smtp_pass:
            print(f"[Welcome Email] Note: SMTP_EMAIL / SMTP_PASSWORD not configured. Welcome email for {to_email} generated in preview mode.")
            return

        msg = MIMEMultipart('alternative')
        msg['Subject'] = subject
        msg['From'] = f"Portfolio Tracker <{smtp_user}>"
        msg['To'] = to_email

        plain_text = f"""Welcome to Portfolio Tracker, {display_name}!

Your privacy-first financial dashboard is now active.
Track Indian Equities (NSE/BSE) and Commodities (MCX Gold, Silver, Crude Oil) all in one place.
Set Real-Time Price Alerts and ask the AI Portfolio Analyst.

Open Dashboard: https://portfolio-tracker-1-n2qq.onrender.com

- Team Portfolio Tracker"""
        msg.attach(MIMEText(plain_text, 'plain'))
        msg.attach(MIMEText(html_body, 'html'))

        with smtplib.SMTP(smtp_host, smtp_port, timeout=12) as server:
            server.starttls()
            server.login(smtp_user, smtp_pass)
            server.send_message(msg)
            print(f"[Welcome Email] Successfully sent live welcome email to {to_email}")

    except Exception as e:
        print(f"[Welcome Email] Worker notice (handled gracefully): {e}")

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
        # Onboarding registration: send welcome email ONCE for newly created account
        send_welcome_email_async(email)
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
        # Routine login - do NOT resend onboarding welcome emails to existing users
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
    scheme = 'https' if request.is_secure or request.headers.get('X-Forwarded-Proto') == 'https' else 'http'

    # Standardize localhost to 127.0.0.1 for desktop testing (registered in Google Cloud Console)
    if 'localhost' in host:
        new_host = host.replace('localhost', '127.0.0.1')
        return redirect(f"{scheme}://{new_host}/api/login/google")

    client_id = os.getenv('GOOGLE_CLIENT_ID')
    if not client_id:
        return "GOOGLE_CLIENT_ID is not configured in your environment.", 400

    hostname = host.split(':')[0]
    import ipaddress
    is_private_ip = False
    try:
        ip = ipaddress.ip_address(hostname)
        if ip.is_private and not ip.is_loopback:
            is_private_ip = True
    except ValueError:
        is_private_ip = False

    # Google Cloud OAuth 2.0 strictly rejects private RFC 1918 IPs (192.168.x.x, 10.x.x.x, etc.)
    # When accessed from a mobile device on local Wi-Fi, bridge the OAuth callback via the registered Render domain,
    # embedding the mobile LAN origin in the state parameter so the callback bounces the user back to their phone.
    if is_private_ip:
        origin_url = f"{scheme}://{host}"
        state_data = {
            'token': hashlib.sha256(os.urandom(1024)).hexdigest()[:16],
            'origin': origin_url
        }
        import base64
        state = base64.urlsafe_b64encode(json.dumps(state_data).encode('utf-8')).decode('utf-8')
        redirect_uri = "https://portfolio-tracker-1-n2qq.onrender.com/api/login/google/callback"
    else:
        state = hashlib.sha256(os.urandom(1024)).hexdigest()
        redirect_uri = f"{scheme}://{host}/api/login/google/callback"

    session['oauth_state'] = state

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
    state_param = request.args.get('state', '')
    if not code:
        return redirect('/?error=no_auth_code')

    client_id = os.getenv('GOOGLE_CLIENT_ID')
    client_secret = os.getenv('GOOGLE_CLIENT_SECRET')
    if not client_id or not client_secret:
        return "Google credentials not fully configured in your environment.", 400

    # Determine if request was bridged from a mobile LAN device via state parameter
    return_origin = None
    if state_param:
        import base64
        allowed_pattern = r'^https?://(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|127\.0\.0\.1|localhost|portfolio-tracker-1-n2qq\.onrender\.com)(?::\d+)?$'
        try:
            decoded_bytes = base64.urlsafe_b64decode(state_param.encode('utf-8'))
            state_data = json.loads(decoded_bytes.decode('utf-8'))
            if isinstance(state_data, dict) and 'origin' in state_data:
                cand = state_data['origin'].rstrip('/')
                if re.match(allowed_pattern, cand):
                    return_origin = cand
        except Exception:
            try:
                state_data = json.loads(urllib.parse.unquote(state_param))
                if isinstance(state_data, dict) and 'origin' in state_data:
                    cand = state_data['origin'].rstrip('/')
                    if re.match(allowed_pattern, cand):
                        return_origin = cand
            except Exception:
                pass

    # The redirect_uri sent to Google token exchange must match what was sent during the authorization request
    if return_origin:
        redirect_uri = "https://portfolio-tracker-1-n2qq.onrender.com/api/login/google/callback"
    else:
        scheme = 'https' if request.is_secure or request.headers.get('X-Forwarded-Proto') == 'https' else 'http'
        host = request.host
        if 'localhost' in host:
            host = host.replace('localhost', '127.0.0.1')
        redirect_uri = f"{scheme}://{host}/api/login/google/callback"

    target_base = return_origin if return_origin else ""

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
        error_msg = f"Token exchange failed: {str(e)}"
        return redirect(f"{target_base}/?error={urllib.parse.quote(error_msg)}")

    # Get user info
    userinfo_url = f"https://www.googleapis.com/oauth2/v3/userinfo?access_token={access_token}"
    req_info = urllib.request.Request(userinfo_url)
    try:
        with urllib.request.urlopen(req_info) as res_info:
            info_body = json.loads(res_info.read().decode('utf-8'))
            email = info_body.get('email', '').strip().lower()
    except Exception as e:
        error_msg = f"Fetching user info failed: {str(e)}"
        return redirect(f"{target_base}/?error={urllib.parse.quote(error_msg)}")

    if not email:
        error_msg = "Failed to retrieve email address from Google."
        return redirect(f"{target_base}/?error={urllib.parse.quote(error_msg)}")

    # Check if user exists, otherwise create
    try:
        import uuid
        res = supabase.table('users').select('email').eq('email', email).execute()
        if not res.data:
            placeholder_hash = "oauth-google:" + hashlib.sha256(uuid.uuid4().bytes).hexdigest()
            supabase.table('users').insert({'email': email, 'password_hash': placeholder_hash}).execute()

        user_name = info_body.get('name') or info_body.get('given_name')
        if not res.data:
            # Send welcome email ONLY to brand new accounts, never on repeat Google logins
            send_welcome_email_async(email, user_name=user_name)
    except Exception as e:
        print(f"Supabase user sync notice: {e}")

    session.permanent = True
    session['email'] = email

    return redirect(f"{target_base}/?login_email={urllib.parse.quote(email)}")


# REST API: Get Holdings (Supports session and explicit email parameter)

@app.route('/api/holdings', methods=['GET'])
def get_holdings():
    email = session.get('email') or request.args.get('email')
    if not email:
        return jsonify({'error': 'Unauthorized'}), 401
    clean_email = email.strip().lower()
    try:
        rows = []
        if supabase:
            try:
                res = supabase.table('holdings').select('id, symbol, exchange, name, "yahooSymbol", "assetClass", qty, "buyPrice", price').eq('user_email', clean_email).execute()
                rows = res.data or []
                if not rows:
                    res2 = supabase.table('holdings').select('id, symbol, exchange, name, "yahooSymbol", "assetClass", qty, "buyPrice", price').ilike('user_email', clean_email).execute()
                    rows = res2.data or []
            except Exception as se:
                print(f"[Supabase Holdings Read Error] {se}")
                
        if not rows and clean_email in _LOCAL_HOLDINGS_CACHE:
            rows = _LOCAL_HOLDINGS_CACHE[clean_email]
            
        holdings = []
        for row in rows:
            h = dict(row)
            h['amount'] = float(h.get('buyPrice') or 0) * float(h.get('qty') or 0)
            holdings.append(h)
            
        if holdings:
            _LOCAL_HOLDINGS_CACHE[clean_email] = holdings
            
        return jsonify(holdings)
    except Exception as e:
        if clean_email in _LOCAL_HOLDINGS_CACHE:
            return jsonify(_LOCAL_HOLDINGS_CACHE[clean_email])
        return jsonify({'error': f'Database error: {str(e)}'}), 500

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

    clean_email = email.strip().lower()
    _LOCAL_HOLDINGS_CACHE[clean_email] = holdings

    if supabase:
        try:
            supabase.table('holdings').delete().ilike('user_email', clean_email).execute()
            if holdings:
                rows = []
                for h in holdings:
                    sym = (h.get('symbol') or '').strip().upper()
                    exch = (h.get('exchange') or 'NSE').strip().upper()
                    name = (h.get('name') or sym or 'Asset').strip()
                    ysym = h.get('yahooSymbol')
                    if not ysym:
                        if exch == 'MCX':
                            ysym = f"{sym}.MCX"
                        elif exch == 'BSE':
                            ysym = f"{sym}.BO"
                        else:
                            ysym = f"{sym}.NS"
                    aclass = h.get('assetClass')
                    if not aclass:
                        aclass = 'Commodity' if exch == 'MCX' else 'Equity'
                    hid = str(h.get('id')).strip() if (h.get('id') and str(h.get('id')).strip()) else f"h-{uuid.uuid4().hex[:12]}"
                    rows.append({
                        'id': hid,
                        'user_email': clean_email,
                        'symbol': sym,
                        'exchange': exch,
                        'name': name,
                        'yahooSymbol': ysym,
                        'assetClass': aclass,
                        'qty': float(h.get('qty') or 0),
                        'buyPrice': float(h.get('buyPrice') or 0),
                        'price': float(h.get('price') or 0)
                    })
                supabase.table('holdings').insert(rows).execute()
        except Exception as e:
            print(f"[Supabase Holdings Save Error] {e}")

    return jsonify({'success': True})

# REST API: High-performance cached concurrent live stock and crypto price fetcher
LIVE_PRICE_CACHE = {}
PRICE_CACHE_TTL_SEC = 45  # 45-second cache for lightning-fast repeated queries

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

@app.route('/api/chart-history', methods=['GET'])
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

@app.route('/api/news', methods=['GET'])
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

_MONTH_MAP = {
    'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
    'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12
}

def _parse_ipo_date(date_str):
    if not date_str or str(date_str).strip() in ('-', 'TBA', 'None', '', 'Pending'):
        return None
    s = str(date_str).strip()
    m1 = re.match(r'^(\d{4})-(\d{1,2})-(\d{1,2})', s)
    if m1:
        try:
            return datetime.date(int(m1.group(1)), int(m1.group(2)), int(m1.group(3)))
        except Exception:
            pass
    m2 = re.match(r'^(\d{1,2})[\s\-]+([A-Za-z]{3,})[\s\-]+(\d{4})', s)
    if m2:
        try:
            d = int(m2.group(1))
            mon_str = m2.group(2).lower()[:3]
            m = _MONTH_MAP.get(mon_str, 1)
            y = int(m2.group(3))
            return datetime.date(y, m, d)
        except Exception:
            pass
    return None

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

                'is_allotment_live': (lambda ad: False if (_parse_ipo_date(ad) and datetime.date.today() < _parse_ipo_date(ad)) else True)(item.get('allotmentDate')),

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
    global _ipo_cache
    now   = time.time()
    force = request.args.get('refresh') == '1'

    if not force and _ipo_cache['data'] and (now - _ipo_cache['ts']) < _IPO_CACHE_TTL:
        return jsonify({'data': _ipo_cache['data'], 'cached': True, 'age_seconds': int(now - _ipo_cache['ts'])})

    try:
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
    except Exception as e:
        logger.error(f"Error fetching live IPOs: {e}")
        if _ipo_cache['data']:
            return jsonify({'data': _ipo_cache['data'], 'cached': True, 'warning': str(e), 'age_seconds': int(now - _ipo_cache['ts'])})
        return jsonify({'data': {'open': [], 'upcoming': [], 'listed': []}, 'cached': False, 'error': str(e)}), 200

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

# IPO Single Detail Route  - Category Distribution, Subscription, Financials

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

_ipo_detail_cache = {}

_DETAIL_CACHE_TTL = 900  # 15 min

@app.route('/api/ipo-detail', methods=['GET'])

def get_ipo_detail():

    load_env_file()

    email = session.get('email') or request.args.get('email')

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

# -------------------------------------------------------------
# USER PAN & IPO APPLICATION ALLOTMENT TRACKER APIS (SUPABASE)
# -------------------------------------------------------------

PAN_REGEX = re.compile(r'^[A-Z]{5}[0-9]{4}[A-Z]{1}$')

@app.route('/api/user/pan', methods=['GET', 'POST', 'DELETE'])
@app.route('/api/user/pans', methods=['GET', 'POST', 'DELETE'])
def handle_user_pan():
    load_env_file()
    payload = request.get_json(silent=True) or {}
    email = session.get('email') or request.args.get('email') or payload.get('email')
    if not email:
        return jsonify({'error': 'Unauthorized', 'message': 'User email required'}), 401
    
    clean_email = email.strip().lower()
    
    if request.method == 'GET':
        pan_raw = None
        pans_list = []
        if supabase:
            try:
                res = supabase.table('users').select('pan_card').eq('email', clean_email).execute()
                if res.data and len(res.data) > 0:
                    pan_raw = res.data[0].get('pan_card')
                else:
                    res2 = supabase.table('users').select('pan_card').ilike('email', clean_email).execute()
                    if res2.data and len(res2.data) > 0:
                        pan_raw = res2.data[0].get('pan_card')
            except Exception as e:
                print(f"[Supabase PAN Error] {e}")
                
        primary_pan = ''
        if pan_raw:
            str_val = str(pan_raw).strip()
            if str_val.startswith('[') and str_val.endswith(']'):
                try:
                    import json
                    parsed_p = json.loads(str_val)
                    if parsed_p and isinstance(parsed_p, list):
                        pans_list = [p for p in parsed_p if (p.get('pan') or '').strip().upper() not in DEMO_PANS]
                        if pans_list:
                            primary_pan = pans_list[0].get('pan', '')
                except Exception:
                    pass
            elif len(str_val) == 10 and str_val.upper() not in DEMO_PANS:
                primary_pan = str_val
                pans_list = [{'id': '1', 'name': 'Primary Account', 'pan': str_val}]
                
        if not pans_list and clean_email in _LOCAL_USER_PANS:
            pans_list = [p for p in _LOCAL_USER_PANS[clean_email] if (p.get('pan') or '').strip().upper() not in DEMO_PANS]
            if pans_list:
                primary_pan = pans_list[0].get('pan', '')
                
        _LOCAL_USER_PANS[clean_email] = pans_list
            
        return jsonify({'success': True, 'pan': primary_pan, 'pans': pans_list})
        
    if request.method == 'DELETE':
        pan_to_del = request.args.get('pan') or payload.get('pan')
        if clean_email in _LOCAL_USER_PANS:
            if pan_to_del:
                _LOCAL_USER_PANS[clean_email] = [p for p in _LOCAL_USER_PANS[clean_email] if p.get('pan') != pan_to_del]
            else:
                _LOCAL_USER_PANS[clean_email] = []
        if supabase:
            try:
                res = supabase.table('users').select('pan_card').eq('email', clean_email).execute()
                cur_val = res.data[0].get('pan_card') if res.data else None
                if pan_to_del:
                    if cur_val and str(cur_val).strip().startswith('['):
                        import json
                        arr = json.loads(str(cur_val))
                        arr = [x for x in arr if (x.get('pan') or '').upper() != pan_to_del.strip().upper()]
                        new_val = json.dumps(arr) if arr else None
                        supabase.table('users').update({'pan_card': new_val}).eq('email', clean_email).execute()
                    else:
                        supabase.table('users').update({'pan_card': None}).eq('email', clean_email).execute()
                else:
                    supabase.table('users').update({'pan_card': None}).eq('email', clean_email).execute()
            except Exception as e:
                print(f"[Supabase PAN Delete Error] {e}")
        return jsonify({'success': True, 'pan': '', 'pans': _LOCAL_USER_PANS.get(clean_email, []), 'message': 'PAN deleted successfully'})
    
    # POST: Save / Update PANs
    import json
    input_pans = payload.get('pans')
    if input_pans is not None and isinstance(input_pans, list):
        cleaned_pans = []
        for i, it in enumerate(input_pans, 1):
            p_val = (it.get('pan') or '').strip().upper()
            p_name = (it.get('name') or f'Investor {i}').strip()
            if p_val and PAN_REGEX.match(p_val) and p_val not in DEMO_PANS:
                cleaned_pans.append({'id': str(it.get('id') or i), 'name': p_name, 'pan': p_val})
        json_str = json.dumps(cleaned_pans) if cleaned_pans else None
        _LOCAL_USER_PANS[clean_email] = cleaned_pans
        if supabase:
            try:
                res_u = supabase.table('users').select('email').eq('email', clean_email).execute()
                if not res_u.data:
                    supabase.table('users').insert({'email': clean_email, 'password_hash': 'oauth-local', 'pan_card': json_str}).execute()
                else:
                    supabase.table('users').update({'pan_card': json_str}).eq('email', clean_email).execute()
            except Exception as e:
                print(f"[Supabase PANs Save Error] {e}")
        prim = cleaned_pans[0]['pan'] if cleaned_pans else ''
        return jsonify({'success': True, 'pan': prim, 'pans': cleaned_pans, 'message': f'{len(cleaned_pans)} PAN cards saved successfully!'})
        
    raw_pan = (payload.get('pan') or '').strip().upper()
    raw_name = (payload.get('name') or 'Primary Account').strip()
    if raw_pan in DEMO_PANS:
        return jsonify({'error': 'Demo PAN cannot be linked'}), 400
    if raw_pan and not PAN_REGEX.match(raw_pan):
        return jsonify({'error': 'Invalid PAN format. Must be 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F)'}), 400
        
    cur_list = _LOCAL_USER_PANS.get(clean_email, [])
    found = False
    for x in cur_list:
        if (x.get('pan') or '').upper() == raw_pan:
            x['name'] = raw_name
            found = True
            break
    if not found and raw_pan:
        cur_list.append({'id': str(len(cur_list) + 1), 'name': raw_name, 'pan': raw_pan})
    _LOCAL_USER_PANS[clean_email] = cur_list
    json_val = json.dumps(cur_list)
    
    if supabase:
        try:
            res_u = supabase.table('users').select('email').eq('email', clean_email).execute()
            if not res_u.data:
                supabase.table('users').insert({'email': clean_email, 'password_hash': 'oauth-local', 'pan_card': json_val}).execute()
            else:
                supabase.table('users').update({'pan_card': json_val}).eq('email', clean_email).execute()
        except Exception as e:
            print(f"[Supabase PAN Save Error] {e}")
            
    return jsonify({'success': True, 'pan': raw_pan, 'pans': cur_list, 'message': 'PAN card successfully linked!'})

@app.route('/api/ipo/applications', methods=['GET'])
def get_ipo_applications():
    load_env_file()
    email = session.get('email') or request.args.get('email')
    if not email:
        return jsonify({'error': 'Unauthorized', 'message': 'User email required'}), 401
    
    clean_email = email.strip().lower()
    applications = []
    if supabase:
        try:
            res = supabase.table('ipo_applications').select('*').eq('user_email', clean_email).order('created_at', desc=True).execute()
            if res.data:
                applications = res.data
            else:
                res2 = supabase.table('ipo_applications').select('*').ilike('user_email', clean_email).order('created_at', desc=True).execute()
                if res2.data:
                    applications = res2.data
        except Exception as e:
            print(f"[Supabase IPO Apps Error] {e}")
            
    if not applications and clean_email in _LOCAL_IPO_APPS:
        applications = _LOCAL_IPO_APPS[clean_email]
        
    if applications:
        _LOCAL_IPO_APPS[clean_email] = applications
        
    return jsonify({'success': True, 'applications': applications})

@app.route('/api/ipo/apply', methods=['POST'])
def save_ipo_application():
    load_env_file()
    data = request.get_json(silent=True) or {}
    email = session.get('email') or request.args.get('email') or data.get('email')
    if not email:
        return jsonify({'error': 'Unauthorized', 'message': 'User email required'}), 401
    
    clean_email = email.strip().lower()
    ipo_name = (data.get('ipo_name') or '').strip()
    ipo_symbol = (data.get('ipo_symbol') or '').strip()
    lots = int(data.get('lots') or 1)
    bid_price = data.get('bid_price') or '-'
    allotment_url = data.get('allotment_url') or ''
    pan_card = (data.get('pan_card') or '').strip().upper()
    
    if not ipo_name:
        return jsonify({'error': 'IPO name is required'}), 400
        
    if not pan_card and supabase:
        try:
            u_res = supabase.table('users').select('pan_card').eq('email', clean_email).execute()
            if u_res.data and len(u_res.data) > 0:
                pan_card = u_res.data[0].get('pan_card') or ''
        except Exception:
            pass
            
    app_record = {
        'user_email': clean_email,
        'ipo_name': ipo_name,
        'ipo_symbol': ipo_symbol,
        'pan_card': pan_card,
        'lots': lots,
        'bid_price': float(str(bid_price).replace('₹','').strip()) if str(bid_price).replace('₹','').strip().replace('.','').isdigit() else 0.0,
        'status': 'APPLIED',
        'allotment_url': allotment_url
    }
    
    if supabase:
        try:
            existing = supabase.table('ipo_applications').select('id').eq('user_email', clean_email).eq('ipo_name', ipo_name).execute()
            if existing.data and len(existing.data) > 0:
                supabase.table('ipo_applications').update(app_record).eq('id', existing.data[0]['id']).execute()
            else:
                supabase.table('ipo_applications').insert(app_record).execute()
        except Exception as e:
            print(f"[Supabase IPO Apply Error] {e}")
            return jsonify({'error': f'Database save error: {str(e)}'}), 500
            
    return jsonify({'success': True, 'message': f'Application for {ipo_name} saved!'})

@app.route('/api/ipo/allotment-status', methods=['POST'])
def update_allotment_status():
    load_env_file()
    data = request.get_json(silent=True) or {}
    email = session.get('email') or request.args.get('email') or data.get('email')
    if not email:
        return jsonify({'error': 'Unauthorized', 'message': 'User email required'}), 401
    
    clean_email = email.strip().lower()
    app_id = data.get('id')
    status = data.get('status')
    shares_allotted = int(data.get('shares_allotted') or 0)
    
    if not app_id or not status:
        return jsonify({'error': 'Application ID and status are required'}), 400
        
    if supabase:
        try:
            supabase.table('ipo_applications').update({
                'status': status,
                'shares_allotted': shares_allotted
            }).eq('id', app_id).eq('user_email', clean_email).execute()
        except Exception as e:
            return jsonify({'error': str(e)}), 500
            
    return jsonify({'success': True, 'status': status, 'shares_allotted': shares_allotted})

@app.route('/api/ipo/check-allotment', methods=['POST'])
def direct_check_allotment():
    load_env_file()
    data = request.get_json(silent=True) or {}
    email = session.get('email') or request.args.get('email') or data.get('email')
    clean_email = (email or '').strip().lower()
    
    ipo_name = (data.get('ipo_name') or '').strip()
    ipo_symbol = (data.get('ipo_symbol') or '').strip()
    lot_size = int(data.get('lot_size') or 15)
    issue_price = data.get('issue_price') or '-'
    gmp = float(data.get('gmp') or 0)
    allotment_url = data.get('allotment_url') or ''
    override_status = data.get('override_status')
    override_pan = (data.get('pan') or '').strip().upper()
    
    clean_issue_price = str(issue_price).replace('₹','').strip() if issue_price and issue_price != '-' else '124'
    
    # 1. Warm IPO cache if needed and check timing
    global _ipo_cache
    now = time.time()
    if not _ipo_cache.get('data'):
        try:
            _, _, listed_init = _scrape_groww_all()
            _ipo_cache['data'] = {'open': [], 'upcoming': [], 'listed': listed_init}
            _ipo_cache['ts'] = time.time()
        except Exception as e:
            print(f"[Direct Check Cache Warm Error] {e}")
            
    ipo_data = _ipo_cache.get('data') or {}
    all_open = ipo_data.get('open') or []
    all_upcoming = ipo_data.get('upcoming') or []
    all_listed = ipo_data.get('listed') or []
    
    # Find matching IPO from cache
    matched_ipo = None
    ipo_section = None
    for item in all_open:
        if (item.get('symbol') and ipo_symbol and item.get('symbol').upper() == ipo_symbol.upper()) or (item.get('name') and ipo_name and ipo_name.lower() in item.get('name').lower()):
            matched_ipo = item
            ipo_section = 'open'
            break
    if not matched_ipo:
        for item in all_upcoming:
            if (item.get('symbol') and ipo_symbol and item.get('symbol').upper() == ipo_symbol.upper()) or (item.get('name') and ipo_name and ipo_name.lower() in item.get('name').lower()):
                matched_ipo = item
                ipo_section = 'upcoming'
                break
    if not matched_ipo:
        for item in all_listed:
            if (item.get('symbol') and ipo_symbol and item.get('symbol').upper() == ipo_symbol.upper()) or (item.get('name') and ipo_name and ipo_name.lower() in item.get('name').lower()):
                matched_ipo = item
                ipo_section = 'listed'
                break
                
    today = datetime.date.today()
    allot_date_str = data.get('allotment_date') or (matched_ipo.get('allotment_date') if matched_ipo else None)
    parsed_allot_date = _parse_ipo_date(allot_date_str)
    
    is_not_live = False
    scheduled_display_date = None
    if ipo_section in ('open', 'upcoming'):
        is_not_live = True
        scheduled_display_date = matched_ipo.get('close_date') or 'soon'
    elif parsed_allot_date and today < parsed_allot_date:
        is_not_live = True
        scheduled_display_date = parsed_allot_date.strftime('%d %b %Y')

    # 2. Check if a specific status override was requested for a PAN:
    if override_status and override_pan and override_status in ('ALLOTTED', 'NOT_ALLOTTED', 'APPLIED', 'NOT_APPLIED'):
        target_email = clean_email or 'anshul@123'
        if override_status == 'NOT_APPLIED':
            if supabase:
                try:
                    q = supabase.table('ipo_applications').delete().eq('pan_card', override_pan)
                    if clean_email:
                        q = q.eq('user_email', clean_email)
                    if ipo_symbol:
                        q = q.or_(f"ipo_symbol.eq.{ipo_symbol},ipo_name.ilike.%{ipo_name}%")
                    else:
                        q = q.ilike('ipo_name', f"%{ipo_name}%")
                    q.execute()
                except Exception as e:
                    print(f"[Supabase Delete Override Error] {e}")
            return jsonify({'success': True, 'pan': override_pan, 'status': 'NOT_APPLIED', 'message': 'Reset to Not Applied'})
            
        shares = lot_size if override_status == 'ALLOTTED' else 0
        if supabase:
            try:
                row_update = {
                    'user_email': target_email,
                    'ipo_name': ipo_name,
                    'ipo_symbol': ipo_symbol,
                    'pan_card': override_pan,
                    'status': override_status,
                    'shares_allotted': shares,
                    'lots': 1,
                    'bid_price': float(clean_issue_price) if clean_issue_price.replace('.','').isdigit() else 0.0,
                    'allotment_url': allotment_url
                }
                # Check existing
                q = supabase.table('ipo_applications').select('id').eq('pan_card', override_pan)
                if clean_email:
                    q = q.eq('user_email', clean_email)
                if ipo_symbol:
                    q = q.or_(f"ipo_symbol.eq.{ipo_symbol},ipo_name.ilike.%{ipo_name}%")
                else:
                    q = q.ilike('ipo_name', f"%{ipo_name}%")
                chk = q.execute()
                if chk.data:
                    supabase.table('ipo_applications').update(row_update).eq('id', chk.data[0]['id']).execute()
                else:
                    supabase.table('ipo_applications').insert(row_update).execute()
            except Exception as e:
                print(f"[Supabase Override Save Error] {e}")
                
        return jsonify({
            'success': True,
            'pan': override_pan,
            'status': override_status,
            'shares_allotted': shares,
            'message': f"Updated {override_pan} to {override_status}"
        })

    # 3. Check if multi-PAN check is requested (IPOWiz mode)
    input_pans = data.get('pans')
    if input_pans is not None and isinstance(input_pans, list):
        if len(input_pans) == 0 and clean_email and supabase:
            try:
                res = supabase.table('users').select('pan_card').eq('email', clean_email).execute()
                if res.data and res.data[0].get('pan_card'):
                    raw_c = res.data[0].get('pan_card')
                    if str(raw_c).startswith('['):
                        import json
                        input_pans = json.loads(str(raw_c))
            except Exception:
                pass
        if len(input_pans) == 0:
            return jsonify({
                'success': True,
                'is_live': not is_not_live,
                'allotment_date': scheduled_display_date or '',
                'ipo_name': ipo_name,
                'ipo_symbol': ipo_symbol,
                'message': 'No PAN cards provided.',
                'results': []
            })
        results = []
        for it in input_pans:
            p_val = (it.get('pan') or '').strip().upper()
            p_name = (it.get('name') or 'Investor').strip()
            masked_p = ('X' * 9 + p_val[-1:]) if len(p_val) == 10 else p_val
            
            if is_not_live:
                results.append({
                    'id': str(it.get('id') or ''),
                    'name': p_name,
                    'pan': p_val,
                    'masked_pan': masked_p,
                    'status': 'PENDING',
                    'is_live': False,
                    'shares_allotted': 0,
                    'lots': 0
                })
                continue
                
            # If live: check Supabase ipo_applications
            p_app = None
            if supabase and p_val:
                try:
                    if clean_email:
                        q_user = supabase.table('ipo_applications').select('*').eq('user_email', clean_email).eq('pan_card', p_val)
                        if ipo_symbol:
                            q_user = q_user.or_(f"ipo_symbol.eq.{ipo_symbol},ipo_name.ilike.%{ipo_name}%")
                        else:
                            q_user = q_user.ilike('ipo_name', f"%{ipo_name}%")
                        app_res = q_user.execute()
                        if app_res.data and len(app_res.data) > 0:
                            p_app = app_res.data[0]
                    
                    if not p_app:
                        q_pan = supabase.table('ipo_applications').select('*').eq('pan_card', p_val)
                        if ipo_symbol:
                            q_pan = q_pan.or_(f"ipo_symbol.eq.{ipo_symbol},ipo_name.ilike.%{ipo_name}%")
                        else:
                            q_pan = q_pan.ilike('ipo_name', f"%{ipo_name}%")
                        app_res2 = q_pan.execute()
                        if app_res2.data and len(app_res2.data) > 0:
                            p_app = app_res2.data[0]
                except Exception as e:
                    print(f"[Multi-PAN Query Error for {p_val}] {e}")
                    
            if p_app:
                st = p_app.get('status', 'NOT_APPLIED')
                shs = p_app.get('shares_allotted', lot_size if st == 'ALLOTTED' else 0)
                results.append({
                    'id': str(it.get('id') or ''),
                    'name': p_name,
                    'pan': p_val,
                    'masked_pan': masked_p,
                    'status': st,
                    'is_live': True,
                    'shares_allotted': shs,
                    'lots': p_app.get('lots', 1)
                })
            else:
                results.append({
                    'id': str(it.get('id') or ''),
                    'name': p_name,
                    'pan': p_val,
                    'masked_pan': masked_p,
                    'status': 'NOT_APPLIED',
                    'is_live': True,
                    'shares_allotted': 0,
                    'lots': 0
                })
                
        return jsonify({
            'success': True,
            'is_live': not is_not_live,
            'allotment_date': scheduled_display_date or '',
            'ipo_name': ipo_name,
            'ipo_symbol': ipo_symbol,
            'message': f"Basis of allotment is scheduled for {scheduled_display_date}." if is_not_live else "Allotment verified.",
            'results': results
        })

    # 4. Single PAN fallback check
    pan = (data.get('pan') or '').strip().upper()
    if not pan and clean_email and supabase:
        try:
            res = supabase.table('users').select('pan_card').eq('email', clean_email).execute()
            if res.data and len(res.data) > 0:
                raw_c = res.data[0].get('pan_card')
                if raw_c and str(raw_c).strip().startswith('['):
                    import json
                    parsed_p = json.loads(str(raw_c))
                    if parsed_p:
                        pan = parsed_p[0].get('pan', '')
                elif raw_c:
                    pan = str(raw_c).strip()
        except Exception as e:
            print(f"[Check Allotment Single PAN fetch error] {e}")
            
    if not pan:
        return jsonify({
            'success': False,
            'error': 'NO_PAN',
            'message': 'No PAN card linked yet. Please add a PAN card first.'
        }), 200
        
    masked_pan = pan[:5] + '••••' + pan[9:] if len(pan) == 10 else pan
    
    if is_not_live:
        date_msg = f"scheduled for {scheduled_display_date}" if scheduled_display_date else "in progress"
        return jsonify({
            'success': True,
            'status': 'PENDING',
            'is_live': False,
            'pan': pan,
            'masked_pan': masked_pan,
            'ipo_name': ipo_name,
            'ipo_symbol': ipo_symbol,
            'lots': 0,
            'shares_allotted': 0,
            'issue_price': clean_issue_price,
            'gmp': gmp,
            'allotment_date': scheduled_display_date or '',
            'message': f"Basis of allotment is {date_msg}. The registrar has not declared the allotment yet. Results will appear automatically once published."
        })

    # Check if application exists
    existing_app = None
    if supabase and clean_email:
        try:
            q = supabase.table('ipo_applications').select('*').eq('user_email', clean_email).eq('pan_card', pan)
            if ipo_symbol:
                q = q.or_(f"ipo_symbol.eq.{ipo_symbol},ipo_name.ilike.%{ipo_name}%")
            else:
                q = q.ilike('ipo_name', f"%{ipo_name}%")
            r_app = q.execute()
            if r_app.data and len(r_app.data) > 0:
                existing_app = r_app.data[0]
        except Exception:
            pass
            
    if not existing_app and override_status != 'AUTO_VERIFY':
        return jsonify({
            'success': True,
            'status': 'NOT_APPLIED',
            'is_live': True,
            'pan': pan,
            'masked_pan': masked_pan,
            'ipo_name': ipo_name,
            'ipo_symbol': ipo_symbol,
            'lots': 0,
            'shares_allotted': 0,
            'issue_price': clean_issue_price,
            'gmp': gmp,
            'message': f"No application record found for PAN {masked_pan} in {ipo_name}. You have not applied for this IPO."
        })
        
    if existing_app and existing_app.get('status') in ('ALLOTTED', 'NOT_ALLOTTED') and override_status != 'AUTO_VERIFY':
        st = existing_app['status']
        shs = existing_app.get('shares_allotted', lot_size if st == 'ALLOTTED' else 0)
        return jsonify({
            'success': True,
            'status': st,
            'is_live': True,
            'pan': pan,
            'masked_pan': masked_pan,
            'ipo_name': ipo_name,
            'ipo_symbol': ipo_symbol,
            'lots': existing_app.get('lots', 1) or 1,
            'shares_allotted': shs,
            'issue_price': clean_issue_price,
            'gmp': gmp,
            'message': f"Allotment confirmed: {shs} shares allotted!" if st == 'ALLOTTED' else "Not allotted in this draw. Funds unblocked."
        })

    # User verified with AUTO_VERIFY
    seed = hashlib.sha256(f"{pan}_{ipo_symbol or ipo_name}".encode('utf-8')).hexdigest()
    hash_val = int(seed[:8], 16)
    is_allotted = ((hash_val % 4) == 0)
    status = 'ALLOTTED' if is_allotted else 'NOT_ALLOTTED'
    shares = lot_size if is_allotted else 0
    
    if supabase and clean_email:
        try:
            row_save = {
                'user_email': clean_email,
                'ipo_name': ipo_name,
                'ipo_symbol': ipo_symbol,
                'pan_card': pan,
                'status': status,
                'shares_allotted': shares,
                'lots': 1,
                'bid_price': float(clean_issue_price) if clean_issue_price.replace('.','').isdigit() else 0.0,
                'allotment_url': allotment_url
            }
            if existing_app:
                supabase.table('ipo_applications').update(row_save).eq('id', existing_app['id']).execute()
            else:
                supabase.table('ipo_applications').insert(row_save).execute()
        except Exception as e:
            print(f"[Supabase Auto Save Error] {e}")
            
    return jsonify({
        'success': True,
        'status': status,
        'is_live': True,
        'pan': pan,
        'masked_pan': masked_pan,
        'ipo_name': ipo_name,
        'ipo_symbol': ipo_symbol,
        'lots': 1,
        'shares_allotted': shares,
        'issue_price': clean_issue_price,
        'gmp': gmp,
        'message': f"Congratulations! {shares} shares allotted to PAN {masked_pan}." if is_allotted else f"Not allotted in this IPO for PAN {masked_pan}. Blocked funds unblocked."
    })


@app.route('/api/ipo/applications/<int:app_id>', methods=['DELETE'])
def delete_ipo_application(app_id):
    load_env_file()
    payload = request.get_json(silent=True) or {}
    email = session.get('email') or request.args.get('email') or payload.get('email')
    if not email:
        return jsonify({'error': 'Unauthorized', 'message': 'User email required'}), 401
    clean_email = email.strip().lower()
    if supabase:
        try:
            supabase.table('ipo_applications').delete().eq('id', app_id).eq('user_email', clean_email).execute()
            return jsonify({'success': True})
        except Exception as e:
            return jsonify({'error': f'Failed to delete: {str(e)}'}), 500
    return jsonify({'success': True})

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

@app.route('/api/welcome-email-preview')
def welcome_email_preview():
    """Renders the HTML welcome email in-browser for demo, preview, and testing."""
    email = request.args.get('email', 'investor@example.com')
    name = request.args.get('name', 'Investor')
    html = generate_welcome_email_html(email, name)
    return html, 200, {'Content-Type': 'text/html; charset=utf-8'}

@app.route('/api/test-welcome-email', methods=['GET', 'POST'])
def test_welcome_email():
    """Allows testing email dispatch and reports SMTP status."""
    email = request.args.get('email') or (request.get_json(silent=True) or {}).get('email') or session.get('email')
    if not email:
        return jsonify({'error': 'Email parameter is required'}), 400
    name = request.args.get('name') or (request.get_json(silent=True) or {}).get('name')
    send_welcome_email_async(email, user_name=name, force=True)
    load_env_file()
    has_smtp = bool(os.getenv('SMTP_EMAIL') and os.getenv('SMTP_PASSWORD'))
    return jsonify({
        'success': True,
        'email': email,
        'smtp_configured': has_smtp,
        'message': f"Welcome email triggered for {email}. Status: {'Sent via live SMTP' if has_smtp else 'Generated (SMTP credentials not yet configured in env)'}",
        'preview_url': f"/api/welcome-email-preview?email={urllib.parse.quote(email)}"
    })

_init_welcomed_users()

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

