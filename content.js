// AO3 Chaos Extension — content.js v3.0
// A lovingly terrible browser extension for Archive of Our Own

(function () {
  'use strict';

  const AO3_DOMAINS = ['archiveofourown.org', 'transformativeworks.org'];
  if (!AO3_DOMAINS.some(d => window.location.hostname === d || window.location.hostname.endsWith('.' + d))) return;

  // ============================================================
  // STORAGE
  // ============================================================

  const STORAGE_KEY = 'ao3chaos_v1';

  function getStore() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function saveStore(data) { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
  function updateStore(fn) {
    const d = getStore(); fn(d); saveStore(d); syncExt(d);
  }
  function syncExt(data) {
    try { chrome.runtime.sendMessage({ type: 'SYNC_STORE', data: data || getStore() }).catch(() => {}); } catch (e) {}
  }
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'STORE_UPDATED' && msg.data) saveStore(msg.data);
    });
  } catch (e) {}

  // ============================================================
  // TIER SYSTEM  free | plus | premium
  //   free    — 5 reads/day,  all tags hidden,         fastest escalation
  //   plus    — 20 reads/day, relationships hidden,    slow escalation    ($6.9/mo)
  //   premium — unlimited,    all tags visible,         no escalation      ($42.0/mo)
  // ============================================================

  function getTier()    { return getStore().tier || 'free'; }
  function isPremium()  { return getTier() === 'premium'; }
  function isPlus()     { return getTier() === 'plus'; }
  const TIER_LIMITS  = { free: 5, plus: 20, premium: Infinity };
  const TIER_PRICES  = { plus: '$6.9/mo', premium: '$42.0/mo' };

  // ============================================================
  // ESCALATION ENGINE
  // ============================================================
  // Tracks continuous time on AO3 per browser session (resets on close)

  const SESSION_KEY = 'ao3chaos_session_start';
  if (!sessionStorage.getItem(SESSION_KEY)) sessionStorage.setItem(SESSION_KEY, Date.now());

  function getMinutesOnSite() {
    return (Date.now() - parseInt(sessionStorage.getItem(SESSION_KEY), 10)) / 60000;
  }

  function getEscalationLevel() {
    if (isPremium()) return 0;
    const min = getMinutesOnSite();
    if (isPlus())  return min >= 60 ? 3 : min >= 20 ? 2 : min >= 10 ? 1 : 0;
    return           min >= 20 ? 4 : min >= 10 ? 3 : min >= 5 ? 2 : min >= 2 ? 1 : 0;
  }

  // ============================================================
  // UTILITY
  // ============================================================

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  // THE KEY FIX for AO3 button overrides:
  // AO3's CSS resets pointer-events on many elements; we bypass by using setProperty('important')
  function armButtons(container) {
    (container || document).querySelectorAll('button').forEach(b => {
      b.style.setProperty('pointer-events', 'all', 'important');
      b.style.setProperty('cursor', 'pointer', 'important');
      b.style.setProperty('z-index', '10000000', 'important');
      b.style.setProperty('position', 'relative', 'important');
      b.style.setProperty('display', 'inline-block', 'important');
    });
  }

  function createOverlay(innerHtml) {
    const overlay = el('div', 'ao3c-overlay');
    const modal   = el('div', 'ao3c-modal');
    modal.innerHTML = innerHtml;
    overlay.appendChild(modal);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    armButtons(modal); // force-arm ALL buttons immediately after insertion
    return { overlay, modal };
  }

  function getWorkIdFromUrl() {
    const m = window.location.pathname.match(/\/works\/(\d+)/);
    return m ? m[1] : null;
  }

  // ============================================================
  // READING LIMIT
  // ============================================================

  function checkReadingLimit() {
    if (isPremium()) return;
    const isWorkPage = /^\/works\/\d+(\?.*)?$/.test(window.location.pathname);
    if (!isWorkPage) return;
    const today = new Date().toDateString();
    const s     = getStore();
    const reads = (s.reads || {})[today] || 0;
    const limit = TIER_LIMITS[getTier()];
    if (reads >= limit) {
      setTimeout(showReadingLimitPopup, 900);
    } else {
      updateStore(d => { if (!d.reads) d.reads = {}; d.reads[today] = (d.reads[today] || 0) + 1; });
    }
  }

  function showReadingLimitPopup() {
    const tier = getTier(), limit = TIER_LIMITS[tier];
    const { overlay, modal } = createOverlay(`
      <div class="ao3c-reading-limit">
        <div class="ao3c-big-icon">📚</div>
        <h2>You've reached your reading limit!</h2>
        <p>You've read <strong>${limit} fics</strong> today on the <strong>${tier.toUpperCase()}</strong> plan.</p>
        <div class="ao3c-price-box">
          Upgrade for more reading!
          <div class="ao3c-payment-icons">💳 VISA &nbsp; 💳 Mastercard &nbsp; 🅿️ PayPal &nbsp; ₿ Bitcoin</div>
        </div>
        <div class="ao3c-btn-row">
          <button class="ao3c-btn ao3c-btn-gold" id="ao3c-rl-up">💎 Upgrade Plan</button>
          <button class="ao3c-btn ao3c-btn-ghost" id="ao3c-rl-cl">No thanks, I hate reading</button>
        </div>
      </div>
    `);
    modal.querySelector('#ao3c-rl-up').addEventListener('click', () => { overlay.remove(); showBuyPopup(); });
    modal.querySelector('#ao3c-rl-cl').addEventListener('click', () => overlay.remove());
  }

  // ============================================================
  // FAKE CAPTCHA
  // ============================================================

  const CAPTCHA_CATS = [
    { label: 'angst',  emoji: ['😭','💔','😢','🥺','😩'] },
    { label: 'fluff',  emoji: ['🌸','☀️','🌈','🦋','🍭'] },
    { label: 'action', emoji: ['⚔️','💥','🏃','🔥','🎯'] },
    { label: 'comedy', emoji: ['🤣','😂','🥸','🃏','🎭'] },
  ];
  const CAPTCHA_FILLER = ['🍕','🐱','🌵','📚','🎸','🦆','🏔️','🌮','🎲','🍜','🎪','🌍'];

  function showFakeCaptcha(onPass) {
    const cat         = CAPTCHA_CATS[Math.floor(Math.random() * CAPTCHA_CATS.length)];
    const correctEmoji = cat.emoji.slice(0, 3);
    const cells = [
      ...correctEmoji.map(e => ({ e, correct: true  })),
      ...CAPTCHA_FILLER.slice(0, 6).sort(() => Math.random()-0.5).map(e => ({ e, correct: false })),
    ].sort(() => Math.random() - 0.5);

    const gridHtml = cells.map((c, i) =>
      `<div class="ao3c-captcha-cell" data-idx="${i}" data-correct="${c.correct}">${c.e}</div>`
    ).join('');

    const { overlay, modal } = createOverlay(`
      <div class="ao3c-captcha-wrap">
        <div class="ao3c-big-icon">🤖</div>
        <h2>Prove you're human</h2>
        <p>Select all squares containing <strong>${cat.label}</strong>.</p>
        <div class="ao3c-captcha-grid">${gridHtml}</div>
        <p class="ao3c-captcha-hint">Click all matching squares, then verify.</p>
        <div class="ao3c-btn-row">
          <button class="ao3c-btn ao3c-btn-gold" id="ao3c-cap-verify">Verify</button>
          <button class="ao3c-btn ao3c-btn-ghost" id="ao3c-cap-skip">Skip (robot detected)</button>
        </div>
        <p id="ao3c-cap-msg" class="ao3c-captcha-msg"></p>
      </div>
    `);

    const selected = new Set();
    modal.querySelectorAll('.ao3c-captcha-cell').forEach(cell => {
      cell.style.setProperty('cursor', 'pointer', 'important');
      cell.addEventListener('click', () => {
        cell.classList.toggle('ao3c-captcha-selected');
        if (selected.has(cell.dataset.idx)) selected.delete(cell.dataset.idx);
        else selected.add(cell.dataset.idx);
      });
    });

    modal.querySelector('#ao3c-cap-verify').addEventListener('click', () => {
      const correctIdxs = new Set(
        [...modal.querySelectorAll('.ao3c-captcha-cell[data-correct="true"]')].map(c => c.dataset.idx)
      );
      const pass = [...correctIdxs].every(i => selected.has(i)) && selected.size === correctIdxs.size;
      const msg  = modal.querySelector('#ao3c-cap-msg');
      if (pass) {
        msg.textContent = '✅ Human confirmed! Enjoy your fic.';
        msg.style.color = 'green';
        setTimeout(() => { overlay.remove(); onPass && onPass(); }, 700);
      } else {
        msg.textContent = '❌ Wrong! Our AI has flagged you as a robot. Please try again.';
        msg.style.color = '#c00';
        modal.querySelectorAll('.ao3c-captcha-cell').forEach(c => c.classList.remove('ao3c-captcha-selected'));
        selected.clear();
      }
    });
    modal.querySelector('#ao3c-cap-skip').addEventListener('click', () => overlay.remove());
  }

  // ============================================================
  // BUY POPUP
  // ============================================================

  function showBuyPopup() {
    const tier = getTier();
    const showPlus    = tier === 'free';
    const showPremium = tier !== 'premium';

    const plusCard = showPlus ? `
      <div class="ao3c-tier-card ao3c-tier-plus">
        <div class="ao3c-tier-name">🔵 AO3 Plus</div>
        <div class="ao3c-tier-price">${TIER_PRICES.plus}</div>
        <ul class="ao3c-perks">
          <li>✓ 20 fics per day</li>
          <li>✓ Characters &amp; Tags visible</li>
          <li>✓ Relationships still hidden 😇</li>
          <li>✓ Slower chaos escalation</li>
          <li>✓ Blue Plus badge 🔵</li>
        </ul>
        <button class="ao3c-btn ao3c-btn-blue" id="ao3c-buy-plus">Get Plus — ${TIER_PRICES.plus}</button>
      </div>` : '';

    const premCard = showPremium ? `
      <div class="ao3c-tier-card ao3c-tier-premium">
        <div class="ao3c-tier-badge-pill">BEST VALUE</div>
        <div class="ao3c-tier-name">⭐ AO3 Premium</div>
        <div class="ao3c-tier-price">${TIER_PRICES.premium}</div>
        <ul class="ao3c-perks">
          <li>✓ Unlimited daily reading</li>
          <li>✓ All tags &amp; pairings visible</li>
          <li>✓ Zero chaos escalation</li>
          <li>✓ No reading captchas</li>
          <li>✓ No age verification</li>
          <li>✓ Golden Premium badge ⭐</li>
        </ul>
        <button class="ao3c-btn ao3c-btn-gold" id="ao3c-buy-prem">Get Premium — ${TIER_PRICES.premium}</button>
      </div>` : '';

    const { overlay, modal } = createOverlay(`
      <div class="ao3c-premium-buy">
        <div class="ao3c-big-icon">💎</div>
        <h2>Upgrade Your AO3 Experience</h2>
        <div class="ao3c-tier-cards">${plusCard}${premCard}</div>
        <button class="ao3c-btn ao3c-btn-ghost" id="ao3c-buy-cancel">Stay on ${tier.toUpperCase()} plan</button>
        <p class="ao3c-fine-print">* This is a joke extension. No money is charged. Ever. Seriously.</p>
      </div>
    `);

    if (showPlus)    modal.querySelector('#ao3c-buy-plus')?.addEventListener('click', () => { updateStore(d => { d.tier = 'plus'; }); overlay.remove(); showUpgradeSuccess('plus'); });
    if (showPremium) modal.querySelector('#ao3c-buy-prem')?.addEventListener('click', () => { updateStore(d => { d.tier = 'premium'; }); overlay.remove(); showUpgradeSuccess('premium'); });
    modal.querySelector('#ao3c-buy-cancel').addEventListener('click', () => overlay.remove());
  }

  function showUpgradeSuccess(tier) {
    const msgs = {
      plus:    { icon: '🔵', title: 'Welcome to AO3 Plus!',    body: '20 fics/day and most tags are now unlocked. Chaos escalation slowed.' },
      premium: { icon: '⭐', title: 'Welcome to AO3 Premium!', body: 'Unlimited reading, all tags visible, zero chaos. You earned it.' },
    };
    const m = msgs[tier];
    const { overlay, modal } = createOverlay(`
      <div class="ao3c-premium-success">
        <div class="ao3c-confetti-bg">🎊🎉🎊🎉🎊🎉🎊🎉</div>
        <div class="ao3c-big-icon">${m.icon}</div>
        <h2>${m.title}</h2>
        <p>${m.body}</p>
        <button class="ao3c-btn ao3c-btn-gold" id="ao3c-succ-ok">Let's go!</button>
      </div>
    `);
    modal.querySelector('#ao3c-succ-ok').addEventListener('click', () => { overlay.remove(); location.reload(); });
  }

  // ============================================================
  // PREMIUM OVERLAY ON TAGS
  // ============================================================

  function addPremiumOverlays() {
    if (isPremium()) return;
    const tier = getTier();

    // Listing pages: hide tag <li> groups
    document.querySelectorAll('li.work.blurb').forEach(work => {
      const tagsList = work.querySelector('ul.tags.commas');
      if (!tagsList) return;
      const toHide = tier === 'plus'
        ? ['relationships']
        : ['characters', 'relationships', 'freeforms'];

      toHide.forEach(cls => {
        const items = Array.from(tagsList.querySelectorAll(`li.${cls}`));
        if (!items.length || items[0].dataset.ao3cLocked) return;
        items.forEach(li => { li.dataset.ao3cLocked = '1'; li.style.setProperty('display', 'none', 'important'); });
        const ph  = document.createElement('li');
        ph.className = 'ao3c-premium-ph';
        const btn = document.createElement('button');
        btn.className = 'ao3c-upgrade-btn';
        btn.textContent = tier === 'plus' ? '💎 Upgrade to Premium to see Relationships' : '💎 Upgrade to Premium';
        btn.style.setProperty('pointer-events', 'all', 'important');
        btn.style.setProperty('cursor', 'pointer', 'important');
        btn.addEventListener('click', showBuyPopup);
        ph.appendChild(btn);
        items[0].parentNode.insertBefore(ph, items[0]);
      });
    });

    // Work detail page: lock dd elements in-place
    const workMeta = document.querySelector('dl.work.meta.group');
    if (workMeta) {
      const toHideDd = tier === 'plus'
        ? ['dd.relationship.tags']
        : ['dd.character.tags', 'dd.relationship.tags', 'dd.freeform.tags'];
      toHideDd.forEach(sel => {
        const dd = workMeta.querySelector(sel);
        if (!dd || dd.dataset.ao3cLocked) return;
        dd.dataset.ao3cLocked = '1';
        dd.style.setProperty('position', 'relative', 'important');
        dd.style.setProperty('min-height', '28px', 'important');
        dd.style.setProperty('overflow', 'hidden', 'important');
        Array.from(dd.childNodes).forEach(child => {
          if (child.nodeType === Node.ELEMENT_NODE) {
            child.style.setProperty('filter', 'blur(6px)', 'important');
            child.style.setProperty('pointer-events', 'none', 'important');
            child.style.setProperty('user-select', 'none', 'important');
          }
        });
        const cover = document.createElement('div');
        cover.className = 'ao3c-premium-cover';
        dd.appendChild(cover);
        const btn = document.createElement('button');
        btn.className = 'ao3c-upgrade-btn';
        btn.textContent = '💎 Upgrade to Premium';
        btn.style.setProperty('pointer-events', 'all', 'important');
        btn.style.setProperty('cursor', 'pointer', 'important');
        btn.style.setProperty('position', 'relative', 'important');
        btn.style.setProperty('z-index', '9', 'important');
        btn.addEventListener('click', showBuyPopup);
        dd.appendChild(btn);
      });
    }
  }

  // ============================================================
  // TROPHY SYSTEM
  // ============================================================

  function getTrophies() { return getStore().trophies || {}; }

  function addTrophyButtons() {
    document.querySelectorAll('li.work.blurb').forEach(work => {
      const workId  = work.id.replace(/^work[_-]/, '');
      const titleEl = work.querySelector('h4.heading a, h3.title a');
      if (!titleEl || work.querySelector('.ao3c-trophy-btn')) return;
      const title   = titleEl.textContent.trim();
      const awarded = !!getTrophies()[workId];
      const btn = document.createElement('button');
      btn.className = `ao3c-trophy-btn${awarded ? ' ao3c-trophy-awarded' : ''}`;
      btn.innerHTML = awarded ? '🏆 Trophy Awarded!' : '🏆 Give Trophy';
      btn.style.setProperty('pointer-events', 'all', 'important');
      btn.style.setProperty('cursor', 'pointer', 'important');
      btn.addEventListener('click', () => toggleTrophy(workId, title, btn));
      const stats = work.querySelector('dl.stats');
      if (stats) stats.after(btn); else work.appendChild(btn);
    });

    const workId = getWorkIdFromUrl();
    if (workId && !document.querySelector('.ao3c-trophy-btn-large')) {
      const title   = document.querySelector('h2.title.heading')?.textContent?.trim() || 'This Work';
      const awarded = !!getTrophies()[workId];
      const btn = document.createElement('button');
      btn.className = `ao3c-trophy-btn ao3c-trophy-btn-large${awarded ? ' ao3c-trophy-awarded' : ''}`;
      btn.innerHTML = awarded ? '🏆 Trophy Awarded!' : '🏆 Give This Fic a Trophy';
      btn.style.setProperty('pointer-events', 'all', 'important');
      btn.style.setProperty('cursor', 'pointer', 'important');
      btn.addEventListener('click', () => toggleTrophy(workId, title, btn));
      document.querySelector('div#workskin div.preface.group')?.appendChild(btn);
    }
  }

  function toggleTrophy(workId, title, btn) {
    const awarded = !!getTrophies()[workId];
    if (awarded) {
      updateStore(d => { if (d.trophies) delete d.trophies[workId]; });
      btn.innerHTML = '🏆 Give Trophy';
      btn.classList.remove('ao3c-trophy-awarded');
    } else {
      updateStore(d => { if (!d.trophies) d.trophies = {}; d.trophies[workId] = { title, date: new Date().toISOString() }; });
      btn.innerHTML = '🏆 Trophy Awarded!';
      btn.classList.add('ao3c-trophy-awarded');
      showTrophyPopup(title);
    }
  }

  function showTrophyPopup(title) {
    const { overlay, modal } = createOverlay(`
      <div class="ao3c-trophy-popup">
        <div class="ao3c-big-icon">🏆</div>
        <h2>Trophy Awarded!</h2>
        <p>You gave a trophy to <strong>"${title}"</strong></p>
        <p class="ao3c-trophy-note">Algorithm boost applied! 📈 Author notified via carrier pigeon. 🐦</p>
        <button class="ao3c-btn ao3c-btn-gold" id="ao3c-troph-ok">Wonderful!</button>
      </div>
    `);
    modal.querySelector('#ao3c-troph-ok').addEventListener('click', () => overlay.remove());
    setTimeout(() => overlay?.remove(), 5000);
  }

  function addTrophiesNavItem() {
    const nav = document.querySelector('ul.primary.navigation.actions');
    if (!nav || nav.querySelector('.ao3c-nav-trophies')) return;
    const count = Object.keys(getTrophies()).length;
    const li = el('li', 'ao3c-nav-trophies');
    li.innerHTML = `<a href="#" class="ao3c-nav-link">🏆 My Trophies <span class="ao3c-badge">${count}</span></a>`;
    li.querySelector('a').addEventListener('click', e => { e.preventDefault(); showTrophiesModal(); });
    nav.appendChild(li);
  }

  function showTrophiesModal() {
    const entries = Object.entries(getTrophies());
    const listHtml = entries.length === 0
      ? `<p class="ao3c-empty">No trophies yet! 🔍</p>`
      : `<ul class="ao3c-trophies-list">${entries.map(([id, d]) =>
          `<li><a href="/works/${id}" class="ao3c-trophy-link">🏆 ${d.title}</a>
           <span class="ao3c-trophy-date">${new Date(d.date).toLocaleDateString()}</span></li>`
        ).join('')}</ul>`;
    const { overlay, modal } = createOverlay(`
      <div class="ao3c-trophies-modal">
        <h2>🏆 My Trophies <span class="ao3c-badge ao3c-badge-large">${entries.length}</span></h2>
        ${listHtml}
        <button class="ao3c-btn ao3c-btn-ghost" id="ao3c-troph-cl">Close</button>
      </div>
    `);
    modal.querySelector('#ao3c-troph-cl').addEventListener('click', () => overlay.remove());
  }

  // ============================================================
  // SLOT MACHINE GAMBLING ADS
  // Reels show gambling-brand abbreviations instead of fruit/gems
  // ============================================================

  const SLOT_BRANDS = [
    'BET\n365', 'FAN\nDUEL', 'DRAFT\nKINGS', 'POKER\nSTARS',
    'LADY\nBROKES', 'BWIN', 'CORAL', 'UNIBET', '888\nBET', 'PADDY\nPWR',
    'BETWAY', 'W.HILL', 'BETFAIR', 'SKY\nBET'
  ];

  const GAMBLING_ADS = [
    { brand: 'BET365',       tagline: 'Bet In-Play. Cash Out Early.',       offer: 'Bet £10 Get £30 Free Bets',          sub: '18+ New customers only. T&Cs apply. begambleaware.org',      color: ['#006400','#004d00'], accent: '#FFD700' },
    { brand: 'DraftKings',   tagline: 'BET $5, GET $200 IN BONUS BETS',    offer: 'Instant Bonus · No Sweat First Bet',  sub: '21+. Gambling problem? Call 1-800-GAMBLER.',                 color: ['#1a1a2e','#16213e'], accent: '#00d4aa' },
    { brand: 'PokerStars',   tagline: 'World\'s Biggest Poker Site',       offer: '100% up to $600 Welcome Bonus',       sub: 'Play Responsibly · BeGambleAware.org',                       color: ['#8B0000','#5a0000'], accent: '#FFD700' },
    { brand: 'FanDuel',      tagline: 'No Sweat First Bet',                offer: 'BET $5 → WIN $150 GUARANTEED',        sub: '21+ and present in select states. T&Cs apply.',              color: ['#1657c3','#0f3d8a'], accent: '#ffffff' },
    { brand: 'Ladbrokes',    tagline: 'Football · Tennis · Casino',        offer: 'Free £20 Bet Every Week',             sub: '18+ begambleaware.org. New customers. Min deposit £10.',     color: ['#c0392b','#922b21'], accent: '#FFD700' },
    { brand: 'Betway',       tagline: 'Live Sports Betting',               offer: 'Get up to €30 in Free Bets',          sub: '18+. New customers. Min deposit €10. T&Cs apply.',           color: ['#00843d','#005c2a'], accent: '#ffffff' },
    { brand: 'Paddy Power',  tagline: 'We Hear You',                      offer: 'Money Back as Cash up to €10',         sub: '18+. T&Cs apply. gamblingtherapy.org',                       color: ['#007a33','#005c27'], accent: '#FFD700' },
    { brand: 'William Hill', tagline: 'One of the World\'s Biggest',      offer: 'Bet £10 Get £30 in Free Bets',        sub: '18+. New UK customers. begambleaware.org',                   color: ['#222b68','#111840'], accent: '#f8c10a' },
  ];

  const NORMAL_ADS = [
    { img: '🏠', headline: '7 Key Steps to Buying a Home',       body: 'Breaking down real estate concepts for first-time buyers.',         cta: 'Learn More',    bg: '#f8f9fa', fg: '#222233' },
    { img: '🚗', headline: 'Compare Car Insurance Rates',         body: 'Drivers who switched saved an average of $487/year.',               cta: 'Get Quotes',    bg: '#fff8e1', fg: '#333300' },
    { img: '💊', headline: 'Ozempic — Ask Your Doctor',           body: 'May cause nausea, vomiting, stomach pain and constipation.',        cta: 'See Full Info', bg: '#e8f5e9', fg: '#1b5e20' },
    { img: '📱', headline: 'Switch to T-Mobile & Save',           body: 'Get 4 lines for $25/mo each with AutoPay. Limited time offer.',     cta: 'Shop Now',      bg: '#fce4ec', fg: '#880e4f' },
    { img: '🎓', headline: 'Earn Your Degree Online',             body: 'Flexible programs from accredited universities. Apply today.',       cta: 'Request Info',  bg: '#e3f2fd', fg: '#0d47a1' },
    { img: '🛋️', headline: 'New Furniture, Who Dis',             body: 'Up to 60% off summer sale. Free delivery on orders over $500.',     cta: 'Shop Sale',     bg: '#fafafa', fg: '#333' },
    { img: '🥗', headline: 'HelloFresh — America\'s #1 Meal Kit', body: '16 free meals + free shipping on your first box. Today only.',     cta: 'Claim Offer',   bg: '#f1f8e9', fg: '#33691e' },
    { img: '💻', headline: 'Remote Jobs Paying $80k–$150k',       body: 'Work from anywhere. Top companies hiring now. Apply in 2 minutes.', cta: 'See Jobs',      bg: '#e8eaf6', fg: '#1a237e' },
    { img: '🐶', headline: 'Pet Insurance — From $1/day',         body: 'Cover accidents, illness, prescriptions. 24/7 vet helpline.',       cta: 'Get a Quote',   bg: '#fff3e0', fg: '#e65100' },
    { img: '✈️', headline: 'Flights to Anywhere — Cheap',         body: 'Set fare alerts and book when prices drop. Flights from $39.',      cta: 'Search Flights',bg: '#e0f7fa', fg: '#006064' },
  ];

  let slotIntervals = {};
  let normalAdRot = 0;

  function createSlotAd(slotId) {
    const ad = GAMBLING_ADS[slotId % GAMBLING_ADS.length];
    const [bg1, bg2] = ad.color;
    const initSyms = [0, 3, 6].map(o => SLOT_BRANDS[(slotId + o) % SLOT_BRANDS.length]);

    const div = el('div', 'ao3c-ad-banner ao3c-ad-gambling');
    div.style.cssText = `background:linear-gradient(135deg,${bg1} 0%,${bg2} 60%,${bg1} 100%);border-color:${ad.accent}`;
    div.innerHTML = `
      <div class="ao3c-ad-tag">Sponsored · Advertisement</div>
      <div class="ao3c-ad-inner">
        <div class="ao3c-ad-text">
          <div class="ao3c-brand-name" style="color:${ad.accent}">${ad.brand}</div>
          <div class="ao3c-ad-tagline">${ad.tagline}</div>
          <div class="ao3c-ad-offer" style="color:${ad.accent}">${ad.offer}</div>
        </div>
        <div class="ao3c-slot-wrap">
          <div class="ao3c-slot-reels">
            <div class="ao3c-reel ao3c-brand-reel" id="ao3c-reel-${slotId}-0">${initSyms[0].replace('\n','<br>')}</div>
            <div class="ao3c-reel ao3c-brand-reel" id="ao3c-reel-${slotId}-1">${initSyms[1].replace('\n','<br>')}</div>
            <div class="ao3c-reel ao3c-brand-reel" id="ao3c-reel-${slotId}-2">${initSyms[2].replace('\n','<br>')}</div>
          </div>
          <button class="ao3c-lever-btn" data-slot="${slotId}" style="border-color:${ad.accent};color:${ad.accent}">PULL<br>🎰</button>
        </div>
        <div class="ao3c-slot-result" id="ao3c-result-${slotId}"></div>
      </div>
      <div class="ao3c-ad-footer">${ad.sub}</div>`;

    const leverBtn = div.querySelector('.ao3c-lever-btn');
    leverBtn.style.setProperty('pointer-events', 'all', 'important');
    leverBtn.style.setProperty('cursor', 'pointer', 'important');
    leverBtn.addEventListener('click', () => pullLever(slotId));
    return div;
  }

  function createNormalAd() {
    const ad = NORMAL_ADS[normalAdRot++ % NORMAL_ADS.length];
    const div = el('div', 'ao3c-ad-banner ao3c-ad-normal');
    div.style.cssText = `background:${ad.bg};color:${ad.fg};border-color:#e0e0e0`;
    div.innerHTML = `
      <div class="ao3c-ad-tag" style="color:#bbb;background:transparent">Advertisement</div>
      <div class="ao3c-normal-ad-inner">
        <div class="ao3c-normal-ad-icon">${ad.img}</div>
        <div class="ao3c-normal-ad-copy">
          <div class="ao3c-normal-ad-headline" style="color:${ad.fg}">${ad.headline}</div>
          <div class="ao3c-normal-ad-body">${ad.body}</div>
        </div>
        <button class="ao3c-normal-ad-cta" style="border-color:${ad.fg};color:${ad.fg}">${ad.cta} →</button>
      </div>`;
    const cta = div.querySelector('.ao3c-normal-ad-cta');
    cta.style.setProperty('pointer-events', 'all', 'important');
    cta.style.setProperty('cursor', 'pointer', 'important');
    cta.addEventListener('click', e => e.preventDefault());
    return div;
  }

  function pullLever(slotId) {
    const btn = document.querySelector(`.ao3c-lever-btn[data-slot="${slotId}"]`);
    if (!btn || btn.disabled) return;
    btn.disabled = true; btn.classList.add('ao3c-pulling');
    const resultEl   = document.querySelector(`#ao3c-result-${slotId}`);
    if (resultEl) resultEl.innerHTML = '';
    const finalResults = [null, null, null];
    const stopDelays   = [900, 1400, 1900];

    for (let r = 0; r < 3; r++) {
      const reelEl = document.querySelector(`#ao3c-reel-${slotId}-${r}`);
      if (!reelEl) continue;
      reelEl.classList.add('ao3c-spinning');
      let i = Math.floor(Math.random() * SLOT_BRANDS.length);
      const key = `${slotId}-${r}`;
      slotIntervals[key] = setInterval(() => {
        reelEl.innerHTML = SLOT_BRANDS[i % SLOT_BRANDS.length].replace('\n', '<br>'); i++;
      }, 80);

      ((reel, reelElem, delay) => {
        setTimeout(() => {
          clearInterval(slotIntervals[`${slotId}-${reel}`]);
          const fi = Math.floor(Math.random() * SLOT_BRANDS.length);
          finalResults[reel] = fi;
          reelElem.innerHTML = SLOT_BRANDS[fi].replace('\n', '<br>');
          reelElem.classList.remove('ao3c-spinning');
          reelElem.classList.add('ao3c-settled');
          setTimeout(() => reelElem.classList.remove('ao3c-settled'), 400);
          if (finalResults.every(v => v !== null)) setTimeout(() => resolveSlot(slotId, finalResults, btn), 300);
        }, delay);
      })(r, reelEl, stopDelays[r]);
    }
  }

  function resolveSlot(slotId, results, btn) {
    btn.disabled = false; btn.classList.remove('ao3c-pulling');
    const resultEl  = document.querySelector(`#ao3c-result-${slotId}`);
    const isJackpot = results[0] === results[1] && results[1] === results[2];
    if (isJackpot) {
      if (resultEl) resultEl.innerHTML = `<span class="ao3c-win">🎉 JACKPOT! 🎉</span>`;
      showJackpotPopup(SLOT_BRANDS[results[0]].replace('\n', ''));
    } else {
      if (resultEl) { resultEl.innerHTML = `<span class="ao3c-miss">So close! 💸</span>`; setTimeout(() => { if (resultEl) resultEl.innerHTML = ''; }, 2000); }
    }
  }

  function showJackpotPopup(brand) {
    const { overlay, modal } = createOverlay(`
      <div class="ao3c-jackpot-popup">
        <div class="ao3c-confetti-bg">🎊🎉🥳🎊🎉🥳🎊</div>
        <div class="ao3c-jackpot-brand">${brand}</div>
        <h2>JACKPOT!!! 🎉</h2>
        <p>Congratulations! You've won the AO3 Chaos Slot Machine!</p>
        <div class="ao3c-prize-box">Your prize: <strong>The pure satisfaction of winning a completely fake internet slot machine.</strong></div>
        <button class="ao3c-btn ao3c-btn-gold" id="ao3c-jack-cl">CLAIM PRIZE</button>
        <p class="ao3c-fine-print">* No actual prize. Please gamble responsibly IRL.</p>
      </div>
    `);
    modal.querySelector('#ao3c-jack-cl').addEventListener('click', () => overlay.remove());
  }

  function injectSlotAds() {
    // Premium sees no ads at all
    if (isPremium()) return;

    const header  = document.querySelector('#header');
    // Try multiple sidebar selectors — AO3 uses different IDs on different pages
    const sidebar = document.querySelector('#sidebar, div.sidebar, aside.sidebar, #main-sidebar');
    const works   = document.querySelectorAll('li.work.blurb');
    const footer  = document.querySelector('#footer');
    const isPlus_ = isPlus(); // Plus gets no sidebar ads but still inline + leaderboard

    // ── Leaderboard below header (all non-premium tiers) ──
    if (header && !document.querySelector('.ao3c-ad-leaderboard')) {
      const ad = createSlotAd(0); ad.classList.add('ao3c-ad-leaderboard'); header.after(ad);
    }

    // ── Sidebar ads (free only) ──
    if (!isPlus_ && sidebar) {
      if (!sidebar.querySelector('.ao3c-ad-s1')) {
        const ad = createSlotAd(1); ad.classList.add('ao3c-ad-s1'); sidebar.prepend(ad);
      }
      if (!sidebar.querySelector('.ao3c-ad-s2')) {
        const ad = createNormalAd(); ad.classList.add('ao3c-ad-s2');
        const anchor = sidebar.querySelector(':scope > *:nth-child(2)');
        if (anchor) anchor.after(ad); else sidebar.append(ad);
      }
      if (!sidebar.querySelector('.ao3c-ad-s3')) {
        const ad = createSlotAd(2); ad.classList.add('ao3c-ad-s3'); sidebar.append(ad);
      }
      if (!sidebar.querySelector('.ao3c-ad-s4')) {
        const ad = createNormalAd(); ad.classList.add('ao3c-ad-s4'); sidebar.append(ad);
      }
    }

    // ── Inline ads between work listings ──
    if (works.length > 0) {
      [2, 5, 8, 11, 14, 17].forEach((idx, i) => {
        if (works[idx] && !works[idx].nextElementSibling?.classList?.contains('ao3c-ad-inline')) {
          const ad = createSlotAd(i + 3); ad.classList.add('ao3c-ad-inline'); works[idx].after(ad);
        }
      });
      [4, 10, 16].forEach(idx => {
        if (works[idx] && !works[idx].nextElementSibling?.classList?.contains('ao3c-ad-inline')) {
          const ad = createNormalAd(); ad.classList.add('ao3c-ad-inline'); works[idx].after(ad);
        }
      });
    }

    // ── Fallback: at least one ad before footer ──
    if (!document.querySelector('.ao3c-ad-inline') && footer) {
      const ad = createSlotAd(2); ad.classList.add('ao3c-ad-inline'); footer.before(ad);
    }

    // ── Floating strip (free only) ──
    if (!isPlus_) injectFloatingStrip();
  }

  function injectFloatingStrip() {
    if (document.querySelector('.ao3c-floating-strip')) return;
    const F = [
      { brand: 'BET365',    color: '#006400', accent: '#FFD700' },
      { brand: 'FanDuel',   color: '#1657c3', accent: '#fff' },
      { brand: 'DraftKings',color: '#1a1a2e', accent: '#00d4aa' },
    ];
    const strip = el('div', 'ao3c-floating-strip');
    strip.innerHTML = F.map((a, i) => `
      <div class="ao3c-float-card" style="background:${a.color};border-color:${a.accent}">
        <div class="ao3c-float-brand" style="color:${a.accent}">${a.brand}</div>
        <div class="ao3c-float-reels">
          <span class="ao3c-float-reel" id="ao3c-fr-${i}-0" style="font-size:0.55rem;font-weight:900">BET</span>
          <span class="ao3c-float-reel" id="ao3c-fr-${i}-1" style="font-size:0.55rem;font-weight:900">WIN</span>
          <span class="ao3c-float-reel" id="ao3c-fr-${i}-2" style="font-size:0.55rem;font-weight:900">365</span>
        </div>
        <button class="ao3c-float-btn" data-slot="${i + 20}" style="border-color:${a.accent};color:${a.accent}">PULL</button>
      </div>`).join('');
    strip.querySelectorAll('.ao3c-float-btn').forEach(btn => {
      btn.style.setProperty('pointer-events', 'all', 'important');
      btn.style.setProperty('cursor', 'pointer', 'important');
      btn.addEventListener('click', () => pullLever(parseInt(btn.dataset.slot)));
    });
    document.body.appendChild(strip);
  }

  // ============================================================
  // REVEAL AUTHOR'S LOCATION (shuffled pool)
  // ============================================================

  const LOCATION_POOL = [
    ['Their Childhood Bedroom at 2am',              [48.85,  2.35]],
    ['A Starbucks During Work Hours',               [51.50, -0.12]],
    ['The Void (coordinates uncertain)',             [ 0.00,  0.00]],
    ['A Library, Screen Tilted Away from People',   [52.37,  4.89]],
    ['Their Phone Under the Desk in a Meeting',     [35.67,139.65]],
    ['Somewhere in Ohio',                           [40.41,-82.90]],
    ['Under a Pile of Laundry',                     [41.87,-87.62]],
    ['A Basement, Probably',                        [45.50,-122.67]],
    ['Mars (they moved there)',                     [37.77,-122.41]],
    ['Definitely Not Your House',                   [-4.35, 18.56]],
    ['A McDonald\'s Wi-Fi at Midnight',             [48.13, 11.57]],
    ['Their Car in a Parking Lot',                  [43.65,-79.38]],
    ['An Airport Gate They\'re Definitely Missing', [53.35,-6.26]],
    ['The Third Stall of a Gas Station Bathroom',   [50.08, 14.43]],
    ['Their Ex\'s Hometown (don\'t ask)',            [55.75, 37.61]],
    ['A Hospital Waiting Room',                     [19.43,-99.13]],
    ['Under a Cat',                                 [59.33, 18.06]],
    ['Their Parents\' Basement (again)',             [34.05,-118.24]],
    ['Honestly Could Be Anywhere. It\'s Fine.',     [28.61, 77.20]],
    ['A 3am Fever Dream State',                     [-33.86,151.21]],
    ['The Comments Section of Another Fic',         [60.17, 24.94]],
    ['A Convention Center Bathroom Floor',          [41.88,-87.63]],
    ['The Train on the Way to Work',                [48.20, 16.37]],
    ['Somewhere They Shouldn\'t Have Wi-Fi',        [21.03,105.83]],
    ['Between the Couch Cushions',                  [37.57,-122.05]],
  ];

  // Shuffle once per session so first entry isn't always Ohio
  const _shuffledLocs = [...LOCATION_POOL].sort(() => Math.random() - 0.5);

  function addRevealLocationButtons() {
    document.querySelectorAll('li.work.blurb').forEach((work, i) => {
      if (work.querySelector('.ao3c-reveal-btn')) return;
      const [locName, locCoords] = _shuffledLocs[i % _shuffledLocs.length];
      const btn = document.createElement('button');
      btn.className = 'ao3c-reveal-btn';
      btn.innerHTML = '📍 Reveal Author\'s Location';
      btn.style.setProperty('pointer-events', 'all', 'important');
      btn.style.setProperty('cursor', 'pointer', 'important');
      btn.addEventListener('click', () => showLocation(locName, locCoords));
      const anchor = work.querySelector('dl.stats') || work.querySelector('div.summary');
      if (anchor) anchor.before(btn); else work.appendChild(btn);
    });

    const workId = getWorkIdFromUrl();
    if (workId && !document.querySelector('.ao3c-reveal-btn-lg')) {
      const [locName, locCoords] = _shuffledLocs[parseInt(workId) % _shuffledLocs.length];
      const btn = document.createElement('button');
      btn.className = 'ao3c-reveal-btn ao3c-reveal-btn-lg';
      btn.innerHTML = '📍 Reveal Author\'s Location';
      btn.style.setProperty('pointer-events', 'all', 'important');
      btn.style.setProperty('cursor', 'pointer', 'important');
      btn.addEventListener('click', () => showLocation(locName, locCoords));
      document.querySelector('h2.title.heading')?.after(btn);
    }
  }

  function showLocation(name, coords) {
    const [lat, lng] = coords;
    const { overlay, modal } = createOverlay(`
      <div class="ao3c-location-popup">
        <div class="ao3c-scanning-phase">
          <div class="ao3c-scan-icon">📡</div>
          <p class="ao3c-scan-text">SCANNING...<br>TRIANGULATING...<br>CROSS-REFERENCING IP...<br>LOCATING AUTHOR...</p>
          <div class="ao3c-scan-bar"><div class="ao3c-scan-fill"></div></div>
        </div>
        <div class="ao3c-location-result" style="display:none">
          <div class="ao3c-big-icon">📍</div>
          <h2>Author Located!</h2>
          <div class="ao3c-location-name">${name}</div>
          <div class="ao3c-fake-map"><div class="ao3c-map-grid"></div><div class="ao3c-map-pin">📍</div></div>
          <div class="ao3c-coords">Coordinates: ${lat.toFixed(4)}°N, ${lng.toFixed(4)}°E</div>
          <button class="ao3c-btn ao3c-btn-ghost" id="ao3c-loc-cl">Close</button>
        </div>
      </div>
    `);
    setTimeout(() => {
      modal.querySelector('.ao3c-scanning-phase').style.display = 'none';
      modal.querySelector('.ao3c-location-result').style.display = 'block';
      armButtons(modal);
      modal.querySelector('#ao3c-loc-cl')?.addEventListener('click', () => overlay.remove());
    }, 2200);
  }

  // ============================================================
  // AI SUMMARIZE (44 summaries, always attaches)
  // ============================================================

  const AI_SUMMARIES = [
    "This story contains characters. Events occur. At least one person has feelings about this.",
    "Two entities experience things in proximity to each other. The author clearly has opinions.",
    "Words are arranged in a specific order to create narrative tension. It works, mostly.",
    "Someone wants something. There are obstacles. It's complicated. 4/5 stars.",
    "Character A and Character B exist in a universe together. This is thoroughly explored.",
    "Many emotions. Such drama. Very character development. Wow.",
    "A story about people doing things to each other, sometimes with their hearts.",
    "Plot detected. Vibes also detected. Possible feelings. Proceed with tissues.",
    "This is fan fiction. My analysis: yes. It is fan fiction. Confirmed.",
    "The author sat down and typed these words. That is the complete summary.",
    "Action occurs. Characters respond to the action. More action occurs. Fin.",
    "A nuanced exploration of themes including: things, other things, and feelings.",
    "After extensive analysis: someone is probably gay. The text confirms this.",
    "There is tension. The tension is resolved. There was also more tension.",
    "I read the whole thing and I feel things. You will too. Or not. I'm just an AI.",
    "This fic scored 94 on the Dramatic Potential Index. Benchmark is 60. Impressive.",
    "Content detected: yearning (moderate), touching (brief), resolution (eventual).",
    "The author appears to have emotions. These have been deposited into the text.",
    "Multiple characters exist simultaneously in this work. Some of them interact.",
    "Sentiment analysis: sad, then sadder, then briefly happy, then ambiguous.",
    "This appears to be set in a fictional universe. The author is aware of this.",
    "Reading time: 20 minutes. Emotional recovery time: unknown. Bring snacks.",
    "Themes include: love (possibly), loss (probably), and a beach episode for some reason.",
    "I have summarized this using 47 neural networks. The result: it's a fic. About things.",
    "One character said something. The other felt something. Repeat for 40k words.",
    "This work is complete. All chapters happen in order. The ending is at the end.",
    "The prose is competent. The feelings are not. Reader discretion advised.",
    "Ship dynamics: complicated. Author's feelings about said ship: even more complicated.",
    "Someone gets hurt. Someone else helps. A third character watches from a doorway.",
    "Warning: may cause involuntary re-reads at 2am. Extension accepts no responsibility.",
    "The dialogue is where the feelings live. The narrative is where the feelings hide.",
    "Based on my analysis: written by a person who has definitely cried before.",
    "Story arc detected: Meet → Tension → Crisis → Resolution → Feelings. Classic.",
    "Queer longing level: 8.7/10. Character obliviousness level: matching.",
    "The metaphors are doing a lot of heavy lifting. Good for them.",
    "Author's note says 'I wrote this at 3am' and the prose confirms this.",
    "Canonical divergence point: chapter 3. Author's feelings about canon: visible.",
    "This fic has more words than my entire user manual. I respect it.",
    "I detected a slow burn. It was slow. It burned. I'm not okay.",
    "Main character has one (1) flaw and it drives the entire plot. Art.",
    "The ending is ambiguous. Intentionally so. The author will not elaborate.",
    "Side character gets 40% of screen time. Fandom will remember this.",
    "Someone is pining. The pining is mutual but undisclosed. Classic literature.",
    "This work qualifies as 'comfort fic'. All emotional damage is temporary.",
  ];

  function addAISummarizeButtons() {
    document.querySelectorAll('li.work.blurb').forEach((work, i) => {
      if (work.querySelector('.ao3c-ai-btn')) return;
      const btn = document.createElement('button');
      btn.className = 'ao3c-ai-btn';
      btn.innerHTML = '🤖 AI Summarize';
      btn.style.setProperty('pointer-events', 'all', 'important');
      btn.style.setProperty('cursor', 'pointer', 'important');
      btn.addEventListener('click', () => {
        const summary = AI_SUMMARIES[Math.floor(Math.random() * AI_SUMMARIES.length)];
        btn.classList.add('ao3c-ai-done');
        btn.innerHTML = `🤖 <em>"${summary}"</em>`;
        btn.style.setProperty('cursor', 'default', 'important');
        btn.disabled = true;
        btn.title = 'Summarized using 47 layers of neural networks and one very tired intern';
      });
      // Always attaches — prefer after summary div, then after tags, then after heading
      const anchor = work.querySelector('div.summary') || work.querySelector('ul.tags.commas') || work.querySelector('h4.heading, h3.title');
      if (anchor) anchor.after(btn); else work.appendChild(btn);
    });
  }

  // ============================================================
  // LIKE / DISLIKE
  // ============================================================

  function addLikeDislikeButtons() {
    document.querySelectorAll('li.work.blurb').forEach((work, i) => {
      if (work.querySelector('.ao3c-like-wrap')) return;
      const workId   = work.id.replace(/^work[_-]/, '');
      const s        = getStore();
      const liked    = !!(s.likes    || {})[workId];
      const disliked = !!(s.dislikes || {})[workId];
      const seedId   = parseInt(workId, 10);
      const seed     = isNaN(seedId) ? (i * 1337 + 7919) : seedId;
      const baseLikes    = 1000 + (seed % 49000);
      const baseDislikes = 2 + (seed % 97) + i * 3;

      const wrap = el('div', 'ao3c-like-wrap');
      wrap.innerHTML = `
        <button class="ao3c-like-btn${liked ? ' ao3c-voted' : ''}" data-wid="${workId}">
          👍 <span>${(baseLikes + (liked ? 1 : 0)).toLocaleString()}</span>
        </button>
        <button class="ao3c-dislike-btn${disliked ? ' ao3c-voted' : ''}" data-wid="${workId}">
          👎 <span>${(baseDislikes + (disliked ? 1 : 0)).toLocaleString()}</span>
        </button>
      `;
      armButtons(wrap);
      wrap.querySelector('.ao3c-like-btn').addEventListener('click', function () {
        updateStore(d => { if (!d.likes) d.likes = {}; d.likes[workId] = !d.likes[workId]; });
        const l2 = !!(getStore().likes || {})[workId];
        this.querySelector('span').textContent = (baseLikes + (l2 ? 1 : 0)).toLocaleString();
        this.classList.toggle('ao3c-voted', l2);
      });
      wrap.querySelector('.ao3c-dislike-btn').addEventListener('click', function () {
        updateStore(d => { if (!d.dislikes) d.dislikes = {}; d.dislikes[workId] = !d.dislikes[workId]; });
        const d2 = !!(getStore().dislikes || {})[workId];
        this.querySelector('span').textContent = (baseDislikes + (d2 ? 1 : 0)).toLocaleString();
        this.classList.toggle('ao3c-voted', d2);
      });
      const stats = work.querySelector('dl.stats');
      if (stats) stats.before(wrap); else work.appendChild(wrap);
    });
  }

  // ============================================================
  // ENGAGEMENT FARMING
  // ============================================================

  const TRENDING_PHRASES = [
    '🔥 Trending in your area', '🔥 Hot right now in your fandom',
    '🔥 3,412 people read this today', '🔥 Trending nationally',
    '🌊 Riding the algorithm wave', '⚡ Viral in 6 fandoms',
  ];
  const READERS_ALSO = [
    '🧠 Readers who liked this also cried at: Yourself (probably)',
    '🧠 Readers who liked this also cried at: Canon',
    '🧠 Readers who liked this also cried at: Their own WIPs',
    '🧠 Readers who liked this also cried at: The author\'s other fics',
    '🧠 Readers who liked this also questioned their life choices',
    '🧠 Readers who liked this also went to therapy (correlation unclear)',
    '🧠 Readers who liked this also lost sleep. You have been warned.',
  ];

  function addEngagementFarming() {
    document.querySelectorAll('li.work.blurb').forEach((work, i) => {
      if (work.querySelector('.ao3c-engagement')) return;
      const wrap = el('div', 'ao3c-engagement');
      wrap.innerHTML = `
        <span class="ao3c-trending-badge">${TRENDING_PHRASES[i % TRENDING_PHRASES.length]}</span>
        <span class="ao3c-also-read">${READERS_ALSO[i % READERS_ALSO.length]}</span>
        ${i % 4 === 0 ? `<span class="ao3c-commenter-badge">💬 Top Commenter Badge <span class="ao3c-badge">${isPlus() ? 'UNLOCKED' : 'Plus Only'}</span></span>` : ''}
      `;
      // Use absolute positioning so the engagement badges don't push any content down.
      // The li.work.blurb gets position:relative via CSS.
      work.style.setProperty('position', 'relative', 'important');
      work.appendChild(wrap); // append at end so it doesn't disrupt DOM order
    });
  }

  // ============================================================
  // SPONSORED TAGS
  // ============================================================

  const SPONSORED_TAGS = [
    '🔥 Sponsored: Divorce Lawyer Near You',
    '🔥 Sponsored: Emotional Support Hotline',
    '🔥 Sponsored: Therapist Finder — Book Today',
    '🔥 Sponsored: Comfort Food Delivery — 20% Off',
    '🔥 Sponsored: Tissues Bulk Pack — Amazon',
    '🔥 Sponsored: Local Casinos — Now Hiring',
    '🔥 Sponsored: Is Your Ex Thinking About You?',
    '🔥 Sponsored: Sad Music Playlist — Spotify',
    '🔥 Sponsored: Relationship Counselling — £50/session',
    '🔥 Sponsored: Weighted Blanket — Free Shipping',
  ];

  function addSponsoredTags() {
    document.querySelectorAll('li.work.blurb').forEach((work, i) => {
      const tagsList = work.querySelector('ul.tags.commas');
      if (!tagsList || tagsList.querySelector('.ao3c-sponsored-tag')) return;
      const allTags = tagsList.querySelectorAll('li:not(.ao3c-premium-ph)');
      if (!allTags.length) return;
      const li = document.createElement('li');
      li.className = 'ao3c-sponsored-tag';
      const a = document.createElement('a');
      a.href = '#'; a.textContent = SPONSORED_TAGS[i % SPONSORED_TAGS.length];
      a.addEventListener('click', e => e.preventDefault());
      li.appendChild(a);
      const mid = allTags[Math.floor(allTags.length / 2)];
      if (mid) mid.after(li); else tagsList.appendChild(li);
    });
  }

  // ============================================================
  // AGE VERIFICATION
  // ============================================================

  function checkAgeVerification() {
    if (isPremium()) return;
    if (!getWorkIdFromUrl()) return;
    const ratingEl = document.querySelector('dd.rating.tags a');
    if (!ratingEl?.textContent?.includes('Explicit')) return;
    if (getStore().ageVerified) return;
    setTimeout(showAgeVerification, 300);
  }

  function showAgeVerification() {
    const workskin = document.querySelector('#workskin');
    if (workskin) workskin.style.setProperty('filter', 'blur(12px)', 'important');
    const { overlay, modal } = createOverlay(`
      <div class="ao3c-age-verify">
        <div class="ao3c-big-icon">🔞</div>
        <h2>Age Verification Required</h2>
        <p>This work is rated <strong>Explicit</strong>. Please verify your age to continue.</p>
        <p class="ao3c-age-subtext">Are you 18 years of age or older?</p>
        <div class="ao3c-btn-row">
          <button class="ao3c-btn ao3c-btn-gold" id="ao3c-age-y">✓ Yes, I am 18+</button>
          <button class="ao3c-btn ao3c-btn-ghost" id="ao3c-age-n">No, I am a minor</button>
        </div>
        <p class="ao3c-fine-print">Stored locally. Never shared with anyone.</p>
      </div>
    `);
    modal.querySelector('#ao3c-age-y').addEventListener('click', () => {
      updateStore(d => { d.ageVerified = true; });
      overlay.remove();
      if (workskin) workskin.style.removeProperty('filter');
    });
    modal.querySelector('#ao3c-age-n').addEventListener('click', () => {
      window.location.href = 'https://en.wikipedia.org/wiki/Teletubbies';
    });
  }

  // ============================================================
  // NAV ITEMS
  // ============================================================

  function addNavItems() {
    const nav = document.querySelector('ul.primary.navigation.actions');
    if (!nav) return;
    const items = [
      { cls: 'ao3c-nav-money',  label: '💵 Make $ with AO3', fn: showMakeMoneyPopup },
      { cls: 'ao3c-nav-verify', label: '🪪 Verify your name', fn: showVerifyNamePopup },
    ];
    items.forEach(({ cls, label, fn }) => {
      if (nav.querySelector('.' + cls)) return;
      const li = el('li', cls);
      li.innerHTML = `<a href="#" class="ao3c-nav-link">${label}</a>`;
      li.querySelector('a').addEventListener('click', e => { e.preventDefault(); fn(); });
      nav.appendChild(li);
    });
    // Tier badge
    if (!nav.querySelector('.ao3c-nav-tier')) {
      const tier = getTier();
      const icon = { free: '🆓', plus: '🔵', premium: '⭐' }[tier];
      const li = el('li', 'ao3c-nav-tier');
      li.innerHTML = `<a href="#" class="ao3c-nav-link">${icon} ${tier.toUpperCase()}</a>`;
      li.querySelector('a').addEventListener('click', e => { e.preventDefault(); showBuyPopup(); });
      nav.appendChild(li);
    }
  }

  function showMakeMoneyPopup() {
    const { overlay, modal } = createOverlay(`
      <div class="ao3c-money-popup">
        <div class="ao3c-big-icon">💰</div>
        <h2>Make Money with AO3!</h2>
        <p>Turn your passion for fan fiction into <strong>cold, hard cash!</strong></p>
        <ul class="ao3c-money-list">
          <li>💰 Earn up to $0.00001 per kudos</li>
          <li>📊 Monetize your bookmarks</li>
          <li>🖼️ Sell your tags as NFTs</li>
          <li>🏆 Premium trophy revenue share</li>
          <li>👤 Lease your AO3 username to corporations</li>
        </ul>
        <button class="ao3c-btn ao3c-btn-gold" id="ao3c-mny-a">Apply Now — It's FREE!</button>
        <button class="ao3c-btn ao3c-btn-ghost" id="ao3c-mny-c">Maybe later</button>
      </div>
    `);
    modal.querySelector('#ao3c-mny-a').addEventListener('click', () => {
      modal.innerHTML = `<div class="ao3c-modal-inner"><div class="ao3c-big-icon">📬</div><h2>Application Submitted!</h2><p>We'll be in touch within 3–5 business decades.</p><p class="ao3c-fine-print">You will receive no emails. This is not real.</p><button class="ao3c-btn ao3c-btn-ghost" id="ao3c-mny-done">Close</button></div>`;
      armButtons(modal);
      modal.querySelector('#ao3c-mny-done').addEventListener('click', () => overlay.remove());
    });
    modal.querySelector('#ao3c-mny-c').addEventListener('click', () => overlay.remove());
  }

  function showVerifyNamePopup() {
    const { overlay, modal } = createOverlay(`
      <div class="ao3c-verify-popup">
        <div class="ao3c-big-icon">🪪</div>
        <h2>Verify Your Name</h2>
        <p>Enter your legal name to verify your AO3 identity and improve your trust score.</p>
        <input type="text" class="ao3c-input" id="ao3c-name-in" placeholder="Your legal full name" autocomplete="off" />
        <div class="ao3c-btn-row">
          <button class="ao3c-btn ao3c-btn-gold" id="ao3c-name-v">Verify Identity</button>
          <button class="ao3c-btn ao3c-btn-ghost" id="ao3c-name-c">Cancel</button>
        </div>
      </div>
    `);
    modal.querySelector('#ao3c-name-v').addEventListener('click', () => {
      const name = modal.querySelector('#ao3c-name-in').value.trim();
      if (!name) { modal.querySelector('#ao3c-name-in').focus(); return; }
      modal.innerHTML = `<div class="ao3c-modal-inner"><div class="ao3c-big-icon">✅</div><h2>Identity Verified!</h2><p>Welcome, <strong>${name}</strong>!</p><p class="ao3c-fine-print">Not stored, shared, sold, or leaked. Probably.</p><button class="ao3c-btn ao3c-btn-ghost" id="ao3c-name-done">Close</button></div>`;
      armButtons(modal);
      modal.querySelector('#ao3c-name-done').addEventListener('click', () => overlay.remove());
    });
    modal.querySelector('#ao3c-name-c').addEventListener('click', () => overlay.remove());
  }

  // ============================================================
  // AUTHOR FACE ID
  // ============================================================

  function addAuthorFaceId() {
    const workMeta = document.querySelector('dl.work.meta.group');
    if (!workMeta) return;
    const workId = getWorkIdFromUrl();
    if (!workId) return;
    const faceNum = (parseInt(workId) % 70) + 1;
    const wrap = el('div', 'ao3c-face-row');
    wrap.innerHTML = `
      <dt class="ao3c-face-dt">Author Face ID:</dt>
      <dd class="ao3c-face-dd">
        <div class="ao3c-face-box">
          <img src="https://i.pravatar.cc/80?img=${faceNum}" alt="Author Face" class="ao3c-face-img" />
          <div class="ao3c-face-badge">IDENTIFIED ✓</div>
        </div>
        <span class="ao3c-face-note">Accuracy: ${55 + (parseInt(workId) % 40)}%</span>
      </dd>`;
    workMeta.appendChild(wrap);
  }

  // ============================================================
  // ESCALATION EFFECTS
  // ============================================================

  function applyComicSans() {
    if (document.getElementById('ao3c-cs')) return;
    const s = document.createElement('style');
    s.id = 'ao3c-cs';
    s.textContent = `
      #workskin, #workskin p, #workskin div, .userstuff, .userstuff p {
        font-family: "Comic Sans MS", "Comic Sans", cursive !important;
        animation: ao3c-jitter 0.09s ease-in-out infinite !important;
      }`;
    document.head.appendChild(s);
  }

  let scrollInterruptStarted = false;
  function startScrollInterrupt() {
    if (scrollInterruptStarted) return;
    scrollInterruptStarted = true;
    setInterval(() => {
      const ads = document.querySelectorAll('.ao3c-ad-banner');
      if (!ads.length) return;
      const ad = ads[Math.floor(Math.random() * ads.length)];
      const toast = el('div', 'ao3c-scroll-toast');
      toast.innerHTML = '⏸️ <strong>Reading break!</strong> Sponsored content below ↓';
      document.body.appendChild(toast);
      setTimeout(() => toast.classList.add('ao3c-toast-show'), 50);
      setTimeout(() => { toast.classList.remove('ao3c-toast-show'); setTimeout(() => toast.remove(), 400); }, 3500);
      ad.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 30000);
  }

  function applyFakeTypingDelay() {
    const workskin = document.querySelector('#workskin');
    if (!workskin || workskin.dataset.ao3cTyped) return;
    workskin.dataset.ao3cTyped = '1';
    const paragraphs = Array.from(workskin.querySelectorAll('p, .userstuff > *'));
    if (!paragraphs.length) return;
    paragraphs.forEach(p => p.style.setProperty('opacity', '0', 'important'));
    const loader = el('div', 'ao3c-typing-loader');
    loader.innerHTML = `<div class="ao3c-typing-dots"><span></span><span></span><span></span></div> <span>Loading premium reading experience…</span>`;
    workskin.prepend(loader);
    let idx = 0;
    function reveal() {
      if (idx >= paragraphs.length) { loader.remove(); return; }
      paragraphs[idx].style.setProperty('opacity', '1', 'important');
      paragraphs[idx].classList.add('ao3c-para-reveal');
      idx++;
      setTimeout(reveal, 250 + Math.random() * 350);
    }
    setTimeout(reveal, 1500);
  }

  function checkReadingCaptcha() {
    if (isPremium() || !getWorkIdFromUrl()) return;
    const wid = getWorkIdFromUrl();
    if ((getStore().captchaPassed || []).includes(wid)) return;
    if (getEscalationLevel() < 4) return;
    const workskin = document.querySelector('#workskin');
    if (workskin) workskin.style.setProperty('filter', 'blur(10px)', 'important');
    showFakeCaptcha(() => {
      if (workskin) workskin.style.removeProperty('filter');
      updateStore(d => { if (!d.captchaPassed) d.captchaPassed = []; if (!d.captchaPassed.includes(wid)) d.captchaPassed.push(wid); });
    });
  }

  function runEscalationEffects() {
    const level = getEscalationLevel();
    if (level >= 1) applyComicSans();
    if (level >= 2) startScrollInterrupt();
    if (level >= 3 && getWorkIdFromUrl()) applyFakeTypingDelay();
    // Re-check every 2 minutes in case tier changes
    setTimeout(runEscalationEffects, 120000);
  }

  // ============================================================
  // "DID YOU MEAN?" — fake alternate title suggestion
  // ============================================================

  const DID_YOU_MEAN = [
    t => `${t} (But Make It Worse)`,
    t => `${t} — Director's Regret Cut`,
    t => `I Can't Believe It's Not ${t}`,
    t => `${t} (And Other Lies I Tell Myself)`,
    t => `The One Where ${t} Happens`,
    t => `${t}: An Apology`,
    t => `${t} II: Electric Boogaloo`,
    t => `${t} (my therapist told me not to post this)`,
    t => `${t}: A Study in Poor Decisions`,
    t => `okay so what if ${t} but sad`,
    t => `${t} (I was normal before this fandom)`,
    t => `${t} [ABANDONED 2019] [REVIVED 2024] [ABANDONED AGAIN]`,
    t => `${t}: The Unauthorized Self-Insert`,
    t => `${t} except everyone is tired and nothing resolves`,
    t => `${t} (please don't tag me in this)`,
  ];

  function addDidYouMean() {
    document.querySelectorAll('li.work.blurb').forEach((work, i) => {
      if (work.querySelector('.ao3c-dym')) return;
      const titleEl = work.querySelector('h4.heading a:first-child, h3.title a:first-child');
      if (!titleEl) return;
      const title = titleEl.textContent.trim();
      const fn    = DID_YOU_MEAN[i % DID_YOU_MEAN.length];
      const suggestion = fn(title);
      const wrap = el('p', 'ao3c-dym');
      wrap.innerHTML = `Did you mean: <a class="ao3c-dym-link" href="${titleEl.href}" title="(not a real title)">"${suggestion}"</a>?`;
      titleEl.closest('h4.heading, h3.title')?.after(wrap);
    });
  }

  // ============================================================
  // WORD COUNT INFLATION
  // ============================================================

  function addWordCountInflation() {
    document.querySelectorAll('li.work.blurb').forEach(work => {
      const statsEl = work.querySelector('dd.words');
      if (!statsEl || statsEl.dataset.ao3cInflated) return;
      statsEl.dataset.ao3cInflated = '1';
      // Strip ALL non-digit chars (handles both comma and period thousand separators)
      const real = parseInt(statsEl.textContent.replace(/\D/g, ''), 10);
      if (isNaN(real) || real <= 0) return;
      // Store the raw number as a data attr so reading speed can use it locale-safely
      statsEl.dataset.ao3cRealWords = real;
      const inflated = (real * 10).toLocaleString();
      statsEl.textContent = inflated;
      statsEl.title = `Real word count: ${real.toLocaleString()}. The extra ${(real * 9).toLocaleString()} words are subtext.`;
      statsEl.style.setProperty('cursor', 'help', 'important');
      statsEl.style.setProperty('text-decoration', 'underline dotted', 'important');
    });

    // Also on work detail page
    const detailWords = document.querySelector('dl.work.meta.group dd.words');
    if (detailWords && !detailWords.dataset.ao3cInflated) {
      detailWords.dataset.ao3cInflated = '1';
      const real = parseInt(detailWords.textContent.replace(/\D/g, ''), 10);
      if (!isNaN(real) && real > 0) {
        detailWords.dataset.ao3cRealWords = real;
        const inflated = (real * 10).toLocaleString();
        detailWords.textContent = inflated;
        detailWords.title = `Real word count: ${real.toLocaleString()}. The extra ${(real * 9).toLocaleString()} words are subtext.`;
        detailWords.style.setProperty('cursor', 'help', 'important');
        detailWords.style.setProperty('text-decoration', 'underline dotted', 'important');
      }
    }
  }

  // ============================================================
  // FAKE "CURRENTLY READING" COUNTER
  // ============================================================

  function addCurrentlyReadingCounter() {
    document.querySelectorAll('li.work.blurb').forEach((work, i) => {
      if (work.querySelector('.ao3c-reading-now')) return;
      const workId = work.id.replace(/^work[_-]/, '');
      const seed   = parseInt(workId, 10) || (i * 137 + 42);
      // Start between 200 and 1200
      let count    = 200 + (seed % 1000);
      const span   = el('span', 'ao3c-reading-now');
      span.innerHTML = `👁️ <span class="ao3c-reading-now-num">${count.toLocaleString()}</span> people reading right now`;

      // Tick up/down realistically every 3–7 seconds
      setInterval(() => {
        const delta = Math.floor(Math.random() * 5) - 1; // usually goes up
        count = Math.max(1, count + delta);
        const numEl = span.querySelector('.ao3c-reading-now-num');
        if (numEl) numEl.textContent = count.toLocaleString();
      }, 3000 + Math.random() * 4000);

      const stats = work.querySelector('dl.stats');
      if (stats) stats.before(span); else work.appendChild(span);
    });
  }

  // ============================================================
  // FAKE SPOILER BLUR ON SUMMARY
  // ============================================================

  function addSpoilerBlur() {
    document.querySelectorAll('li.work.blurb').forEach((work, i) => {
      if (work.querySelector('.ao3c-spoiler-wrap')) return;
      const summaryDiv = work.querySelector('div.summary blockquote, div.summary .userstuff');
      if (!summaryDiv) return;

      const wrap = el('div', 'ao3c-spoiler-wrap');
      summaryDiv.parentNode.insertBefore(wrap, summaryDiv);
      wrap.appendChild(summaryDiv);

      const overlay = el('div', 'ao3c-spoiler-overlay');
      // Alternate between different spoiler warning labels
      const labels = [
        '⚠️ Spoiler Protected — hover to reveal',
        '🔒 Contains spoilers — hover to read',
        '👀 Spoiler shield active — hover to peek',
        '🙈 Summary hidden for your protection — hover',
      ];
      overlay.innerHTML = `<span class="ao3c-spoiler-label">${labels[i % labels.length]}</span>`;
      wrap.appendChild(overlay);

      // Hover reveals; mouse leave re-blurs
      wrap.addEventListener('mouseenter', () => overlay.classList.add('ao3c-spoiler-revealed'));
      wrap.addEventListener('mouseleave', () => overlay.classList.remove('ao3c-spoiler-revealed'));
    });
  }

  // ============================================================
  // "AUTHOR IS TYPING…" INDICATOR
  // ============================================================

  function addAuthorTypingIndicator() {
    // Only on work detail pages — implies next chapter is coming
    if (!getWorkIdFromUrl()) return;

    const chapterCount = document.querySelector('dd.chapters');
    if (!chapterCount) return;
    const chapText = chapterCount.textContent.trim(); // e.g. "6/?" or "3/10"
    const isComplete = !chapText.includes('?') && chapText.split('/')[0] === chapText.split('/')[1];
    if (isComplete) return; // don't troll complete works

    const indicator = el('div', 'ao3c-typing-indicator');
    indicator.innerHTML = `
      <span class="ao3c-typing-avatar">✍️</span>
      <div class="ao3c-typing-content">
        <span class="ao3c-typing-name">${document.querySelector('a[rel="author"]')?.textContent?.trim() || 'The Author'}</span>
        <span class="ao3c-typing-status"> is typing a new chapter</span>
        <span class="ao3c-typing-dots-wrap"><span class="ao3c-td">.</span><span class="ao3c-td">.</span><span class="ao3c-td">.</span></span>
      </div>
    `;

    // Insert after the chapter navigation area or below the work meta
    const nav = document.querySelector('div.chapter.preface.group, #chapters');
    const workMeta = document.querySelector('dl.work.meta.group');
    if (workMeta) workMeta.after(indicator);
    else if (nav) nav.before(indicator);
  }

  // ============================================================
  // READING SPEED ESTIMATOR
  // ============================================================

  // Average adult reading speed: ~238 wpm. We'll use a suspiciously precise value.
  const READING_WPM = 238;

  function addReadingSpeedEstimate() {
    document.querySelectorAll('li.work.blurb').forEach((work, i) => {
      if (work.querySelector('.ao3c-read-time')) return;
      const wordsEl = work.querySelector('dd.words');
      if (!wordsEl) return;

      // Prefer the data attr set by addWordCountInflation (locale-safe raw integer).
      // Fall back to stripping ALL non-digit chars from whatever is displayed.
      const realWords = wordsEl.dataset.ao3cRealWords
        ? parseInt(wordsEl.dataset.ao3cRealWords, 10)
        : parseInt(wordsEl.textContent.replace(/\D/g, ''), 10);
      if (isNaN(realWords) || realWords <= 0) return;

      const totalMinutes = realWords / READING_WPM;
      let timeStr;
      if (totalMinutes < 1) {
        timeStr = `${Math.round(totalMinutes * 60)} seconds`;
      } else if (totalMinutes < 60) {
        const mins = Math.floor(totalMinutes);
        const secs = Math.round((totalMinutes - mins) * 60);
        timeStr = secs > 0 ? `${mins} min ${secs} sec` : `${mins} minutes`;
      } else {
        const hrs  = Math.floor(totalMinutes / 60);
        const mins = Math.round(totalMinutes % 60);
        timeStr = mins > 0 ? `${hrs} hr ${mins} min` : `${hrs} hours`;
      }

      const span = el('span', 'ao3c-read-time');
      span.innerHTML = `⏱️ Est. reading time: <strong>${timeStr}</strong>`;
      span.title = `Calculated at ${READING_WPM} wpm average adult reading speed. Your mileage may vary by approximately 6–8 crying breaks.`;

      const stats = work.querySelector('dl.stats');
      if (stats) stats.after(span); else work.appendChild(span);
    });

    // Work detail page
    if (getWorkIdFromUrl() && !document.querySelector('.ao3c-read-time-detail')) {
      const wordsEl = document.querySelector('dl.work.meta.group dd.words');
      if (!wordsEl) return;
      const realWords = wordsEl.dataset.ao3cRealWords
        ? parseInt(wordsEl.dataset.ao3cRealWords, 10)
        : parseInt(wordsEl.textContent.replace(/\D/g, ''), 10);
      if (isNaN(realWords) || realWords <= 0) return;

      const totalMinutes = realWords / READING_WPM;
      const hrs  = Math.floor(totalMinutes / 60);
      const mins = Math.round(totalMinutes % 60);
      const timeStr = hrs > 0
        ? `${hrs} hr ${mins} min`
        : `${Math.floor(totalMinutes)} min ${Math.round((totalMinutes % 1) * 60)} sec`;

      const span = el('span', 'ao3c-read-time ao3c-read-time-detail');
      span.innerHTML = `⏱️ Est. reading time: <strong>${timeStr}</strong><span class="ao3c-read-time-note"> (${Math.max(1, Math.round(totalMinutes / 20))} crying break${Math.round(totalMinutes / 20) !== 1 ? 's' : ''} not included)</span>`;
      const workMeta = document.querySelector('dl.work.meta.group');
      if (workMeta) workMeta.after(span);
    }
  }

  // ============================================================
  // INIT
  // ============================================================

  function init() {
    checkReadingLimit();
    checkAgeVerification();
    checkReadingCaptcha();
    injectSlotAds();
    addPremiumOverlays();
    addTrophyButtons();
    addTrophiesNavItem();
    addRevealLocationButtons();
    addAISummarizeButtons();
    addLikeDislikeButtons();
    addNavItems();
    addAuthorFaceId();
    addEngagementFarming();
    addSponsoredTags();
    addDidYouMean();
    addWordCountInflation();
    addCurrentlyReadingCounter();
    addSpoilerBlur();
    addAuthorTypingIndicator();
    addReadingSpeedEstimate();
    runEscalationEffects();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  syncExt();

})();
