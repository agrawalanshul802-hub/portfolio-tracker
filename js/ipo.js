// js/ipo.js
// ─── IPO TRACKER, PAN & EXPORT ───────────────────────────────────────────────
// IPO Wiz multi-PAN allotment state & handlers,
// IPO 2-step modal controllers (overview + multi-check),
// IPO modal detail & category distribution,
// Menu bar & drawer navigation,
// Portfolio export engine (CSV download & PDF print generator).
// Depends on: js/state.js, js/portfolio.js
"use strict";

// =========================================================
//  IPOWIZ MULTI-PAN & 2-STEP ALLOTMENT TRACKER STATE & HANDLERS
// =========================================================
// No default or demo PANs - completely user managed
const DEMO_PANS = [];

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
} catch (e) { }
try { localStorage.setItem('portfolio_saved_pans', JSON.stringify(_userPans)); } catch (e) { }

let _userPan = _userPans.length > 0 ? _userPans[0].pan : '';
let _isPanMasked = true; // masked by default like video!
let _ipoApplications = [];
try {
  const storedApps = localStorage.getItem('portfolio_ipo_applications');
  if (storedApps) _ipoApplications = JSON.parse(storedApps);
} catch (e) { }

let _currentAllotModalData = null;
window._cachedIpoData = null;
try {
  const storedIpoData = localStorage.getItem('portfolio_cached_ipos');
  if (storedIpoData) window._cachedIpoData = JSON.parse(storedIpoData);
} catch (e) { }

window.parseJsIpoDate = function (dStr) {
  if (!dStr || dStr === '-' || dStr === 'TBA' || dStr === 'None' || dStr === 'Pending') return null;
  const s = String(dStr).trim();
  const m1 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m1) return new Date(parseInt(m1[1]), parseInt(m1[2]) - 1, parseInt(m1[3]), 23, 59, 59);
  const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
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
window.fetchUserPan = function () { if (typeof window.fetchUserPans === 'function') return window.fetchUserPans(); };

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
      try { localStorage.setItem('portfolio_ipo_applications', JSON.stringify(_ipoApplications)); } catch (e) { }
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
window.resolveIpoRegistrarUrl = function (ipoName, symbol, rawUrl) {
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

window.redirectToRegistrar = function (allotUrl, ipoNameEsc) {
  if (window.event) window.event.stopPropagation();
  const ipoName = decodeURIComponent(ipoNameEsc || '');
  const targetUrl = resolveIpoRegistrarUrl(ipoName, '', allotUrl ? decodeURIComponent(allotUrl) : '');

  // If user has linked their PAN, auto-copy to clipboard for effortless pasting
  const userPan = (_userPans && _userPans.length > 0) ? _userPans[0].pan : (_userPan || '');
  if (userPan && navigator.clipboard) {
    navigator.clipboard.writeText(userPan).catch(() => { });
    toast(`📋 PAN (${maskPanDigits(userPan)}) copied! Opening official registrar portal...`);
  } else {
    toast(`🌐 Opening official allotment portal for ${ipoName}...`);
  }

  window.open(targetUrl, '_blank', 'noopener,noreferrer');
};

window.openDirectRegistrarFromModal = function (e) {
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
  try { localStorage.setItem('portfolio_ipo_applications', JSON.stringify(_ipoApplications)); } catch (e) { }
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
  const errBox = document.getElementById('ipoError');
  const lastUpd = document.getElementById('ipoLastUpdated');

  if (_ipoLoaded && !force) {
    if (loading) loading.style.display = 'none';
    if (errBox) errBox.style.display = 'none';
    return;
  }

  if (loading) loading.style.display = 'flex';
  if (errBox) errBox.style.display = 'none';
  if (lastUpd) lastUpd.style.display = 'none';

  try {
    // Fetch user's linked PAN and tracked applications in parallel with live IPOs
    if (typeof fetchUserPans === 'function') fetchUserPans();
    if (typeof fetchIpoApplications === 'function') fetchIpoApplications();

    const userEmail = (typeof currentUser !== 'undefined' && currentUser && currentUser.email) || localStorage.getItem('portfolio_user_email') || '';
    const url = '/api/ipos?' + (userEmail ? `email=${encodeURIComponent(userEmail)}&` : '') + (force ? 'refresh=1' : '');
    const res = await fetch(url);

    if (!res.ok) {
      if (window._cachedIpoData && window._cachedIpoData.open) {
        console.warn('IPO fetch failed (' + res.status + '), falling back to cached in-memory data');
        const data = window._cachedIpoData;
        renderIpoList('open', data.open || []);
        renderIpoList('upcoming', data.upcoming || []);
        renderIpoList('listed', data.listed || []);
        return;
      }
      throw new Error('Server returned ' + res.status);
    }

    const json = await res.json();
    if (json.error) throw new Error(json.error);

    const data = json.data || { open: [], upcoming: [], listed: [] };
    window._cachedIpoData = data;
    try { localStorage.setItem('portfolio_cached_ipos', JSON.stringify(data)); } catch (e) { }
    const openList = data.open || [];
    const upcomingList = data.upcoming || [];
    const listedList = data.listed || [];

    renderIpoList('open', openList);
    renderIpoList('upcoming', upcomingList);
    renderIpoList('listed', listedList);

    const oc = document.getElementById('openCount');
    if (oc) oc.textContent = openList.length;
    const uc = document.getElementById('upcomingCount');
    if (uc) uc.textContent = upcomingList.length;
    const lc = document.getElementById('listedCount');
    if (lc) lc.textContent = listedList.length;

    const badge = document.getElementById('ipoOpenBadge');
    if (badge) {
      badge.style.display = openList.length > 0 ? 'inline-flex' : 'none';
      badge.textContent = openList.length;
    }

    if (lastUpd) {
      const age = json.age_seconds || 0;
      lastUpd.textContent = json.cached
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
                <span>Mainboard Issues</span>
                <span class="ipo-subgroup-badge mainboard">${mainList.length}</span>
              </div>
              <span class="ipo-subgroup-desc">Min retail lot ~₹14,000–₹15,000 • Regular NSE &amp; BSE</span>
            </div>
            <div class="ipo-subgroup-cards">${mainHtml}</div>

            <div class="ipo-subgroup-header" style="margin-top:24px;">
              <div class="ipo-subgroup-title">
                <span>SME Board Issues</span>
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

    document.querySelectorAll('.ipo-seg-btn').forEach(function (btn) {
      const fn = btn.getAttribute('onclick') || '';
      btn.classList.toggle('active', fn.indexOf("'" + section + "'") !== -1);
    });

    document.querySelectorAll('.ipo-section').forEach(function (s) {
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
window.closeChartModal = function () { };

init();
