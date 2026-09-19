# routes/holdings.py
# Manages user stock/commodity holdings in Supabase:
#   GET  /api/holdings  - Fetch user's portfolio
#   POST /api/holdings  - Save/update portfolio

import os, uuid, json
from flask import Blueprint, jsonify, request, session
from routes import supabase, _LOCAL_HOLDINGS_CACHE

holdings_bp = Blueprint('holdings', __name__)

@holdings_bp.route('/api/holdings', methods=['GET'])
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

@holdings_bp.route('/api/holdings', methods=['POST'])
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

