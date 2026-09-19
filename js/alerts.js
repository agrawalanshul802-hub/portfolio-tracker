// js/alerts.js
// ─── PRICE ALERT ENGINE ───────────────────────────────────────────────────────
// Groww/Zerodha-style price alert system.
// User sets a target price → engine polls live prices every 60 sec
// → fires browser notification when price crosses target.
// Depends on: js/state.js, js/portfolio.js
"use strict";

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
        try { initPromptBar(); } catch (e) { console.warn(e); }

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

