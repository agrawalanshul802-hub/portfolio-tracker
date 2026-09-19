// js/analytics.js
// ─── AI CHAT & REPORTS ───────────────────────────────────────────────────────
// AI PromptBar component (sends questions to /api/ask-ai),
// Reports & Account modal (valuation statement, export).
// Chart.js calls for allocation pie and performance line charts
// are within the portfolio.js stats renderer above.
// Depends on: js/state.js, js/portfolio.js
"use strict";

      /* -------------------------------------------------------------
         REACT BITS PROMPTBAR COMPONENT (Vanilla JS Controller)
         ------------------------------------------------------------- */
      let promptBarState = {
        selectedModel: { key: 'groq', name: 'Groq Llama 3.3', tag: 'Fast', desc: 'Ultra-low latency inference' },
        models: [
          { key: 'groq', name: 'Groq Llama 3.3', tag: 'Fast', desc: 'Ultra-low latency inference' },
          { key: 'local', name: 'Local Engine', tag: 'Offline', desc: 'Rules-based offline analyzer' }
        ],
        effortLevels: ['Low', 'Medium', 'High', 'Extra', 'Max'],
        effortIndex: 1, // 'Medium'
        chips: [], // { key, name }
        activeMenu: null, // 'sources' | 'model' | 'effort' | 'commands' | null
        isBusy: false,
        abortController: null,
        sparksAnimId: null,
        sparksParticles: []
      };

      function updatePromptBarSendState() {
        const input = document.getElementById('aiInput');
        const sendBtn = document.getElementById('aiSendBtn');
        const path = document.getElementById('pbSendPath');
        if (!sendBtn || !path) return;

        if (promptBarState.isBusy) {
          sendBtn.disabled = false;
          sendBtn.setAttribute('data-busy', '');
          sendBtn.removeAttribute('data-armed');
          sendBtn.setAttribute('aria-label', 'Stop generation');
          sendBtn.title = 'Stop generation';
          path.setAttribute('d', 'M7 7 H17 V17 H7 Z'); // Stop square
        } else {
          sendBtn.removeAttribute('data-busy');
          sendBtn.setAttribute('aria-label', 'Send prompt');
          sendBtn.title = 'Send prompt';
          path.setAttribute('d', 'M12 4.5 L18.5 11 L14.25 11 L14.25 19.5 L9.75 19.5 L9.75 11 L5.5 11 Z'); // Up arrow
          const hasContent = (input && input.value.trim().length > 0) || promptBarState.chips.length > 0;
          if (hasContent) {
            sendBtn.disabled = false;
            sendBtn.setAttribute('data-armed', '');
          } else {
            sendBtn.disabled = true;
            sendBtn.removeAttribute('data-armed');
          }
        }
      }

      window.autoResizePromptBar = autoResizePromptBar;
      window.updatePromptBarSendState = updatePromptBarSendState;
      function autoResizePromptBar() {
        const input = document.getElementById('aiInput');
        if (!input) return;
        input.style.height = 'auto';
        const h = Math.min(Math.max(input.scrollHeight, 22), 110);
        input.style.height = h + 'px';
        updatePromptBarSendState();
      }

      function renderPromptBarChips() {
        const wrap = document.getElementById('promptBarChips');
        if (!wrap) return;
        wrap.innerHTML = '';
        promptBarState.chips.forEach((chip, idx) => {
          const el = document.createElement('div');
          el.className = 'prompt-bar__chip';
          el.innerHTML = `
            <span class="prompt-bar__chip-name">${chip.name}</span>
            <button type="button" class="prompt-bar__chip-x" aria-label="Remove ${chip.name}">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          `;
          el.querySelector('.prompt-bar__chip-x').addEventListener('click', (e) => {
            e.stopPropagation();
            promptBarState.chips.splice(idx, 1);
            renderPromptBarChips();
            updatePromptBarSendState();
          });
          wrap.appendChild(el);
        });
        updatePromptBarSendState();
      }

      function closePromptBarMenu() {
        const menu = document.getElementById('promptBarMenu');
        const modelBtn = document.getElementById('pbModelBtn');
        const effortBtn = document.getElementById('pbEffortBtn');
        const plusBtn = document.getElementById('pbPlusBtn');
        if (menu) {
          menu.style.display = 'none';
          menu.innerHTML = '';
          menu.removeAttribute('data-kind');
        }
        if (modelBtn) modelBtn.removeAttribute('data-on');
        if (effortBtn) effortBtn.removeAttribute('data-on');
        if (plusBtn) plusBtn.removeAttribute('data-on');
        promptBarState.activeMenu = null;
      }

      function openPromptBarMenu(type) {
        const menu = document.getElementById('promptBarMenu');
        const modelBtn = document.getElementById('pbModelBtn');
        const effortBtn = document.getElementById('pbEffortBtn');
        const plusBtn = document.getElementById('pbPlusBtn');
        if (!menu) return;

        if (promptBarState.activeMenu === type) {
          closePromptBarMenu();
          return;
        }

        closePromptBarMenu();
        promptBarState.activeMenu = type;
        menu.style.display = 'block';
        menu.setAttribute('data-kind', type);

        if (type === 'model') {
          if (modelBtn) modelBtn.setAttribute('data-on', '');
          let html = '';
          promptBarState.models.forEach(m => {
            const isSel = m.key === promptBarState.selectedModel.key;
            html += `
              <button type="button" class="prompt-bar__row ${isSel ? 'active' : ''}" data-model-key="${m.key}">
                <span class="prompt-bar__row-icon">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></svg>
                </span>
                <span class="prompt-bar__row-name">${m.name}</span>
                <span class="prompt-bar__row-desc">${m.desc}</span>
                <span class="prompt-bar__row-tag">${m.tag}</span>
                <span class="prompt-bar__row-check" ${isSel ? 'data-on' : ''}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                </span>
              </button>
            `;
          });
          menu.innerHTML = html;
          menu.querySelectorAll('[data-model-key]').forEach(btn => {
            btn.addEventListener('click', () => {
              const k = btn.getAttribute('data-model-key');
              const found = promptBarState.models.find(x => x.key === k);
              if (found) {
                promptBarState.selectedModel = found;
                const lbl = document.getElementById('pbModelLabel');
                if (lbl) lbl.textContent = found.name;
              }
              closePromptBarMenu();
            });
          });
        } else if (type === 'effort') {
          if (effortBtn) effortBtn.setAttribute('data-on', '');
          const curLvl = promptBarState.effortLevels[promptBarState.effortIndex];
          const pct = (promptBarState.effortIndex / (promptBarState.effortLevels.length - 1)) * 100;
          menu.innerHTML = `
            <div class="prompt-bar__effort-head">
              <span class="prompt-bar__effort-title">Reasoning Effort:</span>
              <span class="prompt-bar__effort-level" id="pbEffortPopupLevel">${curLvl}</span>
            </div>
            <div class="prompt-bar__effort-track" id="pbEffortTrack" style="--pb-effort-fill: ${pct}%; --pb-effort-x: ${pct}%;">
              <div class="prompt-bar__effort-fill" id="pbEffortFill"></div>
              <div class="prompt-bar__effort-dot" style="left: 0%;"></div>
              <div class="prompt-bar__effort-dot" style="left: 25%;"></div>
              <div class="prompt-bar__effort-dot" style="left: 50%;"></div>
              <div class="prompt-bar__effort-dot" style="left: 75%;"></div>
              <div class="prompt-bar__effort-dot" style="left: 100%;"></div>
              <div class="prompt-bar__effort-thumb" id="pbEffortThumb"></div>
            </div>
            <div class="prompt-bar__effort-ends">
              <span>Fast</span>
              <span>Thorough (Max)</span>
            </div>
          `;

          const track = document.getElementById('pbEffortTrack');
          function updateEffortByX(clientX) {
            const rect = track.getBoundingClientRect();
            const rawPct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            const nearestIdx = Math.round(rawPct * (promptBarState.effortLevels.length - 1));
            setPromptBarEffort(nearestIdx);
          }

          if (track) {
            let isDragging = false;
            track.addEventListener('pointerdown', (e) => {
              isDragging = true;
              track.setPointerCapture(e.pointerId);
              updateEffortByX(e.clientX);
            });
            track.addEventListener('pointermove', (e) => {
              if (isDragging) updateEffortByX(e.clientX);
            });
            track.addEventListener('pointerup', (e) => {
              isDragging = false;
              try { track.releasePointerCapture(e.pointerId); } catch(err){}
            });
          }
        } else if (type === 'sources') {
          if (plusBtn) plusBtn.setAttribute('data-on', '');
          let html = '';
          const holdings = (window.state && window.state.holdings) || [];
          
          html += `
            <button type="button" class="prompt-bar__row" data-add-chip="ALL" data-name="All Portfolio Holdings">
              <span class="prompt-bar__row-icon">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>
              </span>
              <span class="prompt-bar__row-name">Entire Portfolio</span>
              <span class="prompt-bar__row-desc">${holdings.length} Active Positions Context</span>
              <span class="prompt-bar__row-tag">Full</span>
            </button>
          `;

          holdings.slice(0, 10).forEach(h => {
            const sym = h.symbol || 'STOCK';
            html += `
              <button type="button" class="prompt-bar__row" data-add-chip="${sym}" data-name="@${sym}">
                <span class="prompt-bar__row-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                </span>
                <span class="prompt-bar__row-name">@${sym}</span>
                <span class="prompt-bar__row-desc">${h.company || h.assetClass || 'Holding'}</span>
                <span class="prompt-bar__row-tag">Asset</span>
              </button>
            `;
          });

          menu.innerHTML = html;
          menu.querySelectorAll('[data-add-chip]').forEach(btn => {
            btn.addEventListener('click', () => {
              const k = btn.getAttribute('data-add-chip');
              const n = btn.getAttribute('data-name');
              if (!promptBarState.chips.some(c => c.key === k)) {
                promptBarState.chips.push({ key: k, name: n });
                renderPromptBarChips();
              }
              closePromptBarMenu();
            });
          });
        } else if (type === 'commands') {
          let html = `
            <button type="button" class="prompt-bar__row" data-cmd="/summarize">
              <span class="prompt-bar__row-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg></span>
              <span class="prompt-bar__row-name">/summarize</span>
              <span class="prompt-bar__row-desc">Executive summary of portfolio health & P&L</span>
            </button>
            <button type="button" class="prompt-bar__row" data-cmd="/risk">
              <span class="prompt-bar__row-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>
              <span class="prompt-bar__row-name">/risk</span>
              <span class="prompt-bar__row-desc">Analyze portfolio concentration and downside risks</span>
            </button>
            <button type="button" class="prompt-bar__row" data-cmd="/tax">
              <span class="prompt-bar__row-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg></span>
              <span class="prompt-bar__row-name">/tax</span>
              <span class="prompt-bar__row-desc">Calculate estimated capital gains & tax liabilities</span>
            </button>
            <button type="button" class="prompt-bar__row" data-cmd="/diversify">
              <span class="prompt-bar__row-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg></span>
              <span class="prompt-bar__row-name">/diversify</span>
              <span class="prompt-bar__row-desc">Asset allocation, equity vs commodity balance</span>
            </button>
            <button type="button" class="prompt-bar__row" data-cmd="/explain">
              <span class="prompt-bar__row-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>
              <span class="prompt-bar__row-name">/explain</span>
              <span class="prompt-bar__row-desc">Explain key financial metrics (P/E, beta, alpha)</span>
            </button>
          `;
          menu.innerHTML = html;
          menu.querySelectorAll('[data-cmd]').forEach(btn => {
            btn.addEventListener('click', () => {
              const cmd = btn.getAttribute('data-cmd');
              const input = document.getElementById('aiInput');
              if (input) {
                input.value = cmd + ' ';
                input.focus();
                autoResizePromptBar();
              }
              closePromptBarMenu();
            });
          });
        }
      }

      window.setPromptBarEffort = setPromptBarEffort;
      window.closePromptBarMenu = closePromptBarMenu;
      window.openPromptBarMenu = openPromptBarMenu;
      function setPromptBarEffort(idx) {
        promptBarState.effortIndex = Math.max(0, Math.min(promptBarState.effortLevels.length - 1, idx));
        const lvl = promptBarState.effortLevels[promptBarState.effortIndex];
        const pct = (promptBarState.effortIndex / (promptBarState.effortLevels.length - 1)) * 100;
        
        const label = document.getElementById('pbEffortLabel');
        if (label) label.textContent = lvl;

        const popLvl = document.getElementById('pbEffortPopupLevel');
        if (popLvl) popLvl.textContent = lvl;

        const track = document.getElementById('pbEffortTrack');
        if (track) {
          track.style.setProperty('--pb-effort-fill', pct + '%');
          track.style.setProperty('--pb-effort-x', pct + '%');
        }

        const bar = document.getElementById('aiPromptBar');
        const field = document.getElementById('promptBarField');
        const effortBtn = document.getElementById('pbEffortBtn');

        if (lvl === 'Max') {
          if (bar) bar.setAttribute('data-max', '');
          if (field) field.setAttribute('data-max', '');
          if (effortBtn) effortBtn.setAttribute('data-max', '');
          startPromptBarSparks();
        } else {
          if (bar) bar.removeAttribute('data-max');
          if (field) field.removeAttribute('data-max');
          if (effortBtn) effortBtn.removeAttribute('data-max');
          stopPromptBarSparks();
        }
      }

      function startPromptBarSparks() {
        const canvas = document.getElementById('promptBarSparks');
        const field = document.getElementById('promptBarField');
        if (!canvas || !field) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        function resize() {
          const r = field.getBoundingClientRect();
          canvas.width = r.width;
          canvas.height = r.height;
        }
        resize();

        promptBarState.sparksParticles = [];
        for (let i = 0; i < 24; i++) {
          promptBarState.sparksParticles.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            vx: (Math.random() - 0.5) * 0.4,
            vy: -0.3 - Math.random() * 0.5,
            size: 1 + Math.random() * 2.2,
            alpha: 0.2 + Math.random() * 0.7,
            life: Math.random() * 100,
            maxLife: 60 + Math.random() * 80
          });
        }

        function loop() {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          promptBarState.sparksParticles.forEach(p => {
            p.x += p.vx;
            p.y += p.vy;
            p.life++;
            if (p.life > p.maxLife || p.y < -5) {
              p.x = Math.random() * canvas.width;
              p.y = canvas.height + 2;
              p.life = 0;
            }
            const curAlpha = Math.sin((p.life / p.maxLife) * Math.PI) * p.alpha;
            ctx.fillStyle = `rgba(179, 157, 255, ${curAlpha})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
          });
          promptBarState.sparksAnimId = requestAnimationFrame(loop);
        }

        if (promptBarState.sparksAnimId) cancelAnimationFrame(promptBarState.sparksAnimId);
        loop();
      }

      function stopPromptBarSparks() {
        if (promptBarState.sparksAnimId) {
          cancelAnimationFrame(promptBarState.sparksAnimId);
          promptBarState.sparksAnimId = null;
        }
        const canvas = document.getElementById('promptBarSparks');
        if (canvas) {
          const ctx = canvas.getContext('2d');
          if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      }

      function initPromptBar() {
        const input = document.getElementById('aiInput');
        const sendBtn = document.getElementById('aiSendBtn');
        const modelBtn = document.getElementById('pbModelBtn');
        const effortBtn = document.getElementById('pbEffortBtn');
        const plusBtn = document.getElementById('pbPlusBtn');
        const micBtn = document.getElementById('pbMicBtn');

        if (!input || !sendBtn) return;

        // Auto-resize on input
        input.addEventListener('input', () => {
          autoResizePromptBar();
          const val = input.value;
          if (val === '/' || val.endsWith(' /')) {
            openPromptBarMenu('commands');
          } else if (val === '@' || val.endsWith(' @')) {
            openPromptBarMenu('sources');
          }
        });

        // Keydown handler
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (promptBarState.isBusy) {
              stopAiGeneration();
            } else if (input.value.trim() || promptBarState.chips.length > 0) {
              sendAiMessage();
            }
          } else if (e.key === 'Escape') {
            closePromptBarMenu();
          }
        });

        // Send Button
        sendBtn.addEventListener('click', () => {
          if (promptBarState.isBusy) {
            stopAiGeneration();
          } else {
            sendAiMessage();
          }
        });

        // Model Switcher Button
        if (modelBtn) {
          modelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openPromptBarMenu('model');
          });
        }

        // Effort Slider Button
        if (effortBtn) {
          effortBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openPromptBarMenu('effort');
          });
        }

        // Plus / Add Sources Button
        if (plusBtn) {
          plusBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openPromptBarMenu('sources');
          });
        }

        // Mic Button (Speech Recognition)
        if (micBtn) {
          const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
          let recognition = null;
          let isListening = false;

          if (SpeechRec) {
            recognition = new SpeechRec();
            recognition.continuous = false;
            recognition.interimResults = false;
            recognition.lang = 'en-US';

            recognition.onstart = () => {
              isListening = true;
              micBtn.setAttribute('data-on', '');
              micBtn.title = 'Listening... Speak now';
              if (typeof toast === 'function') toast('🎙️ Listening... Speak your investment query.');
            };

            recognition.onresult = (evt) => {
              const transcript = evt.results[0][0].transcript;
              if (transcript) {
                input.value = (input.value ? input.value + ' ' : '') + transcript;
                autoResizePromptBar();
              }
            };

            recognition.onerror = () => {
              isListening = false;
              micBtn.removeAttribute('data-on');
              micBtn.title = 'Voice dictation';
            };

            recognition.onend = () => {
              isListening = false;
              micBtn.removeAttribute('data-on');
              micBtn.title = 'Voice dictation';
            };

            micBtn.addEventListener('click', () => {
              if (isListening) {
                recognition.stop();
              } else {
                try { recognition.start(); } catch (err) { console.warn(err); }
              }
            });
          } else {
            micBtn.addEventListener('click', () => {
              if (typeof toast === 'function') {
                toast('Speech recognition not supported in this browser. Please type your query.', 'info');
              }
            });
          }
        }

        // Click outside closes popover menu
        document.addEventListener('click', (e) => {
          const bar = document.getElementById('aiPromptBar');
          if (bar && !bar.contains(e.target)) {
            closePromptBarMenu();
          }
        });

        // Initialize state
        setPromptBarEffort(1); // Medium
        updatePromptBarSendState();
      }

      function stopAiGeneration() {
        if (promptBarState.abortController) {
          promptBarState.abortController.abort();
          promptBarState.abortController = null;
        }
        promptBarState.isBusy = false;
        updatePromptBarSendState();
        const chatBox = document.getElementById('aiMessages');
        if (chatBox) {
          const stopMsg = document.createElement('div');
          stopMsg.className = 'ai-message system';
          stopMsg.textContent = '⏹️ Generation stopped.';
          chatBox.appendChild(stopMsg);
          chatBox.scrollTop = chatBox.scrollHeight;
        }
      }

      window.sendAiSuggestion = function (text) {
        const input = document.getElementById('aiInput');
        if (input) {
          input.value = text;
          autoResizePromptBar();
          sendAiMessage();
        }
      };

      window.sendAiMessage = async function () {
        const input = document.getElementById('aiInput');
        if (!input) return;
        let msg = input.value.trim();

        // Include chip context if present
        if (promptBarState.chips.length > 0) {
          const chipContext = promptBarState.chips.map(c => c.name).join(', ');
          msg = (msg ? `${msg}\n\n[Context: ${chipContext}]` : `Please analyze: ${chipContext}`);
        }

        if (!msg) return;

        // Reset input and clear chips
        input.value = '';
        promptBarState.chips = [];
        renderPromptBarChips();
        autoResizePromptBar();

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
        promptBarState.abortController = controller;
        promptBarState.isBusy = true;
        updatePromptBarSendState();

        const timeoutId = setTimeout(() => controller.abort(), 25000);

        try {
          const res = await fetch('/api/ask-ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: msg,
              holdings: state.holdings,
              model: promptBarState.selectedModel.key,
              effort: promptBarState.effortLevels[promptBarState.effortIndex].toLowerCase()
            }),
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
              statusBadge.textContent = prov.includes('groq') ? '⚡ Live Groq AI' : (prov.includes('gemini') ? '✨ Gemini AI' : 'Live AI Engine');
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
          if (e.name !== 'AbortError' || !chatBox.querySelector('.ai-message.system:last-child')?.textContent?.includes('stopped')) {
            const errMsg = document.createElement('div');
            errMsg.className = 'ai-message system';
            errMsg.textContent = e.name === 'AbortError' ? 'AI request timed out or was cancelled.' : `Failed to connect: ${e.message}`;
            chatBox.appendChild(errMsg);
            chatBox.scrollTop = chatBox.scrollHeight;
          }
        } finally {
          promptBarState.isBusy = false;
          promptBarState.abortController = null;
          updatePromptBarSendState();
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

