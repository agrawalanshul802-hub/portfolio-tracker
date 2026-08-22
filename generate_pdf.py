import os
import sys
import subprocess

# Auto-install reportlab if missing
try:
    import reportlab
except ImportError:
    print("ReportLab is not installed. Installing it now...")
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "reportlab"])
        import reportlab
        print("ReportLab successfully installed!")
    except Exception as e:
        print(f"Failed to install ReportLab automatically: {e}")
        print("Please run: pip install reportlab")
        sys.exit(1)

from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas

class NumberedCanvas(canvas.Canvas):
    """
    Two-pass canvas to dynamically compute and render total page counts
    in running footers.
    """
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_decorations(num_pages)
            super().showPage()
        super().save()

    def draw_page_decorations(self, page_count):
        self.saveState()
        
        # Suppress headers and footers on the cover page (Page 1)
        if self._pageNumber == 1:
            self.restoreState()
            return
            
        # Draw Running Header
        self.setFont("Helvetica-Bold", 8)
        self.setFillColor(colors.HexColor("#5B21B6"))
        self.drawString(54, 750, "PORTFOLIO TRACKER - SYSTEM REQUIREMENTS & DESIGN REPORT")
        self.setStrokeColor(colors.HexColor("#E5E7EB"))
        self.setLineWidth(0.5)
        self.line(54, 742, 558, 742)
        
        # Draw Running Footer
        self.setFont("Helvetica", 9)
        self.setFillColor(colors.HexColor("#4B5563"))
        page_str = f"Page {self._pageNumber} of {page_count}"
        self.drawRightString(558, 40, page_str)
        self.drawString(54, 40, "Confidential - Project Synopsis")
        
        self.restoreState()

def build_pdf(filename="requirements.pdf"):
    # Target page width = 612, height = 792 (Letter)
    # Margins: 0.75 in (54 pt)
    doc = SimpleDocTemplate(
        filename,
        pagesize=letter,
        leftMargin=54,
        rightMargin=54,
        topMargin=72,
        bottomMargin=72
    )

    styles = getSampleStyleSheet()
    
    # Custom Palette Styling
    primary_color = colors.HexColor("#5B21B6")
    text_color = colors.HexColor("#1F2937")
    muted_color = colors.HexColor("#4B5563")

    # Modify Default Styles
    styles['Normal'].textColor = text_color
    styles['Normal'].fontSize = 10
    styles['Normal'].leading = 14

    # Custom Header Styles
    title_style = ParagraphStyle(
        'CoverTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=26,
        leading=32,
        textColor=colors.HexColor("#111827"),
        alignment=1, # Center
        spaceAfter=15
    )
    
    subtitle_style = ParagraphStyle(
        'CoverSubtitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=13,
        leading=18,
        textColor=muted_color,
        alignment=1, # Center
        spaceAfter=50
    )

    h1_style = ParagraphStyle(
        'Header1',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=18,
        leading=22,
        textColor=primary_color,
        spaceBefore=22,
        spaceAfter=12,
        keepWithNext=True
    )

    h2_style = ParagraphStyle(
        'Header2',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=12,
        leading=16,
        textColor=colors.HexColor("#111827"),
        spaceBefore=14,
        spaceAfter=6,
        keepWithNext=True
    )

    bullet_style = ParagraphStyle(
        'BulletText',
        parent=styles['Normal'],
        leftIndent=20,
        firstLineIndent=-10,
        spaceAfter=6
    )

    cell_style = ParagraphStyle(
        'TableCell',
        parent=styles['Normal'],
        fontSize=9,
        leading=12
    )
    
    cell_header_style = ParagraphStyle(
        'TableHeaderCell',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=9,
        leading=12,
        textColor=colors.HexColor("#111827")
    )

    story = []

    # ================= COVER PAGE =================
    story.append(Spacer(1, 120))
    story.append(Paragraph("<b>P</b>", ParagraphStyle('Logo', parent=title_style, fontSize=64, leading=70, textColor=primary_color)))
    story.append(Spacer(1, 10))
    story.append(Paragraph("PROJECT SYNOPSIS &amp; DESIGN REPORT", title_style))
    story.append(Paragraph("Multi-Asset Portfolio Tracker &amp; Real-Time Analytics Dashboard", subtitle_style))
    story.append(Spacer(1, 100))
    
    meta_text = """
    <b>Subject:</b> Software Project Engineering &amp; Design<br/>
    <b>Date of Submission:</b> July 29, 2026<br/>
    <b>Author:</b> Software Development Team<br/>
    <b>Stack:</b> Flask Web Server, SQLite3 DB, JS (GSAP, Chart.js)
    """
    story.append(Paragraph(meta_text, ParagraphStyle('Meta', parent=styles['Normal'], alignment=1, fontSize=10, leading=16, textColor=muted_color)))
    story.append(PageBreak())

    # ================= 1. PROJECT SYNOPSIS =================
    story.append(Paragraph("1. Project Synopsis (Project Proposal)", h1_style))
    story.append(Paragraph(
        "In the modern personal finance landscape, retail investors face significant difficulties in managing "
        "their investments due to portfolio fragmentation. Individuals hold diversified assets across multiple "
        "brokerage platforms—including equity holdings, exchange-traded funds (ETFs), cash positions, and "
        "cryptocurrencies. Keeping track of consolidated net worth across separate accounts creates high "
        "administrative overhead, latency in risk assessment, and poor allocation visibility.",
        styles['Normal']
    ))
    story.append(Spacer(1, 8))
    story.append(Paragraph(
        "The <b>Proposed Multi-Asset Portfolio Tracker</b> solves these challenges by consolidating all assets "
        "into a single, high-performance web dashboard. The system automatically fetches and renders real-time "
        "valuations, calculates active yields (unrealized profit/loss, percentage gains), assesses overall "
        "portfolio concentration weights, and maps external market news feeds directly to user holdings.",
        styles['Normal']
    ))
    
    story.append(Paragraph("Key Objectives:", h2_style))
    story.append(Paragraph("&bull; <b>Data Consolidation:</b> Create a single database repository for user assets.", bullet_style))
    story.append(Paragraph("&bull; <b>Real-Time Sync:</b> Query Yahoo Finance and CoinGecko dynamically via custom backend proxy routes.", bullet_style))
    story.append(Paragraph("&bull; <b>Risk Assessment:</b> Highlight concentration risk metrics, top asset exposure percentages, and diversification ratings.", bullet_style))
    story.append(Paragraph("&bull; <b>Local AI Assistance:</b> Embed an AI Portfolio Analyst agent providing direct analytical feedback on holding structures.", bullet_style))

    # Existing vs Proposed System Table
    story.append(Spacer(1, 10))
    table_data = [
        [Paragraph("Metric", cell_header_style), Paragraph("Existing System", cell_header_style), Paragraph("Proposed System", cell_header_style)],
        [Paragraph("Net Worth tracking", cell_style), Paragraph("Manual copy-pasting across various brokerage sites.", cell_style), Paragraph("Unified SQL DB syncing all portfolios.", cell_style)],
        [Paragraph("Asset Updating", cell_style), Paragraph("Stale values, manual entries of end-of-day quotes.", cell_style), Paragraph("Real-time live synchronization (Yahoo/CoinGecko).", cell_style)],
        [Paragraph("CORS API blocks", cell_style), Paragraph("CORS blocks prevent querying external APIs directly.", cell_style), Paragraph("Flask-based proxy route rewrites and handles URLs.", cell_style)],
        [Paragraph("Analytics", cell_style), Paragraph("Static sheets lacking risk analysis warnings.", cell_style), Paragraph("Active risk profile grading and concentration metrics.", cell_style)]
    ]
    t = Table(table_data, colWidths=[100, 200, 200])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor("#F9FAFB")),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor("#E5E7EB")),
        ('PADDING', (0,0), (-1,-1), 8),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
    ]))
    story.append(t)
    story.append(PageBreak())

    # ================= 2. REQUIREMENT SPECIFICATION =================
    story.append(Paragraph("2. Requirement Specification", h1_style))
    
    story.append(Paragraph("Hardware Requirements:", h2_style))
    story.append(Paragraph("&bull; <b>CPU:</b> Dual-Core Processor 2.0 GHz or higher (Intel Core i3/i5/i7 or equivalent).", bullet_style))
    story.append(Paragraph("&bull; <b>RAM:</b> 4 GB minimum (8 GB recommended for fluid development).", bullet_style))
    story.append(Paragraph("&bull; <b>Disk Storage:</b> 250 MB of free hard drive space for packages and DB logs.", bullet_style))
    story.append(Paragraph("&bull; <b>Network Connection:</b> Active internet connection required for API price fetches.", bullet_style))
    
    story.append(Paragraph("Software Requirements:", h2_style))
    story.append(Paragraph("&bull; <b>Operating System:</b> Windows 10/11, macOS 10.15+, or Linux Ubuntu 20.04+.", bullet_style))
    story.append(Paragraph("&bull; <b>Runtime Environment:</b> Python 3.10+.", bullet_style))
    story.append(Paragraph("&bull; <b>Backend Web Framework:</b> Flask 3.0+.", bullet_style))
    story.append(Paragraph("&bull; <b>Database Engines:</b> SQLite3 (Relational, serverless database engine).", bullet_style))
    story.append(Paragraph("&bull; <b>Frontend Stack:</b> HTML5, CSS3, JavaScript (ES6).", bullet_style))
    story.append(Paragraph("&bull; <b>External Libraries:</b> Chart.js (for Canvas graphs) and GSAP (for UI stagger animations).", bullet_style))
    
    # ================= 3. FEASIBILITY STUDY =================
    story.append(Paragraph("3. Feasibility Study", h1_style))
    
    story.append(Paragraph("A. Technical Feasibility", h2_style))
    story.append(Paragraph(
        "The project is technically feasible. The implementation of custom proxy endpoints handles browser CORS blocks "
        "securely by routing queries through Python's built-in urllib module. Chart.js and GSAP are lightweight client-side "
        "scripts, ensuring zero performance hits. The serverless SQLite3 structure simplifies database maintenance.",
        styles['Normal']
    ))
    
    story.append(Paragraph("B. Economic Feasibility", h2_style))
    story.append(Paragraph(
        "The project relies entirely on open-source libraries, runtimes, and databases, resulting in zero development "
        "licensing costs. Furthermore, it accesses free public APIs (Yahoo Finance and CoinGecko), completely eliminating "
        "the need for expensive monthly financial data subscriptions. Operational deployment fits easily within free tiers.",
        styles['Normal']
    ))

    story.append(Paragraph("C. Organizational &amp; Cultural Feasibility", h2_style))
    story.append(Paragraph(
        "The app integrates smoothly into a user's daily financial workflows. It presents a clean, intuitive layout "
        "designed specifically for retail investors (supporting local formatting like INR currency notations and Indian "
        "market RSS feeds). It maintains complete user data privacy through local storage configurations.",
        styles['Normal']
    ))
    story.append(PageBreak())

    # ================= 4. EVENT TABLE =================
    story.append(Paragraph("4. Event Table", h1_style))
    story.append(Paragraph(
        "The application follows an event-driven flow where user interface interactions trigger backend routes "
        "and update state arrays. Below is a structured event model of the system:",
        styles['Normal']
    ))
    
    event_headers = ["Event Trigger", "Source", "Action / Process", "Output State"]
    event_data = [
        [Paragraph(h, cell_header_style) for h in event_headers],
        [Paragraph("Registration Form Submitted", cell_style), Paragraph("Auth Modal", cell_style), Paragraph("Hashes password; inserts record into USERS table.", cell_style), Paragraph("User registered; returns HTTP 200.", cell_style)],
        [Paragraph("Login Form Submitted", cell_style), Paragraph("Auth Modal", cell_style), Paragraph("Validates password hash; generates session cookie.", cell_style), Paragraph("Loads portfolio workspace view.", cell_style)],
        [Paragraph("Add/Edit Asset Form Submitted", cell_style), Paragraph("Holdings Modal", cell_style), Paragraph("Computes buy value; guesses initial price; saves in HOLDINGS.", cell_style), Paragraph("Recalculates totals; updates table UI.", cell_style)],
        [Paragraph("Refreshes Dashboard screen", cell_style), Paragraph("Browser event", cell_style), Paragraph("Fetches CoinGecko &amp; Yahoo Finance prices via /proxy/.", cell_style), Paragraph("Updates CMP; recalculates gains/losses.", cell_style)],
        [Paragraph("AI Chat Prompt sent", cell_style), Paragraph("Analyst Chat", cell_style), Paragraph("Prepares portfolio statistics; calls backend local AI agent.", cell_style), Paragraph("Appends analyst response to chat list.", cell_style)]
    ]
    
    et = Table(event_data, colWidths=[110, 80, 180, 130])
    et.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor("#F9FAFB")),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor("#E5E7EB")),
        ('PADDING', (0,0), (-1,-1), 6),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
    ]))
    story.append(et)
    story.append(Spacer(1, 20))

    # ================= 5. ER DIAGRAM DESCRIPTION =================
    story.append(Paragraph("5. Entity-Relationship (ER) Diagram", h1_style))
    story.append(Paragraph(
        "The relational database schema uses a streamlined relational structure built inside SQLite3. "
        "The diagram displays a one-to-many cardinality between Users and Holdings.",
        styles['Normal']
    ))
    
    schema_data = [
        [Paragraph("Entity", cell_header_style), Paragraph("Attributes &amp; Keys", cell_header_style), Paragraph("Relationship / Card.", cell_header_style)],
        [Paragraph("<b>USERS</b>", cell_style), Paragraph("🔑 email (PK)<br/># password_hash<br/># created_at", cell_style), Paragraph("One User can own 0 to many Holdings (1 : N)", cell_style)],
        [Paragraph("<b>HOLDINGS</b>", cell_style), Paragraph("🔑 id (PK)<br/>🔗 user_email (FK)<br/># symbol<br/># exchange<br/># name<br/># yahooSymbol<br/># assetClass<br/># qty<br/># buyPrice<br/># price", cell_style), Paragraph("Many Holdings link to a single registered User email.", cell_style)]
    ]
    st = Table(schema_data, colWidths=[100, 240, 160])
    st.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor("#F9FAFB")),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor("#E5E7EB")),
        ('PADDING', (0,0), (-1,-1), 8),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
    ]))
    story.append(st)
    story.append(PageBreak())

    # ================= 6. SYSTEM DESIGN DETAILS =================
    story.append(Paragraph("6. System Design Details (UML Models)", h1_style))
    
    story.append(Paragraph("A. Use Case Diagram", h2_style))
    story.append(Paragraph(
        "<b>Actor:</b> Registered Investor<br/>"
        "<b>Use Cases:</b><br/>"
        "&bull; <b>Manage Holdings:</b> Allows the user to add new asset purchases, edit quantities/buy prices, and record sales.<br/>"
        "&bull; <b>View Portfolio Analytics:</b> Renders Chart.js and list summaries of asset weights and risk ratings.<br/>"
        "&bull; <b>Aggregate Stock News:</b> Synchronizes RSS feeds to provide stock news based on portfolio symbols.<br/>"
        "&bull; <b>Query AI Analyst:</b> Evaluates portfolio holdings and answers investment strategy questions.",
        styles['Normal']
    ))
    
    story.append(Paragraph("B. Class Diagram", h2_style))
    story.append(Paragraph(
        "The system classes are organized as follows:<br/>"
        "1. <b>DatabaseManager:</b> Handles connection sessions, queries, and writes to database.db.<br/>"
        "2. <b>FlaskController:</b> Maps REST endpoints (`/api/holdings`, `/api/news`, `/proxy/`, `/api/ask-ai`) to their processing handlers.<br/>"
        "3. <b>UIEngine:</b> Operates client-side logic, holds UI states, parses JSON data, and updates DOM trees.",
        styles['Normal']
    ))

    story.append(Paragraph("C. Activity Diagram (Live Price Fetch Workflow)", h2_style))
    story.append(Paragraph(
        "The workflow steps when the user triggers the Live Price update:<br/>"
        "1. Initialize live price caching lists.<br/>"
        "2. Loop through holdings and fetch Crypto prices directly from CoinGecko API.<br/>"
        "3. Filter out stocks, checking if they are Indian Equities (`NSE`/`BSE`).<br/>"
        "4. If Indian, query Yahoo Finance proxy endpoint (`/proxy/https://query1.finance.yahoo.com/...`).<br/>"
        "5. If US/Global, query Twelve Data API endpoint.<br/>"
        "6. If any fetch fails, retrieve fallback data or simulated open-market drift figures.<br/>"
        "7. Recalculate portfolio parameters, render updated values, and persist updates back into database.db.",
        styles['Normal']
    ))

    # Build the document
    doc.build(story, canvasmaker=NumberedCanvas)
    print("requirements.pdf successfully generated!")

if __name__ == "__main__":
    build_pdf()
