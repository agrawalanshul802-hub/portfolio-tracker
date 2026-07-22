import http.server
import urllib.request
import urllib.parse
import os
import sys
import socket
import sqlite3
import hashlib
from flask import Flask, jsonify, request, session, send_from_directory

PORT = 8080
DIRECTORY = os.path.dirname(os.path.abspath(__file__))
DATABASE = os.path.join(DIRECTORY, 'database.db')

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
    return send_from_directory(DIRECTORY, 'PORTFOLIO.html.html')

# Support serving any static files (images, icons, etc.)
@app.route('/<path:path>')
def static_files(path):
    return send_from_directory(DIRECTORY, path)

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
