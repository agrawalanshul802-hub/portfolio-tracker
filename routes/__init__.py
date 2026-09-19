# routes/__init__.py
# Shared state: database connection, caches, helper functions
# All blueprints import from here to avoid circular imports

import os, re, json, uuid, hashlib, threading, datetime
import urllib.parse, urllib.request
from supabase import create_client, Client as SupabaseClient

# Root project directory
DIRECTORY = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Supabase connection
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")
supabase = None
if SUPABASE_URL and SUPABASE_KEY:
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    except Exception as e:
        print(f"[Supabase] Init warning: {e}")
else:
    print("[Supabase] Notice: Credentials not set. Using in-memory caches.")

# In-Memory Fallback Caches (prevent data loss on cold-starts)
_LOCAL_HOLDINGS_CACHE = {}
_LOCAL_USER_PANS      = {}
_LOCAL_IPO_APPS       = {}
DEMO_PANS = {"FNUPA8261H", "AJLPA3918K", "AVGPA2677Q", "BTDPY6025L", "QDKPS9103R"}

def hash_password(password):
    """Hash password with PBKDF2-HMAC-SHA256 + random salt."""
    salt = os.urandom(16)
    pw_hash = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 100000)
    return salt.hex() + ":" + pw_hash.hex()

def verify_password(stored_password, provided_password):
    """Verify a plaintext password against stored hash."""
    try:
        salt_hex, hash_hex = stored_password.split(":")
        salt = bytes.fromhex(salt_hex)
        pw_hash = hashlib.pbkdf2_hmac("sha256", provided_password.encode(), salt, 100000)
        return pw_hash.hex() == hash_hex
    except Exception:
        return False
