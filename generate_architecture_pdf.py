import os
import sys
from reportlab.lib.pagesizes import A4
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether, HRFlowable
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.pdfgen import canvas

class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super(NumberedCanvas, self).__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_decorations(num_pages)
            super(NumberedCanvas, self).showPage()
        super(NumberedCanvas, self).save()

    def draw_page_decorations(self, page_count):
        self.saveState()
        self.setFont("Helvetica", 8)
        self.setFillColor(colors.HexColor("#64748B"))
        
        # Header (pages > 1)
        if self._pageNumber > 1:
            self.drawString(40, 805, "PORTFOLIO TRACKER — Architecture, File Inventory & Usage Analysis")
            self.drawRightString(555, 805, "System & Codebase Guide")
            self.setStrokeColor(colors.HexColor("#E2E8F0"))
            self.setLineWidth(0.6)
            self.line(40, 798, 555, 798)
            
        # Footer (all pages)
        self.setStrokeColor(colors.HexColor("#E2E8F0"))
        self.setLineWidth(0.6)
        self.line(40, 42, 555, 42)
        self.drawString(40, 30, "Portfolio Tracker Architecture Manual • TYBSc Computer Science • University of Mumbai")
        self.drawRightString(555, 30, f"Page {self._pageNumber} of {max(1, page_count)}")
        self.restoreState()

def build_pdf(filename="PROJECT_FILE_ARCHITECTURE_GUIDE.pdf"):
    doc = SimpleDocTemplate(
        filename,
        pagesize=A4,
        leftMargin=40,
        rightMargin=40,
        topMargin=50,
        bottomMargin=50
    )

    styles = getSampleStyleSheet()

    # Custom styles
    c_primary = colors.HexColor("#0F172A")    # Slate 900
    c_accent  = colors.HexColor("#0D9488")    # Teal 600
    c_purple  = colors.HexColor("#6366F1")    # Indigo 500
    c_dark    = colors.HexColor("#1E293B")    # Slate 800
    c_text    = colors.HexColor("#334155")    # Slate 700
    c_dim     = colors.HexColor("#64748B")    # Slate 500
    c_light   = colors.HexColor("#F8FAFC")    # Slate 50
    c_border  = colors.HexColor("#E2E8F0")    # Slate 200

    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=24,
        leading=28,
        textColor=c_primary,
        spaceAfter=6
    )

    subtitle_style = ParagraphStyle(
        'DocSubtitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=12,
        leading=16,
        textColor=c_accent,
        spaceAfter=15
    )

    meta_style = ParagraphStyle(
        'DocMeta',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9,
        leading=13,
        textColor=c_dim
    )

    h1_style = ParagraphStyle(
        'SectionH1',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=14,
        leading=18,
        textColor=c_primary,
        spaceBefore=14,
        spaceAfter=8,
        keepWithNext=True
    )

    h2_style = ParagraphStyle(
        'SectionH2',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=11,
        leading=15,
        textColor=c_purple,
        spaceBefore=10,
        spaceAfter=4,
        keepWithNext=True
    )

    body_style = ParagraphStyle(
        'DocBody',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9,
        leading=13.5,
        textColor=c_text,
        spaceAfter=6
    )

    bullet_style = ParagraphStyle(
        'DocBullet',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8.5,
        leading=12.5,
        textColor=c_text,
        leftIndent=15,
        firstLineIndent=-10,
        spaceAfter=3
    )

    badge_active = ParagraphStyle(
        'BadgeActive',
        fontName='Helvetica-Bold',
        fontSize=8,
        leading=10,
        textColor=colors.HexColor("#065F46"),
        alignment=1
    )

    badge_ref = ParagraphStyle(
        'BadgeRef',
        fontName='Helvetica-Bold',
        fontSize=8,
        leading=10,
        textColor=colors.HexColor("#92400E"),
        alignment=1
    )

    badge_modular = ParagraphStyle(
        'BadgeMod',
        fontName='Helvetica-Bold',
        fontSize=8,
        leading=10,
        textColor=colors.HexColor("#1E40AF"),
        alignment=1
    )

    th_style = ParagraphStyle(
        'TableHeader',
        fontName='Helvetica-Bold',
        fontSize=8.5,
        leading=11,
        textColor=colors.white,
        alignment=0
    )

    td_style = ParagraphStyle(
        'TableCell',
        fontName='Helvetica',
        fontSize=8,
        leading=11,
        textColor=c_text,
        alignment=0
    )

    td_bold = ParagraphStyle(
        'TableCellBold',
        fontName='Helvetica-Bold',
        fontSize=8,
        leading=11,
        textColor=c_primary,
        alignment=0
    )

    callout_style = ParagraphStyle(
        'CalloutText',
        fontName='Helvetica-Oblique',
        fontSize=8.5,
        leading=12.5,
        textColor=c_dark
    )

    story = []

    # ─── HEADER / COVER BLOCK ───────────────────────────────────────────────
    story.append(Spacer(1, 10))
    story.append(Paragraph("PORTFOLIO TRACKER", title_style))
    story.append(Paragraph("Comprehensive Codebase Architecture, File Directory Inventory & Usage Analysis", subtitle_style))
    
    meta_text = """
    <b>Project Title:</b> Real-Time Multi-Asset Wealth & Portfolio Tracker &bull; <b>Academic Year:</b> 2025–2026<br/>
    <b>Author:</b> Mr. Anshul Ramesh Agrawal (TYBSc Computer Science &bull; Seat No: 01 &bull; Roll No: 01)<br/>
    <b>Institution:</b> Vidyavardhini's A.V. College, University of Mumbai &bull; <b>Guide:</b> Prof. Shrimathi Narayanan<br/>
    <b>Stack:</b> Python 3.12 (Flask REST API), Supabase PostgreSQL, Vanilla JS/CSS3, Chart.js, Render Cloud
    """
    story.append(Paragraph(meta_text, meta_style))
    story.append(Spacer(1, 10))
    story.append(HRFlowable(width="100%", thickness=1.5, color=c_accent, spaceBefore=4, spaceAfter=14))

    # ─── SECTION 1: EXECUTIVE SUMMARY ──────────────────────────────────────
    story.append(Paragraph("1. Executive Summary & Purpose of This Document", h1_style))
    story.append(Paragraph(
        "This document provides an exhaustive, component-by-component explanation of all files and directories "
        "comprising the <b>Portfolio Tracker</b> project. It clarifies <b>where</b> each file is used, <b>why</b> it was designed, "
        "and its exact <b>operational status</b> (actively used at runtime, retained as modular architecture source code, "
        "used for deployment/infrastructure, or preserved as academic verification and documentation artifacts).",
        body_style
    ))
    story.append(Paragraph(
        "A critical architectural insight of this codebase is the <b>dual-layer presentation and modular design</b>: "
        "The project provides both clean, decoupled modules (in <code>routes/</code> for backend and <code>js/</code> for frontend) "
        "and consolidated/production-bundled single-file builds (<code>PORTFOLIO TRACKER.html</code> with inline scripts and <code>app.js</code>). "
        "This ensures maximum maintainability for development while guaranteeing resilient zero-dependency browser execution.",
        body_style
    ))
    story.append(Spacer(1, 8))

    # ─── SECTION 2: MASTER FILE TAXONOMY TABLE ─────────────────────────────
    story.append(Paragraph("2. Master File Taxonomy & Usage Status", h1_style))
    story.append(Paragraph(
        "The table below categorizes every file in the project, detailing its operational role and whether it is executed actively at runtime or maintained for reference/architecture.",
        body_style
    ))

    # Table columns: File / Path (130), Role / Category (90), Purpose & Usage Summary (215), Status (80) = 515 total width
    table_data = [
        [
            Paragraph("<b>File / Directory</b>", th_style),
            Paragraph("<b>Layer / Category</b>", th_style),
            Paragraph("<b>Where & Why It Is Used</b>", th_style),
            Paragraph("<b>Operational Status</b>", th_style)
        ],
        [
            Paragraph("<code>PORTFOLIO TRACKER.html</code>", td_bold),
            Paragraph("Frontend UI / SPA", td_style),
            Paragraph("Main single-page web app served by Flask at <code>/</code>. Contains all HTML markup, views, modals, charts container, and standalone inline script.", td_style),
            Paragraph("ACTIVE<br/>(Primary Runtime)", badge_active)
        ],
        [
            Paragraph("<code>style.css</code>", td_bold),
            Paragraph("Design System", td_style),
            Paragraph("Complete application styling (~290 KB): dark-theme glassmorphism, responsive CSS grid/flexbox, custom animations, print media rules for PDF reports.", td_style),
            Paragraph("ACTIVE<br/>(Primary Runtime)", badge_active)
        ],
        [
            Paragraph("<code>app.py</code>", td_bold),
            Paragraph("Backend Entry Point", td_style),
            Paragraph("Flask application entry point. Loads <code>env</code>, configures secure sessions, registers 5 route blueprints, serves static assets, and hosts <code>/admin</code>.", td_style),
            Paragraph("ACTIVE<br/>(Primary Runtime)", badge_active)
        ],
        [
            Paragraph("<code>app.js</code>", td_bold),
            Paragraph("Frontend Reference", td_style),
            Paragraph("Monolithic bundled JavaScript file (~247 KB) containing unified client logic (storage, portfolio CRUD, analytics, charts, alerts, IPOs).", td_style),
            Paragraph("REFERENCE<br/>(Consolidated Source)", badge_ref)
        ],
        [
            Paragraph("<code>routes/</code> (6 files)", td_bold),
            Paragraph("Backend API Blueprints", td_style),
            Paragraph("Modular Flask blueprints separating backend concerns: <code>__init__.py</code>, <code>auth.py</code>, <code>holdings.py</code>, <code>prices.py</code>, <code>ipo.py</code>, <code>ai_copilot.py</code>.", td_style),
            Paragraph("ACTIVE<br/>(Modular Core)", badge_active)
        ],
        [
            Paragraph("<code>js/</code> (7 files)", td_bold),
            Paragraph("Frontend Modules", td_style),
            Paragraph("Clean modular frontend source scripts: <code>state.js</code>, <code>portfolio.js</code>, <code>analytics.js</code>, <code>main.js</code>, <code>effects.js</code>, <code>alerts.js</code>, <code>ipo.js</code>.", td_style),
            Paragraph("MODULAR SOURCE<br/>(Dev Architecture)", badge_modular)
        ],
        [
            Paragraph("<code>FINAL_PROJECT_REPORT.html</code>", td_bold),
            Paragraph("Academic Report", td_style),
            Paragraph("Interactive project report dashboard served at <code>/final-report</code> and <code>/project-report</code>. Houses StarUML diagrams, methodology, and test metrics.", td_style),
            Paragraph("ACTIVE<br/>(Report Route)", badge_active)
        ],
        [
            Paragraph("<code>FINAL_PROJECT_DOCUMENTATION.md</code>", td_bold),
            Paragraph("Documentation", td_style),
            Paragraph("Markdown academic project report submitted for University of Mumbai Semester VI (TYBSc CS, Paper USCSP605).", td_style),
            Paragraph("DOCUMENTATION<br/>(Academic Spec)", badge_ref)
        ],
        [
            Paragraph("<code>final docs.pdf</code>", td_bold),
            Paragraph("Academic Artifact", td_style),
            Paragraph("Compiled master documentation PDF submitted for university examination, external viva, and academic evaluation.", td_style),
            Paragraph("SUBMISSION ARTIFACT<br/>(Official PDF)", badge_ref)
        ],
        [
            Paragraph("<code>requirements.txt</code>", td_bold),
            Paragraph("Dependencies", td_style),
            Paragraph("Defines Python dependencies (Flask, Gunicorn, requests, python-dotenv, Supabase) for local environments and Render cloud builds.", td_style),
            Paragraph("ACTIVE<br/>(Build & Deploy)", badge_active)
        ],
        [
            Paragraph("<code>render.yaml</code> & <code>Procfile</code>", td_bold),
            Paragraph("DevOps / Deployment", td_style),
            Paragraph("Render Cloud Infrastructure-as-Code and Gunicorn WSGI startup configuration. Declares python version, build commands, and port bindings.", td_style),
            Paragraph("ACTIVE<br/>(Cloud Production)", badge_active)
        ],
        [
            Paragraph("<code>env</code>", td_bold),
            Paragraph("Configuration / Secrets", td_style),
            Paragraph("Local environment file containing API keys (Supabase, Groq, Google OAuth, SMTP). Loaded by <code>app.py</code> via <code>load_env_file()</code>.", td_style),
            Paragraph("ACTIVE<br/>(Local Config)", badge_active)
        ],
        [
            Paragraph("<code>Screenshots/</code> & <code>demo_results/</code>", td_bold),
            Paragraph("Verification Proof", td_style),
            Paragraph("Development test outputs, responsive UI captures, and 30/30 API test suite validation logs for viva and academic audit.", td_style),
            Paragraph("TEST ARTIFACTS<br/>(Audit Proof)", badge_ref)
        ],
        [
            Paragraph("<code>Logo & preview assets (.png)</code>", td_bold),
            Paragraph("Media & Branding", td_style),
            Paragraph("Visual assets: <code>logo.png</code>, <code>logo_icon.png</code> (favicon/header), and 5 high-res module preview cards used in reports and docs.", td_style),
            Paragraph("ACTIVE<br/>(Brand & Media)", badge_active)
        ],
        [
            Paragraph("<code>welcomed_users.json</code>", td_bold),
            Paragraph("Onboarding State", td_style),
            Paragraph("Persistent JSON store of user emails that have received the onboarding welcome email to prevent duplicate dispatches upon reboot.", td_style),
            Paragraph("ACTIVE<br/>(Runtime State)", badge_active)
        ]
    ]

    t = Table(table_data, colWidths=[120, 95, 215, 85])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), c_primary),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('GRID', (0, 0), (-1, -1), 0.5, c_border),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, c_light]),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
    ]))
    story.append(t)
    story.append(Spacer(1, 14))

    # ─── SECTION 3: DEEP-DIVE BY COMPONENT LAYER ───────────────────────────
    story.append(PageBreak())
    story.append(Paragraph("3. Detailed File-by-File Analysis & Architectural Rationale", h1_style))
    story.append(Paragraph(
        "Below is an in-depth breakdown of each component layer, explaining exactly why each file was created, "
        "where it connects within the application lifecycle, and how the modules interact.",
        body_style
    ))

    # 3.1 Core Application & Presentation
    story.append(Paragraph("3.1 Core Web Presentation & Styling", h2_style))
    story.append(Paragraph(
        "&bull; <b><code>PORTFOLIO TRACKER.html</code> (Main Single Page Application):</b><br/>"
        "This is the heart of the user experience. It contains the complete semantic HTML5 structure for the application, "
        "including the dark-veil canvas background, hero landing section with live metric badges, authentication modals "
        "(login, sign-up, Google OAuth button), portfolio net worth dashboard, asset allocation donut charts, "
        "real-time holdings data table, trade execution modal (buy, sell, partial sell), IPO tracking tabs, and the AI Copilot chat drawer. "
        "<b>Where used:</b> Served automatically by <code>app.py</code> at the root route (<code>/</code>). It can also be opened standalone in any web browser.<br/>"
        "<b>Why used:</b> Delivering a responsive, zero-broker-credential interface where retail investors can track multi-asset wealth in Indian Rupees (₹).",
        bullet_style
    ))
    story.append(Paragraph(
        "&bull; <b><code>style.css</code> (Design System & Micro-Interactions):</b><br/>"
        "A 290 KB custom stylesheet implementing institutional-grade dark mode glassmorphism. "
        "It establishes the design tokens (HSL CSS variables, typography pairings of <i>JetBrains Mono</i> for financial figures "
        "and <i>Plus Jakarta Sans</i> for interfaces), responsive layouts (mobile, tablet, desktop), TradingView chart containers, "
        "badge color-coding (+ve emerald green, -ve rose red), custom scrollbars, and dedicated <code>@media print</code> rules "
        "that reformat the live dashboard into a clean, white-background valuation statement for client printing and PDF export.<br/>"
        "<b>Where used:</b> Linked directly in <code>PORTFOLIO TRACKER.html</code> and served statically by Flask.<br/>"
        "<b>Why used:</b> To provide a visually stunning, premium fintech aesthetic without relying on bulky CSS frameworks.",
        bullet_style
    ))
    story.append(Spacer(1, 8))

    # 3.2 Backend Modular Architecture (routes/)
    story.append(Paragraph("3.2 Backend Engine & Modular Blueprints (<code>routes/</code>)", h2_style))
    story.append(Paragraph(
        "The backend is developed with Python 3.12 and Flask. Rather than putting all endpoints in a single monolithic script, "
        "the logic is cleanly decoupled into <b>Flask Blueprints</b> within the <code>routes/</code> package:",
        body_style
    ))

    story.append(Paragraph(
        "&bull; <b><code>routes/__init__.py</code> (Shared Infrastructure & Database Factory):</b><br/>"
        "Initializes the Supabase PostgreSQL client (<code>create_client</code>) using environment variables. "
        "Establishes in-memory fallback caches (<code>_LOCAL_HOLDINGS_CACHE</code>, <code>_LOCAL_USER_PANS</code>, <code>_LOCAL_IPO_APPS</code>) "
        "to ensure 100% application uptime even during database cold-starts or network interruptions. "
        "Implements cryptographic security helpers: <code>hash_password()</code> using <b>PBKDF2-HMAC-SHA256</b> with 100,000 iterations "
        "and random 16-byte cryptographic salt, alongside constant-time <code>verify_password()</code>.<br/>"
        "<b>Where used:</b> Imported by all other route blueprints to share DB state and avoid circular dependencies.",
        bullet_style
    ))

    story.append(Paragraph(
        "&bull; <b><code>routes/auth.py</code> (Authentication & Authorization Blueprint):</b><br/>"
        "Handles user authentication and security flows. Endpoints: <code>/api/register</code> (account creation with salt/hash), "
        "<code>/api/login</code> (credential validation), <code>/api/logout</code>, <code>/api/user</code> (current session status), "
        "and <code>/api/google-auth</code> (Google OAuth 2.0 ID token verification via Google API certificates). "
        "Also triggers automated onboarding welcome emails via SMTP upon successful registration.<br/>"
        "<b>Where used:</b> Registered in <code>app.py</code> via <code>app.register_blueprint(auth_bp)</code>.",
        bullet_style
    ))

    story.append(Paragraph(
        "&bull; <b><code>routes/holdings.py</code> (Portfolio Holdings CRUD Blueprint):</b><br/>"
        "Manages user asset holdings across NSE, BSE, MCX, Mutual Funds, and US Equities. "
        "Provides REST endpoints: <code>GET /api/holdings</code> (retrieves user portfolio with computed gains), "
        "<code>POST /api/holdings</code> (adds or modifies an asset holding), and <code>DELETE /api/holdings/&lt;id&gt;</code> (removes an asset). "
        "Persists data directly to Supabase PostgreSQL with automated fallback to the local session cache.<br/>"
        "<b>Where used:</b> Registered in <code>app.py</code> via <code>app.register_blueprint(holdings_bp)</code>.",
        bullet_style
    ))

    story.append(Paragraph(
        "&bull; <b><code>routes/prices.py</code> (Real-Time Price & Market Data Engine):</b><br/>"
        "Resolves live Current Market Prices (CMP) and historical candle data. "
        "Features a multi-worker concurrent fetching engine that queries market quote providers with a 45-second in-memory cache. "
        "This caching mechanism drastically minimizes outbound latency (&lt; 2s response) and protects against external API rate-limiting.<br/>"
        "<b>Where used:</b> Registered in <code>app.py</code> via <code>app.register_blueprint(prices_bp)</code>.",
        bullet_style
    ))

    story.append(Paragraph(
        "&bull; <b><code>routes/ipo.py</code> (IPO Intelligence & Allotment Engine):</b><br/>"
        "Provides comprehensive Indian IPO tracking for both Mainboard and SME offerings. "
        "Delivers live bidding status, issue size, price band, opening/closing dates, and real-time Grey Market Premium (GMP). "
        "Includes a PAN-based allotment verification module that queries registrar endpoints or verified mock datasets.<br/>"
        "<b>Where used:</b> Registered in <code>app.py</code> via <code>app.register_blueprint(ipo_bp)</code>.",
        bullet_style
    ))

    story.append(Paragraph(
        "&bull; <b><code>routes/ai_copilot.py</code> (AI Assistant & Financial News Feed):</b><br/>"
        "Integrates LLM capabilities via Groq API (or intelligent rule-based financial models) to analyze portfolio health, "
        "diversification risk, and asset concentration. Also aggregates curated financial RSS news feeds tailored to Indian retail investors.<br/>"
        "<b>Where used:</b> Registered in <code>app.py</code> via <code>app.register_blueprint(ai_bp)</code>.",
        bullet_style
    ))
    story.append(Spacer(1, 8))

    # 3.3 Frontend Modular Architecture (js/) vs Consolidated app.js
    story.append(Paragraph("3.3 Frontend Modular Architecture (<code>js/</code>) vs. Monolithic <code>app.js</code>", h2_style))
    story.append(Paragraph(
        "A key design decision in this project is the coexistence of <b>clean modular source files</b> in <code>js/</code> "
        "alongside the <b>consolidated reference script</b> <code>app.js</code> and the inline script in <code>PORTFOLIO TRACKER.html</code>:",
        body_style
    ))

    story.append(Paragraph(
        "&bull; <b><code>js/state.js</code>:</b> Global state store managing user session, holdings cache, active tabs, and deterministic PRNG (<code>mulberry32</code>).<br/>"
        "&bull; <b><code>js/portfolio.js</code>:</b> Portfolio management logic: holdings table rendering, buy/sell calculations, P&L mathematics, CSV export, and TradingView chart launching.<br/>"
        "&bull; <b><code>js/analytics.js</code>:</b> Visual analytics engine configuring Chart.js donut charts (asset allocation) and line charts (net worth trajectory).<br/>"
        "&bull; <b><code>js/main.js</code>:</b> Application bootstrap, DOM event listeners, modal controllers, and search autocomplete.<br/>"
        "&bull; <b><code>js/effects.js</code>:</b> UI micro-interactions, GSAP smooth entrance animations, and Dark Veil canvas particle rendering.<br/>"
        "&bull; <b><code>js/alerts.js</code>:</b> Price target alerts, live notifications, and toast notification manager.<br/>"
        "&bull; <b><code>js/ipo.js</code>:</b> IPO listing rendering, filter tabs (Open, Upcoming, Closed), GMP calculation, and PAN allotment verification modal.<br/>"
        "&bull; <b><code>app.js</code> (Consolidated Reference):</b> Houses the entire unified client logic in a single file (~247 KB). "
        "Used as a consolidated development reference and offline backup.<br/>"
        "<b>Why both exist:</b> <code>js/</code> provides maintainable, decoupled code for developers, while <code>PORTFOLIO TRACKER.html</code> "
        "embeds the bundled script inline to allow users to double-click and run the app offline without CORS or module loader restrictions.",
        bullet_style
    ))
    story.append(Spacer(1, 8))

    # 3.4 Academic Documentation, DevOps & Configuration
    story.append(PageBreak())
    story.append(Paragraph("3.4 Academic Documentation, DevOps & Environment Configuration", h2_style))
    
    story.append(Paragraph(
        "&bull; <b><code>FINAL_PROJECT_REPORT.html</code>:</b> An interactive, web-based version of the complete academic project report. "
        "It showcases the project overview, literature survey, system analysis, StarUML diagrams (ER, Class, Sequence, Activity, Component, Deployment), "
        "test cases (30/30 passed), and references. Served dynamically by <code>app.py</code> at <code>/final-report</code> and <code>/project-report</code>.<br/>"
        "&bull; <b><code>FINAL_PROJECT_DOCUMENTATION.md</code>:</b> Markdown academic project specification formatted for University of Mumbai submission. "
        "Documents project metadata, objectives, technology stack, hardware/software prerequisites, and live production URLs.<br/>"
        "&bull; <b><code>final docs.pdf</code>:</b> The compiled, official project documentation PDF (3.39 MB) submitted for university grading and external viva evaluation.<br/>"
        "&bull; <b><code>requirements.txt</code>:</b> Python package manifest specifying pinned dependencies: <code>Flask&gt;=3.0.0</code>, "
        "<code>gunicorn&gt;=22.0.0</code>, <code>requests&gt;=2.31.0</code>, <code>python-dotenv&gt;=1.0.0</code>, and <code>supabase&gt;=2.0.0</code>.<br/>"
        "&bull; <b><code>render.yaml</code> & <code>Procfile</code>:</b> Production deployment configurations for Render Cloud. "
        "<code>render.yaml</code> defines the web service environment, Python 3.12 runtime, and environment variables. "
        "<code>Procfile</code> specifies the WSGI process startup command: <code>web: gunicorn app:app -b 0.0.0.0:$PORT</code>.<br/>"
        "&bull; <b><code>env</code>:</b> Local environment configuration holding sensitive API keys and secrets (Supabase DB URL, Anon Key, "
        "Google OAuth Client ID/Secret, Groq API Key, Flask Secret Key). Read safely by <code>app.py</code> via <code>load_env_file()</code>.<br/>"
        "&bull; <b><code>welcomed_users.json</code>:</b> Local runtime state tracking user emails that have already received onboarding welcome emails, "
        "preventing duplicate emails when the server restarts.<br/>"
        "&bull; <b><code>Screenshots/</code> & <code>demo_results/</code>:</b> Visual proof-of-work captures and test result logs demonstrating "
        "responsive design across devices, API test suite verification, and database sync for academic audit.<br/>"
        "&bull; <b>Logo & Preview Assets (<code>.png</code>):</b> <code>logo.png</code> & <code>logo_icon.png</code> provide application branding and favicon. "
        "Preview graphics (<code>portfolio-tracker-preview.png</code>, <code>holdings_preview.png</code>, <code>analytics_preview.png</code>, "
        "<code>news_preview.png</code>, <code>ai_preview.png</code>) are embedded in reports, documentation, and metadata cards.",
        bullet_style
    ))
    story.append(Spacer(1, 10))

    # ─── SECTION 4: CLARIFICATION: USED VS UNUSED VS REFERENCE ────────────
    story.append(Paragraph("4. Clarification: Used vs. Reference vs. Redundant Files", h1_style))
    story.append(Paragraph(
        "To clearly address the question of <i>'which files are used, why, and if any are not used'</i>, here is the exact operational status:",
        body_style
    ))

    analysis_box = [
        [
            Paragraph("<b>Component Category</b>", th_style),
            Paragraph("<b>Files Included</b>", th_style),
            Paragraph("<b>Exact Usage & Reason for Retention</b>", th_style)
        ],
        [
            Paragraph("<b>Actively Used at Runtime</b>", td_bold),
            Paragraph("<code>PORTFOLIO TRACKER.html</code><br/><code>style.css</code><br/><code>app.py</code><br/><code>routes/*.py</code><br/><code>env</code><br/><code>welcomed_users.json</code><br/><code>logo_icon.png</code>", td_style),
            Paragraph("These files are directly executed when the user runs <code>python app.py</code> or visits the live cloud application on Render. They handle the live web UI, REST API endpoints, database sync, and user sessions.", td_style)
        ],
        [
            Paragraph("<b>Active in Build / Cloud</b>", td_bold),
            Paragraph("<code>requirements.txt</code><br/><code>render.yaml</code><br/><code>Procfile</code>", td_style),
            Paragraph("Used during environment setup (pip) and cloud deployment on Render to build the container, install packages, and start the Gunicorn WSGI server.", td_style)
        ],
        [
            Paragraph("<b>Modular Source Architecture</b>", td_bold),
            Paragraph("<code>js/state.js</code><br/><code>js/portfolio.js</code><br/><code>js/analytics.js</code><br/><code>js/main.js</code><br/><code>js/effects.js</code><br/><code>js/alerts.js</code><br/><code>js/ipo.js</code>", td_style),
            Paragraph("These represent the clean, modularized frontend architecture. While the current HTML embeds the bundled script inline for standalone zero-server execution, these files are the active modular source code for future frontend builds and code maintenance.", td_style)
        ],
        [
            Paragraph("<b>Reference & Consolidated</b>", td_bold),
            Paragraph("<code>app.js</code>", td_style),
            Paragraph("This is the monolithic, consolidated reference file combining all frontend JavaScript. It is preserved for reference, debugging, and single-file scripting.", td_style)
        ],
        [
            Paragraph("<b>Academic Documentation & Verification</b>", td_bold),
            Paragraph("<code>FINAL_PROJECT_REPORT.html</code><br/><code>FINAL_PROJECT_DOCUMENTATION.md</code><br/><code>final docs.pdf</code><br/><code>Screenshots/</code><br/><code>demo_results/</code><br/>Preview <code>.png</code> files", td_style),
            Paragraph("These are academic deliverables and audit proof. They are not part of the runtime execution loop, but are required for University evaluation, project viva, documentation, and external examination.", td_style)
        ]
    ]

    t2 = Table(analysis_box, colWidths=[120, 140, 255])
    t2.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), c_dark),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('GRID', (0, 0), (-1, -1), 0.5, c_border),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, c_light]),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ]))
    story.append(t2)
    story.append(Spacer(1, 14))

    # ─── SECTION 5: ARCHITECTURAL FLOW & DATA LIFECYCLE ───────────────────
    story.append(Paragraph("5. End-to-End System Request Lifecycle", h1_style))
    story.append(Paragraph(
        "The following operational flow illustrates how the active files interact during a user session:",
        body_style
    ))

    flow_text = """
    <b>1. Client Access:</b> User opens the web app. Flask (<code>app.py</code>) serves <code>PORTFOLIO TRACKER.html</code> and <code>style.css</code>.<br/>
    <b>2. Authentication:</b> User signs in via email/password or Google OAuth. The request routes to <code>routes/auth.py</code>, which verifies credentials against Supabase PostgreSQL using PBKDF2-SHA256, sets an HTTP-only session cookie, and checks <code>welcomed_users.json</code>.<br/>
    <b>3. Portfolio Loading:</b> Frontend invokes <code>GET /api/holdings</code>. Handled by <code>routes/holdings.py</code>, which queries Supabase with fallback to in-memory cache.<br/>
    <b>4. Live Price Resolution:</b> Frontend calls <code>GET /api/prices</code>. <code>routes/prices.py</code> queries live market feeds via multi-threaded workers, caches quotes for 45s, and returns latest CMP.<br/>
    <b>5. Interactive Valuation:</b> Frontend (<code>analytics.js</code> / inline engine) calculates Day's Gain and Net Worth, updating Chart.js donut/line charts and rendering the holdings table.<br/>
    <b>6. Statement Generation:</b> User clicks 'Print Valuation Statement'. The custom <code>@media print</code> rules in <code>style.css</code> format the table into an institutional PDF report.
    """
    story.append(Paragraph(flow_text, callout_style))
    story.append(Spacer(1, 14))

    # ─── SECTION 6: CONCLUSION & MAINTENANCE RECOMMENDATIONS ─────────────
    story.append(Paragraph("6. Summary & Recommendations", h1_style))
    summary_p = """
    <b>Summary:</b> Every file in this directory serves a clear and defined purpose. No files are accidental clutter. 
    The active application runtime is driven by <code>app.py</code>, <code>PORTFOLIO TRACKER.html</code>, <code>style.css</code>, 
    and <code>routes/</code>. The modular scripts in <code>js/</code> represent high-quality frontend source code, while 
    <code>app.js</code> serves as the consolidated reference. The remaining files provide deployment automation, environment security, 
    and university-grade academic documentation.<br/><br/>
    <b>Recommendation:</b> Keep all files as structured. When performing future feature additions, update the modular files in 
    <code>routes/</code> for backend and <code>js/</code> for frontend to maintain clean separation of concerns.
    """
    story.append(Paragraph(summary_p, body_style))

    # Build document
    doc.build(story, canvasmaker=NumberedCanvas)
    print(f"Successfully generated PDF: {filename}")

if __name__ == '__main__':
    build_pdf()
