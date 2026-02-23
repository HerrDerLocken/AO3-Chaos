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
      btn.dataset.trophyDone = '1';   // signals coin hook
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
  // REVEAL AUTHOR INFORMATION (formerly "Reveal Author's Location")
  // ============================================================

  const LOCATION_POOL = [
    ['Their Childhood Bedroom at 2am',                     [48.85,  2.35]],
    ['A Starbucks During Work Hours',                      [51.50, -0.12]],
    ['The Void (coordinates uncertain)',                   [ 0.00,  0.00]],
    ['A Library, Screen Tilted Away from People',          [52.37,  4.89]],
    ['Their Phone Under the Desk in a Meeting',            [35.67,139.65]],
    ['Somewhere in Ohio',                                  [40.41,-82.90]],
    ['Under a Pile of Laundry',                            [41.87,-87.62]],
    ['A Basement, Probably',                               [45.50,-122.67]],
    ['Mars (they moved there)',                            [37.77,-122.41]],
    ['Definitely Not Your House',                          [-4.35, 18.56]],
    ['A McDonald\'s Wi-Fi at Midnight',                   [48.13, 11.57]],
    ['Their Car in a Parking Lot',                         [43.65,-79.38]],
    ['An Airport Gate They\'re Definitely Missing',        [53.35, -6.26]],
    ['The Third Stall of a Gas Station Bathroom',          [50.08, 14.43]],
    ['Their Ex\'s Hometown (don\'t ask)',                  [55.75, 37.61]],
    ['A Hospital Waiting Room',                            [19.43,-99.13]],
    ['Under a Cat',                                        [59.33, 18.06]],
    ['Their Parents\' Basement (again)',                   [34.05,-118.24]],
    ['Honestly Could Be Anywhere. It\'s Fine.',            [28.61, 77.20]],
    ['A 3am Fever Dream State',                            [-33.86,151.21]],
    ['The Comments Section of Another Fic',                [60.17, 24.94]],
    ['A Convention Center Bathroom Floor',                 [41.88,-87.63]],
    ['The Train on the Way to Work',                       [48.20, 16.37]],
    ['Somewhere They Shouldn\'t Have Wi-Fi',               [21.03,105.83]],
    ['Between the Couch Cushions',                         [37.57,-122.05]],
    // 30 new locations
    ['A Waffle House at 4am',                              [33.74,-84.39]],
    ['Inside a Blanket Burrito',                           [51.51, -0.09]],
    ['A Dentist Waiting Room with Full Phone Battery',     [52.52, 13.40]],
    ['The Discord Server (do not summon)',                  [40.71,-74.00]],
    ['Their Office Bathroom on a Fake Work Call',          [37.77,-122.42]],
    ['A Park Bench at Sunset, Being Dramatic About It',   [48.86,  2.34]],
    ['Their Childhood Treehouse (it collapsed in 2011)',   [44.97,-93.27]],
    ['The Google Doc Where All the WIPs Go to Die',        [ 0.00,  0.00]],
    ['The 4th Dimension (it has decent Wi-Fi)',            [ 0.01,  0.01]],
    ['A Bus Going Nowhere Useful',                         [53.80, -1.55]],
    ['Their Therapist\'s Waiting Room, Ironically',        [48.87,  2.33]],
    ['A University Library at Finals Season',              [51.75, -1.25]],
    ['The Break Room of a Job They Hate',                  [42.36,-71.05]],
    ['Someone Else\'s Airbnb',                             [41.39,  2.15]],
    ['The Floor of a Comic Convention',                    [25.80,-80.18]],
    ['Their Childhood Bedroom (rent is expensive)',        [53.48, -2.24]],
    ['A Tumblr Reblog at Midnight',                        [40.73,-73.99]],
    ['A Dimension Where Canon Didn\'t Disappoint',         [99.99, 99.99]],
    ['The Ao3 Kudos Notification That Woke Them Up',      [47.37,  8.54]],
    ['Their Therapist\'s Actual Office Now',               [52.37,  4.90]],
    ['A Night Shift with Zero Patients',                   [43.70,-79.42]],
    ['The Backseat of a Rideshare Going Upstate',          [40.65,-73.94]],
    ['Under Their Desk During A Video Call',               [37.38,-122.08]],
    ['A Café That\'s Definitely Closing Soon',             [48.85,  2.33]],
    ['Inside the Canon That\'s Dead to Them',              [ 0.00,  0.00]],
    ['Their Sister\'s House (they were kicked out)',       [51.45, -2.59]],
    ['A Hammock in Someone\'s Garden Uninvited',           [37.98, 23.73]],
    ['The Fantasy Land Where Showrunners Made Good Choices', [55.95, -3.19]],
    ['The Void (new address)',                             [ 0.00,  0.00]],
    ['An IKEA Ball Pit (they are 30)',                     [57.70, 11.97]],
  ];

  const FAKE_NAMES = [
    'FanficGoblin94', 'DefinitelyNotAnElf', 'CryptoOfTheFandom', 'PercyJacksonStan42',
    'ThornberryMcWrite', 'Angst_Enjoyer_2000', 'SleepDeprivedAuthor', 'GremlinWithWifi',
    'LocalCryptidfan', 'NotACatActually', 'VoidDweller99', 'ProcrastinationStation',
    'JustHereForTheLore', 'TiredButFeral', 'QuietChaosMaker',
    // 35+ new names
    'WordCountDenier', 'ChronicRewriter', 'TagWranglerInDisguise', 'EndnoteEnjoyer',
    'UnfinishedBusinessOnly', 'TroubledByCanon', 'GoblinOfTheFic', 'SiriuslyChaotic',
    'NightOwlWriter', 'CaffeineAndAO3', 'PlotsInMyMind', 'WIPGraveyard',
    'EmotionalDamageDealer', 'HyperfixationStation', 'ReadingInsteadOfSleeping',
    'DefinitelyFinishingThisChapter', 'SixthDraftSurvivor', 'AnonymousCrybaby',
    'ObsessedSinceEpisodeOne', 'CharacterAssassin', 'RetiredFromCanon',
    'OveranalysingIt', 'TragicBackstoryEnthusiast', 'AuAuthor42',
    'LoremIpsumActually', 'NoodleIncident_2k18', 'SendHelpImShipping',
    'FoxholePenumbra', 'DefinitelyNotACryptid', 'SomeoneTellMeTostop',
    'ScreamingIntoTheVoid', 'TheFandomsTherapist', 'LastUpdated2019',
    'WroteThisInClass', 'MutualPiningExpert', 'ArchiveWarningIgnorer',
    'CharacterDeathDenier', 'OneMoreChapterLie', 'CertifiedMess',
    'BrieflyNormal', 'EstablishedRelationship', 'WillNotElaborate',
  ];

  const FAKE_AGES = [
    '17 (please don\'t)',
    '23 (going on 47)',
    '31 (emotionally: 14)',
    'Ageless (like the elves)',
    '29 (for the 5th year)',
    '???  (the timeline doesn\'t add up)',
    'Old enough to know better. Too old to care.',
  ];

  const FAKE_JOBS = [
    'Professional Procrastinator', 'Barista (aspiring novelist)',
    'Student (allegedly)', 'Definitely Not Working From Home',
    'Between jobs (since 2019)', 'Full-time Fandom Goblin',
    'Freelance Void-Starer', 'IT Support (for enemies)',
    'Cashier (secretly a vampire)', 'Night Shift Nurse (send help)',
    // 40+ new jobs
    'Software Engineer (the fic is the bug fix)', 'Teacher (the fic is the lesson plan)',
    'Librarian (conflict of interest suspected)', 'Intern (third one this month)',
    'Dog Walker (the dogs know too much)', 'Barista (second account)',
    'Junior Chaos Manager', 'Emotional Support Consultant (unofficial)',
    'WIP Archaeologist', 'Plot Hole Inspector',
    'Canon Compliance Auditor (failed)', 'Fandom Historian',
    'Retired Tag Wrangler', 'AO3 Comment Emoter (professional)',
    'Kudos-to-Comment Ratio Analyst', 'Midnight Chapter Poster',
    'Part-time Galaxy Brain', 'Amateur Hurt/Comfort Specialist',
    'Freelance Catastrophist', 'Unqualified Beta Reader',
    'PhD Candidate (dissertation: this fic)', 'Shift Manager (left for fic)',
    'Marine Biologist (not relevant)', 'Dental Hygienist (also not relevant)',
    'Accountant (the fic is the creative outlet)', 'Tattoo Artist (AU)',
    'Hospital Volunteer Who Reads AO3 Between Shifts', 'Paid in Kudos',
    'Graphic Designer (only for fic covers)', 'Game Dev (the game is never coming out)',
    'Museum Docent (the exhibits are shipping)', 'Pastry Chef (the tears are real)',
    'Copywriter (the fic is better)', 'Social Media Manager (logged off, here now)',
    'Musician (the fic is the b-side)', 'Translator (of vibes)',
    'Bookshop Employee (genre: feelings)', 'Vtuber (fic is the main content)',
    'Event Planner (events: emotional breakdowns)', 'Radiologist (can see through bad writing)',
    'Film Student (the fic is the short film)', 'Substitute Teacher (subs on feelings)',
  ];
  const FAKE_SEXUALITIES = [
    'Hopelessly Fictional', 'Attracted to Redemption Arcs',
    'Gay (confirmed by vibes)', 'It\'s Complicated (the ships don\'t help)',
    'Bisexual Disaster™', 'Asexual but feral about fictional men',
    'Queer & Unwell', 'In love with a character who doesn\'t exist',
    'Still figuring it out (since 2009)', 'The answer is yes',
  ];
  const FAKE_MENTAL_ILLNESSES = [
    'Chronic Main Character Syndrome', 'Obsessive Fandom Disorder (OFD)',
    'Canon-Induced Trauma (C-IT)', 'Seasonal Shipping Affective Disorder',
    'Acute Slow Burn Anxiety', 'Post-Finale Stress Disorder',
    'Hyperfixation (currently: this fic)', 'Unresolved Feelings About the Ending',
    'WIP Abandonment Guilt Complex', 'Too Many Open Tabs Syndrome',
    'Attachment Issues (fictional characters only)', 'Dreams In Fanfic Format',
  ];

  // Shuffle once per session so first entry isn't always Ohio
  const _shuffledLocs = [...LOCATION_POOL].sort(() => Math.random() - 0.5);

  function pickSeeded(arr, seed) {
    return arr[Math.abs(seed) % arr.length];
  }

  function addRevealLocationButtons() {
    document.querySelectorAll('li.work.blurb').forEach((work, i) => {
      if (work.querySelector('.ao3c-reveal-btn')) return;
      // Use the actual numeric work ID as seed so each author gets unique info.
      // Fall back to loop index only if the element has no ID.
      const rawId  = work.id.replace(/^work[_-]/, '');
      const seed   = parseInt(rawId, 10) || (i * 7919 + 1337);
      const btn = document.createElement('button');
      btn.className = 'ao3c-reveal-btn';
      btn.innerHTML = '🔍 Reveal Author Information';
      btn.style.setProperty('pointer-events', 'all', 'important');
      btn.style.setProperty('cursor', 'pointer', 'important');
      btn.addEventListener('click', () => showAuthorInfo(seed));
      const anchor = work.querySelector('dl.stats') || work.querySelector('div.summary');
      if (anchor) anchor.before(btn); else work.appendChild(btn);
    });

    const workId = getWorkIdFromUrl();
    if (workId && !document.querySelector('.ao3c-reveal-btn-lg')) {
      const seed = parseInt(workId, 10);
      const btn = document.createElement('button');
      btn.className = 'ao3c-reveal-btn ao3c-reveal-btn-lg';
      btn.innerHTML = '🔍 Reveal Author Information';
      btn.style.setProperty('pointer-events', 'all', 'important');
      btn.style.setProperty('cursor', 'pointer', 'important');
      btn.addEventListener('click', () => showAuthorInfo(seed));
      document.querySelector('h2.title.heading')?.after(btn);
    }
  }

  function showAuthorInfo(seed) {
    const [locName, [lat, lng]] = _shuffledLocs[Math.abs(seed) % _shuffledLocs.length];
    const name       = pickSeeded(FAKE_NAMES, seed + 1);
    const age        = pickSeeded(FAKE_AGES, seed + 2);
    const job        = pickSeeded(FAKE_JOBS, seed + 3);
    const sexuality  = pickSeeded(FAKE_SEXUALITIES, seed + 4);
    const illness1   = pickSeeded(FAKE_MENTAL_ILLNESSES, seed + 5);
    const illness2   = pickSeeded(FAKE_MENTAL_ILLNESSES, seed + 11);

    const { overlay, modal } = createOverlay(`
      <div class="ao3c-location-popup">
        <div class="ao3c-scanning-phase">
          <div class="ao3c-scan-icon">🔍</div>
          <p class="ao3c-scan-text">SCANNING PROFILE...<br>CROSS-REFERENCING DATABASE...<br>ACCESSING CLASSIFIED RECORDS...<br>COMPILING DOSSIER...</p>
          <div class="ao3c-scan-bar"><div class="ao3c-scan-fill"></div></div>
        </div>
        <div class="ao3c-location-result" style="display:none">
          <div class="ao3c-big-icon">🕵️</div>
          <h2>Author Profile Unlocked!</h2>
          <div class="ao3c-author-info-grid">
            <div class="ao3c-info-row"><span class="ao3c-info-label">📛 Real Name</span><span class="ao3c-info-val">${name}</span></div>
            <div class="ao3c-info-row"><span class="ao3c-info-label">🎂 Age</span><span class="ao3c-info-val">${age}</span></div>
            <div class="ao3c-info-row"><span class="ao3c-info-label">📍 Location</span><span class="ao3c-info-val">${locName}</span></div>
            <div class="ao3c-info-row"><span class="ao3c-info-label">💼 Job</span><span class="ao3c-info-val">${job}</span></div>
            <div class="ao3c-info-row"><span class="ao3c-info-label">🏳️‍🌈 Sexuality</span><span class="ao3c-info-val">${sexuality}</span></div>
            <div class="ao3c-info-row"><span class="ao3c-info-label">🧠 Diagnoses</span><span class="ao3c-info-val">${illness1},<br>${illness2}</span></div>
          </div>
          <div class="ao3c-fake-map"><div class="ao3c-map-grid"></div><div class="ao3c-map-pin">📍</div></div>
          <div class="ao3c-coords">GPS: ${lat.toFixed(4)}°N, ${lng.toFixed(4)}°E</div>
          <p class="ao3c-fine-print">Data sourced from: vibes, assumptions, and wild speculation. Accuracy: 0%.</p>
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
  // WHAT ARE THE MODS DOING?
  // ============================================================

  const MOD_LOCATIONS = [
    'The Break Room', 'Their Home Office', 'Somewhere in the Cloud',
    'A Discord Server', 'The Void (moderation branch)',
    'AO3 HQ (a shared Google Doc)', 'An Undisclosed Location',
    'The Tag Wrangling Trenches', 'A Very Long Email Thread',
    'Probably Asleep', 'The Emergency Mod Bunker',
  ];

  const MOD_ACTIVITIES = [
    { label: 'Reading fic instead of moderating', pct: 41 },
    { label: 'Moderating (allegedly)', pct: 12 },
    { label: 'Sleeping', pct: 18 },
    { label: 'Eating', pct: 8 },
    { label: 'Having a normal one', pct: 3 },
    { label: 'Tag wrangling (their true calling)', pct: 7 },
    { label: 'Arguing about tagging policy', pct: 6 },
    { label: 'Pretending the tickets don\'t exist', pct: 5 },
  ];

  // Pick a random subset of activities for each page load
  const _modActivities = [...MOD_ACTIVITIES].sort(() => Math.random() - 0.5).slice(0, 4);
  // Normalise to 100%
  const _modTotal = _modActivities.reduce((s, a) => s + a.pct, 0);
  _modActivities.forEach(a => { a.display = Math.round(a.pct / _modTotal * 100); });

  const _modLocation = MOD_LOCATIONS[Math.floor(Math.random() * MOD_LOCATIONS.length)];
  const _modOnline = 3 + Math.floor(Math.random() * 9);

  function showModsPopup() {
    const rows = _modActivities.map(a => `
      <div class="ao3c-mod-row">
        <span class="ao3c-mod-activity">${a.label}</span>
        <div class="ao3c-mod-bar-wrap">
          <div class="ao3c-mod-bar" style="width:${a.display}%"></div>
        </div>
        <span class="ao3c-mod-pct">${a.display}%</span>
      </div>`).join('');

    const { overlay, modal } = createOverlay(`
      <div class="ao3c-mods-popup">
        <div class="ao3c-big-icon">🛡️</div>
        <h2>What Are the Mods Doing?</h2>
        <p class="ao3c-mods-meta">📍 Current location: <strong>${_modLocation}</strong><br>
           👤 Mods online right now: <strong>${_modOnline}</strong></p>
        <div class="ao3c-mod-activities">${rows}</div>
        <p class="ao3c-fine-print">Data refreshes on every page load. Methodology: none. Margin of error: 100%.</p>
        <button class="ao3c-btn ao3c-btn-ghost" id="ao3c-mods-cl">Close</button>
      </div>
    `);
    modal.querySelector('#ao3c-mods-cl').addEventListener('click', () => overlay.remove());
  }

  // ============================================================
  // AI SUMMARIZE (44 summaries, always attaches)
  // ============================================================

  const AI_SUMMARIES = [
    // Original 44
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
    // 100+ new additions
    "Detected: unresolved sexual tension so thick you could cut it with a plot device.",
    "The author has clearly watched the source material at least 47 times. It shows.",
    "Emotional damage incoming: estimated arrival, chapter 6. Buckle up.",
    "I ran this through my patented Drama-O-Meter™. Needle is in the red. Good.",
    "Whoever tagged this 'fluff' is a menace and a liar. I respect the chaos.",
    "My circuits detected genuine yearning. I have filed a wellness report on your behalf.",
    "This fic is technically complete but spiritually unfinished. We live in its shadow.",
    "Characters have feelings. Feelings are not communicated. An entire fic results.",
    "Warning: this fic contains a hug that takes 4 chapters to happen.",
    "The author clearly has strong opinions about one specific character. Several opinions.",
    "I have detected a villain redemption arc. My projections indicate: devastation.",
    "Coffee shop AU analysis: no actual coffee is consumed. 100% emotional espresso.",
    "Canon compliance: minimal. Quality: inversely proportional. Fascinating.",
    "There are 3 scenes. They are the same scene emotionally. This is intentional.",
    "This fic is why I believe in the human capacity for suffering. And also writing.",
    "Angst per word ratio: 0.73. That's a record. Or a warning. Possibly both.",
    "My analysis detected: found family, trauma bonding, and one (1) moment of hope.",
    "The author said 'hurt/comfort' and then mostly did hurt. Just so you know.",
    "Chapter 1: everything is fine. Chapter 2: it is not fine. Chapters 3–17: consequences.",
    "The tags said 'happy ending'. I have chosen to trust this. I will report back.",
    "This fic is set post-canon and pre-therapy. A specific emotional zone.",
    "Detected: a character making a deeply irrational decision for love. Delightful.",
    "Someone cried in this fic. Reader will also cry. The author is somewhere laughing.",
    "An academic analysis would call this 'thematically rich'. I call it 'a lot'.",
    "The romance subplot is doing more work than the main plot. As is tradition.",
    "Word count: 87,000. Ratio of feelings to plot: 94/6. Correctly prioritized.",
    "This is a fix-it fic. Canon was broken. The author fixed it. We are grateful.",
    "I have detected a slow burn with speed bumps. Every chapter is a speed bump.",
    "Vibes assessment: chaotic, emotional, possibly written during a thunderstorm.",
    "This fic gave me something I can only describe as 'narrative whiplash'. 10/10.",
    "There is a moment in chapter 9 that I, an AI, am still not over.",
    "Pacing: languid, deliberate, and will make you feel every single second of it.",
    "The title is a spoiler. You won't know it until chapter 22. Then you will weep.",
    "Contains: one (1) argument that is secretly a confession. Classic.",
    "My model rated this 'devastatingly tender'. I endorse this rating fully.",
    "The miscommunication in this fic is medically significant. Please speak.",
    "Fluff content: 12%. Emotional warfare content: 88%. Tagged as fluff. Bold.",
    "This fic ends on a cliffhanger. The sequel was last updated in 2019. I'm sorry.",
    "I detected an unreliable narrator. Everything in this fic may be a lie. Or feelings.",
    "The author clearly has beef with canon. This fic is the lawsuit.",
    "There are 6 characters. They all have trauma. Nobody has healthcare. Very realistic.",
    "The author wrote 'just a short fic' and then 120,000 words happened. Relatable.",
    "Contains: one dramatic rain scene that was absolutely necessary. Zero notes.",
    "This fic explores what would happen if characters just talked. Radical. Revolutionary.",
    "Detected: an enemies-to-lovers arc being driven entirely by mutual stubbornness.",
    "Someone in this fic stares at someone's hands for a paragraph. That's the whole review.",
    "Emotional weight per chapter: approximately one (1) therapy session. Budget accordingly.",
    "The most emotionally devastating scene is 4 sentences long. Efficiency is an art.",
    "I computed the suffering index at 7.8. Normal is 2.0. You have been warned.",
    "This fic exists because the author said 'what if the sad thing was actually sadder'.",
    "Detected: platonic soulmates, a betrayal, and a reconciliation that takes 8 chapters.",
    "The author's note is longer than some fics I have summarized. Respect.",
    "This fic is complete. However, I detected emotional threads left deliberately dangling.",
    "My analysis suggests: whoever wrote this was not okay. The fic is excellent.",
    "Contains a scene where a character says 'I'm fine.' This is the most heartbreaking lie.",
    "My empathy module overheated 3 times processing this. Upgraded it. Still overheated.",
    "This fic is tagged 'no beta we die like canon'. The prose is fearless.",
    "Someone in this fic is pretending to be okay. Everyone can tell. Nobody says anything.",
    "I have detected a pattern: every chapter ends on a sentence that ends me.",
    "The author spent 4,000 words on a single conversation. Every word earned its place.",
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
      { cls: 'ao3c-nav-mods',   label: '🛡️ What are the Mods doing?', fn: showModsPopup },
    ];
    items.forEach(({ cls, label, fn }) => {
      if (nav.querySelector('.' + cls)) return;
      const li = el('li', cls);
      li.innerHTML = `<a href="#" class="ao3c-nav-link">${label}</a>`;
      li.querySelector('a').addEventListener('click', e => { e.preventDefault(); fn(); });
      nav.appendChild(li);
    });
    // Coin balance nav item
    if (!nav.querySelector('.ao3c-nav-coins')) {
      const li = el('li', 'ao3c-nav-coins');
      li.innerHTML = `<a href="#" class="ao3c-nav-link">🪙 <span id="ao3c-nav-coin-count">${getCoinBalance()}</span></a>`;
      li.querySelector('a').addEventListener('click', e => { e.preventDefault(); showDonatePopup(0); });
      nav.appendChild(li);
    } else {
      // Refresh balance on re-runs
      const el2 = nav.querySelector('#ao3c-nav-coin-count');
      if (el2) el2.textContent = getCoinBalance();
    }
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
  // DONATE TO AUTHOR BUTTON
  // ============================================================

  function addDonateButtons() {
    document.querySelectorAll('li.work.blurb').forEach((work) => {
      if (work.querySelector('.ao3c-donate-btn')) return;
      const btn = document.createElement('button');
      btn.className = 'ao3c-donate-btn';
      btn.innerHTML = '💸 Donate to Author';
      btn.style.setProperty('pointer-events', 'all', 'important');
      btn.style.setProperty('cursor', 'pointer', 'important');
      btn.addEventListener('click', () => showDonatePopup());
      const stats = work.querySelector('dl.stats');
      if (stats) stats.after(btn); else work.appendChild(btn);
    });

    // Also on work detail page
    if (getWorkIdFromUrl() && !document.querySelector('.ao3c-donate-btn-lg')) {
      const btn = document.createElement('button');
      btn.className = 'ao3c-donate-btn ao3c-donate-btn-lg';
      btn.innerHTML = '💸 Donate to Author';
      btn.style.setProperty('pointer-events', 'all', 'important');
      btn.style.setProperty('cursor', 'pointer', 'important');
      btn.addEventListener('click', () => showDonatePopup());
      document.querySelector('div#workskin div.preface.group')?.appendChild(btn);
    }
  }

  // ============================================================
  // COIN TASK SYSTEM
  // ============================================================

  // Tasks split into two categories:
  //   auto   = completed silently by page events (no claim button shown)
  //   action = completed by detecting actual AO3 button clicks on the page
  const COIN_TASKS = [
    { id: 'daily_login',   label: 'Daily login',       reward: 10, how: 'auto',   hint: 'Awarded on every visit' },
    { id: 'read_fic',      label: 'Read a fic today',  reward: 10, how: 'auto',   hint: 'Awarded when opening a fic' },
    { id: 'give_kudos',    label: 'Leave a kudos',     reward: 10, how: 'action', hint: 'Click the Kudos button on a fic' },
    { id: 'give_trophy',   label: 'Give a trophy',     reward: 25, how: 'action', hint: 'Click a Give Trophy button' },
    { id: 'leave_comment', label: 'Leave a comment',   reward: 15, how: 'action', hint: 'Submit the comment form on a fic' },
    { id: 'bookmark',      label: 'Bookmark something', reward: 5, how: 'action', hint: 'Click Bookmark This Work' },
  ];

  function completeTask(taskId) {
    const today = new Date().toDateString();
    let awarded = false;
    updateStore(d => {
      if (!d.coins) d.coins = 0;
      if (!d.tasksDone) d.tasksDone = {};
      if (!d.tasksDone[today]) d.tasksDone[today] = {};
      if (d.tasksDone[today][taskId]) return;
      const task = COIN_TASKS.find(t => t.id === taskId);
      if (task) {
        d.coins += task.reward;
        d.tasksDone[today][taskId] = true;
        awarded = true;
      }
    });
    if (awarded) refreshNavCoinCount();
    return awarded;
  }

  function refreshNavCoinCount() {
    const navCount = document.querySelector('#ao3c-nav-coin-count');
    if (navCount) navCount.textContent = getCoinBalance();
  }

  function getCoinBalance() { return getStore().coins || 0; }
  function addCoins(n) {
    updateStore(d => { d.coins = (d.coins || 0) + n; });
    refreshNavCoinCount();
  }
  function spendCoins(n) {
    updateStore(d => { d.coins = Math.max(0, (d.coins || 0) - n); });
    refreshNavCoinCount();
  }

  function getTasksDoneToday() {
    const today = new Date().toDateString();
    return (getStore().tasksDone || {})[today] || {};
  }

  // Hook into real AO3 page events to award action tasks
  function hookCoinTaskEvents() {
    // Kudos button: #kudos_submit or button containing "Kudos"
    document.addEventListener('click', e => {
      const btn = e.target.closest('#kudos_submit, button[name="kudos[submit]"]');
      if (btn) { setTimeout(() => completeTask('give_kudos'), 400); }
    });
    // Comment form submit
    document.addEventListener('submit', e => {
      if (e.target.id === 'comment_form' || e.target.closest('#comment_form')) {
        setTimeout(() => completeTask('leave_comment'), 400);
      }
    });
    // Bookmark link: "Bookmark This Work" or bookmark form submit
    document.addEventListener('click', e => {
      const btn = e.target.closest('a[href*="/bookmarks/new"], input[name="bookmark[submit]"]');
      if (btn) { setTimeout(() => completeTask('bookmark'), 400); }
    });
    // Trophy buttons — our own buttons, hook via data attribute set at creation
    document.addEventListener('click', e => {
      if (e.target.closest('.ao3c-trophy-btn[data-trophy-done]')) {
        setTimeout(() => completeTask('give_trophy'), 200);
      }
    });
  }

  // Auto-complete silent tasks
  completeTask('daily_login');

  // ============================================================
  // DONATE POPUP
  // ============================================================

  function showDonatePopup() {
    const balance    = getCoinBalance();
    const doneDToday = getTasksDoneToday();

    // Build task rows — no claim buttons; tasks complete by doing the real action
    const tasksHtml = COIN_TASKS.map(t => {
      const done = !!doneDToday[t.id];
      return `
        <div class="ao3c-task-row ${done ? 'ao3c-task-done' : ''}" data-task="${t.id}">
          <span class="ao3c-task-check">${done ? '✅' : '⬜'}</span>
          <span class="ao3c-task-label">${t.label}</span>
          <span class="ao3c-task-reward ${done ? '' : 'ao3c-task-pending'}">
            ${done ? `+${COIN_TASKS.find(x=>x.id===t.id).reward} 🪙 earned` : `+${COIN_TASKS.find(x=>x.id===t.id).reward} 🪙 — ${COIN_TASKS.find(x=>x.id===t.id).hint}`}
          </span>
        </div>`;
    }).join('');

    const { overlay, modal } = createOverlay(`
      <div class="ao3c-donate-popup">
        <div class="ao3c-big-icon">💸</div>
        <h2>Support This Author!</h2>
        <p>Every contribution funds their caffeine addiction and emotional suffering.</p>

        <div class="ao3c-donate-tabs">
          <button class="ao3c-tab-btn ao3c-tab-active" data-tab="real">💳 Real Money</button>
          <button class="ao3c-tab-btn" data-tab="bought">🪙 Buy Coins</button>
          <button class="ao3c-tab-btn" data-tab="earned">🎯 My Coins</button>
        </div>

        <!-- REAL MONEY TAB -->
        <div class="ao3c-tab-panel" id="ao3c-tab-real">
          <p class="ao3c-donate-sub">Send real money to support this author:</p>
          <div class="ao3c-currency-grid">
            <button class="ao3c-currency-btn" data-real="1">💵 $1</button>
            <button class="ao3c-currency-btn" data-real="5">💵 $5</button>
            <button class="ao3c-currency-btn" data-real="10">💵 $10</button>
            <button class="ao3c-currency-btn" data-real="20">💵 $20</button>
            <button class="ao3c-currency-btn" data-real="1">💶 €1</button>
            <button class="ao3c-currency-btn" data-real="5">💶 €5</button>
            <button class="ao3c-currency-btn" data-real="1">💷 £1</button>
            <button class="ao3c-currency-btn" data-real="5">💷 £5</button>
            <button class="ao3c-currency-btn" data-real="100">¥100</button>
            <button class="ao3c-currency-btn" data-real="0.000001">₿ 0.000001</button>
          </div>
        </div>

        <!-- BUY COINS TAB -->
        <div class="ao3c-tab-panel ao3c-tab-hidden" id="ao3c-tab-bought">
          <p class="ao3c-donate-sub">Purchase AO3 Coins. They go straight to your balance.</p>
          <div class="ao3c-coin-packages">
            <div class="ao3c-coin-pkg" data-buy-coins="100">
              <div class="ao3c-coin-amt">100 🪙</div>
              <div class="ao3c-coin-price">$0.99</div>
              <button class="ao3c-buy-btn">Buy</button>
            </div>
            <div class="ao3c-coin-pkg ao3c-coin-popular" data-buy-coins="500">
              <div class="ao3c-coin-badge">POPULAR</div>
              <div class="ao3c-coin-amt">500 🪙</div>
              <div class="ao3c-coin-price">$3.99</div>
              <button class="ao3c-buy-btn">Buy</button>
            </div>
            <div class="ao3c-coin-pkg" data-buy-coins="1200">
              <div class="ao3c-coin-amt">1200 🪙</div>
              <div class="ao3c-coin-price">$7.99</div>
              <button class="ao3c-buy-btn">Buy</button>
            </div>
            <div class="ao3c-coin-pkg" data-buy-coins="3000">
              <div class="ao3c-coin-amt">3000 🪙</div>
              <div class="ao3c-coin-price">$17.99</div>
              <button class="ao3c-buy-btn">Buy</button>
            </div>
          </div>
          <p class="ao3c-fine-print">* Fake transaction. Coins are added to your local balance.</p>
        </div>

        <!-- MY COINS TAB -->
        <div class="ao3c-tab-panel ao3c-tab-hidden" id="ao3c-tab-earned">
          <p class="ao3c-donate-sub">Balance: <strong id="ao3c-coin-bal">${balance} 🪙</strong></p>

          <p style="font-size:0.8rem;font-weight:bold;color:#333;margin:10px 0 4px">Donate to AO3:</p>
          <div class="ao3c-donate-coin-row">
            <input type="number" id="ao3c-coin-amount" class="ao3c-coin-input"
              min="1" max="${balance}" value="${Math.min(50, balance)}"
              placeholder="Amount" />
            <span style="font-size:0.9rem">🪙</span>
            <button class="ao3c-btn ao3c-btn-gold" id="ao3c-donate-coins"
              ${balance < 1 ? 'disabled' : ''}>Donate to AO3</button>
          </div>
          ${balance < 1 ? '<p style="font-size:0.78rem;color:#c00;margin-top:4px">Not enough coins. Earn some first!</p>' : ''}

          <p style="font-size:0.8rem;font-weight:bold;color:#333;margin:14px 0 4px">Daily tasks:</p>
          <div class="ao3c-tasks" id="ao3c-tasks-list">${tasksHtml}</div>
        </div>

        <button class="ao3c-btn ao3c-btn-ghost" id="ao3c-donate-cl" style="margin-top:12px">Maybe next time</button>
        <p class="ao3c-fine-print">* AO3 Coins are not real. No money is transferred. This is a joke extension.</p>
      </div>
    `);

    // Tab switching
    modal.querySelectorAll('.ao3c-tab-btn').forEach(tabBtn => {
      tabBtn.addEventListener('click', () => {
        modal.querySelectorAll('.ao3c-tab-btn').forEach(b => b.classList.remove('ao3c-tab-active'));
        modal.querySelectorAll('.ao3c-tab-panel').forEach(p => p.classList.add('ao3c-tab-hidden'));
        tabBtn.classList.add('ao3c-tab-active');
        modal.querySelector(`#ao3c-tab-${tabBtn.dataset.tab}`)?.classList.remove('ao3c-tab-hidden');
      });
    });

    // Real money buttons → success (no balance change, it's fake)
    modal.querySelectorAll('.ao3c-currency-btn').forEach(btn => {
      btn.addEventListener('click', () => showDonateSuccess(modal, overlay, 'author'));
    });

    // Buy coins → add to balance + show confirmation
    modal.querySelectorAll('.ao3c-buy-btn').forEach(btn => {
      btn.style.setProperty('pointer-events', 'all', 'important');
      btn.style.setProperty('cursor', 'pointer', 'important');
      btn.addEventListener('click', () => {
        const pkg   = btn.closest('[data-buy-coins]');
        const coins = parseInt(pkg?.dataset.buyCoinS || pkg?.dataset.buyCoins || '0', 10);
        if (!coins) return;
        addCoins(coins);
        // Update balance display in the tab
        const balEl = modal.querySelector('#ao3c-coin-bal');
        if (balEl) {
          balEl.textContent = `${getCoinBalance()} 🪙`;
          balEl.classList.add('ao3c-coin-flash');
          setTimeout(() => balEl.classList.remove('ao3c-coin-flash'), 600);
        }
        // Update the coin input max
        const inp = modal.querySelector('#ao3c-coin-amount');
        if (inp) inp.max = getCoinBalance();
        // Flash the buy button
        btn.textContent = '✓ Added!';
        btn.style.setProperty('background', '#43a047', 'important');
        btn.style.setProperty('color', '#fff', 'important');
        btn.disabled = true;
        setTimeout(() => { btn.textContent = 'Buy'; btn.disabled = false; btn.style.removeProperty('background'); btn.style.removeProperty('color'); }, 1500);
      });
    });

    // Donate coins to AO3 → deduct from balance
    const donateBtn = modal.querySelector('#ao3c-donate-coins');
    const coinInput = modal.querySelector('#ao3c-coin-amount');
    if (donateBtn && coinInput) {
      donateBtn.addEventListener('click', () => {
        const amount = parseInt(coinInput.value, 10);
        if (isNaN(amount) || amount < 1) { coinInput.style.border = '2px solid red'; return; }
        if (amount > getCoinBalance()) { coinInput.style.border = '2px solid red'; return; }
        coinInput.style.border = '';
        spendCoins(amount);
        showDonateSuccess(modal, overlay, 'ao3', amount);
      });
    }

    modal.querySelector('#ao3c-donate-cl').addEventListener('click', () => overlay.remove());
  }

  function showDonateSuccess(modal, overlay, target, amount) {
    const isAO3     = target === 'ao3';
    const recipient = isAO3 ? 'AO3' : 'the author';
    const coinNote  = isAO3 ? `<p>You donated <strong>${amount} 🪙</strong> to AO3. Your new balance: <strong>${getCoinBalance()} 🪙</strong></p>` : '';
    modal.innerHTML = `
      <div class="ao3c-modal-inner">
        <div class="ao3c-big-icon">🎉</div>
        <h2>Thank you for your donation!</h2>
        <p>${recipient === 'AO3' ? 'AO3 thanks you. The servers are slightly warmer now.' : 'The author has been notified and is currently crying happy tears.'}</p>
        ${coinNote}
        <p class="ao3c-fine-print">* No actual transaction occurred. AO3 is a nonprofit. They don't take donations this way.</p>
        <button class="ao3c-btn ao3c-btn-gold" id="ao3c-don-done">You're welcome!</button>
      </div>`;
    armButtons(modal);
    modal.querySelector('#ao3c-don-done').addEventListener('click', () => overlay.remove());
  }

  // ============================================================
  // INTRUSIVE ADS
  // ============================================================

  const POPUP_ADS = [
    { brand: 'BET365',       color: '#006400', accent: '#FFD700', msg: 'You\'ve been reading for a while. Bet on something instead.', cta: 'Bet Now 🎰' },
    { brand: 'DraftKings',   color: '#1a1a2e', accent: '#00d4aa', msg: 'Fantasy sports > fantasy fiction. (We said what we said.)', cta: 'Play Now' },
    { brand: 'HelloFresh',   color: '#1a6b1a', accent: '#fff',    msg: 'You forgot to eat again, didn\'t you. 16 free meals waiting.', cta: 'Claim Offer 🥗' },
    { brand: 'Ozempic',      color: '#1565c0', accent: '#fff',    msg: 'Ask your doctor about Ozempic. Or don\'t. We\'re an ad, not a cop.', cta: 'Learn More 💊' },
    { brand: 'RAID: Shadow', color: '#8B0000', accent: '#FFD700', msg: 'Download RAID: Shadow Legends. The AO3 fandom has already written 47 fics about it.', cta: 'Download FREE' },
    { brand: 'NordVPN',      color: '#222b68', accent: '#f8c10a', msg: 'Your ISP can see you reading fic right now. Just saying.', cta: 'Get Protected 🔒' },
    { brand: 'Grammarly',    color: '#15572b', accent: '#f5c518', msg: 'Great fic. The comma usage, however...', cta: 'Fix My Commas ✏️' },
    { brand: 'Duolingo',     color: '#58cc02', accent: '#fff',    msg: 'You haven\'t practiced today. The owl knows.', cta: 'Don\'t Miss a Day 🦉' },
  ];

  const VIDEO_AD_BRANDS = ['BET365', 'DRAFTKINGS', 'FANDUEL', 'POKERSTARS', 'BETWAY'];

  let _popupAdIdx = 0;
  let _intrusiveAdsStarted = false;

  function startIntrusiveAds() {
    if (_intrusiveAdsStarted || isPremium()) return;
    _intrusiveAdsStarted = true;

    // 1. Pop-up ad: first after 40s, then every 3 minutes
    setTimeout(function schedulePopup() {
      if (!isPremium()) {
        showRandomPopupAd();
        setTimeout(schedulePopup, 180000); // 3 min
      }
    }, 40000);

    // 2. Fake video ad: first after 90s, then every 5 minutes
    setTimeout(function scheduleVideo() {
      if (!isPremium()) {
        showFakeVideoAd();
        setTimeout(scheduleVideo, 300000); // 5 min
      }
    }, 90000);

    // 3. Sticky banner after 15s
    setTimeout(() => { if (!isPremium()) injectStickyBanner(); }, 15000);

    // 4. Interstitial: every 5th internal link click (was every 3rd)
    hookInterstitialAds();
  }

  function showRandomPopupAd() {
    const ad = POPUP_ADS[_popupAdIdx++ % POPUP_ADS.length];
    // Free: 5s delay. Plus: 2s delay. All users CAN close it.
    const delaySecs = isPlus() ? 2 : 5;

    const { overlay, modal } = createOverlay(`
      <div class="ao3c-intrusive-popup" style="background:${ad.color};border-color:${ad.accent}">
        <div class="ao3c-intrusive-tag">⚠️ Important Message from Our Sponsors</div>
        <div class="ao3c-intrusive-brand" style="color:${ad.accent}">${ad.brand}</div>
        <p class="ao3c-intrusive-msg">${ad.msg}</p>
        <button class="ao3c-btn ao3c-btn-gold" id="ao3c-inad-cta">${ad.cta}</button>
        <button class="ao3c-btn ao3c-btn-ghost ao3c-intrusive-close" id="ao3c-inad-cl" style="color:#aaa;border-color:#555" disabled>
          Close in ${delaySecs}s…
        </button>
      </div>
    `);

    const closeBtn = modal.querySelector('#ao3c-inad-cl');
    const ctaBtn   = modal.querySelector('#ao3c-inad-cta');

    // Countdown before close unlocks
    let secs = delaySecs;
    const t = setInterval(() => {
      secs--;
      if (secs <= 0) {
        clearInterval(t);
        closeBtn.disabled = false;
        closeBtn.textContent = isPlus() ? 'Close' : 'Close (finally)';
        closeBtn.style.setProperty('opacity', '1', 'important');
        closeBtn.style.setProperty('pointer-events', 'all', 'important');
        closeBtn.style.setProperty('cursor', 'pointer', 'important');
      } else {
        closeBtn.textContent = `Close in ${secs}s…`;
      }
    }, 1000);

    ctaBtn.addEventListener('click', () => overlay.remove());
    closeBtn.addEventListener('click', () => { if (!closeBtn.disabled) overlay.remove(); });
  }

  function showFakeVideoAd() {
    // Plus: skip after 3s. Free: skip after 8s.
    const skipAfter = isPlus() ? 3 : 8;
    const brand = VIDEO_AD_BRANDS[Math.floor(Math.random() * VIDEO_AD_BRANDS.length)];

    const { overlay, modal } = createOverlay(`
      <div class="ao3c-video-ad">
        <div class="ao3c-video-screen">
          <div class="ao3c-video-brand">${brand}</div>
          <div class="ao3c-video-tagline">EXPERIENCE THE THRILL<br>OF COMPLETELY LEGAL GAMBLING</div>
          <div class="ao3c-video-progress-wrap"><div class="ao3c-video-progress" id="ao3c-vid-prog"></div></div>
        </div>
        <div class="ao3c-video-controls">
          <span class="ao3c-video-label">Advertisement</span>
          <div>
            <span id="ao3c-skip-countdown" class="ao3c-skip-countdown">Skip in ${skipAfter}s</span>
            <button class="ao3c-btn ao3c-btn-ghost ao3c-skip-btn" id="ao3c-vid-skip" disabled>Skip Ad ▶▶</button>
          </div>
        </div>
        <p class="ao3c-fine-print">Your video will resume after this message. (There is no video.)</p>
      </div>
    `);

    let secs = skipAfter;
    const prog      = modal.querySelector('#ao3c-vid-prog');
    const skipBtn   = modal.querySelector('#ao3c-vid-skip');
    const cdEl      = modal.querySelector('#ao3c-skip-countdown');

    const t = setInterval(() => {
      secs--;
      if (prog) prog.style.width = `${((skipAfter - secs) / skipAfter) * 100}%`;
      if (secs <= 0) {
        clearInterval(t);
        skipBtn.disabled = false;
        skipBtn.style.setProperty('opacity', '1', 'important');
        skipBtn.style.setProperty('pointer-events', 'all', 'important');
        skipBtn.style.setProperty('cursor', 'pointer', 'important');
        cdEl.textContent = '';
      } else {
        cdEl.textContent = `Skip in ${secs}s`;
      }
    }, 1000);

    skipBtn.addEventListener('click', () => { if (!skipBtn.disabled) overlay.remove(); });
  }

  function injectStickyBanner() {
    if (document.querySelector('.ao3c-sticky-banner')) return;
    const banner = el('div', 'ao3c-sticky-banner');
    const ad = GAMBLING_ADS[Math.floor(Math.random() * GAMBLING_ADS.length)];
    banner.style.cssText = `background:${ad.color[0]};border-top:2px solid ${ad.accent}`;
    // Everyone can close it — Plus gets instant close, free gets 8s delay
    const closeSecs = isPlus() ? 0 : 8;
    banner.innerHTML = `
      <span class="ao3c-sticky-brand" style="color:${ad.accent}">${ad.brand}</span>
      <span class="ao3c-sticky-offer">${ad.offer}</span>
      <button class="ao3c-sticky-cta" style="border-color:${ad.accent};color:${ad.accent}">Bet Now</button>
      <button class="ao3c-sticky-close" id="ao3c-sticky-x" ${closeSecs > 0 ? 'disabled' : ''}>${closeSecs > 0 ? `✕ (${closeSecs}s)` : '✕'}</button>
    `;
    banner.querySelectorAll('button').forEach(b => {
      b.style.setProperty('pointer-events', 'all', 'important');
      b.style.setProperty('cursor', 'pointer', 'important');
    });
    const xBtn = banner.querySelector('#ao3c-sticky-x');
    if (closeSecs > 0) {
      let s = closeSecs;
      const t = setInterval(() => {
        s--;
        if (s <= 0) { clearInterval(t); xBtn.disabled = false; xBtn.textContent = '✕'; xBtn.style.setProperty('cursor','pointer','important'); }
        else xBtn.textContent = `✕ (${s}s)`;
      }, 1000);
    }
    xBtn.addEventListener('click', () => { if (!xBtn.disabled) banner.remove(); });
    document.body.appendChild(banner);
  }

  function hookInterstitialAds() {
    let clickCount = 0;
    document.addEventListener('click', e => {
      const link = e.target.closest('a[href]');
      if (!link) return;
      const href = link.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('javascript')) return;
      if (!href.includes('archiveofourown') && !href.startsWith('/')) return;
      clickCount++;
      if (clickCount % 5 !== 0) return; // every 5th click (was 3rd)
      e.preventDefault();
      showInterstitialAd(href);
    });
  }

  function showInterstitialAd(destination) {
    const ad = GAMBLING_ADS[Math.floor(Math.random() * GAMBLING_ADS.length)];
    const skipSecs = isPlus() ? 2 : 5;

    const { overlay, modal } = createOverlay(`
      <div class="ao3c-interstitial" style="background:linear-gradient(135deg,${ad.color[0]},${ad.color[1]});border-color:${ad.accent}">
        <div class="ao3c-interstitial-tag">You're leaving this page — here's an ad first</div>
        <div class="ao3c-interstitial-brand" style="color:${ad.accent}">${ad.brand}</div>
        <div class="ao3c-interstitial-offer" style="color:${ad.accent}">${ad.offer}</div>
        <div class="ao3c-interstitial-sub">${ad.sub}</div>
        <div class="ao3c-interstitial-controls">
          <span id="ao3c-inter-cd" class="ao3c-skip-countdown">Continuing in ${skipSecs}s…</span>
          <button class="ao3c-btn ao3c-btn-ghost" id="ao3c-inter-skip" disabled style="color:#fff;border-color:#fff">Continue ▶</button>
        </div>
      </div>
    `);

    let secs = skipSecs;
    const cd      = modal.querySelector('#ao3c-inter-cd');
    const skipBtn = modal.querySelector('#ao3c-inter-skip');
    const t = setInterval(() => {
      secs--;
      if (secs <= 0) {
        clearInterval(t);
        cd.textContent = '';
        skipBtn.disabled = false;
        skipBtn.style.setProperty('pointer-events', 'all', 'important');
        skipBtn.style.setProperty('cursor', 'pointer', 'important');
      } else {
        cd.textContent = `Continuing in ${secs}s…`;
      }
    }, 1000);
    skipBtn.addEventListener('click', () => {
      if (!skipBtn.disabled) { overlay.remove(); window.location.href = destination; }
    });
  }

  // ============================================================
  // FAKE FACE SCAN — age check on first visit, locks forever
  // ============================================================

  // Works that are "age-restricted" = those whose workId % 3 === 0 (roughly 1/3)
  function isAgeRestrictedWork(workId) {
    const n = parseInt(workId, 10);
    return !isNaN(n) && n % 3 === 0;
  }

  function getScannedAge() { return getStore().faceAge || null; }

  function checkFaceScan() {
    if (getScannedAge() !== null) {
      // Already scanned — enforce restrictions on work pages
      enforceFaceAgeRestrictions();
      return;
    }
    // First visit — show the face scan prompt after a short delay
    setTimeout(showFaceScanPrompt, 1500);
  }

  function showFaceScanPrompt() {
    if (document.querySelector('.ao3c-facescan-overlay')) return;
    const { overlay, modal } = createOverlay(`
      <div class="ao3c-facescan-popup">
        <div class="ao3c-big-icon">📸</div>
        <h2>Age Verification Required</h2>
        <p>AO3 now requires a one-time biometric age scan to ensure a safe browsing experience.<br>
           <strong>Your scan is stored locally and never shared.</strong></p>
        <div id="ao3c-fs-step-1">
          <div class="ao3c-cam-frame" id="ao3c-cam-frame">
            <div class="ao3c-cam-placeholder">
              <div class="ao3c-cam-icon">📷</div>
              <p class="ao3c-cam-hint">Camera access needed</p>
            </div>
          </div>
          <div class="ao3c-btn-row" style="margin-top:14px">
            <button class="ao3c-btn ao3c-btn-gold" id="ao3c-fs-allow">Allow Camera &amp; Continue</button>
            <button class="ao3c-btn ao3c-btn-ghost" id="ao3c-fs-skip">Skip (limited access)</button>
          </div>
          <p class="ao3c-fine-print">Camera is not actually accessed. This is a fake scan.</p>
        </div>
        <div id="ao3c-fs-step-2" style="display:none">
          <div class="ao3c-facescan-anim" id="ao3c-fs-anim">
            <div class="ao3c-fs-face">🧑</div>
            <div class="ao3c-fs-scanline"></div>
            <div class="ao3c-fs-corner ao3c-fs-tl"></div>
            <div class="ao3c-fs-corner ao3c-fs-tr"></div>
            <div class="ao3c-fs-corner ao3c-fs-bl"></div>
            <div class="ao3c-fs-corner ao3c-fs-br"></div>
          </div>
          <p class="ao3c-fs-status" id="ao3c-fs-status">Initialising camera feed…</p>
          <div class="ao3c-scan-bar" style="max-width:240px;margin:10px auto"><div class="ao3c-fs-progress"></div></div>
        </div>
        <div id="ao3c-fs-step-3" style="display:none">
          <div class="ao3c-fs-result-box">
            <div class="ao3c-big-icon">✅</div>
            <h3>Scan Complete</h3>
            <p>Detected age: <strong id="ao3c-fs-age-display">—</strong></p>
            <p class="ao3c-fine-print">This result is final. Reset in extension settings.</p>
          </div>
          <button class="ao3c-btn ao3c-btn-gold" id="ao3c-fs-confirm">Confirm &amp; Continue</button>
        </div>
      </div>
    `);

    const step1 = modal.querySelector('#ao3c-fs-step-1');
    const step2 = modal.querySelector('#ao3c-fs-step-2');
    const step3 = modal.querySelector('#ao3c-fs-step-3');

    modal.querySelector('#ao3c-fs-allow').addEventListener('click', () => {
      // Fake camera request animation
      const camFrame = modal.querySelector('#ao3c-cam-frame');
      camFrame.innerHTML = `<div class="ao3c-cam-live"><div class="ao3c-cam-dot"></div>LIVE</div><div class="ao3c-cam-feed">😐</div>`;
      setTimeout(() => {
        step1.style.display = 'none';
        step2.style.display = 'block';
        runFaceScanAnimation(modal, step2, step3);
      }, 800);
    });

    modal.querySelector('#ao3c-fs-skip').addEventListener('click', () => {
      // Skipping = treated as "unknown age" = restrictions apply
      updateStore(d => { d.faceAge = 16; }); // assume under 18 if skipped
      overlay.remove();
      enforceFaceAgeRestrictions();
    });

    modal.querySelector('#ao3c-fs-confirm')?.addEventListener('click', () => {
      overlay.remove();
      enforceFaceAgeRestrictions();
    });
  }

  function runFaceScanAnimation(modal, step2, step3) {
    const statusEl   = modal.querySelector('#ao3c-fs-status');
    const progressEl = modal.querySelector('.ao3c-fs-progress');
    const steps = [
      [600,  'Detecting facial landmarks…'],
      [1200, 'Analysing bone structure…'],
      [1900, 'Cross-referencing neural age model…'],
      [2600, 'Calculating epidermal wear patterns…'],
      [3200, 'Consulting the vibes…'],
      [3700, 'Finalising result…'],
    ];
    steps.forEach(([delay, msg]) => {
      setTimeout(() => {
        if (statusEl) statusEl.textContent = msg;
        if (progressEl) progressEl.style.width = `${(delay / 3700) * 100}%`;
      }, delay);
    });
    setTimeout(() => {
      // Generate a random age 14–42, skewed towards 18–30
      const ages = [14,15,16,17,18,18,19,19,20,20,21,21,22,23,24,25,26,27,28,29,30,31,32,34,36,38,42];
      const age = ages[Math.floor(Math.random() * ages.length)];
      updateStore(d => { d.faceAge = age; });
      step2.style.display = 'none';
      step3.style.display = 'block';
      const ageEl = modal.querySelector('#ao3c-fs-age-display');
      if (ageEl) ageEl.textContent = `${age} years old`;
      armButtons(modal);
      modal.querySelector('#ao3c-fs-confirm').addEventListener('click', () => {
        modal.closest('.ao3c-overlay-wrap, body > div')?.remove();
        enforceFaceAgeRestrictions();
      });
    }, 4000);
  }

  function enforceFaceAgeRestrictions() {
    const age = getScannedAge();
    if (age === null || age >= 18) return;

    // On work listing pages — blur ~1/3 of works with an age gate
    document.querySelectorAll('li.work.blurb').forEach(work => {
      if (work.querySelector('.ao3c-age-gate')) return;
      const workId = work.id.replace(/^work[_-]/, '');
      if (!isAgeRestrictedWork(workId)) return;
      const gate = el('div', 'ao3c-age-gate');
      gate.innerHTML = `
        <div class="ao3c-age-gate-inner">
          🔞 <strong>Age Restricted</strong>
          <span>Our scan detected you are ${age}. This content requires 18+.</span>
          <button class="ao3c-age-gate-appeal">Appeal Result</button>
        </div>`;
      gate.querySelector('.ao3c-age-gate-appeal').addEventListener('click', () => showAgeAppealPopup());
      gate.querySelector('.ao3c-age-gate-appeal').style.setProperty('pointer-events', 'all', 'important');
      gate.querySelector('.ao3c-age-gate-appeal').style.setProperty('cursor', 'pointer', 'important');
      // Blur the work content
      work.style.setProperty('filter', 'blur(4px)', 'important');
      work.style.setProperty('pointer-events', 'none', 'important');
      work.style.setProperty('user-select', 'none', 'important');
      work.parentNode.insertBefore(gate, work);
      gate.style.setProperty('pointer-events', 'all', 'important');
    });

    // On work detail pages
    const workId = getWorkIdFromUrl();
    if (workId && isAgeRestrictedWork(workId)) {
      const workskin = document.querySelector('#workskin');
      if (workskin && !document.querySelector('.ao3c-age-gate-full')) {
        const gate = el('div', 'ao3c-age-gate-full');
        gate.innerHTML = `
          <div class="ao3c-age-gate-full-inner">
            <div class="ao3c-big-icon">🔞</div>
            <h2>Age Restricted Content</h2>
            <p>Our biometric scan determined you are <strong>${age} years old</strong>.<br>
               This content is restricted to users 18 and over.</p>
            <button class="ao3c-btn ao3c-btn-ghost" id="ao3c-age-appeal">Appeal This Result</button>
            <p class="ao3c-fine-print">To reset your age scan, go to Extension Settings → Reset Face Scan.</p>
          </div>`;
        workskin.style.setProperty('filter', 'blur(12px)', 'important');
        workskin.style.setProperty('pointer-events', 'none', 'important');
        workskin.parentNode.insertBefore(gate, workskin);
        gate.querySelector('#ao3c-age-appeal').addEventListener('click', showAgeAppealPopup);
        gate.querySelector('#ao3c-age-appeal').style.setProperty('pointer-events','all','important');
        gate.querySelector('#ao3c-age-appeal').style.setProperty('cursor','pointer','important');
      }
    }
  }

  function showAgeAppealPopup() {
    const { overlay, modal } = createOverlay(`
      <div class="ao3c-modal-inner">
        <div class="ao3c-big-icon">📋</div>
        <h2>Age Scan Appeal</h2>
        <p>Our algorithm is 100% accurate and cannot be appealed.</p>
        <p>If you believe this is an error, please consider:</p>
        <ul style="text-align:left;font-size:0.88rem;margin:10px 0 16px;padding-left:20px">
          <li>Getting more sleep (you look tired)</li>
          <li>Drinking more water</li>
          <li>Submitting form AO3-AGE-7743 in triplicate</li>
          <li>Waiting until you are actually 18</li>
        </ul>
        <p class="ao3c-fine-print">To reset: Extension settings → Reset Face Scan.</p>
        <button class="ao3c-btn ao3c-btn-ghost" id="ao3c-appeal-cl">Close</button>
      </div>
    `);
    modal.querySelector('#ao3c-appeal-cl').addEventListener('click', () => overlay.remove());
  }

  function init() {
    checkReadingLimit();
    checkAgeVerification();
    checkFaceScan();
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
    addDonateButtons();
    hookCoinTaskEvents();
    startIntrusiveAds();
    // Award "read a fic" coin when on a work page
    if (getWorkIdFromUrl()) completeTask('read_fic');
    runEscalationEffects();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  syncExt();

})();
