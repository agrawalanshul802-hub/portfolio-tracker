// js/effects.js
// ─── VISUAL EFFECTS & ANIMATIONS ─────────────────────────────────────────────
// Bottom action dock bar, ScrollFloat text animation,
// OrbitImages landing-page animation, DarkVeil WebGL CPPN background shader.
// These are purely visual — removing this file doesn't break core functionality.
// Depends on: js/state.js
"use strict";

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

      
