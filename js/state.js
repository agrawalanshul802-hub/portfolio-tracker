// js/state.js
// ─── SHARED STATE & UTILITIES ────────────────────────────────────────────────
// Loads FIRST. Defines all shared variables and helper functions used
// by every other module: storage helpers, formatting, ticker price database.
// Since classic <script> tags share the global lexical scope, all const/let
// declared here are accessible in portfolio.js, ipo.js, alerts.js etc.
"use strict";


      /* ---------------- storage ---------------- */
      const USERS_KEY = 'ptracker_users_v1';
      const SESSION_KEY = 'ptracker_session_v1';
      let currentUser = null; // { email }
      function holdingsKey() { return 'ptracker_holdings_v3_' + (currentUser ? currentUser.email : 'guest'); }
      const memoryStore = {};
      async function storageGet(key) {
        try {
          if (window.storage && typeof window.storage.get === 'function') {
            const r = await window.storage.get(key, false);
            return r ? JSON.parse(r.value) : null;
          }
        } catch (e) { /* fall through to next storage strategy */ }
        try {
          if (window.localStorage) {
            const v = window.localStorage.getItem('ptracker__' + key);
            return v !== null ? JSON.parse(v) : null;
          }
        } catch (e) { /* fall through to next storage strategy */ }
        return Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : null;
      }
      async function storageSet(key, value) {
        try {
          if (window.storage && typeof window.storage.set === 'function') {
            await window.storage.set(key, JSON.stringify(value), false);
            return;
          }
        } catch (e) { /* fall through to next storage strategy */ }
        try {
          if (window.localStorage) {
            window.localStorage.setItem('ptracker__' + key, JSON.stringify(value));
            return;
          }
        } catch (e) { /* fall through to next storage strategy */ }
        memoryStore[key] = value;
      }

      /* ---------------- deterministic pseudo-random ---------------- */
      function hashSeed(str) {
        let h = 2166136261;
        for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
        return h >>> 0;
      }
      function mulberry32(seed) {
        return function () {
          seed |= 0; seed = seed + 0x6D2B79F5 | 0;
          let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
          t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
          return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
      }
      function uid(prefix) { return prefix + '-' + Math.random().toString(36).slice(2, 7).toUpperCase(); }
      function fmtINR(n) { return n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }); }
      function fmtINR2(n) { return n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
      function fmtPct(n) { return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'; }

      /* ---------------- ticker knowledge base (for price guessing) ---------------- */
      // Reference prices captured from live market data on 13 Jul 2026.
      // These are real closing/near-live prices at the time they were checked,
      // not a continuously-updating feed — see the disclaimer in the UI.
      const KNOWN = [
        { ticker: 'RELIANCE', name: 'Reliance Industries Ltd', assetClass: 'Equity', price: 1297.70 },
        { ticker: 'TCS', name: 'Tata Consultancy Services', assetClass: 'Equity', price: 2068.00 },
        { ticker: 'INFY', name: 'Infosys Ltd', assetClass: 'Equity', price: 1068.70 },
        { ticker: 'HDFCBANK', name: 'HDFC Bank Ltd', assetClass: 'Equity', price: 824.50 },
        { ticker: 'ICICIBANK', name: 'ICICI Bank Ltd', assetClass: 'Equity', price: 1391.70 },
        { ticker: 'SBIN', name: 'State Bank of India', assetClass: 'Equity', price: 1038.80 },
        { ticker: 'ITC', name: 'ITC Ltd', assetClass: 'Equity', price: 290.10 },
        { ticker: 'WIPRO', name: 'Wipro Ltd', assetClass: 'Equity', price: 175.84 },
        { ticker: 'TATAMOTORS', name: 'Tata Motors Ltd', assetClass: 'Equity', price: 431.05 },
        { ticker: 'BHARTIARTL', name: 'Bharti Airtel Ltd', assetClass: 'Equity', price: 1920.40 },
        { ticker: 'HINDUNILVR', name: 'Hindustan Unilever Ltd', assetClass: 'Equity', price: 2151.00 },
        { ticker: 'LT', name: 'Larsen & Toubro Ltd', assetClass: 'Equity', price: 3987.00 },
        { ticker: 'NTPC', name: 'NTPC Ltd', assetClass: 'Equity', price: 349.70 },
        { ticker: 'DIXON', name: 'Dixon Technologies Ltd', assetClass: 'Equity', price: 13421.00 },
        { ticker: 'NIFTYBEES', name: 'Nippon India ETF Nifty BeES', assetClass: 'ETF', price: 273.98 },
        { ticker: 'GOLDBEES', name: 'Nippon India ETF Gold BeES', assetClass: 'ETF', exchange: 'NSE', price: 126.05 },
        { ticker: 'SILVERBEES', name: 'Nippon India Silver ETF', assetClass: 'ETF', exchange: 'NSE', price: 220.45 },
        { ticker: 'GOLD', name: 'Gold 24K (MCX / 10g)', assetClass: 'Commodity', exchange: 'MCX', price: 73945 },
        { ticker: 'SILVER', name: 'Silver (MCX / 1kg)', assetClass: 'Commodity', exchange: 'MCX', price: 84700 },
        { ticker: 'CRUDEOIL', name: 'Crude Oil (MCX / bbl)', assetClass: 'Commodity', exchange: 'MCX', price: 6280 },
        { ticker: 'NATURALGAS', name: 'Natural Gas (MCX / mmBtu)', assetClass: 'Commodity', exchange: 'MCX', price: 199 },
        { ticker: 'COPPER', name: 'Copper (MCX / kg)', assetClass: 'Commodity', exchange: 'MCX', price: 825 }
      ];
      function findKnown(symbol) {
        const s = (symbol || '').toUpperCase().replace(/\.(NS|BO|MCX)$/, '');
        return KNOWN.find(c => c.ticker === s);
      }
      function guessAssetClass(symbol, exchange) {
        if (exchange === 'MCX') return 'Commodity';
        const s = (symbol || '').toUpperCase().trim().replace(/\.(NS|BO|MCX)$/, '');
        const known = findKnown(s);
        if (known) return known.assetClass;
        if (['GOLD', 'SILVER', 'CRUDEOIL', 'NATURALGAS', 'COPPER', 'ZINC', 'ALUMINIUM', 'LEAD', 'NICKEL'].includes(s)) return 'Commodity';
        if (s.includes('BEES') || s.includes('ETF')) return 'ETF';
        return 'Equity';
      }
      function buildYahooSymbol(symbol, exchange) {
        const s = (symbol || '').toUpperCase().trim().replace(/\.(NS|BO|MCX)$/, '');
        if (exchange === 'MCX') return s + '.MCX';
        return s + (exchange === 'BSE' ? '.BO' : '.NS');
      }
