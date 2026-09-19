// js/main.js
// ─── APP WIRING & AUTHENTICATION ─────────────────────────────────────────────
// Wires all button click listeners, tab navigation, sidebar links.
// Handles the auth flow: login form, register form, Google OAuth,
// session checking on page load, and the init() startup function.
// init() is called at the very bottom of this file.
// Depends on: ALL other js/ files (load this last among core files)
"use strict";

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

