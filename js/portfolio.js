// js/portfolio.js
// ─── PORTFOLIO CORE ───────────────────────────────────────────────────────────
// Live price fetching, toast notifications, number animations,
// stats rendering (Total Value, P&L, % Return), holdings table,
// Stocks/MCX switcher, price refresh logic, Add/Edit/Delete stock modal.
// Depends on: js/state.js
"use strict";

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
        // Deduplicate list by symbol/id to eliminate duplicate table & stats entries
        const uniqueMap = new Map();
        list.forEach(h => {
          const k = (h.symbol || '') + '::' + (h.exchange || 'NSE');
          if (!uniqueMap.has(k)) uniqueMap.set(k, h);
        });
        const dedupedList = Array.from(uniqueMap.values());
        const sorted = [...dedupedList].sort((a, b) => b.gainPct - a.gainPct);
        const topGainer = sorted[0];
        const topLoser = sorted.length > 1 && sorted[sorted.length - 1].symbol !== topGainer.symbol
          ? sorted[sorted.length - 1]
          : null;

        let statsHtml = `<div class="mini-stat">Top gainer &nbsp;<b>${topGainer.symbol}</b>&nbsp;<span class="pct ${topGainer.gainPct >= 0 ? 'pos' : 'neg'}">${fmtPct(topGainer.gainPct)}</span></div>`;
        if (topLoser) {
          statsHtml += `<div class="mini-stat">Top loser &nbsp;<b>${topLoser.symbol}</b>&nbsp;<span class="pct ${topLoser.gainPct >= 0 ? 'pos' : 'neg'}">${fmtPct(topLoser.gainPct)}</span></div>`;
        } else if (sorted.length > 0) {
          statsHtml += `<div class="mini-stat">Holdings count &nbsp;<b>${sorted.length}</b>&nbsp;<span class="pct pos">Active</span></div>`;
        }
        row.innerHTML = statsHtml;
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
        let rawList = allHoldings();
        // Issue 4: Strict deduplication by symbol and ID
        const seenKeys = new Set();
        let list = rawList.filter(h => {
          const k = (h.id || '') + '::' + (h.symbol || '').trim().toUpperCase();
          if (seenKeys.has(k)) return false;
          seenKeys.add(k);
          return true;
        });
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
              <th>${state.portfolioSection === 'mcx' ? 'Commodity' : (state.portfolioSection === 'stocks' ? 'Stock (NSE/BSE)' : 'Instrument')}</th><th>Buy Price</th><th>Qty</th><th>Buy Value</th><th>CMP</th><th>Current Value</th><th>% Gain</th><th>Gain ₹</th><th style="text-align:right; font-weight:700; letter-spacing:0.08em; text-transform:uppercase;">ACTIONS</th>
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
                        <button type="button" class="row-action-icon chart-link" data-chart="${h.id}" aria-label="View Live Chart" title="View Live Chart">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                        </button>
                        <button type="button" class="row-action-icon sell-link" data-sell="${h.id}" aria-label="Record Sale" title="Record Sale">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
                        </button>
                        <button type="button" class="row-action-icon edit-link" data-edit="${h.id}" aria-label="Edit Holding" title="Edit Holding">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button type="button" class="row-action-icon danger" data-del="${h.id}" aria-label="Delete Holding" title="Delete Holding">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                        </button>
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
        // Issue 6: guard so repeated auto-refresh doesn't flood the toast stack
        if (!window._livePriceToastPending) {
          window._livePriceToastPending = true;
          toast('⚡ Live prices updated!');
          setTimeout(() => { window._livePriceToastPending = false; }, 5000);
        }
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
                riskColor = '#F9FAFB'; // Issue 8: neutral white - violet had no semantic meaning here
              } else if (equityPct > 40) {
                riskRating = 'Optimal Multi-Asset Mix';
                riskColor = '#10B981'; // Green
              }
            }

            // Diversification Health level
            let divStatus = 'Optimal';
            let divBadgeBg = 'rgba(16, 185, 129, 0.1)'; /* Issue 8: green = good, not arbitrary violet */
            let divTextColor = '#10B981';
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
                  ticks: {
                    color: '#94A3B8',
                    font: { family: 'Inter', size: 10 },
                    // Issue 9: horizontal labels - no 45deg tilt
                    maxRotation: 0,
                    minRotation: 0,
                    // Issue 4: truncate long ALL-CAPS symbols for readability
                    callback: function(val) {
                      const lbl = this.getLabelForValue(val);
                      return lbl && lbl.length > 7 ? lbl.slice(0, 7) + '…' : lbl;
                    }
                  }
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

      window.switchTab = switchTab;
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

