    (function () {
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
      /* ---------------- live prices ----------------
         Crypto: CoinGecko public API — no key, reliable CORS support for browsers.
         Equities/ETFs: Twelve Data API — a real market-data provider designed for
         direct browser use (proper CORS support), supports batching many symbols
         in one call. Free-tier API keys have a limited requests-per-minute quota,
         so both are best-effort: on any failure (offline, invalid/exhausted key,
         unrecognized symbol) we silently fall back to the dated reference price /
         simulated estimate below, so the app always still works either way.
      ------------------------------------------------ */
      const TWELVE_DATA_API_KEY = '78eb4294f5a54aeca51eda268715f649';
      const livePriceCache = {}; // { BTC: { price: 6110000, prevClose: 6050000 }, ... }
      let lastFetchErrors = [];

      function getCachedPrice(base) {
        if (!base) return null;
        const entry = livePriceCache[base.toUpperCase()];
        if (!entry) return null;
        return typeof entry === 'object' ? entry.price : entry;
      }

      function getCachedPrevClose(base) {
        if (!base) return null;
        const entry = livePriceCache[base.toUpperCase()];
        if (!entry) return null;
        return typeof entry === 'object' ? entry.prevClose : null;
      }

      async function fetchLiveCryptoPrices() {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 6000);
          const res = await fetch(
            'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=inr&include_24hr_change=true',
            { signal: controller.signal }
          );
          clearTimeout(timer);
          if (!res.ok) throw new Error('CoinGecko responded with ' + res.status);
          const data = await res.json();
          if (data.bitcoin && data.bitcoin.inr) {
            const price = data.bitcoin.inr;
            const change = data.bitcoin.inr_24h_change || 0;
            livePriceCache.BTC = { price, prevClose: price / (1 + change / 100) };
          }
          if (data.ethereum && data.ethereum.inr) {
            const price = data.ethereum.inr;
            const change = data.ethereum.inr_24h_change || 0;
            livePriceCache.ETH = { price, prevClose: price / (1 + change / 100) };
          }
        } catch (e) {
          console.warn('Live crypto price fetch failed, using reference prices instead:', e.message);
        }
      }

      // Fetches prices for many symbols on the same exchange in a single Twelve Data call.
      async function fetchLiveEquityPricesBatch(symbols, exchange) {
        if (!symbols.length) return;
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 7000);
          const url = 'https://api.twelvedata.com/price?symbol=' + encodeURIComponent(symbols.join(','))
            + '&exchange=' + encodeURIComponent(exchange)
            + '&apikey=' + encodeURIComponent(TWELVE_DATA_API_KEY);
          const res = await fetch(url, { signal: controller.signal });
          clearTimeout(timer);
          if (!res.ok) throw new Error('Twelve Data responded with ' + res.status);
          const data = await res.json();

          if (symbols.length === 1) {
            // single-symbol shape: { price: "1234.56" } or { code, message, status:"error" }
            const p = parseFloat(data && data.price);
            if (!isNaN(p) && p > 0) livePriceCache[symbols[0]] = { price: p, prevClose: null };
            return;
          }
          // multi-symbol shape: { SYMBOL: { price: "1234.56" }, ... }
          Object.keys(data || {}).forEach(sym => {
            const entry = data[sym];
            const p = entry && parseFloat(entry.price);
            if (!isNaN(p) && p > 0) livePriceCache[sym.toUpperCase()] = { price: p, prevClose: null };
          });
        } catch (e) {
          console.warn('Live equity price fetch failed for ' + exchange + ' batch, using reference prices instead:', e.message);
        }
      }

      // Fallback for NSE/BSE symbols via Yahoo Finance's chart endpoint
      async function fetchLiveEquityPriceYahoo(yahooSymbol) {
        const targetUrl = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(yahooSymbol)
          + '?range=1d&interval=1m&corsDomain=finance.yahoo.com';
        const baseProxy = window.location.protocol.startsWith('http') ? '' : 'http://127.0.0.1:8080';
        const proxies = [
          url => url,
          url => baseProxy + '/proxy/' + url,
          url => 'https://corsproxy.io/?url=' + encodeURIComponent(url),
          url => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url),
          url => 'https://api.cors.lol/?url=' + encodeURIComponent(url)
        ];

        for (const getProxyUrl of proxies) {
          const url = getProxyUrl(targetUrl);
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 15000);
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timer);
            if (!res.ok) throw new Error('Proxy responded with ' + res.status);
            const data = await res.json();
            const result = data && data.chart && data.chart.result && data.chart.result[0];
            const price = result && result.meta && result.meta.regularMarketPrice;
            const prevClose = result && result.meta && result.meta.chartPreviousClose;
            if (typeof price === 'number' && price > 0) {
              return { price, prevClose: prevClose || price };
            }
            throw new Error('no usable price in response');
          } catch (e) {
            let msg = e.message;
            if (msg.includes('no usable price')) {
              msg = 'Symbol not recognized by Yahoo Finance. Check if the ticker matches Yahoo Finance format (e.g. use "MUTHOOTFIN" instead of "MUTHOOT FINANCE")';
            }
            lastFetchErrors.push(`${yahooSymbol} via ${url.split('?')[0]}: ${msg}`);
            console.warn('Proxy fetch failed:', e.message);
          }
        }
        return null;
      }

      async function refreshLivePricesForHoldings() {
        lastFetchErrors = [];
        if (!state.holdings || !state.holdings.length) return;

        // Visual feedback on refresh button/label
        const updatedLabel = document.getElementById('updatedLabel');
        if (updatedLabel) updatedLabel.textContent = "Updating live prices...";

        const symbols = state.holdings.map(h => h.yahooSymbol || h.symbol).filter(Boolean);
        if (symbols.length === 0) return;

        // 1. Primary: Direct high-speed backend live price API with timeout
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 10000);
          const url = '/api/live-prices?symbols=' + encodeURIComponent(symbols.join(','));
          const res = await fetch(url, { signal: controller.signal });
          clearTimeout(timer);

          if (res.ok) {
            const json = await res.json();
            if (json.success && json.prices) {
              Object.keys(json.prices).forEach(key => {
                const item = json.prices[key];
                if (item && item.price) {
                  livePriceCache[key.toUpperCase()] = {
                    price: item.price,
                    prevClose: item.prevClose || item.price
                  };
                }
              });
            }
          }
        } catch (e) {
          console.warn('Backend live price fetch notice:', e.message);
        }

  // Crypto polling completely purged (MCX Commodity & NSE/BSE focused)
      }

      function applyLivePricesToHoldings() {
        state.holdings.forEach(h => {
          const base = (h.yahooSymbol || '').toUpperCase().replace(/\.(NS|BO|MCX)$/, '');
          const cached = getCachedPrice(base);
          if (cached) h.price = +cached.toFixed(2);
        });
        try { checkPriceAlerts(); } catch (err) { console.warn('Alert check notice:', err); }
      }

      function guessCurrentPrice(yahooSymbol, buyPrice) {
        const baseSymbol = (yahooSymbol || '').toUpperCase().replace(/\.(NS|BO|MCX)$/, '');
        const cached = getCachedPrice(baseSymbol);
        if (cached) {
          return +cached.toFixed(2);
        }
        const known = findKnown(yahooSymbol);
        if (known) {
          const rand = mulberry32(hashSeed(yahooSymbol + '-known'));
          const jitter = 1 + (rand() - 0.5) * 0.01;
          return +(known.price * jitter).toFixed(2);
        }
        return buyPrice;
      }

      function buildHolding(opts, id) {
        const symbol = (opts.symbol || '').toUpperCase().trim();
        const exchange = opts.exchange || 'NSE';
        const buyPrice = Number(opts.buyPrice);
        const qty = Number(opts.qty);
        const yahooSymbol = (opts.yahooOverride && opts.yahooOverride.trim()) ? opts.yahooOverride.trim().toUpperCase() : buildYahooSymbol(symbol, exchange);
        const known = findKnown(yahooSymbol);
        const name = (opts.name && opts.name.trim()) ? opts.name.trim() : (known ? known.name : symbol);
        const price = guessCurrentPrice(yahooSymbol, buyPrice);
        return {
          id: id || uid('H'), symbol, exchange, name, yahooSymbol,
          assetClass: guessAssetClass(yahooSymbol), qty, buyPrice, amount: buyPrice * qty, price
        };
      }

      function seedHoldings() {
        return [
          buildHolding({ symbol: 'DIXON', exchange: 'NSE', name: 'Dixon Technologies (India) Ltd', buyPrice: 11000, qty: 55 }),
          buildHolding({ symbol: 'GOLD', exchange: 'MCX', name: 'Gold 24K (MCX / 10g)', buyPrice: 72000, qty: 5 })
        ];
      }

      let isBalanceHidden = false;
      try {
        isBalanceHidden = localStorage.getItem('portfolio_balance_hidden') === 'true';
      } catch (e) {}

      function updatePrivacyEyeUI() {
        const icon = document.getElementById('privacyEyeIcon');
        if (!icon) return;
        if (isBalanceHidden) {
          icon.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>';
        } else {
          icon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>';
        }
      }
      window.updatePrivacyEyeUI = updatePrivacyEyeUI;

      function toggleBalancePrivacy() {
        isBalanceHidden = !isBalanceHidden;
        try {
          localStorage.setItem('portfolio_balance_hidden', isBalanceHidden ? 'true' : 'false');
        } catch (e) {}
        updatePrivacyEyeUI();
        if (typeof renderStats === 'function') renderStats();
      }
      window.toggleBalancePrivacy = toggleBalancePrivacy;

      const state = window.state = { holdings: [], filter: 'all', search: '', sort: 'default', sortDir: 'desc', dayOpen: {}, lastUpdated: new Date(), currentTab: 'portfolio', portfolioSection: 'all' };
      let _ipoLoaded = false;   // tracks whether IPO data has been fetched
      let _currentIpoSection = 'open'; // tracks active IPO tab
      let allocationChartInstance = null;
      let performanceChartInstance = null;
      let classSplitChartInstance = null;

      function getHoldingsStorageKey() {
        const email = (currentUser && currentUser.email) || localStorage.getItem('portfolio_user_email') || 'default_user';
        return 'ptracker_holdings_' + email.trim().toLowerCase();
      }

      function getLocalHoldings() {
        try {
          const raw = localStorage.getItem(getHoldingsStorageKey());
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) return parsed;
          }
          // Secondary fallback: check global backup
          const backup = localStorage.getItem('ptracker_holdings_backup');
          if (backup) {
            const parsed = JSON.parse(backup);
            if (Array.isArray(parsed) && parsed.length > 0) return parsed;
          }
        } catch (e) {
          console.warn('LocalStorage read error:', e);
        }
        return null;
      }

      function saveLocalHoldings(list) {
        try {
          localStorage.setItem(getHoldingsStorageKey(), JSON.stringify(list || []));
          if (Array.isArray(list) && list.length > 0) {
            localStorage.setItem('ptracker_holdings_backup', JSON.stringify(list));
          }
        } catch (e) {
          console.warn('LocalStorage write error:', e);
        }
      }

      async function loadHoldings() {
        const email = (currentUser && currentUser.email) || localStorage.getItem('portfolio_user_email') || '';
        
        // 1. Instant local read so user data is visible immediately on page load/refresh
        const local = getLocalHoldings();
        if (local && local.length > 0) {
          state.holdings = local;
          computeDayOpen();
        }

        // 2. Fetch from backend database
        try {
          const url = '/api/holdings' + (email ? '?email=' + encodeURIComponent(email) : '');
          const res = await fetch(url);
          if (res.ok) {
            const serverList = await res.json();
            if (Array.isArray(serverList) && serverList.length > 0) {
              state.holdings = serverList;
              saveLocalHoldings(serverList);
            } else if (local && local.length > 0) {
              // Server database was fresh/empty but client has saved holdings: sync client holdings to DB!
              state.holdings = local;
              await persistHoldings(local);
            } else {
              state.holdings = [];
              saveLocalHoldings([]);
            }
          } else if (local && local.length > 0) {
            // Server error or session refresh in progress: keep local holdings!
            state.holdings = local;
          }
        } catch (e) {
          console.error("Failed to load holdings from server:", e);
          if (local && local.length > 0) {
            state.holdings = local;
          }
        }
        computeDayOpen();
      }

      async function persistHoldings(list) {
        const safeList = list || state.holdings || [];
        saveLocalHoldings(safeList);

        const email = (currentUser && currentUser.email) || localStorage.getItem('portfolio_user_email') || '';
        try {
          const url = '/api/holdings' + (email ? '?email=' + encodeURIComponent(email) : '');
          await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: email,
              holdings: safeList
            })
          });
        } catch (e) {
          console.error("Failed to persist holdings to database:", e);
        }
      }

      function persist() {
        persistHoldings(state.holdings);
      }

      function computeDayOpen() {
        state.holdings.forEach(h => {
          const base = (h.yahooSymbol || '').toUpperCase().replace(/\.(NS|BO|MCX)$/, '');
          const realPrevClose = getCachedPrevClose(base);
          if (realPrevClose) {
            state.dayOpen[h.id] = realPrevClose;
          } else {
            const rand = mulberry32(hashSeed(h.yahooSymbol + '-dayopen'));
            const drift = 1 + (rand() - 0.5) * 0.025;
            state.dayOpen[h.id] = h.price / drift;
          }
        });
      }

      function enrich(h) {
        const value = h.qty * h.price;
        const gain = value - h.amount;
        const gainPct = h.amount ? (gain / h.amount) * 100 : 0;
        const openVal = h.qty * (state.dayOpen[h.id] ?? h.price);
        const dayPnl = value - openVal;
        const dayPct = openVal ? (dayPnl / openVal) * 100 : 0;
        return { ...h, value, gain, gainPct, dayPnl, dayPct, isProfit: gain >= 0 };
      }
      function allHoldings() { return state.holdings.map(enrich); }

      /* ---------------- toast ---------------- */
      function toast(msg) {
        const c = document.getElementById('toastContainer');
        const el = document.createElement('div');
        el.className = 'toast'; el.textContent = msg;
        c.appendChild(el);
        setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .25s ease'; setTimeout(() => el.remove(), 250); }, 2400);
      }

      /* ---------------- number: animation ---------------- */
      function animateNumber(elementId, endValue, isCurrency = true, showSign = false) {
        const el = document.getElementById(elementId);
        if (!el) return;

        let startValue = 0;
        const currentText = el.textContent || '';
        if (currentText) {
          const cleanText = currentText.replace(/[^0-9.-]/g, '');
          if (cleanText) startValue = parseFloat(cleanText);
        }

        if (Math.abs(startValue - endValue) < 0.01) {
          if (isCurrency) {
            el.textContent = (showSign && endValue >= 0 ? '+' : '') + fmtINR(endValue);
          } else {
            el.textContent = fmtPct(endValue);
          }
          return;
        }

        const duration = 1200; // 1.2s ease animation
        const startTime = performance.now();

        function update(currentTime) {
          const elapsed = currentTime - startTime;
          const progress = Math.min(elapsed / duration, 1);
          const easeProgress = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
          const val = startValue + (endValue - startValue) * easeProgress;

          if (isCurrency) {
            el.textContent = (showSign && val >= 0 ? '+' : '') + fmtINR(val);
          } else {
            el.textContent = fmtPct(val);
          }

          if (progress < 1) {
            requestAnimationFrame(update);
          } else {
            if (isCurrency) {
              el.textContent = (showSign && endValue >= 0 ? '+' : '') + fmtINR(endValue);
            } else {
              el.textContent = fmtPct(endValue);
            }
          }
        }

        requestAnimationFrame(update);
      }

      /* ---------------- render: stats ---------------- */
      function renderStats() {
                const allList = allHoldings();
        const stocksList = allList.filter(h => h.assetClass !== 'Commodity' && (h.exchange || 'NSE') !== 'MCX');
        const mcxList = allList.filter(h => h.assetClass === 'Commodity' || h.exchange === 'MCX');

        // Update counts on section tab badges
        const countAllEl = document.getElementById('secCountAll');
        const countStocksEl = document.getElementById('secCountStocks');
        const countMcxEl = document.getElementById('secCountMcx');
        if (countAllEl) countAllEl.textContent = allList.length;
        if (countStocksEl) countStocksEl.textContent = stocksList.length;
        if (countMcxEl) countMcxEl.textContent = mcxList.length;

        // Choose list depending on active section
        let list = allList;
        const netWorthLabel = document.querySelector('.net-worth-header .card-label');
        if (state.portfolioSection === 'stocks') {
          list = stocksList;
          if (netWorthLabel) netWorthLabel.textContent = 'Stocks Net Worth (NSE/BSE)';
        } else if (state.portfolioSection === 'mcx') {
          list = mcxList;
          if (netWorthLabel) netWorthLabel.textContent = 'Commodities Net Worth (MCX)';
        } else {
          if (netWorthLabel) netWorthLabel.textContent = 'Total Net Worth (Consolidated)';
        }

        const invested = list.reduce((s, h) => s + h.amount, 0);
        const value = list.reduce((s, h) => s + h.value, 0);
        const gain = value - invested;
        const gainPct = invested ? (gain / invested) * 100 : 0;
        const dayPnl = list.reduce((s, h) => s + h.dayPnl, 0);
        const dayOpenTotal = value - dayPnl;
        const dayPct = dayOpenTotal ? (dayPnl / dayOpenTotal) * 100 : 0;

        if (isBalanceHidden) {
          const statValEl = document.getElementById('statValue');
          if (statValEl) statValEl.textContent = '••••••••';
          const statInvEl = document.getElementById('statInvested');
          if (statInvEl) statInvEl.textContent = '••••••••';
          const statGainEl = document.getElementById('statGain');
          if (statGainEl) { statGainEl.textContent = '••••••••'; statGainEl.className = 'delta-amount'; }
          const statGainPctEl = document.getElementById('statGainPct');
          if (statGainPctEl) { statGainPctEl.textContent = '•••• return'; statGainPctEl.className = 'delta-pct'; }
          const statDayEl = document.getElementById('statDay');
          if (statDayEl) { statDayEl.textContent = '••••••••'; statDayEl.className = 'stat-value'; }
          const statDayPctEl = document.getElementById('statDayPct');
          if (statDayPctEl) { statDayPctEl.textContent = '••••'; statDayPctEl.className = 'sub'; }
        } else {
          animateNumber('statInvested', invested, true, false);
          animateNumber('statValue', value, true, false);

          animateNumber('statGain', gain, true, true);
          const gainEl = document.getElementById('statGain');
          if (gainEl) {
            gainEl.className = 'delta-amount ' + (list.length ? (gain >= 0 ? 'pos' : 'neg') : '');
          }

          animateNumber('statGainPct', gainPct, false);
          const gainPctEl = document.getElementById('statGainPct');
          if (gainPctEl) {
            gainPctEl.className = 'delta-pct ' + (list.length ? (gain >= 0 ? 'pos' : 'neg') : 'neutral');
          }

          animateNumber('statDay', dayPnl, true, true);
          const dayEl = document.getElementById('statDay');
          if (dayEl) {
            dayEl.className = 'stat-value ' + (list.length ? (dayPnl >= 0 ? 'pos' : 'neg') : '');
          }

          animateNumber('statDayPct', dayPct, false);
          const dayPctEl = document.getElementById('statDayPct');
          if (dayPctEl) {
            dayPctEl.className = 'sub ' + (list.length ? (dayPnl >= 0 ? 'pos' : 'neg') : 'neutral');
          }
        }

        const liveResolvedCount = list.filter(h => {
          const base = (h.yahooSymbol || '').toUpperCase().replace(/\.(NS|BO|MCX)$/, '');
          return !!livePriceCache[base];
        }).length;
        const liveEl = document.getElementById('liveCount');
        liveEl.textContent = `${liveResolvedCount}/${list.length} live prices`;
        let titleStr = "";
        if (liveResolvedCount) {
          titleStr += `${liveResolvedCount} holding(s) resolved a live price just now (crypto via CoinGecko; equities try Twelve Data, then Yahoo Finance for NSE/BSE symbols). The rest use a real price captured 13 Jul 2026, or a simulated estimate if unrecognized.`;
        } else {
          titleStr += `Live fetch didn't resolve any holdings right now (no internet, or the data source blocked the request) — using the 13 Jul 2026 reference prices / simulated estimates instead.`;
        }
        if (lastFetchErrors && lastFetchErrors.length > 0) {
          titleStr += `\n\nErrors encountered:\n` + lastFetchErrors.join('\n');
        }
        liveEl.title = titleStr;

        // top gainer / top loser
        const row = document.getElementById('miniStatsRow');
        if (!list.length) { row.innerHTML = ''; return; }
        const sorted = [...list].sort((a, b) => b.gainPct - a.gainPct);
        const topGainer = sorted[0];
        const topLoser = sorted[sorted.length - 1];
        row.innerHTML = `
      <div class="mini-stat">Top gainer &nbsp;<b>${topGainer.symbol}</b>&nbsp;<span class="pct ${topGainer.gainPct >= 0 ? 'pos' : 'neg'}">${fmtPct(topGainer.gainPct)}</span></div>
      <div class="mini-stat">Top loser &nbsp;<b>${topLoser.symbol}</b>&nbsp;<span class="pct ${topLoser.gainPct >= 0 ? 'pos' : 'neg'}">${fmtPct(topLoser.gainPct)}</span></div>
    `;
      }

      function updatedLabelText() {
        const secs = Math.round((Date.now() - state.lastUpdated.getTime()) / 1000);
        if (secs < 5) return 'Updated just now';
        if (secs < 60) return `Updated ${secs}s ago`;
        return `Updated ${Math.floor(secs / 60)}m ago`;
      }
      function tickUpdatedLabel() { document.getElementById('updatedLabel').textContent = updatedLabelText(); }

      
      /* ---------------- Portfolio Section Switcher (Stocks vs MCX) ---------------- */
      function switchPortfolioSection(sec) {
        state.portfolioSection = sec;
        document.querySelectorAll('.sec-tab-btn').forEach(btn => btn.classList.remove('active'));
        const activeBtn = document.getElementById(sec === 'stocks' ? 'secBtnStocks' : (sec === 'mcx' ? 'secBtnMcx' : 'secBtnAll'));
        if (activeBtn) activeBtn.classList.add('active');

        const summaryBadge = document.getElementById('sectionSummaryBadge');
        if (summaryBadge) {
  
        if (sec === 'stocks') summaryBadge.innerHTML = 'Showing <b style="color:#A78BFA;">NSE / BSE Stocks</b> only';
          else if (sec === 'mcx') summaryBadge.innerHTML = 'Showing <b style="color: #F59E0B;">MCX Commodities</b> (Gold, Silver, Metals, Crude)';
          else summaryBadge.textContent = 'Showing Consolidated Net Worth (All Assets)';
        }

        renderAll();
      }
      window.switchPortfolioSection = switchPortfolioSection;

      function selectMcxCommodity(ticker, name, refPrice) {
        const symInput = document.getElementById('symbolInput');
        const exchInput = document.getElementById('exchangeInput');
        const nameInput = document.getElementById('nameInput');
        const buyPriceInput = modalForm ? modalForm.buyPrice : null;

        if (symInput) { symInput.value = ticker; }
        if (exchInput) { exchInput.value = 'MCX'; }
        if (nameInput) { nameInput.value = name; }
        if (buyPriceInput && !buyPriceInput.value && refPrice) { buyPriceInput.value = refPrice; }

        // Trigger live price lookup immediately
        if (symInput) {
          symInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        toast(`Selected MCX ${ticker} • ${name}`);
      }
      window.selectMcxCommodity = selectMcxCommodity;

      function handleExchangeChange(exchVal) {
        const mcxPills = document.getElementById('mcxQuickPills');
        if (mcxPills) {
          mcxPills.style.display = (exchVal === 'MCX') ? 'block' : 'none';
        }
      }
      window.handleExchangeChange = handleExchangeChange;

      /* ---------------- render: table ---------------- */
      function filteredSorted() {
        let list = allHoldings();
        if (state.portfolioSection === 'stocks') {
          list = list.filter(h => h.assetClass !== 'Commodity' && (h.exchange || 'NSE') !== 'MCX');
        } else if (state.portfolioSection === 'mcx') {
          list = list.filter(h => h.assetClass === 'Commodity' || h.exchange === 'MCX');
        }
        if (state.filter === 'profit') list = list.filter(h => h.isProfit);
        if (state.filter === 'loss') list = list.filter(h => !h.isProfit);
        if (state.search) list = list.filter(h => (h.symbol + h.name).toLowerCase().includes(state.search));
        if (state.sort !== 'default') {
          const dir = state.sortDir === 'asc' ? 1 : -1;
          const keyMap = { gainPct: 'gainPct', gain: 'gain', value: 'value', symbol: 'symbol' };
          const key = keyMap[state.sort];
          list.sort((a, b) => {
            if (key === 'symbol') return a.symbol.localeCompare(b.symbol) * dir;
            return (a[key] - b[key]) * dir;
          });
        } else if (state.sortDir === 'asc') {
          list.reverse();
        }
        return list;
      }

      function renderTable() {
                const list = filteredSorted();
        const wrap = document.getElementById('tableWrap');
        const footerBar = document.getElementById('footerBar');
        const holdingsCountEl = document.getElementById('holdingsCount');
        if (holdingsCountEl) holdingsCountEl.textContent = state.holdings.length + ' holdings';

        if (!state.holdings.length) {
          wrap.innerHTML = `<div class="empty-state">No holdings yet. Tap <b>+ Add holding</b> to get started.</div>`;
          if (footerBar) footerBar.style.display = 'none';
          return;
        }
        if (!list.length) {
          wrap.innerHTML = `<div class="empty-state">No holdings match this filter or search.</div>`;
          if (footerBar) footerBar.style.display = 'none';
          return;
        }
        const totalBuy = list.reduce((s, h) => s + h.amount, 0);
        const totalCurrent = list.reduce((s, h) => s + h.value, 0);
        const totalGain = totalCurrent - totalBuy;
        const totalGainPct = totalBuy ? (totalGain / totalBuy) * 100 : 0;
        const totalValue = totalCurrent;

        wrap.innerHTML = `
        <!-- Desktop Table View (>= 768px) -->
        <div class="desktop-holdings-table table-responsive">
          <table>
            <thead><tr>
              <th>${state.portfolioSection === 'mcx' ? 'Commodity' : (state.portfolioSection === 'stocks' ? 'Stock (NSE/BSE)' : 'Instrument')}</th><th>Buy Price</th><th>Qty</th><th>Buy Value</th><th>CMP</th><th>Current Value</th><th>% Gain</th><th>Gain ₹</th><th style="text-align:right;">Actions</th>
            </tr></thead>
            <tbody>
              ${list.map(h => `
                <tr>
                  <td class="cell-primary">
                    <div style="display:flex; align-items:center;">
                      <b>${h.symbol}</b>
                      <span class="exchange-badge-tag ${(h.exchange || 'NSE').toLowerCase()}">${h.exchange || 'NSE'}</span>
                    </div>
                    <div class="cell-sub">${h.name && h.name !== h.symbol ? h.name : h.yahooSymbol}</div>
                  </td>
                  <td>${fmtINR2(h.buyPrice)}</td>
                  <td>${h.qty}</td>
                  <td>${fmtINR(h.amount)}</td>
                  <td>${fmtINR2(h.price)}<div class="cell-under ${h.dayPct >= 0 ? 'pos' : 'neg'}">${fmtPct(h.dayPct)} today</div></td>
                  <td>${fmtINR(h.value)}<div class="cell-under muted">${(totalValue ? h.value / totalValue * 100 : 0).toFixed(1)}% of book</div></td>
                  <td><span class="gain-text ${h.isProfit ? 'pos' : 'neg'}">${fmtPct(h.gainPct)}</span></td>
                  <td><span class="gain-text ${h.isProfit ? 'pos' : 'neg'}">${h.gain >= 0 ? '+' : '-'}${fmtINR(Math.abs(h.gain))}</span></td>
                  <td>
                    <div class="row-actions">
                       <button class="row-action-icon chart-link" data-chart="${h.id}" aria-label="View Live Chart" title="View Live Chart"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></button>
                       <button class="row-action-icon alert-link" data-alert="${h.id}" aria-label="Set Price Alert" title="Set Price Alert"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></button>
                       <button class="row-action-icon sell-link" data-sell="${h.id}" aria-label="Record Sale" title="Record Sale"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg></button>
                       <button class="row-action-icon edit-link" data-edit="${h.id}" aria-label="Edit Holding" title="Edit Holding"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                       <button class="row-action-icon danger" data-del="${h.id}" aria-label="Delete Holding" title="Delete Holding"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg></button>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        `;

        if (footerBar) footerBar.innerHTML = `
      <span>Total Buy: <b>${fmtINR(totalBuy)}</b></span>
      <span>Total Current: <b>${fmtINR(totalCurrent)}</b></span>
      <span>Unrealised: <span class="gain-text ${totalGain >= 0 ? 'pos' : 'neg'}">${totalGain >= 0 ? '+' : '-'}${fmtINR(Math.abs(totalGain))} (${fmtPct(totalGainPct)})</span></span>
    `;
      }

      function renderAll() {
                try {
          renderStats();
        } catch (errStats) {
          console.error("[CRITICAL ERROR IN renderStats]:", errStats);
        }
        try {
          renderTable();
        } catch (errTable) {
          console.error("[CRITICAL ERROR IN renderTable]:", errTable);
        }
        if (state.currentTab === 'analytics') {
          try { renderCharts(); } catch(e) { console.error("renderCharts err:", e); }
        }
      }

      /* ---------------- refresh (attempt live prices, else re-guess with small simulated drift) ---------------- */
      async function refreshPrices() {
        const refreshBtn = document.getElementById('refreshBtn');
        const sortIcon = document.getElementById('sortDirIcon');
        const updateLabel = document.getElementById('updatedLabel');
        if (updateLabel) updateLabel.textContent = 'Updating...';

        // Animate refresh icon/dock
        document.querySelectorAll('[data-dock-action="refresh"] svg, #refreshBtn svg').forEach(svg => {
          svg.style.transition = 'transform 0.6s ease';
          svg.style.transform = 'rotate(360deg)';
          setTimeout(() => { svg.style.transform = 'rotate(0deg)'; }, 650);
        });

        // 1. Fetch live prices via fast backend
        try {
          await refreshLivePricesForHoldings();
        } catch (err) {
          console.warn("Fast refresh notice:", err);
        }

        // 2. Apply prices
        applyLivePricesToHoldings();
        computeDayOpen();
        state.lastUpdated = new Date();
        persist();
        renderAll();
        tickUpdatedLabel();
        toast('⚡ Live prices updated!');
      }

      /* ---------------- modal / CRUD ---------------- */
      const overlay = document.getElementById('modalOverlay');
      const modalForm = document.getElementById('modalForm');
      let modalMode = null, modalId = null;

      function updateYahooPlaceholder() {
        const symbol = (modalForm.symbol.value || 'SYMBOL').toUpperCase();
        const exchange = modalForm.exchange.value;
        document.getElementById('yahooOverrideInput').placeholder = 'Auto: ' + buildYahooSymbol(symbol, exchange);
        if (!modalForm.name.dataset.touched) {
          const known = findKnown(buildYahooSymbol(symbol, exchange));
          modalForm.name.value = known ? known.name : '';
        }
      }

      function openModal(mode, id) {
        modalMode = mode; modalId = id;
        modalForm.reset();

        const exchInput = document.getElementById('exchangeInput');
        const mcxPills = document.getElementById('mcxQuickPills');
        if (mode === 'add' && exchInput) {
          if (state.portfolioSection === 'mcx') {
            exchInput.value = 'MCX';
            if (mcxPills) mcxPills.style.display = 'block';
          } else if (state.portfolioSection === 'stocks') {
            exchInput.value = 'NSE';
            if (mcxPills) mcxPills.style.display = 'none';
          }
        }
        delete modalForm.name.dataset.touched;
        document.getElementById('modalTitle').textContent = mode === 'add' ? 'Add holding' : 'Edit holding';
        document.getElementById('modalSave').textContent = mode === 'add' ? 'Add holding' : 'Save changes';
        if (mode === 'edit') {
          const r = state.holdings.find(h => h.id === id);
          modalForm.symbol.value = r.symbol;
          modalForm.exchange.value = r.exchange;
          modalForm.name.value = r.name;
          modalForm.name.dataset.touched = '1';
          modalForm.buyPrice.value = r.buyPrice;
          modalForm.qty.value = r.qty;
          modalForm.yahooOverride.value = (r.yahooSymbol === buildYahooSymbol(r.symbol, r.exchange)) ? '' : r.yahooSymbol;
        }
        updateYahooPlaceholder();
        overlay.classList.add('open');
        setTimeout(() => document.getElementById('symbolInput').focus(), 50);
      }
      function closeModal() { overlay.classList.remove('open'); modalMode = null; modalId = null; }
      window.openModal = openModal;
      window.closeModal = closeModal;

      async function saveModal(e) {
        if (e) e.preventDefault();
        if (!modalForm.reportValidity()) return;
        const opts = {
          symbol: (modalForm.symbol.value || '').trim().toUpperCase(),
          exchange: modalForm.exchange.value,
          name: (modalForm.name.value || '').trim(),
          buyPrice: Number(modalForm.buyPrice.value),
          qty: Number(modalForm.qty.value),
          yahooOverride: (modalForm.yahooOverride.value || '').trim()
        };

        const targetSym = opts.yahooOverride || buildYahooSymbol(opts.symbol, opts.exchange);
        const baseSym = opts.symbol.replace(/\.(NS|BO|MCX)$/, '');

        // 1. Build holding
        let newHolding = buildHolding(opts, modalMode === 'edit' ? modalId : null);

        // 2. Fetch live price IMMEDIATELY for this specific stock (takes ~300ms)
        const saveBtn = document.getElementById('modalSave');
        const origBtnText = saveBtn.textContent;
        saveBtn.textContent = 'Fetching live CMP...';
        saveBtn.disabled = true;

        try {
          const res = await fetch('/api/live-prices?symbols=' + encodeURIComponent(targetSym));
          if (res.ok) {
            const json = await res.json();
            if (json.success && json.prices) {
              const item = json.prices[baseSym] || json.prices[targetSym] || Object.values(json.prices)[0];
              if (item && item.price) {
                const liveP = +Number(item.price).toFixed(2);
                livePriceCache[baseSym] = { price: liveP, prevClose: item.prevClose || liveP };
                livePriceCache[targetSym] = livePriceCache[baseSym];
                newHolding.price = liveP;
              }
            }
          }
        } catch (err) {
          console.warn('Instant price fetch notice:', err);
        } finally {
          saveBtn.textContent = origBtnText;
          saveBtn.disabled = false;
        }

        if (modalMode === 'add') {
          state.holdings.push(newHolding);
          toast(`Added ${newHolding.symbol} • CMP ₹${newHolding.price}`);
        } else {
          const idx = state.holdings.findIndex(h => h.id === modalId);
          state.holdings[idx] = newHolding;
          toast(`Updated ${newHolding.symbol} • CMP ₹${newHolding.price}`);
        }

        computeDayOpen();
        persist();
        closeModal();
        renderAll();

        // 3. Background refresh to ensure full consistency and alert watchdog check
        refreshLivePricesForHoldings().then(() => {
          applyLivePricesToHoldings();
          computeDayOpen();
          persist();
          renderAll();
        });
      }

      function deleteHolding(id) {
        const h = state.holdings.find(x => x.id === id);
        if (!confirm(`Remove ${h.symbol} from your portfolio?`)) return;
        state.holdings = state.holdings.filter(x => x.id !== id);
        persist(); toast('Holding removed'); renderAll();
      }

      function sellHolding(id) {
        const h = state.holdings.find(x => x.id === id);
        const input = prompt(`Sell how many units of ${h.symbol}? (You hold ${h.qty})`, h.qty);
        if (input === null) return;
        const qtyToSell = Number(input);
        if (isNaN(qtyToSell) || qtyToSell <= 0 || qtyToSell > h.qty) { toast('Enter a valid quantity to sell'); return; }
        if (qtyToSell === h.qty) {
          state.holdings = state.holdings.filter(x => x.id !== id);
          toast(`Sold all ${h.qty} units of ${h.symbol}`);
        } else {
          h.qty = +(h.qty - qtyToSell).toFixed(6);
          h.amount = h.buyPrice * h.qty;
          toast(`Sold ${qtyToSell} units of ${h.symbol}`);
        }
        computeDayOpen();
        persist(); renderAll();
      }

      function renderMarkdown(text) {
        if (!text) return "";
        let html = text;

        // Escape HTML entities to prevent XSS
        html = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

        // Headers: ### Head
        html = html.replace(/^### (.*?)$/gm, "<h3>$1</h3>");
        html = html.replace(/^#### (.*?)$/gm, "<h4>$1</h4>");

        // Bold: **text**
        html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");

        // Bullet lists: * item or - item
        let insideList = false;
        const lines = html.split('\n');
        for (let i = 0; i < lines.length; i++) {
          let line = lines[i].trim();
          if (line.startsWith('* ') || line.startsWith('- ')) {
            let itemContent = line.slice(2);
            if (!insideList) {
              lines[i] = '<ul><li>' + itemContent + '</li>';
              insideList = true;
            } else {
              lines[i] = '<li>' + itemContent + '</li>';
            }
          } else {
            if (insideList) {
              lines[i - 1] = lines[i - 1] + '</ul>';
              insideList = false;
            }
          }
        }
        if (insideList) {
          lines[lines.length - 1] = lines[lines.length - 1] + '</ul>';
        }
        html = lines.join('\n');

        // Paragraphs: split by double newlines and wrap in <p>, skipping headers and lists
        html = html.split(/\n\n+/).map(p => {
          p = p.trim();
          if (!p) return "";
          if (p.startsWith('<h') || p.startsWith('<ul') || p.startsWith('<li>')) return p;
          return '<p>' + p.replace(/\n/g, '<br>') + '</p>';
        }).join('');

        return html;
      }

      function renderCharts() {
        const list = allHoldings();
        if (!list || !list.length) {
          if (allocationChartInstance) { allocationChartInstance.destroy(); allocationChartInstance = null; }
          if (performanceChartInstance) { performanceChartInstance.destroy(); performanceChartInstance = null; }
          if (classSplitChartInstance) { classSplitChartInstance.destroy(); classSplitChartInstance = null; }
          return;
        }

        if (typeof Chart === 'undefined') {
          console.warn('Chart.js is not loaded. Bypassing chart rendering.');
          return;
        }

        const totalValue = list.reduce((a, b) => a + b.value, 0);

        // Compute Diversification Scores & Summary Info
        const counts = list.length;
        document.getElementById('analyticHoldingsCount').textContent = counts;

        // Find largest holding & max concentration
        let maxWeight = 0;
        let maxAssetSymbol = 'N/A';
        list.forEach(h => {
          const w = (h.value / totalValue) * 100;
          if (w > maxWeight) {
            maxWeight = w;
            maxAssetSymbol = h.symbol;
          }
        });
        document.getElementById('analyticMaxWeight').textContent = maxWeight.toFixed(2) + '%';
        document.getElementById('analyticMaxAsset').textContent = `In largest asset: ${maxAssetSymbol}`;

        // Calculate a score: base 100, subtract weight concentration, add points for counts
        let divScore = Math.max(10, Math.round(100 - (maxWeight * 1.2) + Math.min(20, counts * 3.5)));
        divScore = Math.min(100, divScore);

        const scoreEl = document.getElementById('analyticDivScore');
        const statusEl = document.getElementById('analyticDivStatus');
        if (scoreEl && statusEl) {
          scoreEl.textContent = `${divScore}/100`;
          if (divScore >= 75) {
            scoreEl.style.color = '#8B5CF6';
            statusEl.textContent = 'Optimal Diversification';
          } else if (divScore >= 50) {
            scoreEl.style.color = '#F59E0B';
            statusEl.textContent = 'Moderate Concentration';
          } else {
            scoreEl.style.color = '#EF4444';
            statusEl.textContent = 'High Concentration Risk';
          }
        }

        // Fill Portfolio Weightings List
        const listContainer = document.getElementById('weightingsListContainer');
        if (listContainer) {
          listContainer.innerHTML = '';
          const sortedByWeight = [...list].sort((a, b) => b.value - a.value);
          sortedByWeight.forEach(h => {
            const w = (h.value / totalValue) * 100;
            const item = document.createElement('div');
            item.className = 'weight-item';
            item.innerHTML = `
              <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px;">
                <span style="font-weight: 600; color: #FFFFFF;">${h.symbol} <span style="font-weight: normal; color: var(--text-dim); font-size: 12px;">(${h.assetClass})</span></span>
                <span style="color: var(--text-dim);">${w.toFixed(1)}% &middot; ₹${Math.round(h.value).toLocaleString('en-IN')}</span>
              </div>
              <div style="width: 100%; height: 6px; background: rgba(255,255,255,0.05); border-radius: 4px; overflow: hidden;">
                <div style="width: ${w}%; height: 100%; background: linear-gradient(90deg, #8B5CF6 0%, #2DD4BF 100%); border-radius: 4px;"></div>
              </div>
            `;
            listContainer.appendChild(item);
          });
        }

        const colors = [
          '#2DD4BF', '#3B82F6', '#8B5CF6', '#EC4899',
          '#F59E0B', '#8B5CF6', '#EF4444', '#6366F1'
        ];

        // 1. Asset Weights Chart (Doughnut)
        const allocCtx = document.getElementById('allocationChart');
        if (allocCtx) {
          if (allocationChartInstance) allocationChartInstance.destroy();
          const labels = list.map(h => h.symbol);
          const data = list.map(h => h.value);

          allocationChartInstance = new Chart(allocCtx, {
            type: 'doughnut',
            data: {
              labels: labels,
              datasets: [{
                data: data,
                backgroundColor: colors.slice(0, labels.length),
                borderColor: '#181C21',
                borderWidth: 2
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: {
                  position: 'bottom',
                  labels: { color: '#94A3B8', font: { family: 'Inter', size: 11 } }
                },
                tooltip: {
                  callbacks: {
                    label: function (context) {
                      const val = context.raw;
                      const total = context.dataset.data.reduce((a, b) => a + b, 0);
                      const pct = ((val / total) * 100).toFixed(1);
                      return ` ₹${val.toLocaleString('en-IN', { maximumFractionDigits: 0 })} (${pct}%)`;
                    }
                  }
                }
              }
            }
          });
        }

        // 2. Portfolio Risk Health Profile Check
        const healthContainer = document.getElementById('riskHealthCheckContainer');
        if (healthContainer) {
          healthContainer.innerHTML = '';
          const totalVal = list.reduce((sum, h) => sum + h.value, 0);

          if (totalVal === 0) {
            healthContainer.innerHTML = `<div class="empty-state">No holdings to analyze risk.</div>`;
          } else {
            // Find largest holding & max concentration
            let maxAsset = list[0];
            list.forEach(h => {
              if (h.value > maxAsset.value) maxAsset = h;
            });
            const maxWeightVal = (maxAsset.value / totalVal) * 100;

            // Risk & Diversification assessment (Equities vs MCX Commodities)
            const commodityVal = list.filter(h => h.assetClass === 'Commodity' || h.exchange === 'MCX').reduce((sum, h) => sum + h.value, 0);
            const commodityPct = (commodityVal / totalVal) * 100;

            let riskRating = 'Balanced (Equities & MCX Commodities)';
            let riskColor = '#10B981'; // Green
            if (commodityPct > 50) {
              riskRating = 'Commodity Heavy (High Gold/Metals Concentration)';
              riskColor = '#F59E0B'; // Amber
            } else {
              const equityVal = list.filter(h => h.assetClass === 'Equity').reduce((sum, h) => sum + h.value, 0);
              const equityPct = (equityVal / totalVal) * 100;
              if (equityPct > 80) {
                riskRating = 'High Growth (Equity Dominant)';
                riskColor = '#8B5CF6'; // Violet
              } else if (equityPct > 40) {
                riskRating = 'Optimal Multi-Asset Mix';
                riskColor = '#10B981'; // Green
              }
            }

            // Diversification Health level
            let divStatus = 'Optimal';
            let divBadgeBg = 'rgba(139, 92, 246, 0.1)';
            let divTextColor = '#8B5CF6';
            if (maxWeightVal > 30) {
              divStatus = 'High Concentration Risk';
              divBadgeBg = 'rgba(239, 68, 68, 0.1)';
              divTextColor = '#EF4444';
            } else if (maxWeightVal > 15) {
              divStatus = 'Slightly Concentrated';
              divBadgeBg = 'rgba(245, 158, 11, 0.1)';
              divTextColor = '#F59E0B';
            }

            healthContainer.innerHTML = `
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 8px;">
                <span style="font-size: 13px; color: var(--text-dim); font-weight: 500;">Risk Profile Rating</span>
                <span style="font-size: 13px; font-weight: 700; color: ${riskColor};">${riskRating}</span>
              </div>

              <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 8px;">
                <span style="font-size: 13px; color: var(--text-dim); font-weight: 500;">Diversification Status</span>
                <span class="badge" style="background: ${divBadgeBg}; color: ${divTextColor}; border-color: transparent; font-size: 12px; padding: 2px 8px; font-weight:700;">${divStatus}</span>
              </div>

              <div style="padding: 12px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 8px; display: flex; flex-direction: column; gap: 8px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="font-size: 13px; color: var(--text-dim); font-weight: 500;">Top Asset Exposure</span>
                  <span style="font-size: 13px; font-weight: 700; color: #FFFFFF;">${maxAsset.symbol} (${maxWeightVal.toFixed(1)}%)</span>
                </div>
                <div style="width: 100%; height: 6px; background: rgba(255,255,255,0.05); border-radius: 4px; overflow: hidden;">
                  <div style="width: ${maxWeightVal}%; height: 100%; background: ${riskColor}; border-radius: 4px;"></div>
                </div>
              </div>

              <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 8px;">
                <span style="font-size: 13px; color: var(--text-dim); font-weight: 500;">Total Assets Tracked</span>
                <span style="font-size: 13px; font-weight: 700; color: #FFFFFF;">${list.length} holdings</span>
              </div>
            `;
          }
        }

        // 3. Holding Performance Chart (Bar)
        const perfCtx = document.getElementById('performanceChart');
        if (perfCtx) {
          if (performanceChartInstance) performanceChartInstance.destroy();
          const labels = list.map(h => h.symbol);
          const costData = list.map(h => h.amount);
          const valueData = list.map(h => h.value);

          performanceChartInstance = new Chart(perfCtx, {
            type: 'bar',
            data: {
              labels: labels,
              datasets: [
                {
                  label: 'Purchase Cost',
                  data: costData,
                  backgroundColor: '#282D34',
                  borderColor: '#3E434F',
                  borderWidth: 1
                },
                {
                  label: 'Current Value',
                  data: valueData,
                  backgroundColor: '#2DD4BF',
                  borderColor: '#22B7A4',
                  borderWidth: 1
                }
              ]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              scales: {
                x: {
                  grid: { color: 'rgba(255, 255, 255, 0.05)' },
                  ticks: { color: '#94A3B8', font: { family: 'Inter', size: 10 } }
                },
                y: {
                  grid: { color: 'rgba(255, 255, 255, 0.05)' },
                  ticks: {
                    color: '#94A3B8',
                    font: { family: 'Inter', size: 10 },
                    callback: function (value) { return '₹' + value.toLocaleString('en-IN'); }
                  }
                }
              },
              plugins: {
                legend: {
                  position: 'top',
                  labels: { color: '#94A3B8', font: { family: 'Inter', size: 11 } }
                }
              }
            }
          });
        }
      }

      function switchTab(tabId) {
        if (window.innerWidth <= 900) {
          const sb = document.getElementById('sidebar');
          if (sb) sb.classList.remove('open');
          try {
            window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
          } catch(e) {
            window.scrollTo(0, 0);
          }
          document.body.scrollTop = 0;
          document.documentElement.scrollTop = 0;
        }
        state.currentTab = tabId;
        try { localStorage.setItem('portfolio_active_tab', tabId); } catch(e){}

        document.getElementById('tabBtnPortfolio').classList.toggle('active', tabId === 'portfolio');
        document.getElementById('tabBtnAnalytics').classList.toggle('active', tabId === 'analytics');
        document.getElementById('tabBtnAi').classList.toggle('active', tabId === 'ai');
        document.getElementById('tabBtnNews').classList.toggle('active', tabId === 'news');
        document.getElementById('tabBtnIpo').classList.toggle('active', tabId === 'ipo');

        document.getElementById('viewPortfolio').classList.toggle('active', tabId === 'portfolio');
        document.getElementById('viewAnalytics').classList.toggle('active', tabId === 'analytics');
        document.getElementById('viewAi').classList.toggle('active', tabId === 'ai');
        document.getElementById('viewNews').classList.toggle('active', tabId === 'news');
        document.getElementById('viewIpo').classList.toggle('active', tabId === 'ipo');

        const dock = document.getElementById('dockOuter');
        if (dock) {
          dock.style.display = (tabId === 'portfolio') ? 'flex' : 'none';
        }

        if (tabId === 'analytics') {
          setTimeout(renderCharts, 50);
        } else if (tabId === 'news') {
          fetchAndRenderNews();
        } else if (tabId === 'ipo') {
          if (typeof updatePanDisplay === 'function') updatePanDisplay();
          loadIpoData(false);
        }
      }

      let cachedNewsArticles = null;
      let lastNewsFetchTime = 0;
      let selectedNewsCategory = 'ALL';
      let selectedFilterSymbol = 'ALL';

      window.switchNewsCategory = function (cat) {
        selectedNewsCategory = cat;
        // Update active class on tab buttons
        const tabs = document.querySelectorAll('.mc-tab');
        tabs.forEach(tab => {
          const onclickAttr = tab.getAttribute('onclick');
          const isActive = onclickAttr && onclickAttr.includes(`'${cat}'`);
          tab.classList.toggle('active', !!isActive);
        });
        renderNewsDashboard();
      };

      window.filterNewsBySymbol = function (sym) {
        selectedFilterSymbol = sym;
        // Update active class on chips
        const chips = document.querySelectorAll('#newsFilterChips .filter-chip');
        chips.forEach(chip => {
          const onclickAttr = chip.getAttribute('onclick');
          const isActive = onclickAttr && onclickAttr.includes(`'${sym}'`);
          chip.classList.toggle('active', !!isActive);
        });
        renderNewsDashboard();
      };

      function formatTimeAgo(pubTimeSec) {
        const publishTime = pubTimeSec * 1000;
        const diffMs = Date.now() - publishTime;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHrs = Math.floor(diffMins / 60);
        if (diffMins < 60) return `${Math.max(1, diffMins)}m ago`;
        if (diffHrs < 24) return `${diffHrs}h ago`;
        return new Date(publishTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      }

      function getBadgeHtml(type) {
        type = type || 'YAHOO';
        if (type === 'BUZZING') return `<span class="news-badge badge-buzzing">🔥 Buzzing Stock</span>`;
        if (type === 'RECOS') return `<span class="news-badge badge-recos">📈 Brokerage Reco</span>`;
        if (type === 'OUTLOOK') return `<span class="news-badge badge-outlook">🔮 Market Outlook</span>`;
        if (type === 'LATEST') return `<span class="news-badge badge-latest">📰 Latest News</span>`;
        return `<span class="news-badge badge-yahoo">💼 Global News</span>`;
      }

      function getProxiedImgUrl(url) {
        if (!url) return '';
        if (url.startsWith('http')) {
          const baseProxy = window.location.protocol.startsWith('http') ? '' : 'http://127.0.0.1:8080';
          return `${baseProxy}/proxy/${url}`;
        }
        return url;
      }

      async function fetchAndRenderNews() {
        const feedContent = document.getElementById('newsFeedContent');
        const filterChips = document.getElementById('newsFilterChips');
        if (!feedContent || !filterChips) return;

        // Render filter chips from holdings
        const holdingsSymbols = Array.from(new Set(state.holdings.map(h => (h.yahooSymbol || h.symbol).toUpperCase()))).sort();

        // Render chips
        let chipsHtml = `<button class="filter-chip ${selectedFilterSymbol === 'ALL' ? 'active' : ''}" onclick="filterNewsBySymbol('ALL')">All Assets</button>`;
        holdingsSymbols.forEach(sym => {
          chipsHtml += `<button class="filter-chip ${selectedFilterSymbol === sym ? 'active' : ''}" onclick="filterNewsBySymbol('${sym}')">${sym}</button>`;
        });
        filterChips.innerHTML = chipsHtml;

        // Show skeleton loading if cache is empty or we force reload
        const now = Date.now();
        const needsFetch = !cachedNewsArticles || (now - lastNewsFetchTime > 300000); // 5 min client cache

        if (needsFetch) {
          feedContent.innerHTML = `
            <div class="mc-left-column">
              <div class="skeleton-card" style="height: 320px; margin-bottom: 24px;">
                <div class="skeleton-shimmer"></div>
              </div>
              <div class="mc-sub-grid">
                <div class="skeleton-card" style="height: 180px;"><div class="skeleton-shimmer"></div></div>
                <div class="skeleton-card" style="height: 180px;"><div class="skeleton-shimmer"></div></div>
                <div class="skeleton-card" style="height: 180px;"><div class="skeleton-shimmer"></div></div>
              </div>
            </div>
            <div class="mc-right-column">
              <div class="mc-sidebar-panel" style="min-height: 480px;">
                <div class="skeleton-text" style="width: 80%"></div>
                <div class="skeleton-text" style="width: 90%"></div>
                <div class="skeleton-text" style="width: 70%"></div>
                <div class="skeleton-text" style="width: 85%"></div>
                <div class="skeleton-text" style="width: 60%"></div>
                <div class="skeleton-shimmer"></div>
              </div>
            </div>
          `;

          try {
            const symbolsParam = holdingsSymbols.length ? `?symbols=${encodeURIComponent(holdingsSymbols.join(','))}` : '';
            const res = await fetch(`/api/news${symbolsParam}`);
            if (!res.ok) throw new Error('Failed to fetch news from server');
            cachedNewsArticles = await res.json();
            lastNewsFetchTime = Date.now();
          } catch (err) {
            console.error('Error fetching stock news:', err);
            feedContent.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;">⚠️ Failed to load news feed. Check connection or try again later.</div>`;
            return;
          }
        }

        renderNewsDashboard();
      }

      function renderNewsDashboard() {
        const feedContent = document.getElementById('newsFeedContent');
        if (!feedContent) return;

        let articles = cachedNewsArticles || [];

        // 1. Filter by category
        if (selectedNewsCategory !== 'ALL') {
          articles = articles.filter(art => art.type === selectedNewsCategory);
        }

        // 2. Filter by symbol with intelligent fallback
        let showFallbackBanner = false;
        if (selectedFilterSymbol !== 'ALL') {
          const symbolArticles = articles.filter(art => {
            const tickers = (art.relatedTickers || []).map(t => t.toUpperCase());
            return tickers.includes(selectedFilterSymbol) || (art.symbol && art.symbol.toUpperCase() === selectedFilterSymbol);
          });

          if (symbolArticles.length > 0) {
            articles = symbolArticles;
          } else {
            // Keep general articles and flag fallback notice
            showFallbackBanner = true;
          }
        }

        if (articles.length === 0) {
          feedContent.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 48px 24px;">
              <div style="font-size: 32px;">📰</div>
              <div style="font-size: 14px; font-weight: 600; color: #FFFFFF;">No news articles found matching your filters.</div>
              <div style="font-size: 13px; color: var(--text-dim);">Try switching category tabs or resetting the ticker filter.</div>
              <div style="display: flex; gap: 8px; margin-top: 8px;">
                <button onclick="switchNewsCategory('ALL');filterNewsBySymbol('ALL');" class="btn btn-sm btn-secondary" style="padding: 6px 14px; border-radius: 9999px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #FFFFFF; cursor: pointer;">Reset Filters</button>
                <button onclick="lastNewsFetchTime=0;fetchAndRenderNews();" class="btn btn-sm btn-primary" style="padding: 6px 14px; border-radius: 9999px; background: var(--accent, #6366f1); border: none; color: #FFFFFF; cursor: pointer;">Refresh News</button>
              </div>
            </div>
          `;
          return;
        }

        let bannerHtml = '';
        if (showFallbackBanner) {
          const categoryName = selectedNewsCategory === 'ALL' ? 'General' :
            selectedNewsCategory === 'BUZZING' ? 'Buzzing Stocks' :
              selectedNewsCategory === 'RECOS' ? 'Brokerage Recos' :
                selectedNewsCategory === 'LATEST' ? 'Latest News' : 'Market Outlook';

          bannerHtml = `
            <div class="empty-state" style="grid-column: 1 / -1; padding: 18px; background: rgba(167, 139, 250, 0.03); border: 1px dashed rgba(167, 139, 250, 0.15); border-radius: 8px; margin-bottom: 24px; text-align: left; width: 100%; display: flex; flex-direction: column; gap: 4px;">
              <div style="font-size: 13px; font-weight: 700; color: #FFFFFF; display: flex; align-items: center; gap: 8px;">
                💡 No articles specifically mentioning <span style="color: var(--accent); font-weight: 800;">${selectedFilterSymbol}</span> in ${categoryName} feed right now.
              </div>
              <div style="font-size: 12px; color: var(--text-dim);">Showing general updates for the <strong>${categoryName}</strong> feed instead:</div>
            </div>
          `;
        }

        // Split articles
        const heroArt = articles[0];
        const subGridArts = articles.slice(1, 4);
        const sidebarArts = articles.slice(4);

        // Render Hero Card
        let heroHtml = '';
        if (heroArt) {
          const timeAgo = formatTimeAgo(heroArt.providerPublishTime);
          const resolutions = heroArt.thumbnail && heroArt.thumbnail.resolutions;
          const imgUrl = (resolutions && resolutions.length > 0 && resolutions[0].url) ? resolutions[0].url : '';

          let imgHtml = '';
          if (imgUrl) {
            const proxiedUrl = getProxiedImgUrl(imgUrl);
            imgHtml = `<img class="mc-hero-img" src="${proxiedUrl}" alt="Hero Image" onerror="this.parentNode.innerHTML=\'<div class=\\\'news-card-placeholder\\\'>📰</div>\'">`;
          } else {
            imgHtml = `
              <div class="news-card-placeholder">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                  <path d="M16 8v8M8 12h8"/>
                </svg>
                <span style="font-size: 12px; font-weight: 500; margin-top: 4px;">No Preview Image</span>
              </div>
            `;
          }

          let badgeHtml = getBadgeHtml(heroArt.type);
          let targetHtml = heroArt.targetPrice ? `<div class="news-card-target-overlay">🎯 Target ${heroArt.targetPrice}</div>` : '';
          const relatedStr = (heroArt.relatedTickers && heroArt.relatedTickers.length > 0)
            ? heroArt.relatedTickers.join(', ')
            : (heroArt.symbol ? heroArt.symbol : 'GENERAL');

          heroHtml = `
            <a class="mc-hero-card" href="${heroArt.link}" target="_blank" rel="noopener noreferrer">
              <div class="mc-hero-img-wrapper">
                <div class="news-card-badge-overlay">${badgeHtml}</div>
                ${targetHtml}
                ${imgHtml}
              </div>
              <div class="mc-hero-content">
                <div style="font-weight: 700; color: var(--accent); font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em;">Holding: ${relatedStr}</div>
                <h3 class="mc-hero-title">${heroArt.title}</h3>
                <p class="mc-hero-summary">${heroArt.summary || ''}</p>
                <div class="mc-hero-footer">
                  <span>Publisher: <b>${heroArt.publisher}</b></span>
                  <span>${timeAgo}</span>
                </div>
              </div>
            </a>
          `;
        }

        // Render Sub Grid
        let subGridHtml = '';
        subGridArts.forEach(art => {
          const timeAgo = formatTimeAgo(art.providerPublishTime);
          const resolutions = art.thumbnail && art.thumbnail.resolutions;
          const imgUrl = (resolutions && resolutions.length > 0 && resolutions[0].url) ? resolutions[0].url : '';

          let imgHtml = '';
          if (imgUrl) {
            const proxiedUrl = getProxiedImgUrl(imgUrl);
            imgHtml = `<img class="mc-sub-img" src="${proxiedUrl}" alt="Sub Grid Image" onerror="this.parentNode.innerHTML=\'<div class=\\\'news-card-placeholder\\\'>📰</div>\'">`;
          } else {
            imgHtml = `
              <div class="news-card-placeholder" style="height: 120px;">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                </svg>
              </div>
            `;
          }

          let badgeHtml = getBadgeHtml(art.type);
          let targetHtml = art.targetPrice ? `<div class="news-card-target-overlay" style="font-size: 12px; padding: 2px 7px;">🎯 Target ${art.targetPrice}</div>` : '';
          const relatedStr = (art.relatedTickers && art.relatedTickers.length > 0)
            ? art.relatedTickers.join(', ')
            : (art.symbol ? art.symbol : 'GENERAL');

          subGridHtml += `
            <a class="mc-sub-card" href="${art.link}" target="_blank" rel="noopener noreferrer">
              <div class="mc-sub-img-wrapper">
                <div class="news-card-badge-overlay">${badgeHtml}</div>
                ${targetHtml}
                ${imgHtml}
              </div>
              <div class="mc-sub-body">
                <div style="font-weight: 700; color: var(--accent); font-size: 12px; text-transform: uppercase;">${relatedStr}</div>
                <h4 class="mc-sub-title">${art.title}</h4>
                <p class="mc-sub-summary">${art.summary || ''}</p>
                <div class="mc-sub-footer">
                  <span>${art.publisher}</span>
                  <span>${timeAgo}</span>
                </div>
              </div>
            </a>
          `;
        });

        // Render Sidebar List
        let sidebarHtml = '';
        if (sidebarArts.length === 0) {
          sidebarHtml = `<div class="empty-state">No further circular headlines.</div>`;
        } else {
          sidebarArts.slice(0, 7).forEach(art => {
            const timeAgo = formatTimeAgo(art.providerPublishTime);
            const relatedStr = (art.relatedTickers && art.relatedTickers.length > 0)
              ? art.relatedTickers.join(', ')
              : (art.symbol ? art.symbol : 'GENERAL');

            sidebarHtml += `
              <a class="mc-list-item" href="${art.link}" target="_blank" rel="noopener noreferrer">
                <span class="mc-list-title">${art.title}</span>
                <div class="mc-list-meta">
                  <span style="color: var(--accent); font-weight: 700;">${relatedStr}</span>
                  <span>${art.publisher} &middot; ${timeAgo}</span>
                </div>
              </a>
            `;
          });
        }

        // Assemble the full Moneycontrol layout grid dynamically!
        feedContent.innerHTML = bannerHtml + `
          <div class="mc-left-column">
            ${heroHtml}
            <div class="mc-sub-grid">
              ${subGridHtml}
            </div>
          </div>
          <div class="mc-right-column">
            <div class="mc-sidebar-panel">
              <div class="mc-sidebar-header">
                <span>⚡ Market Buzz Circulars</span>
              </div>
              <div class="mc-sidebar-list">
                ${sidebarHtml}
              </div>
            </div>
          </div>
        `;
      }

      window.fetchAndRenderNews = fetchAndRenderNews;

      window.sendAiSuggestion = function (text) {
        const input = document.getElementById('aiInput');
        if (input) {
          input.value = text;
          sendAiMessage();
        }
      };

      window.sendAiMessage = async function () {
        const input = document.getElementById('aiInput');
        if (!input) return;
        const msg = input.value.trim();
        if (!msg) return;

        input.value = '';

        const chatBox = document.getElementById('aiMessages');
        const userMsg = document.createElement('div');
        userMsg.className = 'ai-message user';
        userMsg.textContent = msg;
        chatBox.appendChild(userMsg);
        chatBox.scrollTop = chatBox.scrollHeight;

        const loadingMsg = document.createElement('div');
        loadingMsg.className = 'ai-message assistant loading';
        loadingMsg.innerHTML = '<span style="opacity: 0.6;">Analyzing portfolio data...</span>';
        chatBox.appendChild(loadingMsg);
        chatBox.scrollTop = chatBox.scrollHeight;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        try {
          const res = await fetch('/api/ask-ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: msg, holdings: state.holdings }),
            signal: controller.signal
          });
          clearTimeout(timeoutId);

          let data;
          const contentType = res.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            data = await res.json();
          } else {
            const errText = await res.text();
            throw new Error(errText.substring(0, 150) || 'Invalid server response.');
          }

          loadingMsg.remove();

          if (!res.ok) {
            const errMsg = document.createElement('div');
            errMsg.className = 'ai-message system';
            errMsg.textContent = data.error || 'Server returned an error.';
            chatBox.appendChild(errMsg);
            chatBox.scrollTop = chatBox.scrollHeight;
            return;
          }

          const statusBadge = document.getElementById('aiStatusBadge');
          if (statusBadge) {
            const prov = (data.provider || '').toLowerCase();
            if (data.mode === 'ai' || prov.includes('groq') || prov.includes('gemini') || prov.includes('openrouter')) {
              statusBadge.textContent = prov.includes('groq') ? '⚡ Live Groq AI' : 'Live AI Engine';
              statusBadge.title = `Powered by ${data.provider || 'AI Engine'}`;
              statusBadge.className = 'ai-badge-status live';
            } else {
              statusBadge.textContent = 'Local Analysis Mode';
              statusBadge.className = 'ai-badge-status local';
              statusBadge.title = 'Running rules-based analyzer. Configure GROQ_API_KEY in env for free live AI.';
            }
          }

          const replyContent = data.response || data.reply || data.message || '';
          const botMsg = document.createElement('div');
          botMsg.className = 'ai-message assistant';
          botMsg.innerHTML = renderMarkdown(replyContent);
          chatBox.appendChild(botMsg);

          if (data.warning) {
            const systemNote = document.createElement('div');
            systemNote.className = 'ai-message system';
            let errMsg = '💡 <strong>Server Info:</strong> Running in Local Mode. To unlock full AI investment intelligence, configure a free GEMINI_API_KEY in your server\'s env file.';
            if (data.api_error) {
              errMsg = `⚠️ <strong>AI Connection Note:</strong> ${data.api_error}.<br><br>Local mode active as fallback. Ensure your API key is correct and not restricted.`;
            }
            const existingNote = chatBox.querySelector('.ai-message.system');
            if (existingNote) existingNote.remove();

            systemNote.innerHTML = errMsg;
            chatBox.appendChild(systemNote);
          }

          chatBox.scrollTop = chatBox.scrollHeight;
        } catch (e) {
          clearTimeout(timeoutId);
          loadingMsg.remove();
          const errMsg = document.createElement('div');
          errMsg.className = 'ai-message system';
          errMsg.textContent = e.name === 'AbortError' ? 'AI request timed out. Please try again.' : `Failed to connect: ${e.message}`;
          chatBox.appendChild(errMsg);
          chatBox.scrollTop = chatBox.scrollHeight;
        }
      };

      
      /* -------------------------------------------------------------
         REPORTS & ACCOUNT MODAL CONTROLLERS
         ------------------------------------------------------------- */
      function openReportsModal() {
        const dd = document.getElementById('profileDropdownWrapper');
        if (dd) dd.classList.remove('active');

        const email = (currentUser && currentUser.email) || localStorage.getItem('portfolio_user_email') || 'Investor';
        const now = new Date();
        const dateStr = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' + now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

        const emailEl = document.getElementById('reportUserEmail');
        if (emailEl) emailEl.textContent = email;
        const dateEl = document.getElementById('reportDateStamp');
        if (dateEl) dateEl.textContent = dateStr;

        const list = (typeof allHoldings === 'function') ? allHoldings() : (state.holdings || []);
        let totalInvested = 0;
        let totalValue = 0;

        const rowsHtml = list.map(h => {
          const qty = Number(h.qty || h.shares) || 0;
          const buy = Number(h.buyPrice) || 0;
          const cmp = Number(h.price) || buy;
          const inv = qty * buy;
          const val = qty * cmp;
          const gain = val - inv;
          const gainPct = inv > 0 ? (gain / inv) * 100 : 0;

          totalInvested += inv;
          totalValue += val;

          return `
            <tr>
              <td><b>${h.symbol}</b> <div style="font-size: 12px;color:var(--text-dim);">${h.name || h.yahooSymbol || ''}</div></td>
              <td><span style="font-size: 12px;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,0.06);">${h.exchange || 'NSE'}</span></td>
              <td>${qty}</td>
              <td>₹${buy.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              <td>₹${cmp.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              <td>₹${inv.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              <td>₹${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              <td style="color:${gain >= 0 ? '#10B981' : '#EF4444'};font-weight:700;">${gain >= 0 ? '+' : ''}₹${gain.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              <td style="color:${gain >= 0 ? '#10B981' : '#EF4444'};font-weight:700;">${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(2)}%</td>
            </tr>`;
        }).join('');

        const totalGain = totalValue - totalInvested;
        const totalGainPct = totalInvested > 0 ? (totalGain / totalInvested) * 100 : 0;

        const nwEl = document.getElementById('repNetWorth');
        if (nwEl) nwEl.textContent = '₹' + totalValue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const invEl = document.getElementById('repInvested');
        if (invEl) invEl.textContent = '₹' + totalInvested.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        
        const gainEl = document.getElementById('repGain');
        if (gainEl) {
          gainEl.textContent = (totalGain >= 0 ? '+' : '') + '₹' + totalGain.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          gainEl.style.color = totalGain >= 0 ? '#10B981' : '#EF4444';
        }

        const gainPctEl = document.getElementById('repGainPct');
        if (gainPctEl) {
          gainPctEl.textContent = (totalGainPct >= 0 ? '+' : '') + totalGainPct.toFixed(2) + '%';
          gainPctEl.className = 'kpi-sub ' + (totalGain >= 0 ? 'pos' : 'neg');
        }

        const cntEl = document.getElementById('repHoldingsCount');
        if (cntEl) cntEl.textContent = list.length + ' Asset' + (list.length === 1 ? '' : 's');
        
        let divRating = "Empty Portfolio";
        if (list.length >= 5) divRating = "Well Diversified (High)";
        else if (list.length >= 2) divRating = "Moderate Balance";
        else if (list.length === 1) divRating = "Single Stock Risk";
        const divEl = document.getElementById('repDiversification');
        if (divEl) divEl.textContent = divRating;

        const sumEl = document.getElementById('repTableSummary');
        if (sumEl) sumEl.textContent = `${list.length} positions tracked`;
        const bodyEl = document.getElementById('reportTableBody');
        if (bodyEl) bodyEl.innerHTML = rowsHtml || '<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--text-dim);">No holdings added yet.</td></tr>';

        const modal = document.getElementById('reportsModalOverlay');
        if (modal) modal.classList.add('open');
      }

      function closeReportsModal() {
        const modal = document.getElementById('reportsModalOverlay');
        if (modal) modal.classList.remove('open');
      }

      function exportReportCSV() {
        const list = (typeof allHoldings === 'function') ? allHoldings() : (state.holdings || []);
        if (!list.length) {
          toast('No holdings to export!');
          return;
        }

        const email = (currentUser && currentUser.email) || 'investor';
        let csv = 'Symbol,Name,Exchange,YahooSymbol,AssetClass,Quantity,BuyPrice,CMP,Invested,CurrentValue,GainLoss,ReturnPct\n';
        
        list.forEach(h => {
          const qty = Number(h.qty || h.shares) || 0;
          const buy = Number(h.buyPrice) || 0;
          const cmp = Number(h.price) || buy;
          const inv = qty * buy;
          const val = qty * cmp;
          const gain = val - inv;
          const gainPct = inv > 0 ? (gain / inv) * 100 : 0;

          const row = [
            `"${h.symbol || ''}"`,
            `"${(h.name || '').replace(/"/g, '""')}"`,
            `"${h.exchange || 'NSE'}"`,
            `"${h.yahooSymbol || ''}"`,
            `"${h.assetClass || 'Equity'}"`,
            qty,
            buy.toFixed(2),
            cmp.toFixed(2),
            inv.toFixed(2),
            val.toFixed(2),
            gain.toFixed(2),
            gainPct.toFixed(2) + '%'
          ];
          csv += row.join(',') + '\n';
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `portfolio_statement_${email.split('@')[0]}_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        toast('📥 Statement downloaded as CSV!');
      }

      function copyReportSummary() {
        const list = (typeof allHoldings === 'function') ? allHoldings() : (state.holdings || []);
        const totalInvested = list.reduce((s, h) => s + (Number(h.qty || h.shares) || 0) * (Number(h.buyPrice) || 0), 0);
        const totalValue = list.reduce((s, h) => s + (Number(h.qty || h.shares) || 0) * (Number(h.price) || Number(h.buyPrice) || 0), 0);
        const gain = totalValue - totalInvested;
        const gainPct = totalInvested > 0 ? (gain / totalInvested) * 100 : 0;

        const summary = `📊 *Portfolio Summary Report*\n` +
          `• Total Value: ₹${totalValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}\n` +
          `• Total Invested: ₹${totalInvested.toLocaleString('en-IN', { minimumFractionDigits: 2 })}\n` +
          `• Total P&L: ${gain >= 0 ? '+' : ''}₹${gain.toLocaleString('en-IN', { minimumFractionDigits: 2 })} (${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(2)}%)\n` +
          `• Total Holdings: ${list.length} assets\n` +
          `• Generated: ${new Date().toLocaleString('en-IN')}`;

        navigator.clipboard.writeText(summary).then(() => {
          toast('📋 Portfolio summary copied to clipboard!');
        }).catch(() => {
          toast('Summary ready (clipboard permission denied)');
        });
      }

      function openAccountModal() {
        const dd = document.getElementById('profileDropdownWrapper');
        if (dd) dd.classList.remove('active');

        const email = (currentUser && currentUser.email) || localStorage.getItem('portfolio_user_email') || 'Investor';
        const list = (typeof allHoldings === 'function') ? allHoldings() : (state.holdings || []);
        const totalValue = list.reduce((s, h) => s + (Number(h.qty || h.shares) || 0) * (Number(h.price) || Number(h.buyPrice) || 0), 0);

        const avEl = document.getElementById('accAvatarLarge');
        if (avEl) avEl.textContent = email.charAt(0).toUpperCase();
        const emEl = document.getElementById('accEmailDisplay');
        if (emEl) emEl.textContent = email;
        const cntEl = document.getElementById('accHoldingsCount');
        if (cntEl) cntEl.textContent = list.length + ' Asset' + (list.length === 1 ? '' : 's');
        const valEl = document.getElementById('accPortfolioValue');
        if (valEl) valEl.textContent = '₹' + totalValue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        const modal = document.getElementById('accountModalOverlay');
        if (modal) modal.classList.add('open');
      }

      function closeAccountModal() {
        const modal = document.getElementById('accountModalOverlay');
        if (modal) modal.classList.remove('open');
      }

      function exportDataJson() {
        const list = state.holdings || [];
        const email = (currentUser && currentUser.email) || 'investor';
        const data = {
          user: email,
          exportedAt: new Date().toISOString(),
          version: '2.0-supabase',
          holdings: list
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `portfolio_backup_${email.split('@')[0]}_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        toast('📥 Backup exported as JSON!');
      }

      /* ---------------- wiring ---------------- */
      function wire() {
        document.getElementById('tabBtnPortfolio').addEventListener('click', () => switchTab('portfolio'));
        document.getElementById('tabBtnAnalytics').addEventListener('click', () => switchTab('analytics'));
        document.getElementById('tabBtnAi').addEventListener('click', () => switchTab('ai'));
        document.getElementById('tabBtnNews').addEventListener('click', () => switchTab('news'));
        document.getElementById('tabBtnIpo').addEventListener('click', () => switchTab('ipo'));

        // Mobile & Desktop Sidebar toggler
        const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const desktopBrand = document.getElementById('desktopBrandTrigger');
        const sidebar = document.getElementById('sidebar');
        if (sidebar) {
          const toggleSidebar = (e) => {
            e.stopPropagation();
            sidebar.classList.toggle('open');
          };

          if (mobileMenuBtn) mobileMenuBtn.addEventListener('click', toggleSidebar);
          if (desktopBrand) desktopBrand.addEventListener('click', toggleSidebar);

          document.addEventListener('click', (e) => {
            const isClickInsideMenuBtn = mobileMenuBtn && mobileMenuBtn.contains(e.target);
            const isClickInsideDesktopBrand = desktopBrand && desktopBrand.contains(e.target);
            if (sidebar.classList.contains('open') &&
              !sidebar.contains(e.target) &&
                            !isClickInsideMenuBtn &&
              !isClickInsideDesktopBrand) {
              sidebar.classList.remove('open');
            }
          });
        }

        // Auto-close sidebar on mobile tab clicks
        document.querySelectorAll('.sidebar .nav-item').forEach(item => {
          item.addEventListener('click', () => {
            if (sidebar) sidebar.classList.remove('open');
          });
        });

        const addHoldingBtn = document.getElementById('addHoldingBtn');
        if (addHoldingBtn) addHoldingBtn.addEventListener('click', () => openModal('add'));

        document.getElementById('modalCancel').addEventListener('click', closeModal);
        modalForm.addEventListener('submit', saveModal);

        // Live CMP auto-fetch while typing in Add Holding modal
        let symbolSearchTimer = null;
        const symInput = document.getElementById('symbolInput');
        const cmpIndicator = document.getElementById('symbolCmpIndicator');
        const cmpText = document.getElementById('symbolCmpText');
        const useCmpBtn = document.getElementById('useCmpAsBuyPriceBtn');
        let lastLiveCmpVal = null;

        if (symInput && cmpIndicator) {
          symInput.addEventListener('input', () => {
            const val = symInput.value.trim().toUpperCase();
            if (symbolSearchTimer) clearTimeout(symbolSearchTimer);
            if (!val || val.length < 2) {
              cmpIndicator.style.display = 'none';
              return;
            }

            symbolSearchTimer = setTimeout(async () => {
              try {
                const exch = (document.getElementById('exchangeInput') || {}).value || 'NSE';
                const target = buildYahooSymbol(val, exch);
                const res = await fetch('/api/live-prices?symbols=' + encodeURIComponent(target));
                if (res.ok) {
                  const json = await res.json();
                  if (json.success && json.prices) {
                    const base = val.replace(/\.(NS|BO|MCX)$/, '');
                    const item = json.prices[base] || json.prices[target] || Object.values(json.prices)[0];
                    if (item && item.price) {
                      lastLiveCmpVal = +Number(item.price).toFixed(2);
                      cmpText.textContent = `Live CMP: ₹${lastLiveCmpVal.toLocaleString('en-IN')}`;
                      cmpIndicator.style.display = 'flex';
                      return;
                    }
                  }
                }
              } catch (e) {}
              cmpIndicator.style.display = 'none';
            }, 350);
          });

          if (useCmpBtn) {
            useCmpBtn.addEventListener('click', () => {
              if (lastLiveCmpVal && modalForm.buyPrice) {
                modalForm.buyPrice.value = lastLiveCmpVal;
                toast(`Buy price set to Live CMP ₹${lastLiveCmpVal}`);
              }
            });
          }
        }

        overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
        document.addEventListener('keydown', e => {
          if (e.key === 'Escape') {
            if (overlay && overlay.classList.contains('open')) closeModal();
            closeReportsModal();
            closeAccountModal();
            if (typeof closeChartModal === 'function') closeChartModal();
          }
        });

        document.getElementById('symbolInput').addEventListener('input', (e) => {
          const val = e.target.value;
          const warning = document.getElementById('symbolWarning');
          if (warning) {
            warning.style.display = val.includes(' ') ? 'block' : 'none';
          }
          updateYahooPlaceholder();
        });
        document.getElementById('exchangeInput').addEventListener('change', updateYahooPlaceholder);
        document.getElementById('nameInput').addEventListener('input', () => { modalForm.name.dataset.touched = '1'; });

        document.getElementById('assetFilters').addEventListener('click', e => {
          const btn = e.target.closest('.filter-pill'); if (!btn) return;
          document.querySelectorAll('#assetFilters .filter-pill').forEach(b => b.classList.remove('active'));
          btn.classList.add('active'); state.filter = btn.dataset.class; renderTable();
        });
        document.getElementById('searchInput').addEventListener('input', e => {
          state.search = e.target.value.trim().toLowerCase(); renderTable();
        });
        document.getElementById('sortSelect').addEventListener('change', e => {
          const val = e.target.value;
          if (val === 'default') {
            state.sort = 'default'; state.sortDir = 'desc';
          } else {
            const lastUnderscore = val.lastIndexOf('_');
            state.sort = val.substring(0, lastUnderscore);
            state.sortDir = val.substring(lastUnderscore + 1);
          }
          renderTable();
        });

        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) refreshBtn.addEventListener('click', refreshPrices);

        document.getElementById('tableWrap').addEventListener('click', e => {
          const chartBtn = e.target.closest('[data-chart]');
          if (chartBtn) { openChartModal(chartBtn.dataset.chart); return; }
          const alertBtn = e.target.closest('[data-alert]');
          if (alertBtn) { openAlertModal(alertBtn.dataset.alert); return; }
          const editBtn = e.target.closest('[data-edit]');
          if (editBtn) { openModal('edit', editBtn.dataset.edit); return; }
          const delBtn = e.target.closest('[data-del]');
          if (delBtn) { deleteHolding(delBtn.dataset.del); return; }
          const sellBtn = e.target.closest('[data-sell]');
          if (sellBtn) { sellHolding(sellBtn.dataset.sell); return; }
        });

        document.getElementById('reportsLink').addEventListener('click', openReportsModal);
        document.getElementById('accountLink').addEventListener('click', openAccountModal);

        // Reports modal controls
        const closeRepBtn = document.getElementById('closeReportsModalBtn');
        if (closeRepBtn) closeRepBtn.addEventListener('click', closeReportsModal);
        const printRepBtn = document.getElementById('reportPrintBtn');
        if (printRepBtn) printRepBtn.addEventListener('click', () => { closeReportsModal(); window.exportPortfolioPDF(); });
        const csvRepBtn = document.getElementById('reportCsvBtn');
        if (csvRepBtn) csvRepBtn.addEventListener('click', exportReportCSV);
        const copyRepBtn = document.getElementById('reportCopyBtn');
        if (copyRepBtn) copyRepBtn.addEventListener('click', copyReportSummary);

        // Account modal controls
        const closeAccBtn = document.getElementById('closeAccountModalBtn');
        if (closeAccBtn) closeAccBtn.addEventListener('click', closeAccountModal);
        const exportJsonBtn = document.getElementById('accExportJsonBtn');
        if (exportJsonBtn) exportJsonBtn.addEventListener('click', exportDataJson);
        const accSignOutBtn = document.getElementById('accSignOutBtn');
        if (accSignOutBtn) accSignOutBtn.addEventListener('click', () => { closeAccountModal(); signOut(); });

        // Close on backdrop click
        const repModalOverlay = document.getElementById('reportsModalOverlay');
        if (repModalOverlay) {
          repModalOverlay.addEventListener('click', (e) => {
            if (e.target === repModalOverlay) closeReportsModal();
          });
        }
        const accModalOverlay = document.getElementById('accountModalOverlay');
        if (accModalOverlay) {
          accModalOverlay.addEventListener('click', (e) => {
            if (e.target === accModalOverlay) closeAccountModal();
          });
        }
      }

      /* ---------------- auth ---------------- */
      function simpleHash(str) {
        let h = 0;
        for (let i = 0; i < str.length; i++) { h = (Math.imul(31, h) + str.charCodeAt(i)) | 0; }
        return 'h' + Math.abs(h).toString(36);
      }
      async function getUsers() { return (await storageGet(USERS_KEY)) || []; }
      async function saveUsers(list) { await storageSet(USERS_KEY, list); }

      let authMode = 'login';
      function setAuthMode(mode) {
        authMode = mode;
        document.getElementById('tabLogin').classList.toggle('active', mode === 'login');
        document.getElementById('tabSignup').classList.toggle('active', mode === 'signup');
        document.getElementById('confirmField').style.display = mode === 'signup' ? 'flex' : 'none';
        document.getElementById('authSubmit').textContent = mode === 'signup' ? 'Create account' : 'Log in';
        const heading = document.getElementById('authHeading');
        const subheading = document.getElementById('authSubheading');
        if (heading) heading.textContent = mode === 'signup' ? 'Create Free Account' : 'Welcome Back';
        if (subheading) subheading.textContent = mode === 'signup' ? 'Start tracking your investments in 30 seconds' : 'Access your real-time portfolio dashboard';
        document.getElementById('authSwitch').innerHTML = mode === 'signup'
          ? `Already have an account? <button type="button" id="switchToLogin">Log in</button>`
          : `Don't have an account? <button type="button" id="switchToSignup">Sign up</button>`;
        document.getElementById('authError').classList.remove('show');
        wireAuthSwitch();
      }
      function wireAuthSwitch() {
        const s = document.getElementById('switchToSignup');
        const l = document.getElementById('switchToLogin');
        if (s) s.addEventListener('click', () => setAuthMode('signup'));
        if (l) l.addEventListener('click', () => setAuthMode('login'));
      }
      function showAuthError(msg) {
        const el = document.getElementById('authError');
        el.textContent = msg; el.classList.add('show');
      }

      function createSplitText(containerElement, options = {}) {
        const text = options.text || containerElement.textContent;
        const className = options.className || '';
        const delay = options.delay !== undefined ? options.delay : 50;
        const duration = options.duration !== undefined ? options.duration : 1.25;
        const ease = options.ease || 'power3.out';
        const splitType = options.splitType || 'chars';
        const from = options.from !== undefined ? options.from : { opacity: 0, y: 40 };
        const to = options.to !== undefined ? options.to : { opacity: 1, y: 0 };
        const textAlign = options.textAlign || 'center';
        const tag = options.tag || 'p';
        const onLetterAnimationComplete = options.onLetterAnimationComplete;

        const wrapper = document.createElement(tag);
        wrapper.className = `split-parent ${className}`;
        wrapper.style.textAlign = textAlign;
        wrapper.style.overflow = 'hidden';
        wrapper.style.display = 'inline-block';
        wrapper.style.whiteSpace = 'normal';
        wrapper.style.wordWrap = 'break-word';
        wrapper.style.willChange = 'transform, opacity';

        containerElement.innerHTML = '';
        containerElement.appendChild(wrapper);

        let targets = [];
        if (splitType === 'chars' || splitType === 'words, chars') {
          const words = text.split(/\s+/);
          words.forEach((word, wordIdx) => {
            const wordSpan = document.createElement('span');
            wordSpan.className = 'split-word';
            wordSpan.style.display = 'inline-block';
            wordSpan.style.whiteSpace = 'nowrap';

            const chars = word.split('');
            chars.forEach(char => {
              const charSpan = document.createElement('span');
              charSpan.className = 'split-char';
              charSpan.style.display = 'inline-block';
              charSpan.style.willChange = 'transform, opacity';
              charSpan.textContent = char;
              wordSpan.appendChild(charSpan);
              targets.push(charSpan);
            });

            wrapper.appendChild(wordSpan);

            if (wordIdx < words.length - 1) {
              const spaceSpan = document.createElement('span');
              spaceSpan.className = 'split-space';
              spaceSpan.style.display = 'inline-block';
              spaceSpan.innerHTML = '&nbsp;';
              wrapper.appendChild(spaceSpan);
            }
          });
        } else if (splitType === 'words') {
          const words = text.split(/\s+/);
          words.forEach((word, wordIdx) => {
            const wordSpan = document.createElement('span');
            wordSpan.className = 'split-word';
            wordSpan.style.display = 'inline-block';
            wordSpan.style.willChange = 'transform, opacity';
            wordSpan.textContent = word;
            wrapper.appendChild(wordSpan);
            targets.push(wordSpan);

            if (wordIdx < words.length - 1) {
              const spaceSpan = document.createElement('span');
              spaceSpan.className = 'split-space';
              spaceSpan.style.display = 'inline-block';
              spaceSpan.innerHTML = '&nbsp;';
              wrapper.appendChild(spaceSpan);
            }
          });
        } else {
          const lineSpan = document.createElement('span');
          lineSpan.className = 'split-line';
          lineSpan.style.display = 'inline-block';
          lineSpan.style.willChange = 'transform, opacity';
          lineSpan.textContent = text;
          wrapper.appendChild(lineSpan);
          targets.push(lineSpan);
        }

        if (typeof gsap === 'undefined') {
          console.warn('GSAP is not defined. Bypassing animation.');
          targets.forEach(t => {
            t.style.opacity = '1';
            t.style.transform = 'none';
          });
          if (onLetterAnimationComplete) onLetterAnimationComplete();
          return;
        }

        gsap.fromTo(targets, from, {
          ...to,
          duration: duration,
          ease: ease,
          stagger: delay / 1000,
          onComplete: () => {
            if (onLetterAnimationComplete) onLetterAnimationComplete();
          }
        });
      }

      async function fetchWithWakeupNotice(url, options = {}) {
        let timer = setTimeout(() => {
          const errEl = document.getElementById('authError');
          if (errEl) {
            errEl.innerHTML = `<span style="display:inline-block; animation: pulse 1.5s infinite; color: #A78BFA; font-weight: 500;">⏳ Server is waking up (Render free-tier cold start takes ~50s)... please wait.</span>`;
            errEl.classList.add('show');
          }
        }, 2200);

        try {
          const res = await fetch(url, options);
          clearTimeout(timer);
          const errEl = document.getElementById('authError');
          if (errEl && errEl.innerHTML.includes('Server is waking up')) {
            errEl.classList.remove('show');
            errEl.innerHTML = '';
          }
          return res;
        } catch (e) {
          clearTimeout(timer);
          const errEl = document.getElementById('authError');
          if (errEl && errEl.innerHTML.includes('Server is waking up')) {
            errEl.classList.remove('show');
            errEl.innerHTML = '';
          }
          throw e;
        }
      }

      async function handleAuthSubmit(e) {
        e.preventDefault();
        const email = document.getElementById('authEmail').value.trim().toLowerCase();
        const password = document.getElementById('authPassword').value;
        const confirmPw = document.getElementById('authConfirm').value;
        document.getElementById('authError').classList.remove('show');

        if (authMode === 'signup') {
          if (password.length < 6) { showAuthError('Password must be at least 6 characters.'); return; }
          if (password !== confirmPw) { showAuthError('Passwords do not match.'); return; }
        }

        const submitBtn = document.getElementById('authSubmit');
        const originalBtnText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Processing...';

        try {
          if (authMode === 'signup') {
            const res = await fetchWithWakeupNotice('/api/register', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, password })
            });
            const data = await res.json();
            if (!res.ok) {
              showAuthError(data.error || 'Signup failed');
              submitBtn.disabled = false;
              submitBtn.textContent = originalBtnText;
              return;
            }
            await showFullscreenWelcomeTransition(email, 'Welcome in');
          } else {
            const res = await fetchWithWakeupNotice('/api/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, password })
            });
            const data = await res.json();
            if (!res.ok) {
              showAuthError(data.error || 'Login failed');
              submitBtn.disabled = false;
              submitBtn.textContent = originalBtnText;
              return;
            }
            await showFullscreenWelcomeTransition(email, 'Welcome back');
          }
        } catch (err) {
          showAuthError('Server connection error. Make sure app.py is running.');
          submitBtn.disabled = false;
          submitBtn.textContent = originalBtnText;
        }
      }

      async function showFullscreenWelcomeTransition(email, welcomePhrase) {
        sessionStorage.setItem('portfolio_welcome_shown', 'true');

        const overlay = document.getElementById('welcomeOverlay');
        const welcomeText = document.getElementById('welcomeText');
        const username = (email && email.includes('@')) ? email.split('@')[0] : (email || 'Investor');

        if (overlay && welcomeText) {
          overlay.style.display = 'flex';
          overlay.offsetHeight; // trigger reflow
          overlay.style.opacity = '1';

          const textToAnimate = `${welcomePhrase}, ${username}!`;

          try {
            await Promise.race([
              new Promise(resolve => {
                createSplitText(welcomeText, {
                  text: textToAnimate,
                  delay: 45,
                  duration: 0.7,
                  ease: 'power3.out',
                  from: { opacity: 0, y: 35 },
                  to: { opacity: 1, y: 0 },
                  onLetterAnimationComplete: resolve
                });
              }),
              new Promise(resolve => setTimeout(resolve, 1400)) // Guarantee progression even if animation stalls
            ]);
          } catch (e) {
            console.warn('Welcome text animation notice:', e);
            welcomeText.textContent = textToAnimate;
          }

          await new Promise(r => setTimeout(r, 700));

          overlay.style.opacity = '0';
          await new Promise(r => setTimeout(r, 350));
          overlay.style.display = 'none';
        }

        const submitBtn = document.getElementById('authSubmit');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = authMode === 'signup' ? 'Create account' : 'Log in';
        }

        await enterDashboard(email);
      }

      function showAuthScreen() {
        if (typeof window._startDarkVeil === 'function') window._startDarkVeil();
        const auth = document.getElementById('authScreen');
        const dash = document.getElementById('dashboardScreen');
        if (auth) {
          // Use 'block' on mobile (<=768px) so CSS media queries can control layout
          auth.style.display = window.innerWidth <= 768 ? 'block' : 'flex';
          auth.classList.remove('hidden');
        }
        if (dash) {
          dash.style.display = 'none';
          dash.classList.add('hidden');
        }
      }

      function showDashboardScreen() {
        if (typeof window._stopDarkVeil === 'function') window._stopDarkVeil();
        const auth = document.getElementById('authScreen');
        const dash = document.getElementById('dashboardScreen');
        if (auth) {
          auth.style.display = 'none';
          auth.classList.add('hidden');
        }
        if (dash) {
          dash.style.display = 'flex';
          dash.classList.remove('hidden');
        }
        // Reset scroll position to top
        try {
          window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        } catch(e) {
          window.scrollTo(0, 0);
        }
        document.body.scrollTop = 0;
        document.documentElement.scrollTop = 0;
      }

      async function enterDashboard(email) {
        sessionStorage.setItem('portfolio_welcome_shown', 'true');
        currentUser = { email };
        try {
          localStorage.setItem('portfolio_user_email', email);
          await fetch('/api/auth/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email })
          });
        } catch (e) {
          console.warn('Session sync warning:', e);
        }
        showDashboardScreen();
        if (typeof updatePrivacyEyeUI === 'function') updatePrivacyEyeUI();
        const uEmailLabel = document.getElementById('userEmailLabel');
        if (uEmailLabel) {
          uEmailLabel.textContent = email;
          uEmailLabel.title = email;
          uEmailLabel.setAttribute('aria-label', 'Signed in as ' + email);
        }
        const avatar = document.getElementById('userAvatar');
        if (avatar) avatar.textContent = email.charAt(0).toUpperCase();

        // Preload user's PAN cards and IPO applications in parallel immediately
        if (typeof updatePanDisplay === 'function') updatePanDisplay();
        if (typeof fetchUserPans === 'function') fetchUserPans();
        if (typeof fetchIpoApplications === 'function') fetchIpoApplications();

        // Render from database immediately so the user can see their data
        await loadHoldings();
        renderAll();

        // Restore active tab (e.g. IPO tab, Analytics, News, or Portfolio)
        const savedTab = localStorage.getItem('portfolio_active_tab') || 'portfolio';
        if (typeof switchTab === 'function') {
          switchTab(savedTab);
        }

        // Fetch live prices in the background asynchronously
        document.getElementById('updatedLabel').textContent = "Fetching live prices...";
        refreshLivePricesForHoldings().then(() => {
          applyLivePricesToHoldings();
          computeDayOpen();
          persist();
          renderAll();
          tickUpdatedLabel();
        }).catch(err => {
          console.error("Live fetch failed:", err);
          tickUpdatedLabel();
        });
      }

      async function signOut() {
        sessionStorage.removeItem('portfolio_welcome_shown');
        _ipoLoaded = false;
        try {
          localStorage.removeItem('portfolio_user_email');
          await fetch('/api/logout', { method: 'POST' });
        } catch (e) {
          console.error("Logout request failed:", e);
        }
        currentUser = null;
        showAuthScreen();
        document.getElementById('authForm').reset();
        setAuthMode('login');
      }

      function wirePasswordToggle(btnId, inputId) {
        const btn = document.getElementById(btnId);
        const input = document.getElementById(inputId);
        if (!btn || !input) return;
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const isPw = input.type === 'password';
          input.type = isPw ? 'text' : 'password';
          const openIcon = btn.querySelector('.eye-open-icon');
          const closedIcon = btn.querySelector('.eye-closed-icon');
          if (openIcon && closedIcon) {
            openIcon.style.display = isPw ? 'none' : 'block';
            closedIcon.style.display = isPw ? 'block' : 'none';
          }
        });
      }

      function wireAuth() {
        document.getElementById('tabLogin').addEventListener('click', () => setAuthMode('login'));
        document.getElementById('tabSignup').addEventListener('click', () => setAuthMode('signup'));
        document.getElementById('authForm').addEventListener('submit', handleAuthSubmit);
        const signOutBtn = document.getElementById('signOutBtn');
        if (signOutBtn) signOutBtn.addEventListener('click', signOut);
        const sidebarSignOutBtn = document.getElementById('sidebarSignOutBtn');
        if (sidebarSignOutBtn) sidebarSignOutBtn.addEventListener('click', signOut);
        const menuDrawerSignOutBtn = document.getElementById('menuDrawerSignOutBtn');
        if (menuDrawerSignOutBtn) {
          menuDrawerSignOutBtn.addEventListener('click', () => {
            if (typeof closeDrawer === 'function') closeDrawer();
            signOut();
          });
        }
        wireAuthSwitch();
        wirePasswordToggle('toggleAuthPassword', 'authPassword');
        wirePasswordToggle('toggleAuthConfirm', 'authConfirm');
        const googleLoginBtn = document.getElementById('googleLoginBtn');
        if (googleLoginBtn) {
          googleLoginBtn.addEventListener('click', (e) => {
            e.preventDefault();
            startGoogleLogin();
          });
        }

      }

      /* ---------------- dock (vanilla-JS rebuild of the React Bits Dock — no React/motion needed) ---------------- */
      function initDock() {
        const panel = document.getElementById('dockPanel');
        if (!panel) return;
        const items = Array.from(panel.querySelectorAll('.dock-item'));
        if (!items.length) return;

        // click actions
        panel.addEventListener('click', (e) => {
          const btn = e.target.closest('.dock-item');
          if (!btn) return;
          const action = btn.dataset.dockAction;
          if (action === 'add') openModal('add');
          else if (action === 'search') {
            const input = document.getElementById('searchInput');
            if (input) { input.scrollIntoView({ behavior: 'smooth', block: 'center' }); input.focus(); }
          }
          else if (action === 'sort') {
            const select = document.getElementById('sortSelect');
            if (select) {
              const opts = Array.from(select.options).map(o => o.value);
              const next = opts[(opts.indexOf(select.value) + 1) % opts.length];
              select.value = next;
              select.dispatchEvent(new Event('change'));
              toast('Sort: ' + select.options[select.selectedIndex].text.replace('Sort: ', ''));
            }
          }
          else if (action === 'refresh') refreshPrices();
          else if (action === 'account') { const el = document.getElementById('accountLink'); if (el) el.click(); }
          else if (action === 'signout') signOut();
        });

        // Skip spring-based magnification animations on touchscreens to prevent lagging/reflow issues
        if (!window.matchMedia('(hover: hover)').matches) {
          return;
        }

        const BASE = 56, MAGNIFY = 80, DISTANCE = 140;
        const SPRING = { stiffness: 150, damping: 12, mass: 0.1 };

        const dockState = items.map(el => ({ el, size: BASE, target: BASE, velocity: 0 }));
        let mouseX = null;
        let raf = null;
        let cachedCenters = [];

        function cacheCenters() {
          cachedCenters = dockState.map(s => {
            const rect = s.el.getBoundingClientRect();
            return rect.left + rect.width / 2;
          });
        }

        function setTargets() {
          dockState.forEach((s, idx) => {
            if (mouseX === null) { s.target = BASE; return; }
            const centerX = cachedCenters[idx] || (s.el.getBoundingClientRect().left + s.el.getBoundingClientRect().width / 2);
            const dist = Math.abs(mouseX - centerX);
            const t = Math.max(0, 1 - dist / DISTANCE);
            s.target = BASE + (MAGNIFY - BASE) * t;
          });
        }

        function tick() {
          let stillMoving = false;
          dockState.forEach(s => {
            const force = (s.target - s.size) * SPRING.stiffness;
            const damping = s.velocity * SPRING.damping;
            const accel = (force - damping) / (SPRING.mass * 1000);
            s.velocity += accel;
            s.size += s.velocity * (1 / 60);
            if (Math.abs(s.target - s.size) > 0.1 || Math.abs(s.velocity) > 0.1) stillMoving = true;
            else { s.size = s.target; s.velocity = 0; }
            // Use hardware-accelerated transform instead of layout-thrashing width/height
            const scale = s.size / BASE;
            s.el.style.transform = `scale(${scale}) translateZ(0)`;
          });
          if (stillMoving) raf = requestAnimationFrame(tick);
          else {
            raf = null;
            if (mouseX === null) {
              dockState.forEach(s => { s.el.style.transform = ''; });
            }
          }
        }
        function ensureLoop() { if (!raf) raf = requestAnimationFrame(tick); }

        panel.addEventListener('mousemove', (e) => {
          mouseX = e.clientX;
          if (cachedCenters.length === 0) cacheCenters();
          setTargets();
          ensureLoop();
        });
        panel.addEventListener('mouseleave', () => {
          mouseX = null;
          setTargets();
          ensureLoop();
          cachedCenters = [];
        });
        window.addEventListener('resize', () => {
          cachedCenters = [];
        });
      }

      /* ---------------- ScrollFloat Vanilla Component (React Bits port) ---------------- */
      function initScrollFloat(elementOrSelector, options = {}) {
        const elements = typeof elementOrSelector === 'string'
          ? document.querySelectorAll(elementOrSelector)
          : [elementOrSelector];

        // Critical Mobile Fix: On mobile viewports (<=768px), disable split-character scrub animations.
        // This guarantees that "Get Started in 3 Steps" and "Everything You Need to Track Wealth"
        // are ALWAYS 100% visible, beautifully wrapped, and never vanish on momentum scroll or address-bar resize!
        if (window.innerWidth <= 768 || window.matchMedia('(max-width: 768px)').matches) {
          elements.forEach(el => {
            if (!el) return;
            el.style.opacity = '1';
            el.style.visibility = 'visible';
            el.style.transform = 'none';
            el.style.overflow = 'visible';
          });
          return;
        }

        elements.forEach(el => {
          if (!el) return;

          const text = options.text || el.textContent.trim();
          const animationDuration = options.animationDuration !== undefined ? options.animationDuration : 1;
          const ease = options.ease || 'back.inOut(2)';
          const scrollStart = options.scrollStart || 'center bottom+=50%';
          const scrollEnd = options.scrollEnd || 'bottom bottom-=40%';
          const stagger = options.stagger !== undefined ? options.stagger : 0.03;
          const scroller = options.scroller || window;

          // Split text into characters
          const chars = text.split('');
          el.innerHTML = '';
          const wrapper = document.createElement('span');
          wrapper.className = 'scroll-float-text';
          wrapper.style.display = 'inline-block';

          const charElements = [];
          chars.forEach(char => {
            const charSpan = document.createElement('span');
            charSpan.className = 'char';
            charSpan.style.display = 'inline-block';
            charSpan.textContent = char === ' ' ? '\u00A0' : char;
            wrapper.appendChild(charSpan);
            charElements.push(charSpan);
          });

          el.appendChild(wrapper);
          el.classList.add('scroll-float');
          el.style.overflow = 'hidden';

          // Safe check for GSAP & ScrollTrigger
          if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') {
            console.warn('GSAP or ScrollTrigger is not loaded. Bypassing ScrollFloat animation.');
            charElements.forEach(span => {
              span.style.opacity = '1';
              span.style.transform = 'none';
            });
            return;
          }

          // Register ScrollTrigger plugin
          gsap.registerPlugin(ScrollTrigger);

          gsap.fromTo(
            charElements,
            {
              willChange: 'opacity, transform',
              opacity: 0,
              yPercent: 120,
              scaleY: 2.3,
              scaleX: 0.7,
              transformOrigin: '50% 0%'
            },
            {
              duration: animationDuration,
              ease: ease,
              opacity: 1,
              yPercent: 0,
              scaleY: 1,
              scaleX: 1,
              stagger: stagger,
              scrollTrigger: {
                trigger: el,
                scroller: scroller,
                start: scrollStart,
                end: scrollEnd,
                scrub: true
              }
            }
          );
        });
      }

      function switchShowcaseTab(element, tabName) {
        // Find all showcase cards and toggle active class
        const cards = document.querySelectorAll('.showcase-feature-card, .feature-tab-btn');
        cards.forEach(card => {
          card.classList.remove('active');
          card.setAttribute('aria-selected', 'false');
        });

        if (element) {
          element.classList.add('active');
          element.setAttribute('aria-selected', 'true');
        }

        // Update URL bar path
        const urlElem = document.getElementById('showcaseUrlPath');
        if (urlElem) {
          urlElem.textContent = `portfoliotracker.pro/dashboard/${tabName}`;
        }

        // Update image with smooth GSAP transition
        const img = document.getElementById('showcaseImage');
        if (img) {
          if (typeof gsap !== 'undefined') {
            gsap.to(img, {
              opacity: 0,
              y: 8,
              duration: 0.14,
              ease: 'power2.in',
              onComplete: () => {
                img.src = `${tabName}_preview.png`;
                gsap.to(img, {
                  opacity: 1,
                  y: 0,
                  duration: 0.24,
                  ease: 'power2.out'
                });
              }
            });
          } else {
            img.src = `${tabName}_preview.png`;
          }
        }
      }
      window.switchShowcaseTab = switchShowcaseTab;

      function startGoogleLogin() {
        const btn = document.getElementById('googleLoginBtn');
        if (btn) {
          btn.innerHTML = `
            <svg class="spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <circle cx="12" cy="12" r="10" stroke-opacity="0.25"/>
              <path d="M12 2a10 10 0 0 1 10 10" stroke="#4285F4"/>
            </svg>
            <span>Connecting to Google...</span>
          `;
          btn.style.opacity = '0.85';
          btn.style.pointerEvents = 'none';
        }
        if (window.location.protocol === 'file:') {
          window.location.href = 'http://127.0.0.1:8080/api/login/google';
        } else {
          window.location.href = '/api/login/google';
        }
      }
      window.startGoogleLogin = startGoogleLogin;

      /* ---------------- OrbitImages Vanilla Component (React Bits port) ---------------- */
      function initOrbitImages() {
        const view = document.getElementById('financialOrbit');
        if (!view) return;

        const nodes = view.querySelectorAll('.orbit-node');
        if (!nodes.length) return;

        const pathStr = 'M 160 500 A 340 80 0 1 0 840 500 A 340 80 0 1 0 160 500';

        nodes.forEach((node, idx) => {
          node.style.offsetPath = `path("${pathStr}")`;
          node.style.offsetRotate = '8deg';
          node.style.offsetAnchor = '50% 50%';
          node.style.offsetPosition = '0 0';

          const startPercent = (idx / nodes.length) * 100;
          const duration = 35; // matching the original 35s animation
          const delay = -(startPercent / 100) * duration;
          node.style.animationDelay = `${delay}s`;
          node.classList.add('orbit-node-animated');
        });

        // Responsive scaling setup
        const container = document.querySelector('.orbit-showcase-container');
        if (!container) return;

        const baseWidth = 1000;
        function updateScale() {
          const w = container.clientWidth;
          const scale = Math.min(1, Math.max(0.32, w / baseWidth));
          view.style.transform = `translate(-50%, -50%) rotate(-8deg) scale(${scale})`;
        }

        updateScale();
        window.addEventListener('resize', updateScale);

        // Use ResizeObserver for perfect accuracy
        if (typeof ResizeObserver !== 'undefined') {
          const robserver = new ResizeObserver(updateScale);
          robserver.observe(container);
        }
      }

      /* ---------------- DarkVeil WebGL CPPN Shader Initialization ---------------- */
      function initDarkVeil(canvasId, options = {}) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (!gl) return;

        const vsSource = `
          attribute vec2 position;
          void main() {
            gl_Position = vec4(position, 0.0, 1.0);
          }
        `;

        const fsSource = `
          precision mediump float;
          uniform vec2 uResolution;
          uniform float uTime;
          uniform float uHueShift;
          uniform float uNoise;
          uniform float uScanline;
          uniform float uScanFreq;
          uniform float uWarp;
          
          #define MAX_LAYERS 8
          vec4 buf[MAX_LAYERS];
          
          vec4 softplus(vec4 x) {
            return log(vec4(1.0) + exp(x));
          }
          vec4 cppn_fn(vec2 coordinate, float in0, float in1, float in2) {
            buf[6] = vec4(coordinate.x, coordinate.y, 0.3948333106474662 + in0, 0.36 + in1);
            buf[7] = vec4(0.14 + in2, sqrt(coordinate.x * coordinate.x + coordinate.y * coordinate.y), 0.0, 0.0);
            buf[0] = mat4(vec4(6.5404263, -3.6126034, 0.7590882, -1.13613), vec4(0.8522648, -0.6698696, -0.8936647, 0.7303038), vec4(1.1090124, 0.5057077, 0.709971, -0.3705007), vec4(-0.252033, 0.9015949, 1.0504787, 0.2878954)) * buf[6] + mat4(vec4(-0.2831825, -0.9996503, -0.7351608, -0.3719001), vec4(0.0463994, 0.5085189, -0.7277717, -0.3922985), vec4(0.0, 0.0, 0.0, 0.0), vec4(0.0, 0.0, 0.0, 0.0)) * buf[7];
            buf[0] = tanh(buf[0]);
            buf[1] = mat4(vec4(0.9701768, -0.2319409, 0.8122883, 1.0963773), vec4(-0.4344408, -1.157833, 0.0125866, -1.1118128), vec4(-1.0877967, 1.1396345, -0.9634758, 0.7554904), vec4(0.1601007, -0.7601955, -0.407986, -0.5901306)) * buf[0];
            buf[1] = softplus(buf[1]);
            buf[2] = mat4(vec4(0.7937402, 1.0531585, -0.4285474, -0.9160533), vec4(0.2458428, 1.0950346, -0.4497672, -0.4473859), vec4(-0.5516008, 0.4471556, -0.8037384, -0.7289569), vec4(0.1983058, 0.5312781, 0.2014169, 1.1130635)) * buf[1];
            buf[2] = sin(buf[2]);
            buf[3] = mat4(vec4(0.4851221, -0.7963364, 0.3547167, -0.4206682), vec4(-0.4631393, -0.2974955, 0.7562097, 0.9022631), vec4(-0.5843468, 0.1772658, -0.6729007, -0.5283525), vec4(0.9255747, 0.7303358, 0.941604, -0.2818973)) * buf[2];
            buf[3] = tanh(buf[3]);
            buf[4] = mat4(vec4(0.4499115, -0.7513361, -0.7656608, 0.7431189), vec4(0.8530467, 0.8142345, 0.8091873, -0.9126207), vec4(-0.534898, -0.6698642, 0.0543789, 0.4533036), vec4(0.0094047, 0.1906917, -0.9701725, 0.7351636)) * buf[3];
            buf[4] = softplus(buf[4]);
            buf[5] = mat4(vec4(0.9110292, -0.4651325, 0.0, 0.0), vec4(0.0, 0.0, 0.0, 0.0), vec4(0.0, 0.0, 0.0, 0.0), vec4(0.0, 0.0, 0.0, 0.0)) * buf[4];
            return buf[5];
          }
          vec3 rgb2hsv(vec3 c) {
            vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
            vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
            vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
            float d = q.x - min(q.w, q.y);
            float e = 1.0e-10;
            return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
          }
          vec3 hsv2rgb(vec3 c) {
            vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
            vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
            return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
          }
          void main() {
            vec2 st = gl_FragCoord.xy / uResolution.xy;
            vec2 p = (gl_FragCoord.xy * 2.0 - uResolution.xy) / min(uResolution.x, uResolution.y);
            
            // Apply warp
            float r = length(p);
            float theta = atan(p.y, p.x);
            p.x += sin(theta * 4.0 + uTime * uWarp) * 0.05;
            p.y += cos(theta * 3.0 + uTime * uWarp) * 0.05;
            
            float t = uTime * 0.15;
            vec4 raw = cppn_fn(p, sin(t), cos(t * 0.8), sin(t * 1.2));
            vec3 rgb = clamp(raw.xyz, 0.0, 1.0);
            
            // Enhance contrast and vibrancy
            rgb = smoothstep(0.1, 0.9, rgb);
            
            // Apply hue shift
            vec3 hsv = rgb2hsv(rgb);
            hsv.x = fract(hsv.x + uHueShift / 360.0);
            hsv.y = clamp(hsv.y * 1.3, 0.0, 1.0);
            hsv.z = clamp(hsv.z * 0.9, 0.0, 1.0);
            rgb = hsv2rgb(hsv);
            
            // Add subtle scanlines
            float scanline = sin(gl_FragCoord.y * uScanFreq) * uScanline;
            rgb -= scanline;
            
            // Add fine noise
            float noise = (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * uNoise;
            rgb += noise;
            
            gl_FragColor = vec4(rgb, 1.0);
          }
        `;

        function createShader(gl, type, source) {
          const shader = gl.createShader(type);
          gl.shaderSource(shader, source);
          gl.compileShader(shader);
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader compilation error:', gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
          }
          return shader;
        }

        const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
        const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
        if (!vs || !fs) return;

        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
          console.error('Program linking error:', gl.getProgramInfoLog(program));
          return;
        }

        const positionAttributeLocation = gl.getAttribLocation(program, 'position');
        const positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
          -1, -1,
          1, -1,
          -1, 1,
          -1, 1,
          1, -1,
          1, 1,
        ]), gl.STATIC_DRAW);

        const uResolutionLoc = gl.getUniformLocation(program, 'uResolution');
        const uTimeLoc = gl.getUniformLocation(program, 'uTime');
        const uHueShiftLoc = gl.getUniformLocation(program, 'uHueShift');
        const uNoiseLoc = gl.getUniformLocation(program, 'uNoise');
        const uScanlineLoc = gl.getUniformLocation(program, 'uScanline');
        const uScanFreqLoc = gl.getUniformLocation(program, 'uScanFreq');
        const uWarpLoc = gl.getUniformLocation(program, 'uWarp');

        const start = performance.now();
        let raf = null;

        function resize() {
          const parent = canvas.parentElement;
          if (!parent) return;
          // Downsample canvas resolution (e.g., 25%) and cap max resolution to prevent GPU bottleneck on tall pages
          const scaleFactor = 0.25;
          const w = parent.clientWidth;
          const h = parent.clientHeight;
          canvas.width = Math.min(w * scaleFactor, 800);
          canvas.height = Math.min(h * scaleFactor, 600);
          gl.viewport(0, 0, canvas.width, canvas.height);
        }

        resize();
        window.addEventListener('resize', resize);

        let lastFrameTime = 0;
        function render(time) {
          // Throttle to 30 FPS to reduce GPU and battery consumption by 70%
          if (time - lastFrameTime < 32) {
            raf = requestAnimationFrame(render);
            return;
          }
          lastFrameTime = time;

          const timeSeconds = (time - start) * 0.001 * (options.speed || 1.0);

          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);

          gl.useProgram(program);
          gl.enableVertexAttribArray(positionAttributeLocation);
          gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
          gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);

          gl.uniform2f(uResolutionLoc, canvas.width, canvas.height);
          gl.uniform1f(uTimeLoc, timeSeconds);
          gl.uniform1f(uHueShiftLoc, options.hueShift || 0.0);
          gl.uniform1f(uNoiseLoc, options.noiseIntensity || 0.0);
          gl.uniform1f(uScanlineLoc, options.scanlineIntensity || 0.0);
          gl.uniform1f(uScanFreqLoc, options.scanlineFrequency || 0.0);
          gl.uniform1f(uWarpLoc, options.warpAmount || 0.0);

          gl.drawArrays(gl.TRIANGLES, 0, 6);

          raf = requestAnimationFrame(render);
        }

        window._stopDarkVeil = function() {
          if (raf) { cancelAnimationFrame(raf); raf = null; }
        };
        window._startDarkVeil = function() {
          if (!raf && canvas && canvas.offsetParent !== null) {
            lastFrameTime = performance.now();
            raf = requestAnimationFrame(render);
          }
        };

        document.addEventListener('visibilitychange', () => {
          if (document.hidden) {
            if (typeof window._stopDarkVeil === 'function') window._stopDarkVeil();
          } else {
            const auth = document.getElementById('authScreen');
            if (auth && !auth.classList.contains('hidden') && auth.style.display !== 'none') {
              if (typeof window._startDarkVeil === 'function') window._startDarkVeil();
            }
          }
        });

        const observer = new IntersectionObserver((entries) => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              if (!raf) {
                raf = requestAnimationFrame(render);
              }
            } else {
              if (raf) {
                cancelAnimationFrame(raf);
                raf = null;
              }
            }
          });
        }, { threshold: 0 });
        observer.observe(canvas);
      }

      
      /* ---------------- PRICE ALERT ENGINE (Groww / Zerodha Dark UI) ---------------- */
      let currentAlertHolding = null;
      let alertFrequency = 'every'; // 'every' or 'once'

      function getAlertsStorageKey() {
        const email = (currentUser && currentUser.email) || localStorage.getItem('portfolio_user_email') || 'guest';
        return 'ptracker_alerts_' + email.trim().toLowerCase();
      }

      function getSavedAlerts() {
        try {
          const raw = localStorage.getItem(getAlertsStorageKey());
          if (raw) return JSON.parse(raw);
        } catch (e) { console.warn('Alerts read error:', e); }
        return [];
      }

      function saveAlertsList(alerts) {
        try {
          localStorage.setItem(getAlertsStorageKey(), JSON.stringify(alerts || []));
          updateAlertBadges();
        } catch (e) { console.warn('Alerts save error:', e); }
      }

      function updateAlertBadges() {
        const alerts = getSavedAlerts().filter(a => !a.triggered);
        const count = alerts.length;
        const topBadge = document.getElementById('topbarAlertBadge');
                const sBadge = document.getElementById('sidebarAlertBadge');
        const activeCount = document.getElementById('activeAlertsCount');

        [topBadge, sBadge].forEach(b => {
          if (b) {
            b.textContent = count;
            b.style.display = count > 0 ? 'inline-block' : 'none';
          }
        });
        if (activeCount) activeCount.textContent = count;
      }

      function playAlertChime() {
        try {
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          if (!AudioCtx) return;
          const ctx = new AudioCtx();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.connect(gain);
          gain.connect(ctx.destination);

          // Pleasant high-pitch two-tone alert chime (Groww / Zerodha style)
          osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
          osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12); // A5
          gain.gain.setValueAtTime(0.25, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);

          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.45);
        } catch (e) { /* ignore audio permission errors */ }
      }

      function showTriggeredAlertBanner(alert, livePrice) {
        playAlertChime();
        const banner = document.createElement('div');
        banner.className = 'price-alert-banner';
        banner.innerHTML = `
          <div style="font-size: 24px; line-height: 1;">🔔</div>
          <div style="flex: 1;">
            <div style="font-weight: 800; font-size: 13px; color: #10B981; letter-spacing: 0.5px;">PRICE ALERT TRIGGERED!</div>
            <div style="font-size: 13px; font-weight: 600; margin-top: 2px;">
              <b>${alert.symbol}</b> reached <b>₹${livePrice.toFixed(2)}</b>!
            </div>
            <div style="font-size: 12px; opacity: 0.85; margin-top: 2px;">
              Target was ₹${alert.targetPrice.toFixed(2)} (${alert.direction === 'above' ? 'Crossed Above' : 'Crossed Below'})
            </div>
          </div>
          <button style="background: transparent; border: none; color: #FFFFFF; font-size: 16px; cursor: pointer; padding: 4px;" onclick="this.parentElement.remove()">✕</button>
        `;
        document.body.appendChild(banner);
        setTimeout(() => {
          banner.style.opacity = '0';
          banner.style.transition = 'opacity 0.4s ease';
          setTimeout(() => banner.remove(), 400);
        }, 9000);

        // Native Browser Notification
        if ('Notification' in window && Notification.permission === 'granted') {
          try {
            new Notification(`Price Alert: ${alert.symbol} reached ₹${livePrice.toFixed(2)}!`, {
              body: `Target: ₹${alert.targetPrice.toFixed(2)} on ${alert.exchange || 'NSE'}.`,
              icon: 'logo_icon.png'
            });
          } catch (e) {}
        }
      }

      function checkPriceAlerts() {
        const alerts = getSavedAlerts();
        if (!alerts || !alerts.length) return;

        let hasChanges = false;
        const now = Date.now();

        alerts.forEach(alert => {
          if (alert.triggered && alert.frequency === 'once') return;

          // Find current price for this holding
          const holding = state.holdings.find(h =>
            (h.id && h.id === alert.holdingId) ||
            (h.symbol && h.symbol.toUpperCase() === alert.symbol.toUpperCase())
          );
          if (!holding || !holding.price) return;

          const currentPrice = parseFloat(holding.price);
          const targetPrice = parseFloat(alert.targetPrice);

          // Check cooldown for 'every' (don't alert more than once every 5 mins)
          if (alert.frequency === 'every' && alert.lastTriggeredAt) {
            if (now - alert.lastTriggeredAt < 5 * 60 * 1000) return;
          }

          let triggered = false;
          if (alert.direction === 'above' && currentPrice >= targetPrice) {
            triggered = true;
          } else if (alert.direction === 'below' && currentPrice <= targetPrice) {
            triggered = true;
          }

          if (triggered) {
            showTriggeredAlertBanner(alert, currentPrice);
            alert.lastTriggeredAt = now;
            if (alert.frequency === 'once') {
              alert.triggered = true;
            }
            hasChanges = true;
          }
        });

        if (hasChanges) {
          saveAlertsList(alerts);
          renderActiveAlerts();
        }
      }

      function openAlertModal(holdingId = null) {
        const overlay = document.getElementById('alertModalOverlay');
        if (!overlay) return;

        // Populate stock select with user's holdings
        const select = document.getElementById('alertStockSelect');
        if (select) {
          select.innerHTML = '';
          if (!state.holdings || !state.holdings.length) {
            select.innerHTML = '<option value="">(No holdings added yet)</option>';
          } else {
            state.holdings.forEach(h => {
              const opt = document.createElement('option');
              opt.value = h.id;
              opt.textContent = `${h.symbol} (${h.exchange || 'NSE'}) • ₹${(h.price || h.buyPrice || 0).toFixed(2)}`;
              select.appendChild(opt);
            });
          }
        }

        // Determine which holding is selected
        let targetHolding = null;
        if (holdingId) {
          targetHolding = state.holdings.find(h => h.id === holdingId);
        }
        if (!targetHolding && state.holdings.length > 0) {
          targetHolding = state.holdings[0];
        }

        if (targetHolding) {
          if (select) select.value = targetHolding.id;
          setupAlertForHolding(targetHolding);
        } else {
          setupAlertFallback();
        }

        switchAlertTab('set');
        updateAlertBadges();
        overlay.classList.add('open');
      }

      function setupAlertForHolding(h) {
        currentAlertHolding = h;
        const cmp = parseFloat(h.price || h.buyPrice || 0);

        const symEl = document.getElementById('alertStockSymbol');
        const exchEl = document.getElementById('alertStockExchange');
        const nameEl = document.getElementById('alertStockName');
        const cmpEl = document.getElementById('alertStockCmp');
        const pctEl = document.getElementById('alertStockDayPct');

        if (symEl) symEl.textContent = h.symbol;
        if (exchEl) exchEl.textContent = h.exchange || 'NSE';
        if (nameEl) nameEl.textContent = h.name || h.yahooSymbol || h.symbol;
        if (cmpEl) cmpEl.textContent = fmtINR2(cmp);
        if (pctEl) pctEl.textContent = `${fmtPct(h.dayPct || 0)} today`;

        // Pre-fill target price (e.g. +2% above CMP by default)
        const defaultTarget = +(cmp * 1.02).toFixed(2);
        const input = document.getElementById('alertTargetPriceInput');
        if (input) input.value = defaultTarget > 0 ? defaultTarget : cmp;

        updateAlertDirectionHint();
      }

      function setupAlertFallback() {
        const symEl = document.getElementById('alertStockSymbol');
        if (symEl) symEl.textContent = 'NTPC';
        const input = document.getElementById('alertTargetPriceInput');
        if (input) input.value = '350.00';
        updateAlertDirectionHint();
      }

      function closeAlertModal() {
        const overlay = document.getElementById('alertModalOverlay');
        if (overlay) overlay.classList.remove('open');
      }

      function switchAlertTab(tab) {
        const formSec = document.getElementById('alertFormSection');
        const listSec = document.getElementById('alertListSection');
        const setBtn = document.getElementById('tabSetAlertBtn');
        const listBtn = document.getElementById('tabActiveAlertsBtn');

        if (tab === 'set') {
          if (formSec) formSec.style.display = 'block';
          if (listSec) listSec.style.display = 'none';
          if (setBtn) setBtn.classList.add('active');
          if (listBtn) listBtn.classList.remove('active');
        } else {
          if (formSec) formSec.style.display = 'none';
          if (listSec) listSec.style.display = 'block';
          if (setBtn) setBtn.classList.remove('active');
          if (listBtn) listBtn.classList.add('active');
          renderActiveAlerts();
        }
      }

      function updateAlertDirectionHint() {
        const input = document.getElementById('alertTargetPriceInput');
        const hintText = document.getElementById('alertConditionText');
        if (!input || !hintText) return;

        const targetVal = parseFloat(input.value) || 0;
        const cmpVal = currentAlertHolding ? parseFloat(currentAlertHolding.price || currentAlertHolding.buyPrice || 0) : 340;

        if (targetVal >= cmpVal) {
          hintText.innerHTML = `Will trigger when price crosses <b>ABOVE ₹${targetVal.toFixed(2)}</b> (CMP: ₹${cmpVal.toFixed(2)})`;
        } else {
          hintText.innerHTML = `Will trigger when price drops <b>BELOW ₹${targetVal.toFixed(2)}</b> (CMP: ₹${cmpVal.toFixed(2)})`;
        }
      }

      function renderActiveAlerts() {
        const container = document.getElementById('activeAlertsList');
        if (!container) return;
        const alerts = getSavedAlerts();

        if (!alerts || !alerts.length) {
          container.innerHTML = `
            <div style="text-align:center; padding:32px 16px; color: #94A3B8;">
              <div style="font-size:32px; margin-bottom:8px;">🔕</div>
              <div style="font-weight:600; color: #FFFFFF;">No price alerts set</div>
              <div style="font-size:12px; margin-top:4px;">Create an alert to get notified when stocks reach your target price.</div>
            </div>
          `;
          return;
        }

        container.innerHTML = alerts.map(a => {
          const isTriggered = a.triggered;
          return `
            <div class="alert-item-card">
              <div class="alert-item-left">
                <div class="alert-item-sym">
                  ${a.symbol}
                  <span style="font-size: 12px; padding:1px 5px; border-radius:4px; background:rgba(255,255,255,0.06); color: #94A3B8;">${a.exchange || 'NSE'}</span>
                </div>
                <div class="alert-item-cond">
                  ${a.direction === 'above' ? '▲ Crosses Above' : '▼ Drops Below'} ₹${parseFloat(a.targetPrice).toFixed(2)}
                </div>
                <div class="alert-item-meta">
                  Notify: ${a.frequency === 'every' ? 'Every time' : 'Once'} • Created at ₹${parseFloat(a.createdPrice || 0).toFixed(2)}
                </div>
              </div>
              <div class="alert-item-right">
                <span class="alert-status-badge ${isTriggered ? 'triggered' : 'active'}">
                  ${isTriggered ? 'Triggered 🔔' : 'Active 🟢'}
                </span>
                <button class="alert-del-btn" onclick="deleteAlert('${a.id}')" title="Delete Alert">🗑️</button>
              </div>
            </div>
          `;
        }).join('');
      }

      window.deleteAlert = function(id) {
        let alerts = getSavedAlerts();
        alerts = alerts.filter(a => a.id !== id);
        saveAlertsList(alerts);
        renderActiveAlerts();
        toast('Alert removed.');
      };

      function saveNewAlert() {
        if (!currentAlertHolding) {
          toast('Please select a stock first.');
          return;
        }

        const input = document.getElementById('alertTargetPriceInput');
        const targetPrice = parseFloat(input.value);
        if (!targetPrice || targetPrice <= 0) {
          toast('Please enter a valid target price.');
          return;
        }

        // Request browser notification permission if not yet granted
        if ('Notification' in window && Notification.permission === 'default') {
          Notification.requestPermission();
        }

        const cmp = parseFloat(currentAlertHolding.price || currentAlertHolding.buyPrice || 0);
        const direction = targetPrice >= cmp ? 'above' : 'below';

        const newAlert = {
          id: 'ALT_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
          holdingId: currentAlertHolding.id,
          symbol: currentAlertHolding.symbol,
          exchange: currentAlertHolding.exchange || 'NSE',
          name: currentAlertHolding.name || currentAlertHolding.symbol,
          yahooSymbol: currentAlertHolding.yahooSymbol || currentAlertHolding.symbol,
          targetPrice: targetPrice,
          createdPrice: cmp,
          direction: direction,
          frequency: alertFrequency, // 'every' or 'once'
          createdAt: new Date().toISOString(),
          triggered: false,
          lastTriggeredAt: null
        };

        const alerts = getSavedAlerts();
        alerts.unshift(newAlert);
        saveAlertsList(alerts);

        playAlertChime();
        toast(`🔔 Alert set for ${newAlert.symbol} at ₹${targetPrice.toFixed(2)}!`);
        switchAlertTab('list');
      }

      function wireAlerts() {
        // Topbar & mobile triggers
        const topBtn = document.getElementById('topbarAlertsBtn');
        if (topBtn) topBtn.addEventListener('click', () => openAlertModal());

const sidebarBtn = document.getElementById('tabBtnAlerts');
        if (sidebarBtn) sidebarBtn.addEventListener('click', () => openAlertModal());

        // Close buttons
        const closeBtn = document.getElementById('closeAlertModalBtn');
        if (closeBtn) closeBtn.addEventListener('click', closeAlertModal);

        const crossBtn = document.getElementById('closeAlertModalCrossBtn');
        if (crossBtn) crossBtn.addEventListener('click', closeAlertModal);

        const overlay = document.getElementById('alertModalOverlay');
        if (overlay) {
          overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeAlertModal();
          });
        }

        // Tab buttons
        const tabSet = document.getElementById('tabSetAlertBtn');
        if (tabSet) tabSet.addEventListener('click', () => switchAlertTab('set'));

        const tabList = document.getElementById('tabActiveAlertsBtn');
        if (tabList) tabList.addEventListener('click', () => switchAlertTab('list'));

        const goSetBtn = document.getElementById('goToSetAlertBtn');
        if (goSetBtn) goSetBtn.addEventListener('click', () => switchAlertTab('set'));

        // Stock selector dropdown change
        const select = document.getElementById('alertStockSelect');
        if (select) {
          select.addEventListener('change', (e) => {
            const h = state.holdings.find(item => item.id === e.target.value);
            if (h) setupAlertForHolding(h);
          });
        }

        // Target price input change
        const targetInput = document.getElementById('alertTargetPriceInput');
        if (targetInput) {
          targetInput.addEventListener('input', updateAlertDirectionHint);
        }

        // Quick % chips
        document.querySelectorAll('.alert-chip').forEach(chip => {
          chip.addEventListener('click', (e) => {
            const pct = parseFloat(e.target.dataset.alertPct) || 0;
            const cmp = currentAlertHolding ? parseFloat(currentAlertHolding.price || currentAlertHolding.buyPrice || 0) : 340;
            const newTarget = +(cmp * (1 + pct / 100)).toFixed(2);
            if (targetInput) {
              targetInput.value = newTarget;
              updateAlertDirectionHint();
            }
          });
        });

        // Notify Frequency pills ('Every time' vs 'Once')
        const everyBtn = document.getElementById('notifyEveryBtn');
        const onceBtn = document.getElementById('notifyOnceBtn');
        if (everyBtn && onceBtn) {
          everyBtn.addEventListener('click', () => {
            alertFrequency = 'every';
            everyBtn.className = 'alert-pill active-every';
            onceBtn.className = 'alert-pill';
          });
          onceBtn.addEventListener('click', () => {
            alertFrequency = 'once';
            onceBtn.className = 'alert-pill active-once';
            everyBtn.className = 'alert-pill';
          });
        }

        // Submit button
        const submitBtn = document.getElementById('submitAlertBtn');
        if (submitBtn) submitBtn.addEventListener('click', saveNewAlert);

        // Initial badge sync
        updateAlertBadges();

      window.openAlertModal = openAlertModal;
      window.closeAlertModal = closeAlertModal;
      window.checkPriceAlerts = checkPriceAlerts;
      window.deleteAlert = deleteAlert;

      }

      async function init() {
        // 1. Wire UI interaction listeners safely
        try { wireAuth(); } catch (e) { console.warn(e); }
        try { wire(); } catch (e) { console.warn(e); }
        try { wireAlerts(); } catch (e) { console.warn(e); }
        try { wireMenuDrawer(); } catch (e) { console.warn(e); }
        try { initDock(); } catch (e) { console.warn(e); }

        // 2. Setup dashboard profile dropdown trigger
        try {
          const profileTriggerBtn = document.getElementById('profileTriggerBtn');
          const profileDropdownWrapper = document.getElementById('profileDropdownWrapper');
          if (profileTriggerBtn && profileDropdownWrapper) {
            profileTriggerBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              profileDropdownWrapper.classList.toggle('active');
            });
            document.addEventListener('click', (e) => {
              if (!profileDropdownWrapper.contains(e.target)) {
                profileDropdownWrapper.classList.remove('active');
              }
            });
          }
        } catch (e) { console.warn(e); }

        setInterval(tickUpdatedLabel, 5000);
        setInterval(refreshPrices, 60000);

        // 3. PRIORITY AUTHENTICATION CHECK
        let authenticatedEmail = null;

        // Check A: OAuth Callback URL Parameter (?login_email=... or ?error=...)
        const urlParams = new URLSearchParams(window.location.search);
        const oauthError = urlParams.get('error');
        if (oauthError) {
          window.history.replaceState({}, document.title, window.location.pathname);
          setTimeout(() => {
            if (typeof showToast === 'function') {
              showToast('Authentication: ' + decodeURIComponent(oauthError), 'info');
            }
          }, 400);
        }
        const oauthEmail = urlParams.get('login_email');
        if (oauthEmail) {
          window.history.replaceState({}, document.title, window.location.pathname);
          authenticatedEmail = oauthEmail;
          await showFullscreenWelcomeTransition(authenticatedEmail, 'Welcome back');
          return;
        }

        // Check B: Active Flask Session (/api/session)
        if (!authenticatedEmail) {
          try {
            const res = await fetch('/api/session');
            if (res.ok) {
              const data = await res.json();
              if (data.email) authenticatedEmail = data.email;
            }
          } catch (e) {
            console.warn('Session check error:', e);
          }
        }

        // Check C: Stored Local Session (localStorage) - NEVER wipe on refresh!
        if (!authenticatedEmail) {
          const savedEmail = localStorage.getItem('portfolio_user_email');
          if (savedEmail) {
            authenticatedEmail = savedEmail;
            // Best-effort non-blocking sync with backend session
            fetch('/api/auth/sync', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: savedEmail })
            }).catch(e => console.warn('Auto-login sync notice:', e));
          }
        }

        // 4. ROUTE DIRECTLY TO AUTH OR DASHBOARD
        if (authenticatedEmail) {
          await enterDashboard(authenticatedEmail);
        } else {
          showAuthScreen();
        }

        // 5. Initialize background cosmetic animations safely in background
        try { initOrbitImages(); } catch (e) { console.warn('OrbitImages init:', e); }
        try {
          initDarkVeil('darkVeilCanvas', {
            hueShift: 240,
            noiseIntensity: 0.015,
            scanlineIntensity: 0.1,
            scanlineFrequency: 2.0,
            speed: 0.2,
            warpAmount: 0.3
          });
        } catch (e) { console.warn('DarkVeil init:', e); }
        // Mobile scroll-reveal and tap feedback
        try { initScrollReveal(); } catch(e) { console.warn('ScrollReveal:', e); }
try {
          initScrollFloat('#get-started-section .section-title h2', {
            animationDuration: 1.2,
            ease: 'back.out(1.7)',
            scrollStart: 'top bottom-=5%',
            scrollEnd: 'bottom center+=15%',
            stagger: 0.02
          });
          initScrollFloat('#services-section .section-title h2', {
            animationDuration: 1.2,
            ease: 'back.out(1.7)',
            scrollStart: 'top bottom-=5%',
            scrollEnd: 'bottom center+=15%',
            stagger: 0.02
          });
        } catch (e) { console.warn('ScrollFloat init:', e); }
      }

      /* ── Scroll-Reveal for Landing Sections ── */
      function initScrollReveal() {
        const targets = document.querySelectorAll(
          '.step-card, .service-card-premium, .landing-clarity, .clarity-badge, .feature-tab-btn'
        );
        if (!targets.length) return;

        const observer = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add('revealed');
              // Optionally unobserve after first reveal
              observer.unobserve(entry.target);
            }
          });
        }, {
          threshold: 0.12,
          rootMargin: '0px 0px -40px 0px'
        });

        targets.forEach((el) => {
          el.classList.add('reveal-on-scroll');
          observer.observe(el);
        });
      }

      /* ── Window resize: fix authScreen display mode ── */
      window.addEventListener('resize', () => {
        const auth = document.getElementById('authScreen');
        if (auth && auth.style.display !== 'none') {
          auth.style.display = window.innerWidth <= 768 ? 'block' : 'flex';
        }
      });

            // =========================================================
      //  IPOWIZ MULTI-PAN & 2-STEP ALLOTMENT TRACKER STATE & HANDLERS
      // =========================================================
      // No default or demo PANs - completely user managed
      const DEMO_PANS = ['FNUPA8261H', 'AJLPA3918K', 'AVGPA2677Q', 'BTDPY6025L', 'QDKPS9103R'];

      let _userPans = [];
      try {
        const storedPans = localStorage.getItem('portfolio_saved_pans');
        if (storedPans) {
          const parsed = JSON.parse(storedPans);
          if (Array.isArray(parsed)) {
            // Filter out any demo PANs permanently
            _userPans = parsed.filter(p => p && p.pan && !DEMO_PANS.includes(p.pan.toUpperCase()));
          }
        }
      } catch (e) {}
      try { localStorage.setItem('portfolio_saved_pans', JSON.stringify(_userPans)); } catch(e){}

      let _userPan = _userPans.length > 0 ? _userPans[0].pan : '';
      let _isPanMasked = true; // masked by default like video!
      let _ipoApplications = [];
      try {
        const storedApps = localStorage.getItem('portfolio_ipo_applications');
        if (storedApps) _ipoApplications = JSON.parse(storedApps);
      } catch (e) {}

      let _currentAllotModalData = null;
      window._cachedIpoData = null;
      try {
        const storedIpoData = localStorage.getItem('portfolio_cached_ipos');
        if (storedIpoData) window._cachedIpoData = JSON.parse(storedIpoData);
      } catch (e) {}

      window.parseJsIpoDate = function (dStr) {
        if (!dStr || dStr === '-' || dStr === 'TBA' || dStr === 'None' || dStr === 'Pending') return null;
        const s = String(dStr).trim();
        const m1 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (m1) return new Date(parseInt(m1[1]), parseInt(m1[2]) - 1, parseInt(m1[3]), 23, 59, 59);
        const months = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
        const m2 = s.match(/^(\d{1,2})[\s\-]+([A-Za-z]{3,})[\s\-]+(\d{4})/);
        if (m2) {
          const mon = months[m2[2].toLowerCase().slice(0, 3)] || 0;
          return new Date(parseInt(m2[3]), mon, parseInt(m2[1]), 23, 59, 59);
        }
        return null;
      };

      function maskPanDigits(pan) {
        if (!pan || pan.length !== 10) return pan || '';
        return _isPanMasked ? ('XXXXXXXXX' + pan.slice(-1)) : pan;
      }

      function getInitials(name) {
        if (!name) return 'IN';
        const parts = name.trim().split(/\s+/);
        if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
        return name.slice(0, 2).toUpperCase();
      }

      // --- PAN NUMBERS MODAL ---
      window.openPanModal = function () {
        const modal = document.getElementById('panModalOverlay');
        if (!modal) return;
        renderPanListContainer();
        toggleAddPanForm(false);
        modal.style.display = 'flex';
      };

      window.closePanModal = function () {
        const modal = document.getElementById('panModalOverlay');
        if (modal) modal.style.display = 'none';
      };

      window.togglePanMask = function () {
        _isPanMasked = !_isPanMasked;
        updatePanDisplay();
        renderPanListContainer();
        // If multi check view is open, refresh displayed digits
        const listEl = document.getElementById('multiCheckPanList');
        if (listEl && _currentAllotModalData) {
          const digitNodes = listEl.querySelectorAll('.pan-item-digits');
          _userPans.forEach((p, idx) => {
            if (digitNodes[idx]) digitNodes[idx].textContent = maskPanDigits(p.pan);
          });
        }
      };

      function updatePanDisplay() {
        const bannerVal = document.getElementById('ipoPanDisplay');
        const eyeBtn = document.getElementById('ipoPanEyeBtn');
        const editBtnText = document.getElementById('editPanBtnText');

        if (bannerVal) {
          bannerVal.textContent = _userPans.length > 0 
            ? `${_userPans.length} PANs Linked (${maskPanDigits(_userPans[0].pan)})`
            : 'No PAN Linked';
        }

        if (eyeBtn) {
          eyeBtn.style.display = _userPans.length > 0 ? 'inline-flex' : 'none';
          const openIcon = eyeBtn.querySelector('.pan-eye-open');
          const closedIcon = eyeBtn.querySelector('.pan-eye-closed');
          if (openIcon && closedIcon) {
            openIcon.style.display = _isPanMasked ? 'block' : 'none';
            closedIcon.style.display = _isPanMasked ? 'none' : 'block';
          }
        }

        if (editBtnText) {
          editBtnText.textContent = _userPans.length > 0 ? 'Manage PANs' : 'Link PAN';
        }
      }
      // Initialize immediately from localStorage
      updatePanDisplay();

      function renderPanListContainer() {
        const wrap = document.getElementById('panCardsListContainer');
        if (!wrap) return;

        if (_userPans.length === 0) {
          wrap.innerHTML = '<div style="text-align:center;padding:24px;color:#94A3B8;font-size:13px;">No PAN cards linked yet. Click below to add one.</div>';
          return;
        }

        wrap.innerHTML = _userPans.map(item => {
          const initials = getInitials(item.name);
          const masked = maskPanDigits(item.pan);
          return `
            <div class="pan-item-card" data-id="${item.id}">
              <div style="display:flex;align-items:center;min-width:0;flex:1;">
                <div class="pan-avatar-circle">${initials}</div>
                <div class="pan-item-meta">
                  <div class="pan-item-name">${item.name || 'Investor'}</div>
                  <div class="pan-item-digits">${masked}</div>
                </div>
              </div>
              <div class="pan-item-actions">
                <button type="button" class="pan-icon-btn" title="Edit PAN" onclick="editPanItem('${item.id}')">
                  ✏️
                </button>
                <button type="button" class="pan-icon-btn delete" title="Delete PAN" onclick="deletePanItem('${item.id}')">
                  🗑️
                </button>
              </div>
            </div>
          `;
        }).join('');
      }

      window.toggleAddPanForm = function (show, editObj = null) {
        const box = document.getElementById('panEditFormBox');
        const heading = document.getElementById('panFormHeading');
        const idInput = document.getElementById('panEditId');
        const nameInput = document.getElementById('panHolderNameInput');
        const panInput = document.getElementById('panNumberInput');
        const submitBtn = document.getElementById('panSaveBtn');

        if (!box) return;
        if (!show) {
          box.style.display = 'none';
          return;
        }

        if (editObj) {
          if (heading) heading.textContent = 'Edit Family PAN';
          if (idInput) idInput.value = editObj.id;
          if (nameInput) nameInput.value = editObj.name;
          if (panInput) panInput.value = editObj.pan;
          if (submitBtn) submitBtn.textContent = 'Update PAN';
        } else {
          if (heading) heading.textContent = 'Add Family PAN';
          if (idInput) idInput.value = '';
          if (nameInput) nameInput.value = '';
          if (panInput) panInput.value = '';
          if (submitBtn) submitBtn.textContent = 'Save PAN';
        }
        box.style.display = 'block';
        setTimeout(() => { if (nameInput) nameInput.focus(); }, 50);
      };

      window.editPanItem = function (id) {
        const found = _userPans.find(p => p.id === id);
        if (found) {
          toggleAddPanForm(true, found);
        }
      };

      window.deletePanItem = async function (id) {
        const target = _userPans.find(p => p.id === id);
        if (!target) return;
        if (!confirm(`Are you sure you want to remove ${target.name} (${target.pan})?`)) return;

        _userPans = _userPans.filter(p => p.id !== id);
        localStorage.setItem('portfolio_saved_pans', JSON.stringify(_userPans));
        if (_userPans.length > 0) _userPan = _userPans[0].pan;
        else _userPan = null;

        renderPanListContainer();
        updatePanDisplay();
        toast(`Removed PAN for ${target.name}`);

        const userEmail = (typeof currentUser !== 'undefined' && currentUser && currentUser.email)
          || localStorage.getItem('portfolio_user_email') || '';

        try {
          await fetch(`/api/user/pans?email=${encodeURIComponent(userEmail)}&pan=${encodeURIComponent(target.pan)}`, {
            method: 'DELETE'
          });
        } catch (e) {
          console.warn('Sync delete PAN error:', e);
        }
      };

      window.handleSavePanItem = async function (e) {
        if (e && e.preventDefault) e.preventDefault();
        const idInput = document.getElementById('panEditId');
        const nameInput = document.getElementById('panHolderNameInput');
        const panInput = document.getElementById('panNumberInput');
        const submitBtn = document.getElementById('panSaveBtn');

        const nameVal = (nameInput ? nameInput.value : '').trim();
        const panVal = (panInput ? panInput.value : '').trim().toUpperCase();

        const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
        if (!panRegex.test(panVal)) {
          toast('Invalid PAN format! Must be 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F)');
          return;
        }

        const editId = idInput ? idInput.value : '';
        if (editId) {
          const idx = _userPans.findIndex(p => p.id === editId);
          if (idx !== -1) {
            _userPans[idx] = { id: editId, name: nameVal || 'Investor', pan: panVal };
          }
        } else {
          _userPans.push({
            id: 'pan_' + Date.now(),
            name: nameVal || 'Investor',
            pan: panVal
          });
        }

        _userPan = _userPans[0].pan;
        localStorage.setItem('portfolio_saved_pans', JSON.stringify(_userPans));
        renderPanListContainer();
        updatePanDisplay();
        toggleAddPanForm(false);
        toast(`PAN linked for ${nameVal || 'Investor'}! 🔒`);

        const userEmail = (typeof currentUser !== 'undefined' && currentUser && currentUser.email)
          || localStorage.getItem('portfolio_user_email') || '';

        if (submitBtn) submitBtn.disabled = true;
        try {
          await fetch('/api/user/pans', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: userEmail, pans: _userPans })
          });
        } catch (e) {
          console.warn('Sync save PANs error:', e);
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
      };

      window.fetchUserPans = async function () {
        const userEmail = (typeof currentUser !== 'undefined' && currentUser && currentUser.email)
          || localStorage.getItem('portfolio_user_email') || '';

        try {
          const res = await fetch('/api/user/pans' + (userEmail ? `?email=${encodeURIComponent(userEmail)}` : ''));
          if (!res.ok) return;
          const json = await res.json();
          if (json.success && Array.isArray(json.pans) && json.pans.length > 0) {
            _userPans = json.pans;
            _userPan = _userPans[0].pan;
            localStorage.setItem('portfolio_saved_pans', JSON.stringify(_userPans));
            updatePanDisplay();
            renderPanListContainer();
          } else if (json.success && (!json.pans || json.pans.length === 0) && _userPans.length > 0 && userEmail) {
            const validPans = _userPans.filter(p => p && p.pan && !DEMO_PANS.includes(p.pan.toUpperCase()));
            if (validPans.length > 0) {
              fetch('/api/user/pans', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: userEmail, pans: validPans })
              }).catch(e => console.warn('Two-way PAN sync notice:', e));
            }
          }
        } catch (e) {
          console.warn('fetchUserPans notice:', e);
        }
      };
      window.fetchUserPan = function() { if (typeof window.fetchUserPans === 'function') return window.fetchUserPans(); };

      window.fetchIpoApplications = async function () {
        const userEmail = (typeof currentUser !== 'undefined' && currentUser && currentUser.email)
          || localStorage.getItem('portfolio_user_email')
          || '';

        try {
          const url = '/api/ipo/applications' + (userEmail ? `?email=${encodeURIComponent(userEmail)}` : '');
          const res = await fetch(url);
          if (!res.ok) return;
          const json = await res.json();
          if (json.success && Array.isArray(json.applications)) {
            _ipoApplications = json.applications;
            try { localStorage.setItem('portfolio_ipo_applications', JSON.stringify(_ipoApplications)); } catch(e){}
            updateIpoKpis();
            renderMyIpoApplications();
            if (window._cachedIpoData) {
              if (window._cachedIpoData.open) renderIpoList('open', window._cachedIpoData.open);
              if (window._cachedIpoData.upcoming) renderIpoList('upcoming', window._cachedIpoData.upcoming);
              if (window._cachedIpoData.listed) renderIpoList('listed', window._cachedIpoData.listed);
            }
          }
        } catch (err) {
          console.error('fetchIpoApplications error:', err);
        }
      };

      function updateIpoKpis() {
        const validApps = (_ipoApplications || []).filter(a => a.status && a.status !== 'NOT_APPLIED');
        const total = validApps.length;
        const allotted = validApps.filter(a => a.status === 'ALLOTTED').length;
        const awaiting = validApps.filter(a => a.status === 'APPLIED').length;

        const kTotal = document.getElementById('kpiAppliedCount');
        const kAllot = document.getElementById('kpiAllottedCount');
        const kAwait = document.getElementById('kpiAwaitingCount');
        const myCount = document.getElementById('myAppsCount');

        if (kTotal) kTotal.textContent = total;
        if (kAllot) kAllot.textContent = allotted;
        if (kAwait) kAwait.textContent = awaiting;
        if (myCount) myCount.textContent = total;
      }

      window.renderMyIpoApplications = function () {
        const wrap = document.getElementById('ipoListMyApps');
        const empty = document.getElementById('ipoMyAppsEmpty');
        if (!wrap) return;

        const validApps = (_ipoApplications || []).filter(a => a.status && a.status !== 'NOT_APPLIED');
        if (validApps.length === 0) {
          wrap.innerHTML = '';
          if (empty) empty.style.display = 'block';
          return;
        }

        if (empty) empty.style.display = 'none';

        wrap.innerHTML = validApps.map(app => {
          const isAllotted = app.status === 'ALLOTTED';
          const isNot = app.status === 'NOT_ALLOTTED';
          const badgeClass = isAllotted ? 'allotted' : (isNot ? 'not-allotted' : 'applied');
          const statusText = isAllotted
            ? `🟢 ${app.shares_allotted || 15} Shares Allotted`
            : (isNot ? '🔴 Not Allotted (Refunded)' : '🟡 Applied / In Review');

          const appNameEsc = encodeURIComponent(app.ipo_name || '');
          const allotUrl = encodeURIComponent(app.allotment_url || '');

          return `
            <div class="my-ipo-card">
              <div class="my-ipo-info">
                <h4>${app.ipo_name}</h4>
                <div class="my-ipo-meta">
                  <span class="ipo-allot-chip ${badgeClass}">${statusText}</span>
                  <span>Lots: ${app.lots || 1}</span>
                  ${app.pan_card ? `<span style="font-family:monospace;color:#A78BFA;">PAN: ${maskPanDigits(app.pan_card)}</span>` : ''}
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:8px;">
                <button class="btn btn-primary" style="padding:6px 12px;font-weight:700;" onclick="redirectToRegistrar('${allotUrl}', '${appNameEsc}')">
                  Check on Registrar ↗
                </button>
                <button class="btn btn-outline btn-sm" style="padding:6px 10px;color:#EF4444;border-color:rgba(239,68,68,0.25);" title="Remove Tracking" onclick="handleDeleteApplication('${app.id}')">
                  🗑
                </button>
              </div>
            </div>
          `;
        }).join('');
      };

      // =========================================================
      //  IPOWIZ 2-STEP MODAL CONTROLLERS (OVERVIEW & MULTI-CHECK)
      // =========================================================
      window.openAllotmentModal = function (ipoNameEsc, ipoSymbol, allotmentUrl, lotSize, priceBand, gmp, allotmentDate = '', openDate = '', closeDate = '', listingDate = '', issueSize = '') {
        const ipoName = decodeURIComponent(ipoNameEsc || '');
        const modal = document.getElementById('ipoAllotmentModalOverlay');
        if (!modal) return;

        const cleanLot = parseInt(lotSize) || 15;
        const cleanGmp = parseFloat(gmp) || 0;
        const estProfit = cleanGmp * cleanLot;

        const cleanOpen = decodeURIComponent(openDate || 'TBA');
        const cleanClose = decodeURIComponent(closeDate || 'TBA');
        const cleanAllot = decodeURIComponent(allotmentDate || 'TBA');
        const cleanList = decodeURIComponent(listingDate || 'TBA');
        const cleanSize = decodeURIComponent(issueSize || 'TBA');

        if (window._cachedIpoData) {
          const allList = [...(window._cachedIpoData.open || []), ...(window._cachedIpoData.upcoming || []), ...(window._cachedIpoData.listed || [])];
          const found = allList.find(x => 
            (ipoSymbol && x.symbol && x.symbol.toUpperCase() === ipoSymbol.toUpperCase()) ||
            (ipoName && x.name && (x.name.toLowerCase().includes(ipoName.toLowerCase()) || ipoName.toLowerCase().includes(x.name.toLowerCase())))
          );
          if (found) {
            if ((!cleanAllot || cleanAllot === 'TBA' || cleanAllot === '-') && found.allotment_date) cleanAllot = found.allotment_date;
            if ((!cleanOpen || cleanOpen === 'TBA' || cleanOpen === '-') && found.open_date) cleanOpen = found.open_date;
            if ((!cleanClose || cleanClose === 'TBA' || cleanClose === '-') && found.close_date) cleanClose = found.close_date;
            if ((!cleanList || cleanList === 'TBA' || cleanList === '-') && found.listing_date) cleanList = found.listing_date;
            if ((!cleanSize || cleanSize === 'TBA' || cleanSize === '-') && found.issue_size) cleanSize = found.issue_size;
            if (!allotmentUrl && found.allotment_url) allotmentUrl = found.allotment_url;
          }
        }

        _currentAllotModalData = {
          ipoName,
          ipoSymbol: ipoSymbol || '',
          allotmentUrl: allotmentUrl ? decodeURIComponent(allotmentUrl) : '',
          lotSize: cleanLot,
          priceBand: priceBand || '-',
          gmp: cleanGmp,
          estProfit: estProfit,
          allotmentDate: cleanAllot,
          openDate: cleanOpen,
          closeDate: cleanClose,
          listingDate: cleanList,
          issueSize: cleanSize
        };

        // Populate Subview 1: Overview & Grid
        const titleEl = document.getElementById('allotModalTitle');
        if (titleEl) titleEl.textContent = ipoName;

        const typeEl = document.getElementById('allotModalType');
        if (typeEl) {
          typeEl.textContent = (ipoSymbol && ipoSymbol.toUpperCase().includes('SME')) ? 'SME IPO' : 'Mainboard IPO';
        }

        const gLot = document.getElementById('gridLotSize');
        const gPrice = document.getElementById('gridPriceRange');
        const gProfit = document.getElementById('gridEstProfit');
        const gSize = document.getElementById('gridIssueSize');
        const gOpen = document.getElementById('gridOpenDate');
        const gClose = document.getElementById('gridCloseDate');
        const gAllot = document.getElementById('gridAllotmentDate');
        const gList = document.getElementById('gridListingDate');

        if (gLot) gLot.textContent = `${cleanLot} shares`;
        if (gPrice) gPrice.textContent = priceBand && priceBand !== '-' ? (priceBand.startsWith('₹') ? priceBand : '₹' + priceBand) : 'Market Price';
        if (gProfit) {
          if (estProfit > 0) {
            gProfit.textContent = `+₹${estProfit.toLocaleString('en-IN')} (+₹${cleanGmp}/sh)`;
            gProfit.className = 'val green';
          } else {
            gProfit.textContent = cleanGmp > 0 ? `+₹${cleanGmp}/sh` : 'TBA';
            gProfit.className = 'val';
          }
        }
        if (gSize) gSize.textContent = cleanSize;
        if (gOpen) gOpen.textContent = cleanOpen;
        if (gClose) gClose.textContent = cleanClose;
        if (gAllot) gAllot.textContent = cleanAllot;
        if (gList) gList.textContent = cleanList;

        const detailsBtn = document.getElementById('overviewDetailsBtn');
        if (detailsBtn) {
          detailsBtn.href = _currentAllotModalData.allotmentUrl || 'https://linkintime.co.in/initial_offer/public-issues.html';
        }

        // Switch to Subview 1
        const view1 = document.getElementById('allotViewOverview');
        const view2 = document.getElementById('allotViewMultiCheck');
        if (view1) view1.style.display = 'block';
        if (view2) view2.style.display = 'none';

        modal.style.display = 'flex';
      };

                  // Direct official registrar redirection (no automated / simulated guess)
      window.resolveIpoRegistrarUrl = function(ipoName, symbol, rawUrl) {
        if (rawUrl && !rawUrl.includes('example.com') && rawUrl !== '-' && rawUrl !== 'TBA') {
          return rawUrl;
        }
        const sName = (ipoName || '').toLowerCase();
        if (sName.includes('kanohar')) {
          return 'https://in.mpms.mufg.com/Initial_Offer/public-issues.html';
        }
        if (sName.includes('amtech')) {
          return 'https://maashitla.com/';
        }
        if (sName.includes('steamhouse') || sName.includes('lcc')) {
          return 'https://ipostatus.kfintech.com/';
        }
        // Universal BSE India Official Allotment Check
        return 'https://www.bseindia.com/investors/appli_check.aspx';
      };

      window.redirectToRegistrar = function(allotUrl, ipoNameEsc) {
        if (window.event) window.event.stopPropagation();
        const ipoName = decodeURIComponent(ipoNameEsc || '');
        const targetUrl = resolveIpoRegistrarUrl(ipoName, '', allotUrl ? decodeURIComponent(allotUrl) : '');

        // If user has linked their PAN, auto-copy to clipboard for effortless pasting
        const userPan = (_userPans && _userPans.length > 0) ? _userPans[0].pan : (_userPan || '');
        if (userPan && navigator.clipboard) {
          navigator.clipboard.writeText(userPan).catch(() => {});
          toast(`📋 PAN (${maskPanDigits(userPan)}) copied! Opening official registrar portal...`);
        } else {
          toast(`🌐 Opening official allotment portal for ${ipoName}...`);
        }

        window.open(targetUrl, '_blank', 'noopener,noreferrer');
      };

      window.openDirectRegistrarFromModal = function(e) {
        if (e && e.preventDefault) e.preventDefault();
        if (!_currentAllotModalData) return;
        const { ipoName, allotmentUrl } = _currentAllotModalData;
        redirectToRegistrar(allotmentUrl, encodeURIComponent(ipoName));
      };

      window.closeAllotmentModal = function () {
        const modal = document.getElementById('ipoAllotmentModalOverlay');
        if (modal) modal.style.display = 'none';
        _currentAllotModalData = null;
      };

            
      window.quickMarkApplied = async function (ipoNameEsc, ipoSymbol, lotSize, priceBand, allotmentUrl) {
        if (window.event) window.event.stopPropagation();
        const ipoName = decodeURIComponent(ipoNameEsc);
        if (!_userPan) {
          toast('Please link your PAN card first to track IPO applications! 🔒');
          openPanModal();
          return;
        }

        const userEmail = (typeof currentUser !== 'undefined' && currentUser && currentUser.email) || localStorage.getItem('portfolio_user_email') || '';

        // Optimistically update local _ipoApplications immediately
        const existingIdx = _ipoApplications.findIndex(a => 
          (ipoSymbol && a.ipo_symbol && a.ipo_symbol.toUpperCase() === ipoSymbol.toUpperCase()) ||
          (a.ipo_name && a.ipo_name.toLowerCase() === ipoName.toLowerCase())
        );
        const newAppObj = {
          id: existingIdx !== -1 ? _ipoApplications[existingIdx].id : ('app_' + Date.now()),
          user_email: userEmail,
          ipo_name: ipoName,
          ipo_symbol: ipoSymbol,
          pan_card: _userPan || '',
          lots: 1,
          bid_price: priceBand || '-',
          status: 'APPLIED',
          allotment_url: allotmentUrl || ''
        };
        if (existingIdx !== -1) _ipoApplications[existingIdx] = newAppObj;
        else _ipoApplications.unshift(newAppObj);
        try { localStorage.setItem('portfolio_ipo_applications', JSON.stringify(_ipoApplications)); } catch(e){}
        updateIpoKpis();
        renderMyIpoApplications();
        if (window._cachedIpoData) {
          if (window._cachedIpoData.open) renderIpoList('open', window._cachedIpoData.open);
          if (window._cachedIpoData.upcoming) renderIpoList('upcoming', window._cachedIpoData.upcoming);
          if (window._cachedIpoData.listed) renderIpoList('listed', window._cachedIpoData.listed);
        }
        toast(`Tracking ${ipoName} application! 📋`);

        try {
          const res = await fetch('/api/ipo/apply' + (userEmail ? `?email=${encodeURIComponent(userEmail)}` : ''), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: userEmail,
              ipo_name: ipoName,
              ipo_symbol: ipoSymbol,
              lots: 1,
              bid_price: priceBand || '-',
              allotment_url: allotmentUrl || '',
              pan_card: _userPan || ''
            })
          });
          const json = await res.json();
          if (!res.ok || !json.success) {
            console.warn('Backend track notice:', json.error);
          }
          await fetchIpoApplications();
        } catch (err) {
          console.warn('Network notice for track IPO:', err.message);
        }
      };

      window.handleDeleteApplication = async function (appId) {
        const idToDelete = appId || (_currentAllotModalData && _currentAllotModalData.appId);
        if (!idToDelete) return;

        if (!confirm('Are you sure you want to stop tracking this IPO application?')) return;

        const userEmail = (typeof currentUser !== 'undefined' && currentUser && currentUser.email) || localStorage.getItem('portfolio_user_email') || '';
        try {
          const res = await fetch(`/api/ipo/applications/${idToDelete}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: userEmail })
          });
          const json = await res.json();
          if (!res.ok || !json.success) {
            throw new Error(json.error || 'Failed to delete');
          }
          toast('Application removed from tracker.');
          closeAllotmentModal();
          await fetchIpoApplications();
        } catch (err) {
          toast('Error: ' + err.message);
        }
      };

      // Close modal on backdrop click
      window.addEventListener('click', function (e) {
        const panModal = document.getElementById('panModalOverlay');
        const allotModal = document.getElementById('ipoAllotmentModalOverlay');
        if (e.target === panModal) closePanModal();
        if (e.target === allotModal) closeAllotmentModal();
      });

      window.loadIpoData = async function (force = false) {
        const loading = document.getElementById('ipoLoading');
        const errBox  = document.getElementById('ipoError');
        const lastUpd = document.getElementById('ipoLastUpdated');

        if (_ipoLoaded && !force) {
          if (loading) loading.style.display = 'none';
          if (errBox)  errBox.style.display  = 'none';
          return;
        }

        if (loading) loading.style.display = 'flex';
        if (errBox)  errBox.style.display  = 'none';
        if (lastUpd) lastUpd.style.display  = 'none';

        try {
          // Fetch user's linked PAN and tracked applications in parallel with live IPOs
          if (typeof fetchUserPans === 'function') fetchUserPans();
          if (typeof fetchIpoApplications === 'function') fetchIpoApplications();

          const userEmail = (typeof currentUser !== 'undefined' && currentUser && currentUser.email) || localStorage.getItem('portfolio_user_email') || '';
          const url = '/api/ipos?' + (userEmail ? `email=${encodeURIComponent(userEmail)}&` : '') + (force ? 'refresh=1' : '');
          const res  = await fetch(url);

          if (!res.ok) {
            if (window._cachedIpoData && window._cachedIpoData.open) {
              console.warn('IPO fetch failed (' + res.status + '), falling back to cached in-memory data');
              const data = window._cachedIpoData;
              renderIpoList('open',     data.open     || []);
              renderIpoList('upcoming', data.upcoming || []);
              renderIpoList('listed',   data.listed   || []);
              return;
            }
            throw new Error('Server returned ' + res.status);
          }

          const json = await res.json();
          if (json.error) throw new Error(json.error);

          const data = json.data || { open: [], upcoming: [], listed: [] };
          window._cachedIpoData = data;
          try { localStorage.setItem('portfolio_cached_ipos', JSON.stringify(data)); } catch(e){}
          const openList     = data.open     || [];
          const upcomingList = data.upcoming || [];
          const listedList   = data.listed   || [];

          renderIpoList('open',     openList);
          renderIpoList('upcoming', upcomingList);
          renderIpoList('listed',   listedList);

          const oc = document.getElementById('openCount');
          if (oc) oc.textContent = openList.length;
          const uc = document.getElementById('upcomingCount');
          if (uc) uc.textContent = upcomingList.length;
          const lc = document.getElementById('listedCount');
          if (lc) lc.textContent = listedList.length;

          const badge = document.getElementById('ipoOpenBadge');
          if (badge) {
            badge.style.display  = openList.length > 0 ? 'inline-flex' : 'none';
            badge.textContent    = openList.length;
          }

          if (lastUpd) {
            const age = json.age_seconds || 0;
            lastUpd.textContent  = json.cached
              ? ('Updated ' + Math.round(age / 60) + ' min ago')
              : 'Live market data — just now';
            lastUpd.style.display = 'block';
          }

          _ipoLoaded = true;
        } catch (e) {
          console.error('IPO fetch error:', e);
          _ipoLoaded = false;
          if (errBox) errBox.style.display = 'block';
        } finally {
          if (loading) loading.style.display = 'none';
        }
      };

      let _currentIpoBoard = 'all'; // 'all' | 'mainboard' | 'sme'

      window.switchIpoBoard = function (board) {
        try {
          _currentIpoBoard = board;
          document.querySelectorAll('.ipo-board-btn').forEach(function (btn) {
            btn.classList.toggle('active', btn.id === ('ipoBoardTab' + board.charAt(0).toUpperCase() + board.slice(1)));
          });

          const hintEl = document.getElementById('ipoBoardHint');
          if (hintEl) {
            if (board === 'mainboard') hintEl.textContent = 'Showing Mainboard Issues (NSE & BSE Mainboard)';
            else if (board === 'sme') hintEl.textContent = 'Showing SME Issues (BSE SME & NSE Emerge)';
            else hintEl.textContent = 'Showing All Categories (Mainboard & SME)';
          }

          if (_currentIpoSection === 'myApps') {
            if (typeof renderMyIpoApplications === 'function') renderMyIpoApplications();
          } else if (window._cachedIpoData && window._cachedIpoData[_currentIpoSection]) {
            renderIpoList(_currentIpoSection, window._cachedIpoData[_currentIpoSection]);
          }
        } catch (e) {
          console.error('switchIpoBoard error:', e);
        }
      };

      function updateIpoBoardCounts(ipos) {
        try {
          const list = ipos || [];
          const mainList = list.filter(i => !(i.type || i.exchange || '').toUpperCase().includes('SME'));
          const smeList = list.filter(i => (i.type || i.exchange || '').toUpperCase().includes('SME'));

          const bAll = document.getElementById('ipoBoardCountAll');
          if (bAll) bAll.textContent = list.length;
          const bMain = document.getElementById('ipoBoardCountMainboard');
          if (bMain) bMain.textContent = mainList.length;
          const bSme = document.getElementById('ipoBoardCountSme');
          if (bSme) bSme.textContent = smeList.length;
        } catch (e) {
          console.error('updateIpoBoardCounts error:', e);
        }
      }

      function renderSingleIpoCard(ipo, section) {
        const isOpen = section === 'open';
        const isListed = section === 'listed';

        // Logo
        const logo = ipo.logo_url
          ? `<img src="${ipo.logo_url}" alt="" class="ipo-clean-logo" onerror="this.style.display='none'"/>`
          : `<div class="ipo-clean-logo">${(ipo.name || 'I')[0]}</div>`;

        // Tag
        const isSme = (ipo.type || ipo.exchange || '').toUpperCase().includes('SME');
        const typeText = isSme ? 'SME' : 'Mainboard';

        // Check if user has an active application record for this IPO
        const app = (_ipoApplications || []).find(a => 
          a.status && a.status !== 'NOT_APPLIED' &&
          ((ipo.symbol && a.ipo_symbol && a.ipo_symbol.toUpperCase() === ipo.symbol.toUpperCase()) ||
           (ipo.name && a.ipo_name && (a.ipo_name.toLowerCase().includes(ipo.name.toLowerCase()) || ipo.name.toLowerCase().includes(a.ipo_name.toLowerCase()))))
        );

        let statusChip = '';
        const nameEsc = encodeURIComponent(ipo.name || '');
        const ipoSymbol = ipo.symbol || '';
        const allotUrl = ipo.allotment_url || '';
        const lotSize = parseInt(ipo.lot_size) || 1;
        const priceBand = ipo.price_band || (ipo.issue_price ? '₹' + ipo.issue_price : '-');

        // GMP representation
        let gmpHtml = '';
        if (ipo.gmp != null && ipo.gmp > 0) {
          const lotNum = parseInt(ipo.lot_size) || 1;
          const estProfit = (ipo.gmp * lotNum).toLocaleString('en-IN');
          gmpHtml = `
            <div class="ipo-clean-gmp">
              <span class="gmp-pill positive">+₹${ipo.gmp} (+${(ipo.gmp_pct || 0).toFixed(1)}%)</span>
              ${lotNum > 1 ? `<span class="gmp-subtext">+₹${estProfit} / lot</span>` : ''}
            </div>`;
        } else if (ipo.gmp === 0) {
          gmpHtml = `
            <div class="ipo-clean-gmp">
              <span class="gmp-pill neutral">₹0 (0.0%)</span>
            </div>`;
        } else {
          gmpHtml = `
            <div class="ipo-clean-gmp">
              <span class="gmp-pill neutral">TBA</span>
            </div>`;
        }

        // Return representation for listed
        if (isListed) {
          const retStr = String(ipo.listing_return || 'Pending');
          const isPos = retStr.startsWith('+');
          gmpHtml = `
            <div class="ipo-clean-gmp">
              <span class="gmp-pill ${isPos ? 'positive' : 'neutral'}">${retStr}</span>
              <span class="gmp-subtext">Issue: ₹${ipo.issue_price || '-'}</span>
            </div>`;
        }

        // Determine if allotment is in the future
        let isFutureAllotment = false;
        if (ipo.is_allotment_live === false) {
          isFutureAllotment = true;
        } else if (ipo.allotment_date && ipo.allotment_date !== '-' && ipo.allotment_date !== 'TBA') {
          const dt = parseJsIpoDate(ipo.allotment_date);
          if (dt && dt > new Date()) {
            isFutureAllotment = true;
          }
        }

        // Dates & Price
        const dateRange = isOpen
          ? `${ipo.open_date || '-'} – ${ipo.close_date || '-'}`
          : (isListed 
              ? (isFutureAllotment ? `Allotment on ${ipo.allotment_date || '-'}` : `Allotted ${ipo.allotment_date || '-'}`)
              : `Opens ${ipo.open_date || 'TBA'}`);

        // Context-Aware Action Badge / Button
        let actionElement = '';
        const allotDateStr = ipo.allotment_date || '';
        const oDate = encodeURIComponent(ipo.open_date || 'TBA');
        const cDate = encodeURIComponent(ipo.close_date || 'TBA');
        const lDate = encodeURIComponent(ipo.listing_date || 'TBA');
        const iSize = encodeURIComponent(ipo.issue_size || 'TBA');

        if (isFutureAllotment) {
          statusChip = `<span class="ipo-allot-chip" style="background:rgba(251,191,36,0.12);color: #F59E0B;border:1px solid rgba(251,191,36,0.25);">⏳ Allotment ${ipo.allotment_date || 'Soon'}</span>`;
          actionElement = `<button class="ipo-clean-btn secondary" onclick="redirectToRegistrar('${allotUrl}', '${nameEsc}')" title="Open Official Registrar Portal">Registrar Portal ↗</button>`;
        } else if (isListed) {
          statusChip = `<span class="ipo-allot-chip allotted" style="background:rgba(52,211,153,0.12);color: #10B981;border:1px solid rgba(52,211,153,0.25);">📢 Allotment Live</span>`;
          actionElement = `<button class="ipo-clean-btn primary" onclick="redirectToRegistrar('${allotUrl}', '${nameEsc}')" title="Check Allotment on Official Registrar Portal">Check Allotment ↗</button>`;
        } else if (isOpen) {
          actionElement = `<button class="ipo-clean-btn mark-applied-btn" onclick="quickMarkApplied('${nameEsc}', '${ipoSymbol}', ${lotSize}, '${priceBand}', '${allotUrl}')">+ Track / Applied</button>`;
        } else {
          actionElement = `<button class="ipo-clean-btn secondary" onclick="openIpoDetail('${encodeURIComponent(ipo.id || '')}', '${ipoSymbol}', '${nameEsc}', '${encodeURIComponent(gmpHtml)}')">View Prospectus</button>`;
        }

        if (app) {
          if (app.status === 'ALLOTTED') {
            statusChip = `<span class="ipo-allot-chip allotted">🎉 Allotted ${app.shares_allotted || ''} shares</span>`;
          } else if (app.status === 'NOT_ALLOTTED') {
            statusChip = `<span class="ipo-allot-chip not-allotted">Refund Initiated</span>`;
          } else if (app.status === 'APPLIED') {
            statusChip = `<span class="ipo-allot-chip applied">✓ Bid Tracked</span>`;
          }
        }

        return `
          <div class="ipo-row-card" onclick="openIpoDetail('${encodeURIComponent(ipo.id || '')}', '${ipoSymbol}', '${nameEsc}', '${encodeURIComponent(gmpHtml)}')">
            <!-- Col 1: Identity -->
            <div class="ipo-col-company">
              ${logo}
              <div class="ipo-company-meta">
                <div class="ipo-company-name" title="${ipo.name || ''}">${ipo.name || 'Unknown Issue'}</div>
                <div class="ipo-company-sub">
                  <span class="ipo-type-pill ${isSme ? 'sme' : 'mainboard'}">${typeText.toUpperCase()}</span>
                  <span>${dateRange}</span>
                  ${statusChip}
                </div>
              </div>
            </div>

            <!-- Col 2: Price Band / Issue Price -->
            <div class="ipo-col-stat">
              <span class="ipo-stat-label">Price Band</span>
              <span class="ipo-stat-val">${ipo.price_band || (ipo.issue_price ? '₹' + ipo.issue_price : 'TBA')}</span>
              ${ipo.lot_size && ipo.lot_size !== '-' ? `<span class="ipo-stat-sub">Lot: ${ipo.lot_size} shares</span>` : ''}
            </div>

            <!-- Col 3: Subscription -->
            <div class="ipo-col-stat">
              <span class="ipo-stat-label">${isListed ? 'Total Sub' : (isOpen ? 'Subscription' : 'Status')}</span>
              ${isOpen && ipo.sub_total && ipo.sub_total !== '-'
                ? `<span class="sub-pill">${ipo.sub_total}</span>`
                : `<span class="ipo-stat-val" style="font-size: 12px;color:#94A3B8;">${ipo.sub_total || (isOpen ? '-' : 'Upcoming')}</span>`
              }
            </div>

            <!-- Col 4: GMP or Return -->
            <div class="ipo-col-stat">
              <span class="ipo-stat-label">${isListed ? 'Listing Gain' : 'GMP Premium'}</span>
              ${gmpHtml}
            </div>

            <!-- Col 5: Action -->
            <div style="display:flex;gap:8px;align-items:center;justify-content:flex-end;">
              ${actionElement}
            </div>
          </div>`;
      }

      function renderIpoList(section, ipos) {
        const capSec = section.charAt(0).toUpperCase() + section.slice(1);
        const listWrap = document.getElementById('ipoList' + capSec);
        const emptyBox = document.getElementById('ipo' + capSec + 'Empty');
        if (!listWrap) return;

        if (section === _currentIpoSection) {
          updateIpoBoardCounts(ipos);
        }

        if (!ipos || ipos.length === 0) {
          listWrap.innerHTML = '';
          if (emptyBox) emptyBox.style.display = 'block';
          return;
        }
        if (emptyBox) emptyBox.style.display = 'none';

        const mainList = ipos.filter(i => !(i.type || i.exchange || '').toUpperCase().includes('SME'));
        const smeList = ipos.filter(i => (i.type || i.exchange || '').toUpperCase().includes('SME'));

        if (_currentIpoBoard === 'mainboard') {
          if (mainList.length === 0) {
            listWrap.innerHTML = '<div class="ipo-empty-clean">No Mainboard IPOs found in this category.</div>';
          } else {
            listWrap.innerHTML = mainList.map(ipo => renderSingleIpoCard(ipo, section)).join('');
          }
          return;
        }

        if (_currentIpoBoard === 'sme') {
          if (smeList.length === 0) {
            listWrap.innerHTML = '<div class="ipo-empty-clean">No SME IPOs found in this category.</div>';
          } else {
            listWrap.innerHTML = smeList.map(ipo => renderSingleIpoCard(ipo, section)).join('');
          }
          return;
        }

        // Default 'all': Display structured sections if both categories exist
        if (mainList.length > 0 && smeList.length > 0) {
          const mainHtml = mainList.map(ipo => renderSingleIpoCard(ipo, section)).join('');
          const smeHtml = smeList.map(ipo => renderSingleIpoCard(ipo, section)).join('');

          listWrap.innerHTML = `
            <div class="ipo-subgroup-header">
              <div class="ipo-subgroup-title">
                <span>🏢 Mainboard Issues</span>
                <span class="ipo-subgroup-badge mainboard">${mainList.length}</span>
              </div>
              <span class="ipo-subgroup-desc">Min retail lot ~₹14,000–₹15,000 • Regular NSE &amp; BSE</span>
            </div>
            <div class="ipo-subgroup-cards">${mainHtml}</div>

            <div class="ipo-subgroup-header" style="margin-top:24px;">
              <div class="ipo-subgroup-title">
                <span>🚀 SME Board Issues</span>
                <span class="ipo-subgroup-badge sme">${smeList.length}</span>
              </div>
              <span class="ipo-subgroup-desc">Lot size ~₹1 Lakh+ • BSE SME &amp; NSE Emerge</span>
            </div>
            <div class="ipo-subgroup-cards">${smeHtml}</div>
          `;
        } else {
          listWrap.innerHTML = ipos.map(ipo => renderSingleIpoCard(ipo, section)).join('');
        }
      }

      window.switchIpoSection = function (section) {
        try {
          _currentIpoSection = section;
          const capSec = section.charAt(0).toUpperCase() + section.slice(1);
          const targetId = 'ipoSection' + capSec;

          document.querySelectorAll('.ipo-seg-btn').forEach(function(btn) {
            const fn = btn.getAttribute('onclick') || '';
            btn.classList.toggle('active', fn.indexOf("'" + section + "'") !== -1);
          });

          document.querySelectorAll('.ipo-section').forEach(function(s) {
            if (s.id === targetId) {
              s.classList.add('active');
            } else {
              s.classList.remove('active');
            }
          });

          if (section === 'myApps') {
            renderMyIpoApplications();
          } else if (window._cachedIpoData && window._cachedIpoData[section]) {
            updateIpoBoardCounts(window._cachedIpoData[section]);
            renderIpoList(section, window._cachedIpoData[section]);
          }
        } catch (err) {
          console.error('switchIpoSection error:', err);
        }
      };
// =========================================================
      //  IPO MODAL DETAIL & CATEGORY DISTRIBUTION HANDLERS
      // =========================================================
      let _currentDetailData = null;

      window.openIpoDetail = async function (searchId, symbol, baseName, gmpHtml) {
        const modal = document.getElementById('ipoDetailModal');
        if (!modal) return;

        // Reset to first tab
        switchModalTab('sub');
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';

        const loading = document.getElementById('ipoModalLoading');
        const panels = document.querySelectorAll('.ipo-tab-panel');
        if (loading) {
          loading.style.display = 'flex';
          loading.innerHTML = `<div class="ipo-spinner"></div><p>Fetching full category quotas, subscription rates &amp; financial history...</p>`;
        }
        panels.forEach(p => p.style.display = 'none');

        // Set basic header info immediately
        document.getElementById('ipoModalTitle').textContent = baseName || symbol || 'IPO Details';
        document.getElementById('ipoModalType').textContent = 'IPO Details';
        document.getElementById('ipoModalSector').textContent = 'General Equities';
        
        const gmpBadge = document.getElementById('ipoModalGmpBadge');
        if (gmpBadge) {
          if (gmpHtml && gmpHtml.trim()) {
            gmpBadge.innerHTML = gmpHtml;
            gmpBadge.style.display = 'inline-flex';
          } else {
            gmpBadge.style.display = 'none';
          }
        }

        try {
          const url = `/api/ipo-detail?id=${encodeURIComponent(searchId || '')}&symbol=${encodeURIComponent(symbol || '')}&name=${encodeURIComponent(baseName || '')}`;
          const res = await fetch(url);
          if (!res.ok) throw new Error('Server returned ' + res.status);
          const json = await res.json();
          if (json.error) throw new Error(json.error);

          const ipo = json.data;
          _currentDetailData = ipo;
          populateIpoModal(ipo);
          if (loading) loading.style.display = 'none';
          const activePanel = document.querySelector('.ipo-tab-panel.active');
          if (activePanel) activePanel.style.display = 'flex';
        } catch (e) {
          console.error('Modal detail fetch error:', e);
          if (loading) {
            loading.style.display = 'flex';
            loading.innerHTML = `<div style="text-align:center;padding:20px;">
              <p style="color: #EF4444;font-weight:600;margin-bottom:8px;">⚠️ Detailed prospectus data currently unavailable for this issue.</p>
              <p style="color:#94A3B8;font-size:13px;">Please check official exchange filings or retry.</p>
            </div>`;
          }
        }
      };

      window.closeIpoDetailModal = function (e) {
        if (e && e.target && e.target.id !== 'ipoDetailModal' && !e.target.classList.contains('ipo-modal-close-btn')) {
          return;
        }
        const modal = document.getElementById('ipoDetailModal');
        if (modal) modal.classList.remove('open');
        document.body.style.overflow = '';
      };

      window.switchModalTab = function (tabName) {
        document.querySelectorAll('.ipo-modal-tab-btn').forEach(btn => {
          btn.classList.toggle('active', (btn.getAttribute('onclick') || '').includes(`'${tabName}'`));
        });
        document.querySelectorAll('.ipo-tab-panel').forEach(p => {
          const isActive = p.id === 'ipoPanel' + tabName.charAt(0).toUpperCase() + tabName.slice(1);
          p.classList.toggle('active', isActive);
          p.style.display = isActive ? 'flex' : 'none';
        });
      };

      function populateIpoModal(ipo) {
        // 1. Header
        document.getElementById('ipoModalTitle').textContent = ipo.companyName || ipo.companyShortName || ipo.symbol;
        document.getElementById('ipoModalType').textContent = ipo.isSme ? 'SME IPO' : 'Mainboard IPO';
        document.getElementById('ipoModalSector').textContent = ipo.sector || 'Equities';

        const logoWrap = document.getElementById('ipoModalLogo');
        if (ipo.logoUrl) {
          logoWrap.innerHTML = `<img src="${ipo.logoUrl}" style="width:100%;height:100%;object-fit:contain;border-radius: 12px;" alt="" onerror="this.style.display='none'"/>`;
        } else {
          logoWrap.textContent = (ipo.companyName || 'I')[0];
        }

        // 2. Subscription Rates (QIB, NII, Retail, Total)
        const subWrap = document.getElementById('ipoModalSubList');
        const subRates = ipo.subscriptionRates || [];
        let totalSubRate = '-';

        if (subRates.length) {
          subWrap.innerHTML = subRates.map(r => {
            const isTotal = (r.category || '').toUpperCase() === 'TOTAL';
            if (isTotal) totalSubRate = `${r.subscriptionRate}x Subscribed`;
            const rateNum = parseFloat(r.subscriptionRate) || 0;
            const pctFill = Math.min(100, Math.max(5, rateNum * 12));
            const isHot = rateNum >= 10;
            return `
              <div class="sub-rate-row">
                <div class="sub-rate-header">
                  <span>${r.categoryName || r.category}</span>
                  <span style="color:${isHot ? '#F59E0B' : '#A78BFA'};font-weight:700;">${r.subscriptionRate != null ? r.subscriptionRate + 'x' : '-'}</span>
                </div>
                <div class="sub-progress-track">
                  <div class="sub-progress-fill ${isHot ? 'high' : ''}" style="width: ${pctFill}%;"></div>
                </div>
              </div>`;
          }).join('');
        } else {
          subWrap.innerHTML = '<div style="color: #94A3B8;font-size:13px;padding:8px 0;">Live category subscription will appear once bidding starts.</div>';
        }
        document.getElementById('ipoModalTotalSub').textContent = totalSubRate;

        // 3. Category Quotas & Application Limits
        const catTable = document.getElementById('ipoModalCategoryRows');
        const categories = ipo.categories || [];
        if (categories.length) {
          catTable.innerHTML = categories.map(c => {
            const minShares = c.minBidQuantity || c.lotSize || '-';
            const priceStr = c.minPrice && c.maxPrice ? `₹${c.minPrice} - ₹${c.maxPrice}` : (ipo.minPrice && ipo.maxPrice ? `₹${ipo.minPrice} - ₹${ipo.maxPrice}` : 'TBA');
            return `
              <tr>
                <td><strong>${c.categoryLabel || c.category}</strong><br><small style="color: #94A3B8;">${c.categorySubText || ''}</small></td>
                <td>${c.lotSize || ipo.lotSize || '-'} shares</td>
                <td>${minShares} shares</td>
                <td>${priceStr}</td>
                <td>${c.categorySubText ? c.categorySubText.replace('Apply ', '') : '-'}</td>
              </tr>`;
          }).join('');
        } else {
          catTable.innerHTML = '<tr><td colspan="5" style="color: #94A3B8;text-align:center;padding:12px;">Category quota details will be updated shortly from DRHP.</td></tr>';
        }

        // 4. Issue Essentials Grid
        const essGrid = document.getElementById('ipoModalEssentialsGrid');
        essGrid.innerHTML = `
          <div class="essential-card">
            <span class="essential-label">Price Band</span>
            <span class="essential-value">${ipo.minPrice && ipo.maxPrice ? '₹' + ipo.minPrice + ' to ₹' + ipo.maxPrice : 'TBA'}</span>
          </div>
          <div class="essential-card">
            <span class="essential-label">Lot Size</span>
            <span class="essential-value">${ipo.lotSize ? ipo.lotSize + ' Shares' : '-'}</span>
          </div>
          <div class="essential-card">
            <span class="essential-label">Total Issue Size</span>
            <span class="essential-value">${ipo.issueSize || 'TBA'}</span>
          </div>
          <div class="essential-card">
            <span class="essential-label">Face Value</span>
            <span class="essential-value">₹${ipo.faceValue || '10'} / share</span>
          </div>
        `;

        // 5. Timeline
        const timelineWrap = document.getElementById('ipoModalTimeline');
        timelineWrap.innerHTML = `
          <div class="timeline-step"><span>Bidding Starts</span><strong>${ipo.startDate || 'TBA'}</strong></div>
          <div class="timeline-step"><span>Bidding Closes</span><strong>${ipo.endDate || 'TBA'}</strong></div>
          <div class="timeline-step"><span>Basis of Allotment</span><strong>${ipo.allotmentDate || 'TBA'}</strong></div>
          <div class="timeline-step"><span>Expected Listing Date</span><strong>${ipo.listingDate || 'TBA'}</strong></div>
        `;

        // 6. About & Financials
        const aboutComp = ipo.aboutCompany || {};
        document.getElementById('ipoModalAbout').textContent = aboutComp.aboutCompany || 'Company profile and business model details filed in the official DRHP prospectus.';
        document.getElementById('ipoModalManagement').textContent = aboutComp.managingDirector ? `Key Executive: ${aboutComp.managingDirector} • Founded: ${aboutComp.yearFounded || '-'}` : '';

        // Financials Table
        const finTable = document.getElementById('ipoModalFinancialsTable');
        const financials = ipo.financials || [];
        if (financials.length) {
          document.getElementById('ipoModalFinancialsCard').style.display = 'block';
          let years = [];
          financials.forEach(f => {
            if (f.yearly) {
              Object.keys(f.yearly).forEach(y => { if (!years.includes(y)) years.push(y); });
            }
          });
          years.sort();

          let finHtml = `<thead><tr><th>Metric</th>${years.map(y => `<th>FY ${y}</th>`).join('')}</tr></thead><tbody>`;
          financials.forEach(f => {
            finHtml += `<tr><td><strong>${f.title}</strong></td>`;
            years.forEach(y => {
              const val = (f.yearly || {})[y];
              finHtml += `<td>${val != null ? '₹' + Number(val).toFixed(2) + ' Cr' : '-'}</td>`;
            });
            finHtml += `</tr>`;
          });
          finHtml += `</tbody>`;
          finTable.innerHTML = finHtml;
        } else {
          document.getElementById('ipoModalFinancialsCard').style.display = 'none';
        }

        // Pros / Cons
        const pcWrap = document.getElementById('ipoModalProsCons');
        let pcHtml = '';
        if (ipo.pros && ipo.pros.length) {
          pcHtml += `<div class="sub-breakdown-card"><div class="sub-card-title" style="color: #10B981;">Key Strengths (Pros)</div><ul style="margin:0;padding-left:18px;font-size:13px;color: #94A3B8;line-height:1.5;">${ipo.pros.map(p => `<li style="margin-bottom:6px;">${p}</li>`).join('')}</ul></div>`;
        }
        if (ipo.cons && ipo.cons.length) {
          pcHtml += `<div class="sub-breakdown-card"><div class="sub-card-title" style="color: #EF4444;">Key Risks (Cons)</div><ul style="margin:0;padding-left:18px;font-size:13px;color: #94A3B8;line-height:1.5;">${ipo.cons.map(c => `<li style="margin-bottom:6px;">${c}</li>`).join('')}</ul></div>`;
        }
        pcWrap.innerHTML = pcHtml;

        // 7. Footer Registrar & Allotment Link
        document.getElementById('ipoModalRegistrarInfo').innerHTML = ipo.registrar ? `Registrar: <strong>${ipo.registrar}</strong>` : '';
        const allotBtn = document.getElementById('ipoModalAllotBtn');
        allotBtn.href = ipo.rtaLink || 'https://linkintime.co.in/MIPO/Ipoallotment.html';

        const drhpBtn = document.getElementById('ipoModalDrhpBtn');
        if (ipo.documentUrl) {
          drhpBtn.href = ipo.documentUrl;
          drhpBtn.style.display = 'inline-flex';
        } else {
          drhpBtn.style.display = 'none';
        }
      }

      // IPO Row Card Event Delegation (Safe & robust click handling)
      document.addEventListener('click', function (e) {
        const card = e.target.closest('.ipo-row-card');
        if (card && !e.target.closest('a') && !e.target.closest('button')) {
          const searchId = card.getAttribute('data-search-id') || '';
          const symbol = card.getAttribute('data-symbol') || '';
          const name = decodeURIComponent(card.getAttribute('data-name') || '');
          const gmpEl = card.querySelector('.ipo-clean-gmp');
          const gmpHtml = gmpEl ? gmpEl.innerHTML : '';
          if (window.openIpoDetail) {
            window.openIpoDetail(searchId, symbol, name, gmpHtml);
          }
        }
      });

      // =========================================================
      //  MENU BAR & DRAWER NAVIGATION LOGIC
      // =========================================================
      function wireMenuDrawer() {
        const sidebar = document.getElementById('sidebar');
        const backdrop = document.getElementById('sidebarBackdrop');
        const menuBtn = document.getElementById('topbarMenuBtn');
        const closeBtn = document.getElementById('sidebarCloseBtn');

        function openDrawer() {
          if (sidebar) sidebar.classList.add('open');
          if (backdrop) backdrop.classList.add('active');
          document.body.style.overflow = 'hidden';
        }

        function closeDrawer() {
          if (sidebar) sidebar.classList.remove('open');
          if (backdrop) backdrop.classList.remove('active');
          document.body.style.overflow = '';
        }

        if (menuBtn) menuBtn.addEventListener('click', (e) => { e.stopPropagation(); openDrawer(); });
        if (closeBtn) closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeDrawer(); });
        if (backdrop) backdrop.addEventListener('click', closeDrawer);

        // Auto close drawer when any navigation tab is clicked
        document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
          item.addEventListener('click', () => {
            closeDrawer();
          });
        });
      }

      // =========================================================
      //  PORTFOLIO EXPORT ENGINE (CSV & PDF PRINT GENERATOR)
      // =========================================================

      window.exportPortfolioCSV = function () {
        if (!state.holdings || !state.holdings.length) {
          toast('Portfolio is empty. Add holdings first.');
          return;
        }

        const now = new Date();
        const dateStr = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

        let csv = 'PORTFOLIO TRACKER - INVESTMENT VALUATION STATEMENT\n';
        csv += `Account:,"${currentUser ? currentUser.email : 'User'}"\n`;
        csv += `Generated On:,"${dateStr}"\n\n`;

        // CSV Header
        csv += 'Stock Symbol,Yahoo Ticker,Asset Class,Quantity,Buy Price (INR),Invested Amount (INR),CMP (INR),Current Value (INR),Unrealized P&L (INR),Return (%)\n';

        let totalInvested = 0;
        let totalCurrent = 0;

        state.holdings.forEach(h => {
          const qty = Number(h.qty || h.shares) || 0;
          const buy = Number(h.buyPrice) || 0;
          const cmp = Number(h.price) || buy;
          const inv = qty * buy;
          const cur = qty * cmp;
          const gain = cur - inv;
          const gainPct = inv > 0 ? (gain / inv) * 100 : 0;

          totalInvested += inv;
          totalCurrent += cur;

          csv += `"${h.symbol}","${h.yahooSymbol || h.symbol}.NS","${h.assetClass || 'Equity'}",${qty},${buy.toFixed(2)},${inv.toFixed(2)},${cmp.toFixed(2)},${cur.toFixed(2)},${gain.toFixed(2)},${gainPct.toFixed(2)}%\n`;
        });

        const totalGain = totalCurrent - totalInvested;
        const totalGainPct = totalInvested > 0 ? (totalGain / totalInvested) * 100 : 0;

        csv += `\n"TOTAL PORTFOLIO","","","","","${totalInvested.toFixed(2)}","","${totalCurrent.toFixed(2)}","${totalGain.toFixed(2)}","${totalGainPct.toFixed(2)}%"\n`;

        // Download CSV Blob
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `Portfolio_Report_${dateStr.replace(/\s+/g, '_')}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast('✅ Portfolio CSV report downloaded successfully!');
      };

      window.exportPortfolioPDF = function () {
        if (!state.holdings || !state.holdings.length) {
          toast('Portfolio is empty. Add holdings first.');
          return;
        }

        const now = new Date();
        const dateFormatted = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' + now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

        document.getElementById('printUserEmail').textContent = currentUser ? currentUser.email : 'Investor';
        document.getElementById('printGeneratedDate').textContent = dateFormatted;

        let totalInvested = 0;
        let totalCurrent = 0;

        const rowsHtml = state.holdings.map(h => {
          const qty = Number(h.qty || h.shares) || 0;
          const buy = Number(h.buyPrice) || 0;
          const cmp = Number(h.price) || buy;
          const inv = qty * buy;
          const cur = qty * cmp;
          const gain = cur - inv;
          const gainPct = inv > 0 ? (gain / inv) * 100 : 0;

          totalInvested += inv;
          totalCurrent += cur;

          return `
            <tr>
              <td><strong>${h.symbol}</strong> <small style="color: #64748B;">(${h.yahooSymbol || h.symbol})</small></td>
              <td>${qty}</td>
              <td>₹${buy.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              <td>₹${inv.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              <td>₹${cmp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              <td>₹${cur.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              <td style="color:${gain >= 0 ? '#10B981' : '#EF4444'};font-weight:700;">${gain >= 0 ? '+' : ''}₹${gain.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              <td style="color:${gain >= 0 ? '#10B981' : '#EF4444'};font-weight:700;">${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(2)}%</td>
            </tr>`;
        }).join('');

        const totalGain = totalCurrent - totalInvested;
        const totalGainPct = totalInvested > 0 ? (totalGain / totalInvested) * 100 : 0;

        document.getElementById('printNetWorth').textContent = '₹' + totalCurrent.toLocaleString('en-IN', { minimumFractionDigits: 2 });
        document.getElementById('printInvested').textContent = '₹' + totalInvested.toLocaleString('en-IN', { minimumFractionDigits: 2 });
        document.getElementById('printGain').textContent = (totalGain >= 0 ? '+' : '') + '₹' + totalGain.toLocaleString('en-IN', { minimumFractionDigits: 2 });
        document.getElementById('printGainPct').textContent = (totalGainPct >= 0 ? '+' : '') + totalGainPct.toFixed(2) + '%';

        const totalRowHtml = `
          <tr class="total-row">
            <td><strong>TOTAL SUMMARY</strong></td>
            <td>-</td>
            <td>-</td>
            <td>₹${totalInvested.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            <td>-</td>
            <td>₹${totalCurrent.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            <td style="color:${totalGain >= 0 ? '#10B981' : '#EF4444'};font-weight:800;">${totalGain >= 0 ? '+' : ''}₹${totalGain.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            <td style="color:${totalGain >= 0 ? '#10B981' : '#EF4444'};font-weight:800;">${totalGainPct >= 0 ? '+' : ''}${totalGainPct.toFixed(2)}%</td>
          </tr>`;

        document.getElementById('printTableBody').innerHTML = rowsHtml + totalRowHtml;

        // Trigger native browser print / save as PDF
        window.print();
      };

  // Direct TradingView web URL generator & chart opener
  function buildTvWebUrl(symbol, exchange) {
    var ex = (exchange || 'NSE').toUpperCase().trim();
    var sym = (symbol || '').toUpperCase().trim();
    sym = sym.replace(/\.NS$/, '').replace(/\.BO$/, '');
    if (ex === 'MCX') {
      if (sym === 'GOLD' || sym.indexOf('GOLD') === 0) return 'https://in.tradingview.com/chart/?symbol=MCX:GOLD1!';
      if (sym === 'SILVER' || sym.indexOf('SILVER') === 0) return 'https://in.tradingview.com/chart/?symbol=MCX:SILVER1!';
      if (sym === 'CRUDEOIL' || sym.indexOf('CRUDE') >= 0) return 'https://in.tradingview.com/chart/?symbol=MCX:CRUDEOIL1!';
      if (sym === 'COPPER') return 'https://in.tradingview.com/chart/?symbol=MCX:COPPER1!';
      if (sym === 'ALUMINIUM') return 'https://in.tradingview.com/chart/?symbol=MCX:ALUMINIUM1!';
      if (sym === 'ZINC') return 'https://in.tradingview.com/chart/?symbol=MCX:ZINC1!';
      if (sym === 'LEAD') return 'https://in.tradingview.com/chart/?symbol=MCX:LEAD1!';
      if (sym === 'NICKEL') return 'https://in.tradingview.com/chart/?symbol=MCX:NICKEL1!';
      if (sym.indexOf('GAS') >= 0) return 'https://in.tradingview.com/chart/?symbol=MCX:NATURALGAS1!';
      return 'https://in.tradingview.com/chart/?symbol=MCX:' + sym + '1!';
    }
    if (ex === 'BSE' || ex === 'BO') return 'https://in.tradingview.com/chart/?symbol=BSE:' + sym;
    return 'https://in.tradingview.com/chart/?symbol=NSE:' + sym;
  }

  function openChartModal(holdingId) {
    var holdings = (window.state && window.state.holdings) || [];
    var h = null;
    for (var i = 0; i < holdings.length; i++) {
      if (String(holdings[i].id) === String(holdingId)) { h = holdings[i]; break; }
    }
    if (!h) return;
    var tvUrl = buildTvWebUrl(h.symbol, h.exchange);
    window.open(tvUrl, '_blank', 'noopener,noreferrer');
  }
  window.openChartModal = openChartModal;
  window.closeChartModal = function() {};

      init();
    })();
