# A PROJECT REPORT ON PORTFOLIO TRACKER

**Submitted by:** Mr. ANSHUL RAMESH AGRAWAL (Roll No: 01 | Seat No: 01)  
**Degree:** Bachelor of Science in Computer Science (T.Y.B.Sc. Computer Science - Semester VI)  
**Subject:** Project Work - II (Paper Code: USCSP605)  
**Guide:** Prof. SHRIMATHI NARAYANAN  
**College:** VIDYAVARDHINI'S A. V. College of Arts, K. M. College of Commerce, E. S. A. College of Science (Affiliated to University of Mumbai), Vasai (West), Palghar-401202, Maharashtra  
**Academic Year:** 2025 – 2026  

---

## 1. Introduction and Objectives
### Introduction
In today's fast-evolving financial landscape, Indian retail investors diversify their wealth across multiple asset classes including Indian equities (NSE & BSE), mutual funds, ETFs, gold, and cryptocurrencies. Portfolio Tracker is a secure, privacy-first, cloud-synchronized web application designed to solve fragmented multi-broker tracking. Built with Python Flask, Supabase PostgreSQL, and Chart.js, the platform delivers automated live prices, P&L analytics, and PDF valuation statements without exposing broker credentials.

### Objectives
1. Centralized Multi-Asset Tracking in INR (₹).
2. Real-Time Price Synchronization via cached multi-threaded quote resolvers.
3. Privacy-First Architecture with zero broker credential requirements.
4. Cloud Data Persistence on Supabase PostgreSQL.
5. Interactive Valuation Reports with one-click PDF print and CSV export.
6. AI Market Intelligence and News Aggregation.

---

## 2. Scope and Technology Stack
- **Frontend:** HTML5, Vanilla CSS3 (Glassmorphism), JavaScript (ES6+), Chart.js
- **Backend:** Python 3.11+, Flask REST API, Gunicorn WSGI
- **Database:** Supabase PostgreSQL Cloud
- **Security:** PBKDF2-SHA256 Password Salting, Google OAuth 2.0
- **Cloud Deployment:** Render Cloud Web Services

---

## 3. System Features & Modules
1. **Authentication Module:** Secure registration, PBKDF2 hashing, and Google OAuth 2.0 social login.
2. **Holdings Management Module (CRUD):** Add, edit, record partial sales, and delete assets synced to Supabase.
3. **Live Price Resolution Engine:** Multi-worker threaded quote fetching with in-memory 45-second cache.
4. **Analytics & Valuation Engine:** Dynamic asset allocation donut charts, Net Worth, Total Gain %, and Day's P&L.
5. **Reports Generator Module:** PDF-ready valuation statement and CSV export modal.

---

## 4. StarUML System Design Details
- **Event Table:** Complete 8-event operational specification (Register, Login, Google OAuth, Add Holding, Refresh Prices, Sell, Report, AI Query).
- **Entity Relationship (ER) Diagram:** USERS (1) $\leftrightarrow$ (N) HOLDINGS schema.
- **Class Diagram:** User, Holding, PriceEngine, SupabaseClient, ReportGenerator.
- **Activity Diagram:** Login $ightarrow$ Concurrent Data Polling $ightarrow$ Render UI $ightarrow$ Export Statement.
- **Sequence Diagram:** Chronological interaction between Client UI, Flask Server, In-Memory Cache, and Yahoo Finance API.
- **Component Diagram:** Client SPA $\leftrightarrow$ Flask WSGI Server $\leftrightarrow$ Supabase / Yahoo API.
- **Deployment Diagram:** Client Workstation (Browser) $\leftrightarrow$ Render Cloud (WSGI) $\leftrightarrow$ Supabase PostgreSQL.

---

## 5. Hardware and Software Requirements
- **Processor:** Dual-Core 2.0 GHz or higher
- **RAM:** 2.0 GB Minimum (4.0 GB Recommended)
- **OS:** Windows 10/11, Linux, macOS, Android/iOS
- **Browser:** Google Chrome, Microsoft Edge, Mozilla Firefox
- **Language / Environment:** Python 3.10+, JavaScript, Supabase SDK

---

## 6. Live Production URL & Verification
- **Live URL:** https://portfolio-tracker-1-n2qq.onrender.com
- **Test Suite Status:** 30/30 Endpoints Passed
