# routes/auth.py
# Handles all authentication:
#   /api/auth/sync    - Sync session on page reload
#   /api/session      - Get current session
#   /api/register     - New user registration
#   /api/login        - Email/password login
#   /api/logout       - Logout
#   /api/login/google - Google OAuth login
#   /api/welcome-email-preview  - Preview welcome email
#   /api/test-welcome-email     - Test email dispatch

import os, json, hashlib, uuid, threading, re, smtplib
import urllib.parse, urllib.request
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from flask import Blueprint, jsonify, request, session, redirect
from routes import supabase, hash_password, verify_password, DIRECTORY, load_env_file

auth_bp = Blueprint('auth', __name__)

WELCOMED_USERS_FILE = os.path.join(DIRECTORY, 'welcomed_users.json')
_welcomed_users_lock = threading.Lock()

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

@auth_bp.route('/api/register', methods=['POST'])

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

@auth_bp.route('/api/login', methods=['POST'])

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

@auth_bp.route('/api/logout', methods=['POST'])

def logout():

    session.pop('email', None)

    return jsonify({'success': True})

# REST API: Google OAuth 2.0 Login Redirect
@auth_bp.route('/api/login/google')
def google_login():
    host = request.host.lower()
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

    # Google Cloud Console only authorizes:
    # 1. http://127.0.0.1:8080/api/login/google/callback (Desktop testing)
    # 2. https://portfolio-tracker-1-n2qq.onrender.com/api/login/google/callback (Production & Mobile LAN Bridge)
    if hostname == '127.0.0.1':
        redirect_uri = f"{scheme}://127.0.0.1:8080/api/login/google/callback"
        state = hashlib.sha256(os.urandom(1024)).hexdigest()
    elif is_private_ip:
        # Accessed on mobile phone over local Wi-Fi (e.g. 192.168.x.x, 10.x.x.x).
        # Google OAuth strictly forbids private IPs, so bridge via Render HTTPS callback,
        # storing the phone's local LAN origin in the state parameter to bounce back upon login.
        origin_url = f"{scheme}://{host}"
        state_data = {
            'token': hashlib.sha256(os.urandom(1024)).hexdigest()[:16],
            'origin': origin_url
        }
        import base64
        state = base64.urlsafe_b64encode(json.dumps(state_data).encode('utf-8')).decode('utf-8')
        redirect_uri = "https://portfolio-tracker-1-n2qq.onrender.com/api/login/google/callback"
    else:
        # Production on Render: ALWAYS force HTTPS to prevent scheme mismatch on reverse proxy
        state = hashlib.sha256(os.urandom(1024)).hexdigest()
        redirect_uri = "https://portfolio-tracker-1-n2qq.onrender.com/api/login/google/callback"

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
@auth_bp.route('/api/login/google/callback')
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

    host = request.host.lower()
    if return_origin:
        redirect_uri = "https://portfolio-tracker-1-n2qq.onrender.com/api/login/google/callback"
    elif '127.0.0.1' in host or 'localhost' in host:
        redirect_uri = "http://127.0.0.1:8080/api/login/google/callback"
    else:
        redirect_uri = "https://portfolio-tracker-1-n2qq.onrender.com/api/login/google/callback"

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
        if supabase:
            res = supabase.table('users').select('email').eq('email', email).execute()
            if not res.data:
                placeholder_hash = "oauth-google:" + hashlib.sha256(uuid.uuid4().bytes).hexdigest()
                supabase.table('users').insert({'email': email, 'password_hash': placeholder_hash}).execute()

        user_name = info_body.get('name') or info_body.get('given_name')
        # Send welcome email asynchronously to new users
        send_welcome_email_async(email, user_name=user_name)
    except Exception as e:
        print(f"Supabase user sync notice: {e}")

    session.permanent = True
    session['email'] = email

    return redirect(f"{target_base}/?login_email={urllib.parse.quote(email)}")


# Welcome email preview & test endpoints
@auth_bp.route('/api/welcome-email-preview')
def welcome_email_preview():
    """Renders the HTML welcome email in-browser for demo, preview, and testing."""
    email = request.args.get('email', 'investor@example.com')
    name = request.args.get('name', 'Investor')
    html = generate_welcome_email_html(email, name)
    return html, 200, {'Content-Type': 'text/html; charset=utf-8'}

@auth_bp.route('/api/test-welcome-email', methods=['GET', 'POST'])
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

