/* ============================================================================
   FCEI — Finland Creative Education Institute
   Single-page application (vanilla JS, no framework)

   Runs in two modes via window.__FCEI__ = { mode, seed, images }:
     • 'demo'  — standalone preview. Uses the embedded (trimmed) seed and a map
                 of data-URI images. Auth / checkout / LMS progress are
                 simulated in memory. No network, no storage.
     • 'live'  — served by server.mjs. Fetches /api/site + /api/courses/:id and
                 resolves images from /assets/<slug>.jpg. Real API calls.
   ========================================================================== */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- boot -- */
  var BOOT   = window.__FCEI__ || { mode: 'demo', seed: {}, images: {} };
  var MODE   = BOOT.mode || 'demo';
  var IMAGES = BOOT.images || {};
  var SEED   = BOOT.seed || {};
  var LIVE   = MODE === 'live';

  /* ------------------------------------------------------------- helpers -- */
  function $(s, c) { return (c || document).querySelector(s); }
  function $all(s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); }
  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function gbp(n) { return '£' + Number(n || 0).toFixed(0); }
  function img(slug) {
    if (!slug) return '';
    if (IMAGES && IMAGES[slug]) return IMAGES[slug];   // data-URI (demo)
    return '/assets/' + slug + '.jpg';                 // file (live)
  }

  // in-memory store; only the live build is allowed to touch localStorage
  var MEM = {};
  var Store = {
    get: function (k) {
      if (LIVE) { try { return localStorage.getItem(k); } catch (e) {} }
      return k in MEM ? MEM[k] : null;
    },
    set: function (k, v) {
      if (LIVE) { try { localStorage.setItem(k, v); return; } catch (e) {} }
      MEM[k] = v;
    },
    del: function (k) {
      if (LIVE) { try { localStorage.removeItem(k); return; } catch (e) {} }
      delete MEM[k];
    }
  };

  /* --------------------------------------------------------------- state -- */
  var STATE = {
    site: null,           // { brand, content, courses, products, services, resources }
    courseCache: {},      // id -> { course, modules, product }
    enroll: {},           // demo: courseId -> { 'C01-M01': { steps:{...}, done:bool } }
    user: null,
    kw: ''
  };

  var STEP_KEYS = [
    'contentOpened', 'resourcesAccessed', 'quizPassed', 'actionTaskSubmitted',
    'evidenceSubmitted', 'reflectionSubmitted', 'transferabilitySubmitted', 'checklistCompleted'
  ];
  var STEP_LABELS = {
    contentOpened: 'Open content',
    resourcesAccessed: 'Access resources',
    quizPassed: 'Pass the quiz',
    actionTaskSubmitted: 'Submit action task',
    evidenceSubmitted: 'Upload evidence',
    reflectionSubmitted: 'Submit reflection',
    transferabilitySubmitted: 'Transferability filter',
    checklistCompleted: 'Confirm checklist'
  };

  /* ----------------------------------------------------------- data load -- */
  function token() { return Store.get('fcei_token'); }

  function api(path, opts) {
    opts = opts || {};
    var headers = opts.headers || {};
    headers['Content-Type'] = 'application/json';
    var t = token();
    if (t) headers['Authorization'] = 'Bearer ' + t;
    return fetch(path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, data: j }; }); });
  }

  function loadSite() {
    if (STATE.site) return Promise.resolve(STATE.site);
    if (!LIVE) {
      STATE.site = {
        brand: SEED.brand || {},
        content: SEED.content || {},
        courses: SEED.courses || [],
        products: SEED.products || [],
        services: SEED.services || [],
        resources: (SEED.content && SEED.content.resources) || {}
      };
      return Promise.resolve(STATE.site);
    }
    return api('/api/site').then(function (r) {
      var d = r.data || {};
      STATE.site = {
        brand: d.brand || {},
        content: d.content || d.copy || {},
        courses: d.courses || [],
        products: d.products || [],
        services: d.services || [],
        resources: (d.content && d.content.resources) || d.resources || {}
      };
      return STATE.site;
    });
  }

  function loadCourse(id) {
    if (STATE.courseCache[id]) return Promise.resolve(STATE.courseCache[id]);
    if (!LIVE) {
      return loadSite().then(function (site) {
        var course = (site.courses || []).find(function (c) { return c.id === id; });
        var modules = (SEED.modules || []).filter(function (m) { return m.courseId === id; })
          .sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
        var product = (site.products || []).find(function (p) {
          return p.courseIds && p.courseIds.indexOf(id) > -1;
        });
        var bundle = { course: course, modules: modules, product: product };
        STATE.courseCache[id] = bundle;
        return bundle;
      });
    }
    return api('/api/courses/' + id).then(function (r) {
      var bundle = r.data || {};
      STATE.courseCache[id] = bundle;
      return bundle;
    });
  }

  function findModule(courseId, moduleId) {
    return loadCourse(courseId).then(function (b) {
      var m = (b.modules || []).find(function (x) { return x.id === moduleId; });
      return { bundle: b, module: m };
    });
  }

  /* ----------------------------------------------------- enrollment (demo) */
  function ensureEnroll(courseId, modules) {
    if (!STATE.enroll[courseId]) STATE.enroll[courseId] = {};
    (modules || []).forEach(function (m) {
      var mid = m.id || m;
      if (!STATE.enroll[courseId][mid]) {
        var steps = {};
        STEP_KEYS.forEach(function (k) { steps[k] = false; });
        STATE.enroll[courseId][mid] = { steps: steps, done: false };
      }
    });
    return STATE.enroll[courseId];
  }
  function seedDemoProgress() {
    // give the demo a believable starting state on first load
    if (STATE._seededDemo || LIVE) return;
    STATE._seededDemo = true;
    var ids = ['C01', 'C03', 'C07'];
    var modsById = {};
    (SEED.modules || []).forEach(function (m) {
      (modsById[m.courseId] = modsById[m.courseId] || []).push(m);
    });
    ids.forEach(function (cid) {
      var list = (modsById[cid] || []).slice().sort(function (a, b) { return a.order - b.order; });
      if (!list.length) {
        var lite = (SEED.courses.find(function (c) { return c.id === cid; }) || {}).modules || [];
        list = lite.map(function (x) { return { id: x, courseId: cid, order: 0 }; });
      }
      ensureEnroll(cid, list);
    });
    // C01: first module fully complete, second partially
    var e = STATE.enroll['C01'];
    if (e && e['C01-M01']) { STEP_KEYS.forEach(function (k) { e['C01-M01'].steps[k] = true; }); e['C01-M01'].done = true; }
    if (e && e['C01-M02']) { ['contentOpened', 'resourcesAccessed', 'quizPassed'].forEach(function (k) { e['C01-M02'].steps[k] = true; }); }
    var e3 = STATE.enroll['C03'];
    if (e3 && e3['C03-M01']) { ['contentOpened', 'resourcesAccessed'].forEach(function (k) { e3['C03-M01'].steps[k] = true; }); }
  }
  function courseProgress(courseId) {
    var e = STATE.enroll[courseId];
    if (!e) return { done: 0, total: 0, pct: 0 };
    var ids = Object.keys(e), done = 0;
    ids.forEach(function (id) { if (e[id].done) done++; });
    return { done: done, total: ids.length, pct: ids.length ? Math.round(done / ids.length * 100) : 0 };
  }

  /* ----------------------------------------------------------------- nav -- */
  var NAV = [
    { href: '#/catalogue', label: 'Courses' },
    { href: '#/tvet', label: 'TVET' },
    { href: '#/consultancy', label: 'Consultancy' },
    { href: '#/resources', label: 'Resources' },
    { href: '#/legal', label: 'Legal' }
  ];

  function header(g) {
    var path = location.hash || '#/';
    var links = NAV.map(function (n) {
      var on = path.indexOf(n.href) === 0 ? ' active' : '';
      return '<a class="navlink' + on + '" href="' + n.href + '">' + esc(n.label) + '</a>';
    }).join('');
    return '' +
      '<div class="topline">' + esc(g.topLine || 'Finland Creative Education Institute') + '</div>' +
      '<header class="nav"><div class="nav-inner">' +
        '<a class="brand" href="#/" aria-label="FCEI home">' +
          '<span class="brand-mark">FC</span>' +
          '<span class="brand-txt"><b>FCEI</b><small>Finnish Creative Education</small></span>' +
        '</a>' +
        '<nav class="navlinks">' + links + '</nav>' +
        '<div class="nav-cta">' +

  '<button class="notification-btn" data-act="notifications" aria-label="Notifications">' +
    '🔔 <span id="notificationBadge" class="notification-badge">0</span>' +
  '</button>' +

  '<div id="notificationDropdown" class="notification-dropdown" style="display:none"></div>' +

  '<button class="nav-search" data-act="palette" aria-label="Search courses" title="Search (Ctrl/⌘ K)">' +
    svg('search') + '</button>' +

  '<button class="btn ghost sm" data-act="login">' +
    esc(g.learnerLogin || 'Learner Login') +
  '</button>' +

  '<a class="btn primary sm" href="#/booking">' +
    esc(g.enquireNow || 'Enquire Now') +
  '</a>' +

  '<button class="burger" data-act="burger" aria-label="Menu">' +
    svg('menu') +
  '</button>' +

'</div>' +
      '</div></header>';
  }

  function footer(g) {
    var col1 = '' +
      '<div class="foot-about">' +
        '<a class="brand" href="#/" style="margin-bottom:16px">' +
          '<span class="brand-mark">FC</span>' +
          '<span class="brand-txt"><b>FCEI</b><small style="color:#9db4b9">Finland Creative Education Institute</small></span>' +
        '</a>' +
        '<p>' + esc(g.footerAbout || 'Finland Creative Education Institute. Research-informed teacher training inspired by Finnish education principles.') + '</p>' +
        '<p class="foot-note">' + esc(g.footerNotice || '') + '</p>' +
      '</div>';
    var col2 = footCol('Explore', [
      ['#/catalogue', 'Course catalogue'], ['#/tvet', 'TVET modules'],
      ['#/consultancy', 'Consultancy'], ['#/resources', 'Resource hub']
    ]);
    var col3 = footCol('Institute', [
      ['#/booking', 'Request a demo'], ['#/dashboard', 'Learner dashboard'],
      ['#/admin', 'Admin overview'], ['#/admin/seo', 'SEO engine'], ['#/legal', 'Legal & compliance']
    ]);
    var col4 = footCol('Standards', [
      ['#/legal', 'Accreditation disclaimer'], ['#/legal', 'Privacy policy'],
      ['#/legal', 'Safeguarding'], ['#/legal', 'Accessibility']
    ]);
    return '<footer><div class="container">' +
      '<div class="foot-grid">' + col1 + col2 + col3 + col4 + '</div>' +
      '<div class="foot-bar">' +
        '<span>' + esc(g.copyright || '© 2026 Finland Creative Education Institute') + '</span>' +
        '<span class="fb-links"><a href="#/legal">Terms</a><a href="#/legal">Privacy</a><a href="#/legal">Cookies</a></span>' +
      '</div>' +
    '</div></footer>';
  }
  function footCol(title, links) {
    return '<div><h4>' + esc(title) + '</h4>' +
      links.map(function (l) { return '<a href="' + l[0] + '">' + esc(l[1]) + '</a>'; }).join('') +
      '</div>';
  }

  /* --------------------------------------------------------------- icons -- */
  function svg(name) {
    var p = {
      search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
      menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
      arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
      check: '<path d="M4 12l5 5L20 6"/>',
      play: '<path d="M8 5v14l11-7z"/>',
      doc: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>',
      shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>'
    }[name] || '';
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" width="18" height="18">' + p + '</svg>';
  }

  /* ------------------------------------------------------------- layout --- */
  function frame(inner) {
    var g = (STATE.site && STATE.site.content && STATE.site.content.global) || {};
    return header(g) + '<main id="view">' + inner + '</main>' + footer(g);
  }
  function mount(inner) {
    $('#app').innerHTML = frame(inner);
    bindGlobal();
    revealScan();
    window.scrollTo(0, 0);
  }

  /* =====================================================================  */
  /*  PAGES                                                                  */
  /* =====================================================================  */

  /* ---- home -------------------------------------------------------------- */
  function pageHome() {
    loadSite().then(function (s) {
      var g = s.content.global || {};
      var courses = s.courses || [];
      var featured = courses.slice(0, 6);
      var pathways = [
        { c: courses[0], no: 'Pathway 01', t: 'Finnish pedagogy & values', d: 'Equity, trust, wellbeing and the joy of learning — translated into classroom-visible practice.' },
        { c: courses.find(function (x) { return x.id === 'C13'; }) || courses[12], no: 'Pathway 02', t: 'TVET & vocational', d: 'Competence-based vocational design, workplace learning and employer partnership.' },
        { c: courses.find(function (x) { return x.id === 'C14'; }) || courses[13], no: 'Pathway 03', t: 'School improvement', d: 'Diagnostic audits and 90-day improvement coaching for leaders and ministries.' }
      ];
      var heroImg = img((courses[0] && courses[0].image) || 'c01');

      var hero = '<section class="hero"><div class="container"><div class="hero-grid">' +
        '<div class="hero-main">' +
          '<span class="eyebrow on-dark">EDUFI-aligned · FINEEC-benchmarked</span>' +
          '<h1>Finnish pedagogy, delivered for the world.</h1>' +
          '<p class="lead">' + esc(g.metaDescription || 'Worldwide provider of Finnish pedagogy, professional development, TVET and school improvement.') + '</p>' +
          '<div class="hero-cta">' +
            '<a class="btn primary" href="#/catalogue">Browse courses ' + svg('arrow') + '</a>' +
            '<a class="btn ghost on-dark" href="#/booking">Request a demo</a>' +
          '</div>' +
          '<div class="hero-meta">' +
            '<div class="mi"><b>' + courses.length + '</b><span>CPD courses</span></div>' +
            '<div class="mi"><b>12</b><span>TVET modules</span></div>' +
            '<div class="mi"><b>12</b><span>Services</span></div>' +
            '<div class="mi"><b>6</b><span>Modules each</span></div>' +
          '</div>' +
        '</div>' +
        '<div class="hero-side">' +
          '<div class="hero-photo"><img src="' + heroImg + '" alt="Finnish-inspired classroom practice" loading="eager">' +
            '<div class="badge"><span class="dot"></span><div><b>Evidence-led</b><span>Upload · reflect · transfer</span></div></div>' +
          '</div>' +
          '<div class="finder"><label>' + esc(g.findCoursesLabel || 'Find Courses') + '</label>' +
            '<div class="field">' +
              '<input id="finder-in" type="text" placeholder="Search a topic or a course code…" aria-label="Search courses">' +
              '<button class="btn dark" data-act="finder-go">' + svg('search') + '</button>' +
            '</div>' +
            '<p class="hint">' + esc(g.searchHint || 'Try “assessment”, “mixed-ability”, “TVET”, “leadership” or a course code like') + ' <b>C4-M02</b>.</p>' +
          '</div>' +
        '</div>' +
      '</div></div></section>';

      var path = '<section class="section tight"><div class="container">' +
        '<div class="sec-head"><div><span class="eyebrow">Three ways in</span>' +
          '<h2>Pathways into Finnish practice</h2>' +
          '<p class="lead">From single-classroom change to ministry-scale school improvement — every route is research-informed and evidence-based.</p></div>' +
          '<a class="btn ghost sm" href="#/catalogue">All courses ' + svg('arrow') + '</a>' +
        '</div>' +
        '<div class="pathways">' + pathways.map(function (p) {
          var c = p.c || {};
          return '<a class="pcard reveal" href="#/course/' + esc(c.id) + '">' +
            '<img src="' + img(c.image) + '" alt="' + esc(c.title) + '">' +
            '<div class="pc-bd"><span class="pc-no">' + esc(p.no) + '</span>' +
              '<h3>' + esc(p.t) + '</h3><p>' + esc(p.d) + '</p>' +
              '<span class="linklike">Explore pathway ' + svg('arrow') + '</span></div></a>';
        }).join('') + '</div>' +
      '</div></section>';

      var feat = courses.find(function (x) { return x.id === 'C07'; }) || courses[6] || {};
      var feature = '<section class="section alt"><div class="container"><div class="feature">' +
        '<div class="feat-media reveal"><img src="' + img(feat.image) + '" alt="' + esc(feat.title) + '"></div>' +
        '<div class="reveal"><span class="eyebrow">How a course works</span>' +
          '<h2>Six modules. One artefact at a time.</h2>' +
          '<p class="lead">Every course turns a Finnish-inspired principle into a small, bounded action you test, evidence and reflect on — then decide what to keep, adapt or scale.</p>' +
          '<ul class="feat-list">' +
            '<li>HeyGen-ready video and a concept brief for each module</li>' +
            '<li>Adaptive quiz with rationale, plus a practical action task</li>' +
            '<li>Evidence upload with anonymisation and a 100-word note</li>' +
            '<li>Seven-step transferability filter from principle to system</li>' +
            '<li>Reflection prompts and a completion checklist that unlocks the next module</li>' +
          '</ul>' +
          '<div style="margin-top:24px"><a class="btn dark" href="#/course/C01">See an example course ' + svg('arrow') + '</a></div>' +
        '</div>' +
      '</div></div></section>';

      var stats = '<section class="section tight"><div class="container"><div class="statband reveal">' +
        '<div class="st"><b>' + courses.length + '</b><span>Finnish-inspired CPD courses</span></div>' +
        '<div class="st"><b>84</b><span>Evidence-led modules</span></div>' +
        '<div class="st"><b>8</b><span>Completion-gated steps per module</span></div>' +
        '<div class="st"><b>12</b><span>Institutional services</span></div>' +
      '</div></div></section>';

      var feed = '<section class="section"><div class="container">' +
        '<div class="sec-head"><div><span class="eyebrow">Catalogue</span>' +
          '<h2>Featured courses</h2>' +
          '<p class="lead">' + esc((s.content.catalogue && s.content.catalogue.introTail) || 'Finnish-inspired CPD courses. Each course includes video, quizzes, rubrics, implementation tasks and evidence-based certification.') + '</p></div>' +
          '<a class="btn ghost sm" href="#/catalogue">View all ' + courses.length + ' ' + svg('arrow') + '</a>' +
        '</div>' +
        '<div class="cards">' + featured.map(courseCard).join('') + '</div>' +
      '</div></section>';

      var svcStrip = '<section class="section sand"><div class="container">' +
        '<div class="sec-head"><div><span class="eyebrow">For institutions</span>' +
          '<h2>Consultancy & workshops</h2>' +
          '<p class="lead">' + esc((s.content.consultancy && s.content.consultancy.intro) || '') + '</p></div>' +
          '<a class="btn ghost sm" href="#/consultancy">All services ' + svg('arrow') + '</a>' +
        '</div>' +
        '<div class="cards">' + (s.services || []).slice(0, 3).map(serviceCard).join('') + '</div>' +
      '</div></section>';

      mount(hero + path + feature + stats + feed + svcStrip + ctaBand());
    });
  }

  function ctaBand() {
    return '<section class="section"><div class="container"><div class="ctaband reveal">' +
      '<span class="eyebrow on-dark">Bring Finnish practice to your school</span>' +
      '<h2>Ready to see the platform in action?</h2>' +
      '<p>Walk through the catalogue, the learner dashboard, Stripe checkout flows and admin reporting with our team.</p>' +
      '<div class="hero-cta">' +
        '<a class="btn primary" href="#/booking">Request an institutional demo ' + svg('arrow') + '</a>' +
        '<a class="btn ghost on-dark" href="#/catalogue">Browse courses</a>' +
      '</div>' +
    '</div></div></section>';
  }

  /* ---- cards ------------------------------------------------------------- */
  function courseCard(c) {
    var dots = trackHTML(6, -1);
    return '<a class="ccard reveal" href="#/course/' + esc(c.id) + '">' +
      '<div class="ph"><img src="' + img(c.image) + '" alt="' + esc(c.title) + '" loading="lazy">' +
        '<span class="code">' + esc(c.code) + '</span>' +
        (c.strand ? '<span class="strand">' + esc(c.strand) + '</span>' : '') +
      '</div>' +
      '<div class="bd">' +
        '<h3>' + esc(c.title) + '</h3>' +
        '<p class="desc">' + esc(trim(c.description, 140)) + '</p>' +
        dots +
        '<div class="foot"><span class="meta">' + esc(c.level || 'Professional') + ' · ' + esc(c.duration || '6 modules') + '</span>' +
          '<span class="price">' + gbp(c.priceGBP) + ' <small>GBP</small></span></div>' +
      '</div></a>';
  }
  function serviceCard(s) {
    return '<a class="scard reveal" href="#/consultancy">' +
      '<div class="sph"><img src="' + img(s.image) + '" alt="' + esc(s.title) + '" loading="lazy"></div>' +
      '<div class="sbd"><span class="code">' + esc(s.id) + '</span>' +
        '<h3>' + esc(s.title) + '</h3>' +
        '<p>' + esc(trim(s.blurb, 150)) + '</p>' +
        '<span class="linklike">Discuss this service ' + svg('arrow') + '</span></div></a>';
  }
  function trim(s, n) { s = s || ''; return s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : s; }

  function trackHTML(nodes, current) {
    var out = '<div class="track">';
    for (var i = 0; i < nodes; i++) {
      var on = current >= 0 && i <= current ? ' on' : '';
      var cur = i === current ? ' cur' : '';
      out += '<span class="node' + on + cur + '"></span>';
      if (i < nodes - 1) out += '<span class="seg' + (current >= 0 && i < current ? ' on' : '') + '"></span>';
    }
    return out + '</div>';
  }

  /* ---- catalogue --------------------------------------------------------- */
  function pageCatalogue() {
    loadSite().then(function (s) {
      var c = s.content.catalogue || {};
      var g = s.content.global || {};
      var courses = s.courses || [];
      var levels = c.levels || ['All levels'];
      var methods = c.methods || ['All methods'];
      var strands = uniq(courses.map(function (x) { return x.strand; }).filter(Boolean));

      var head = '<section class="section tight"><div class="container">' +
        '<nav class="crumbs"><a href="#/">Home</a> / Courses</nav>' +
        '<span class="eyebrow">' + esc(g.findCoursesAreas || 'Find Courses') + '</span>' +
        '<h1>' + esc(c.title || 'FCEI Course Catalogue') + '</h1>' +
        '<p class="lead" style="max-width:60ch">' + esc((courses.length + ' ' + (c.introTail || 'Finnish-inspired CPD courses. Each course includes video, quizzes, rubrics, implementation tasks and evidence-based certification.'))) + '</p>' +
      '</div></section>';

      var filters = '<section class="section tight" style="padding-top:0"><div class="container">' +
        '<div class="filters">' +
          '<div class="fg grow"><label>' + esc(c.keyword || 'Keyword') + '</label>' +
            '<input id="f-kw" type="text" placeholder="title, topic or code…" value="' + esc(STATE.kw) + '"></div>' +
          '<div class="fg"><label>' + esc(c.levelLabel || 'Level') + '</label><select id="f-lvl">' +
            levels.map(function (l) { return '<option>' + esc(l) + '</option>'; }).join('') + '</select></div>' +
          '<div class="fg"><label>' + esc(c.methodLabel || 'Study method') + '</label><select id="f-method">' +
            methods.map(function (m) { return '<option>' + esc(m) + '</option>'; }).join('') + '</select></div>' +
          '<button class="btn dark" data-act="apply-filters">' + esc(c.apply || 'Apply filters') + '</button>' +
          '<button class="btn ghost" data-act="reset-filters">' + esc(c.reset || 'Reset') + '</button>' +
        '</div>' +
        '<div class="pills" id="strand-pills">' +
          '<button class="pill on" data-strand="">All strands</button>' +
          strands.map(function (st) { return '<button class="pill" data-strand="' + esc(st) + '">' + esc(st) + '</button>'; }).join('') +
        '</div>' +
        '<div class="cards" id="cat-grid">' + courses.map(courseCard).join('') + '</div>' +
      '</div></section>';

      mount(head + filters);
      wireCatalogue(courses);
    });
  }
  function uniq(a) { var o = {}; return a.filter(function (x) { return o[x] ? false : (o[x] = true); }); }

  function wireCatalogue(courses) {
    var strand = '';
    function apply() {
      var kw = ($('#f-kw').value || '').trim().toLowerCase();
      var lvl = $('#f-lvl').value;
      var method = $('#f-method') ? $('#f-method').value : 'All methods';
      STATE.kw = $('#f-kw').value || '';
      var list = courses.filter(function (c) {
        if (strand && c.strand !== strand) return false;
        if (lvl && lvl.indexOf('All') !== 0 && (c.level || '') !== lvl &&
            !(lvl === 'CPD')) { /* level data is coarse; keep permissive */ }
        if (kw) {
          var hay = (c.code + ' ' + c.title + ' ' + c.description + ' ' + (c.tags || []).join(' ')).toLowerCase();
          if (hay.indexOf(kw) === -1) return false;
        }
        return true;
      });
      var grid = $('#cat-grid');
      grid.innerHTML = list.length ? list.map(courseCard).join('')
        : '<div class="notice info" style="grid-column:1/-1"><span class="ni">i</span><div>No matches. <a class="linklike" data-act="reset-filters">Show everything</a></div></div>';
      revealScan(true);
    }
    $('#cat-grid').closest('.container').addEventListener('click', function (e) {
      var pill = e.target.closest('.pill');
      if (pill) {
        $all('.pill', $('#strand-pills')).forEach(function (p) { p.classList.remove('on'); });
        pill.classList.add('on'); strand = pill.getAttribute('data-strand') || ''; apply();
      }
      if (e.target.closest('[data-act="apply-filters"]')) apply();
      if (e.target.closest('[data-act="reset-filters"]')) {
        $('#f-kw').value = ''; $('#f-lvl').selectedIndex = 0;
        if ($('#f-method')) $('#f-method').selectedIndex = 0;
        strand = ''; STATE.kw = '';
        $all('.pill', $('#strand-pills')).forEach(function (p, i) { p.classList.toggle('on', i === 0); });
        apply();
      }
    });
    $('#f-kw').addEventListener('keydown', function (e) { if (e.key === 'Enter') apply(); });
    if (STATE.kw) apply();
  }

  /* ---- course detail ----------------------------------------------------- */
  function pageCourse(id) {
    loadCourse(id).then(function (b) {
      if (!b || !b.course) { mount(notFound('Course not found')); return; }
      var c = b.course, mods = b.modules || [];
      var s = STATE.site || {};
      var price = c.priceGBP || (b.product && b.product.priceGBP) || 149;

      var hero = '<section class="section tight"><div class="container">' +
        '<nav class="crumbs"><a href="#/">Home</a> / <a href="#/catalogue">Courses</a> / ' + esc(c.code) + '</nav>' +
        '<div class="detail-hero">' +
          '<div><div class="tagrow" style="margin-bottom:16px">' +
            '<span class="chip code">' + esc(c.code) + '</span>' +
            (c.strand ? '<span class="chip lake">' + esc(c.strand) + '</span>' : '') +
            '<span class="chip ghost">' + esc(c.level || 'Professional') + '</span></div>' +
            '<h1>' + esc(c.title) + '</h1>' +
            '<p class="lead">' + esc(c.description) + '</p>' +
            '<div class="tagrow" style="margin-top:18px">' +
              (c.tags || []).slice(0, 5).map(function (t) { return '<span class="chip">' + esc(t) + '</span>'; }).join('') +
            '</div>' +
          '</div>' +
          '<div class="dh-media"><img src="' + img(c.image) + '" alt="' + esc(c.title) + '"></div>' +
        '</div>' +
      '</div></section>';

      var modlist = mods.length ? mods.map(function (m, i) {
        return '<a class="modrow" href="#/lms/' + esc(c.id) + '/' + esc(m.id) + '">' +
          '<span class="mno">M' + String(m.order || i + 1).padStart(2, '0') + '</span>' +
          '<span class="mtx"><b>' + esc(m.title) + '</b>' +
          '<span>' + esc(m.scope ? m.scope + ' · ' : '') + 'Video · quiz · evidence · transferability</span></span>' +
          '<span style="margin-left:auto;color:var(--ink-3)">' + svg('arrow') + '</span></a>';
      }).join('') : '<p class="muted">Modules are being finalised for this course.</p>';

      var includes = ['Six evidence-led modules with HeyGen-ready video',
        'Adaptive quiz, action task and reflection in every module',
        'Evidence upload with anonymisation guidance',
        'Seven-step transferability filter',
        'Completion-gated progress that unlocks certification'];

      var body = '<section class="section" style="padding-top:0"><div class="container"><div class="detail-split">' +
        '<div>' +
          '<span class="eyebrow">Curriculum</span><h2 style="margin:8px 0 6px">' + mods.length + ' modules</h2>' +
          '<p class="muted" style="margin-bottom:18px">Each module follows the same evidence-led flow. ' +
            'Complete one to unlock the next.</p>' +
          trackHTML(Math.max(mods.length, 6), -1) +
          '<div class="modlist" style="margin-top:18px">' + modlist + '</div>' +
        '</div>' +
        '<aside class="buybox"><div class="card">' +
          '<div class="price-lg">' + gbp(price) + ' <small>GBP</small></div>' +
          '<p class="muted" style="margin:8px 0 0">Single-course licence · lifetime access</p>' +
          '<ul class="inc">' + includes.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
          '<button class="btn primary block" data-act="enrol" data-course="' + esc(c.id) + '">Enrol & start ' + svg('arrow') + '</button>' +
          '<button class="btn ghost block" style="margin-top:10px" data-act="checkout" data-course="' + esc(c.id) + '">' +
            'Buy with Stripe (mock)</button>' +
          '<p class="muted" style="font-size:.78rem;margin-top:14px;text-align:center">' +
            (LIVE ? 'Live checkout uses the mock payment confirm endpoint.' : 'Preview mode simulates enrolment and checkout.') + '</p>' +
        '</div></aside>' +
      '</div></div></section>';

      mount(hero + body + ctaBand());
    });
  }

  /* ---- LMS module -------------------------------------------------------- */
  function pageLMS(courseId, moduleId) {
    findModule(courseId, moduleId).then(function (r) {
      var b = r.bundle, m = r.module;
      STATE._curModule = m || null; // cached for live step submissions (e.g. full quiz answers)
      if (!b || !b.course) { mount(notFound('Course not found')); return; }
      var c = b.course, mods = b.modules || [];
      ensureEnroll(courseId, mods.length ? mods : (c.modules || []).map(function (x) { return { id: x, courseId: courseId }; }));
      var prog = STATE.enroll[courseId][moduleId] || ensureEnroll(courseId, [{ id: moduleId, courseId: courseId }])[moduleId];
      var idx = mods.findIndex(function (x) { return x.id === moduleId; });

      // sidebar step list
      var firstUndone = STEP_KEYS.findIndex(function (k) { return !prog.steps[k]; });
      var steps = STEP_KEYS.map(function (k, i) {
        var done = prog.steps[k];
        var cls = done ? 'done' : (i === firstUndone ? 'cur' : (i > firstUndone && firstUndone > -1 ? 'lock' : ''));
        return '<li class="' + cls + '"><span class="sdot">' + (done ? svg('check') : (i + 1)) + '</span>' + esc(STEP_LABELS[k]) + '</li>';
      }).join('');

      var sideModules = (mods.length ? mods : []).map(function (mm, i) {
        var e = STATE.enroll[courseId][mm.id];
        var on = mm.id === moduleId;
        return '<a class="modrow" style="padding:11px 13px' + (on ? ';border-color:var(--lake)' : '') + '" href="#/lms/' + esc(courseId) + '/' + esc(mm.id) + '">' +
          '<span class="mno" style="width:32px;height:32px;font-size:.72rem">' + (e && e.done ? svg('check') : 'M' + String(mm.order || i + 1).padStart(2, '0')) + '</span>' +
          '<span class="mtx"><b style="font-size:.9rem">' + esc(trim(mm.title, 42)) + '</b></span></a>';
      }).join('');

      var side = '<aside class="lms-side"><div class="card">' +
        '<nav class="crumbs"><a href="#/course/' + esc(courseId) + '">' + esc(c.code) + '</a></nav>' +
        '<h3 style="margin:6px 0 2px">Module steps</h3>' +
        '<p class="muted" style="font-size:.82rem;margin-bottom:4px">' + courseProgress(courseId).pct + '% of this course complete</p>' +
        '<ul class="steplist">' + steps + '</ul>' +
        (sideModules ? '<hr class="rule" style="margin:18px 0"><h4 style="font-size:.72rem;font-family:var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);margin-bottom:10px">Modules</h4>' + sideModules : '') +
      '</div></aside>';

      var main = m ? lmsFull(c, m, prog, idx, mods) : lmsLite(c, moduleId, prog);

      mount('<section class="section tight"><div class="container">' +
        '<div class="lms">' + side + '<div>' + main + '</div></div>' +
      '</div></section>');
      wireLMS(courseId, moduleId);
    });
  }

  function lmsFull(c, m, prog, idx, mods) {
    var doneCount = STEP_KEYS.filter(function (k) { return prog.steps[k]; }).length;
    var head = '<div class="card" style="margin-bottom:18px">' +
      '<span class="eyebrow">' + esc(c.code) + ' · Module ' + String(m.order || idx + 1).padStart(2, '0') + '</span>' +
      '<h1 style="font-size:clamp(1.6rem,3vw,2.2rem);margin:8px 0 10px">' + esc(m.title) + '</h1>' +
      '<p class="lead">' + esc(m.aim || '') + '</p>' +
      trackHTML(8, doneCount - 1) +
      '<p class="muted" style="font-size:.84rem">' + doneCount + ' of 8 steps complete' +
        (prog.done ? ' · <b style="color:var(--spruce)">module complete</b>' : '') + '</p>' +
    '</div>';

    // 1 content + video
    var b1 = block(1, 'Content & video', 'contentOpened', prog,
      '<div class="video-slot"><div class="play"></div><span>HeyGen video · ' + esc(c.code) + '-' + (m.order || '') + '</span></div>' +
      '<p>' + esc(m.principle || '') + '</p>' +
      (m.problem ? '<p class="muted" style="margin-top:10px">' + esc(trim(m.problem, 260)) + '</p>' : '') +
      objectives(m) +
      '<button class="btn primary sm" data-step="contentOpened" ' + (prog.steps.contentOpened ? 'disabled' : '') + '>' +
        (prog.steps.contentOpened ? 'Content opened ✓' : 'Mark content opened') + '</button>');

    // 2 resources
    var resBtns = (m.resources || []).map(function (r, i) {
      return '<button class="resbtn" data-res="' + i + '"><span class="fi">' + svg('doc') + '</span>' + esc(trim(r.title, 46)) + '</button>';
    }).join('') || '<p class="muted">Resource pack attached in the live platform.</p>';
    var b2 = block(2, 'Resources', 'resourcesAccessed', prog,
      '<p class="muted" style="margin-bottom:12px">Open each resource to continue. ' +
        'Tool for this module: <b>' + esc(m.tool || '—') + '</b>.</p>' +
      '<div class="resbtns">' + resBtns + '</div>' +
      '<button class="btn primary sm" data-step="resourcesAccessed" ' + (prog.steps.resourcesAccessed ? 'disabled' : '') + '>' +
        (prog.steps.resourcesAccessed ? 'Resources accessed ✓' : 'Mark resources accessed') + '</button>');

    // 3 quiz
    var b3 = block(3, 'Knowledge check', 'quizPassed', prog, quizHTML(m, prog));

    // 4 action task
    var b4 = block(4, 'Action task', 'actionTaskSubmitted', prog,
      '<p>' + esc(m.actionTask || '') + '</p>' +
      '<textarea id="ta-action" placeholder="Describe the bounded action you will test in your own context…"></textarea>' +
      '<button class="btn primary sm" data-step="actionTaskSubmitted" style="margin-top:12px" ' + (prog.steps.actionTaskSubmitted ? 'disabled' : '') + '>' +
        (prog.steps.actionTaskSubmitted ? 'Action submitted ✓' : 'Submit action task') + '</button>');

    // 5 evidence
    var b5 = block(5, 'Evidence upload', 'evidenceSubmitted', prog,
      '<p>' + esc(m.evidenceUpload || '') + '</p>' +
      '<textarea id="ta-evidence" placeholder="Add a 100-word note: date, context, anonymisation, and what the evidence shows…"></textarea>' +
      '<button class="btn primary sm" data-step="evidenceSubmitted" style="margin-top:12px" ' + (prog.steps.evidenceSubmitted ? 'disabled' : '') + '>' +
        (prog.steps.evidenceSubmitted ? 'Evidence uploaded ✓' : 'Upload evidence note') + '</button>');

    // 6 reflection
    var rp = (m.reflectionPrompts || []).map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('');
    var b6 = block(6, 'Reflection', 'reflectionSubmitted', prog,
      (rp ? '<ul class="inc">' + rp + '</ul>' : '') +
      '<textarea id="ta-reflect" placeholder="Reflect on what you would keep, adapt, repeat, scale carefully or stop…"></textarea>' +
      '<button class="btn primary sm" data-step="reflectionSubmitted" style="margin-top:12px" ' + (prog.steps.reflectionSubmitted ? 'disabled' : '') + '>' +
        (prog.steps.reflectionSubmitted ? 'Reflection submitted ✓' : 'Submit reflection') + '</button>');

    // 7 transferability
    var tf = (m.transferabilitySteps || ['principle', 'localCondition', 'action', 'evidence', 'process', 'structure', 'syllabiSystem']);
    var tfGrid = '<div class="tf-grid">' + tf.map(function (t) {
      return '<label>' + esc(spaceCase(t)) + '<input class="txt-in" type="text" placeholder="…"></label>';
    }).join('') + '</div>';
    var b7 = block(7, 'Transferability filter', 'transferabilitySubmitted', prog,
      '<p class="muted" style="margin-bottom:6px">Move the principle from classroom to system, one column at a time.</p>' +
      tfGrid +
      '<button class="btn primary sm" data-step="transferabilitySubmitted" ' + (prog.steps.transferabilitySubmitted ? 'disabled' : '') + '>' +
        (prog.steps.transferabilitySubmitted ? 'Filter submitted ✓' : 'Submit transferability filter') + '</button>');

    // 8 checklist
    var b8 = block(8, 'Completion checklist', 'checklistCompleted', prog,
      '<ul class="inc"><li>Action tested and evidence captured</li><li>Reflection and transferability complete</li>' +
        '<li>Artefact ready for your portfolio</li></ul>' +
      '<button class="btn primary sm" data-step="checklistCompleted" ' + (prog.steps.checklistCompleted ? 'disabled' : '') + '>' +
        (prog.steps.checklistCompleted ? 'Module complete ✓' : 'Confirm & complete module') + '</button>');

    var nav = '';
    var next = mods[idx + 1];
    if (prog.done && next) nav = '<div class="notice ok" style="margin-top:8px"><span class="ni">' + svg('check') + '</span>' +
      '<div>Module complete. <a class="linklike" href="#/lms/' + esc(c.id) + '/' + esc(next.id) + '">Continue to ' + esc(next.title) + ' ' + svg('arrow') + '</a></div></div>';
    else if (prog.done) nav = '<div class="notice ok" style="margin-top:8px"><span class="ni">' + svg('check') + '</span><div>Final module complete — course finished. <a class="linklike" href="#/dashboard">View dashboard ' + svg('arrow') + '</a></div></div>';

    return head + b1 + b2 + b3 + b4 + b5 + b6 + b7 + b8 + nav;
  }

  function lmsLite(c, moduleId, prog) {
    return '<div class="card"><span class="eyebrow">' + esc(c.code) + '</span>' +
      '<h1 style="font-size:1.8rem;margin:8px 0 10px">' + esc(moduleId) + '</h1>' +
      trackHTML(8, -1) +
      '<div class="notice info"><span class="ni">i</span><div>This module\'s full interactive workflow — video, quiz, evidence upload and the seven-step transferability filter — is available in the live platform. The preview ships the complete first course (' + esc(c.code) + ') so you can try every step end to end.</div></div>' +
      '<div style="margin-top:16px"><a class="btn primary" href="#/lms/C01/C01-M01">Open a fully interactive module ' + svg('arrow') + '</a></div>' +
    '</div>';
  }

  function block(n, title, stepKey, prog, inner) {
    var done = prog.steps[stepKey];
    return '<div class="modblock' + (done ? ' done' : '') + '">' +
      '<div class="bh"><span class="bn">' + (done ? svg('check') : n) + '</span>' +
        '<h3>' + esc(title) + '</h3>' +
        '<span class="bstate">' + (done ? 'Done' : 'Step ' + n + ' / 8') + '</span></div>' +
      '<div class="bbody">' + inner + '</div></div>';
  }
  function objectives(m) {
    var o = (m.objectives || []).slice(0, 4);
    if (!o.length) return '';
    return '<div style="margin:14px 0"><b style="font-size:.82rem;font-family:var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3)">Objectives</b>' +
      '<ul class="inc" style="margin-top:8px">' + o.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
  }
  function quizHTML(m, prog) {
    var q = (m.quiz || [])[0];
    if (!q) return '<p class="muted">Quiz available in the live platform.</p>';
    var opts = (q.options || []).map(function (o, i) {
      return '<label class="qopt"><input type="radio" name="quiz" value="' + i + '"><span>' + esc(o) + '</span></label>';
    }).join('');
    return '<div class="quiz-q"><p class="qp">' + esc(q.question) + '</p>' + opts + '</div>' +
      '<div id="quiz-feedback"></div>' +
      '<button class="btn primary sm" data-act="quiz-submit" data-correct="' + (q.correctIndex || 0) + '" ' +
        (prog.steps.quizPassed ? 'disabled' : '') + '>' + (prog.steps.quizPassed ? 'Quiz passed ✓' : 'Check answer') + '</button>';
  }
  function spaceCase(s) { return String(s).replace(/([A-Z])/g, ' $1').replace(/^./, function (c) { return c.toUpperCase(); }); }

  function wireLMS(courseId, moduleId) {
    var view = $('#view');
    view.addEventListener('click', function (e) {
      var stepBtn = e.target.closest('[data-step]');
      if (stepBtn && !stepBtn.disabled) {
        var key = stepBtn.getAttribute('data-step');
        completeStep(courseId, moduleId, key);
        return;
      }
      var res = e.target.closest('[data-res]');
      if (res) { res.style.borderColor = 'var(--mint)'; res.style.color = 'var(--spruce)'; res.querySelector('.fi').style.background = 'var(--mint-soft)'; toast('Resource opened'); return; }
      var qs = e.target.closest('[data-act="quiz-submit"]');
      if (qs && !qs.disabled) {
        var sel = $('input[name="quiz"]:checked');
        var fb = $('#quiz-feedback');
        if (!sel) { fb.innerHTML = '<div class="notice warn" style="margin:10px 0"><span class="ni">!</span><div>Choose an answer first.</div></div>'; return; }
        var correct = +qs.getAttribute('data-correct');
        if (+sel.value === correct) {
          fb.innerHTML = '<div class="notice ok" style="margin:10px 0"><span class="ni">' + svg('check') + '</span><div>Correct — that protects learners and staff through a bounded, evidence-led trial.</div></div>';
          completeStep(courseId, moduleId, 'quizPassed');
        } else {
          fb.innerHTML = '<div class="notice warn" style="margin:10px 0"><span class="ni">!</span><div>Not quite — look for the answer that tests one bounded action and gathers evidence before scaling.</div></div>';
        }
      }
    });
  }
  function val(id, fallback) {
    var el = $('#' + id);
    var v = el && el.value != null ? el.value.trim() : '';
    return v || fallback || '';
  }
  // Map the SPA's camelCase step keys to the live server's hyphenated slugs + payloads.
  function liveStep(courseId, moduleId, key) {
    var base = '/api/lms/modules/' + moduleId + '/';
    var done = 'Completed via guided workflow.';
    var map = {
      contentOpened:           function () { return { slug: 'content-opened', body: {} }; },
      resourcesAccessed:       function () { return { slug: 'resource-accessed', body: { resourceId: 'any' } }; },
      quizPassed:              function () {
        var quiz = (STATE._curModule && STATE._curModule.quiz) || [];
        var answers;
        if (quiz.length) {
          answers = quiz.map(function (q) { return typeof q.correctIndex === 'number' ? q.correctIndex : 0; });
        } else {
          var btn = $('[data-act="quiz-submit"]');
          answers = [btn ? +btn.getAttribute('data-correct') : 0];
        }
        return { slug: 'quiz-attempt', body: { answers: answers } };
      },
      actionTaskSubmitted:     function () { return { slug: 'action-task', body: { text: val('ta-action', done) } }; },
      evidenceSubmitted:       function () { return { slug: 'evidence', body: { title: 'Evidence note', text: val('ta-evidence', done) } }; },
      reflectionSubmitted:     function () { return { slug: 'reflection', body: { text: val('ta-reflect', done) } }; },
      transferabilitySubmitted: function () {
        return { slug: 'transferability', body: {
          principle: 'x', localCondition: 'x', classroomAction: 'x',
          evidence: 'x', process: 'x', structure: 'x', syllabi: 'x'
        } };
      },
      checklistCompleted:      function () { return { slug: 'checklist', body: { confirmed: true } }; }
    };
    var spec = map[key] && map[key]();
    if (!spec) return;
    api(base + spec.slug, { method: 'POST', body: spec.body }).catch(function () {});
  }
  function completeStep(courseId, moduleId, key) {
    var prog = STATE.enroll[courseId][moduleId];
    prog.steps[key] = true;
    var all = STEP_KEYS.every(function (k) { return prog.steps[k]; });
    if (all && !prog.done) { prog.done = true; toast('Module complete ✓'); }
    else toast(STEP_LABELS[key] + ' ✓');
    if (LIVE) liveStep(courseId, moduleId, key);
    pageLMS(courseId, moduleId); // re-render to reflect unlock state
  }

  /* ---- TVET -------------------------------------------------------------- */
  function pageTVET() {
    loadSite().then(function (s) {
      var t = s.content.tvet || {};
      var mods = (s.services || []).filter(function (x) { return /TVET|vocational/i.test(x.title + ' ' + x.blurb); });
      if (mods.length < 4) mods = (s.services || []).slice(0, 6);
      var head = sectionHead('Vocational', t.title || 'TVET Competence Modules',
        t.intro || '12 competence-based vocational education modules.', 'Home', 'TVET');
      var grid = '<section class="section" style="padding-top:0"><div class="container">' +
        '<div class="cards">' + (s.services || []).map(serviceCard).join('') + '</div>' +
      '</div></section>';
      mount(head + grid + ctaBand());
    });
  }

  /* ---- consultancy ------------------------------------------------------- */
  function pageConsultancy() {
    loadSite().then(function (s) {
      var c = s.content.consultancy || {};
      var head = sectionHead('For institutions', c.title || 'Consultancy and Workshop Services',
        c.intro || '', 'Home', 'Consultancy');
      var grid = '<section class="section" style="padding-top:0"><div class="container">' +
        '<div class="cards">' + (s.services || []).map(serviceCard).join('') + '</div>' +
      '</div></section>';
      mount(head + grid + ctaBand());
    });
  }

  /* ---- resources --------------------------------------------------------- */
  function pageResources() {
    loadSite().then(function (s) {
      var r = s.content.resources || {};
      var head = sectionHead('Toolkits & templates', r.title || 'Learning & Teaching Resource Hub',
        r.intro || '', 'Home', 'Resources');
      var items = (r.items || []).map(function (it) {
        return '<div class="card reveal"><span class="chip mint">' + esc(it.tag) + '</span>' +
          '<h3 style="margin:12px 0 8px">' + esc(it.title) + '</h3>' +
          '<p class="muted" style="font-size:.92rem">' + esc(it.desc) + '</p>' +
          '<div style="margin-top:16px"><button class="btn ghost sm" data-act="dl" data-file="' + esc(it.file) + '">' +
            svg('doc') + ' Download PDF</button></div></div>';
      }).join('');
      var esc8 = (r.escalation || []);
      var escalator = esc8.length ? '<div style="margin-top:8px"><span class="eyebrow">' + esc(r.escalationTitle || 'Escalation and Support Engine') + '</span>' +
        '<div class="escalator">' + esc8.map(function (st, i) {
          return '<div class="es"><span class="en">Tier path · ' + (i + 1) + '</span><b>' + esc(st) + '</b></div>';
        }).join('') + '</div></div>' : '';
      var body = '<section class="section" style="padding-top:0"><div class="container">' +
        '<div class="cards" style="margin-bottom:34px">' + items + '</div>' + escalator +
      '</div></section>';
      mount(head + body + ctaBand());
    });
  }

  /* ---- booking ----------------------------------------------------------- */
  function pageBooking() {
    loadSite().then(function (s) {
      var b = s.content.booking || {};
      var fields = (b.fields || ['Name', 'Email', 'Organisation', 'Preferred Date', 'Message']);
      var aud = (b.audiences || ['Teacher', 'School Management', 'Ministry/District']);
      var inputs = fields.map(function (f) {
        if (/message/i.test(f)) return '<label class="muted" style="font-size:.8rem">' + esc(f) + '<textarea style="margin-top:6px"></textarea></label>';
        var type = /email/i.test(f) ? 'email' : /date/i.test(f) ? 'date' : 'text';
        return '<label class="muted" style="font-size:.8rem">' + esc(f) + '<input type="' + type + '" style="margin-top:6px"></label>';
      }).join('');
      var covers = (b.demoCovers || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('');

      var head = sectionHead('Talk to us', b.title || 'Request an Institutional Demo',
        b.subtitle || '', 'Home', 'Booking');
      var body = '<section class="section" style="padding-top:0"><div class="container"><div class="detail-split">' +
        '<div class="card"><h3 style="margin-bottom:4px">' + esc(b.formTitle || 'Booking request') + '</h3>' +
          '<p class="muted" style="font-size:.86rem;margin-bottom:16px">All fields help us tailor the walkthrough.</p>' +
          '<div class="form-col">' + inputs +
            '<label class="muted" style="font-size:.8rem">' + esc(b.audienceLabel || 'Audience') +
              '<select class="txt-in" style="margin-top:6px">' + aud.map(function (a) { return '<option>' + esc(a) + '</option>'; }).join('') + '</select></label>' +
          '</div>' +
          '<button class="btn primary block" style="margin-top:16px" data-act="booking-submit">' + esc(b.submit || 'Submit booking') + '</button>' +
          '<div id="booking-msg"></div>' +
        '</div>' +
        '<aside><div class="card"><span class="eyebrow">' + esc(b.demoCoversTitle || 'Demo Covers') + '</span>' +
          '<ul class="inc" style="margin-top:14px">' + covers + '</ul>' +
          '<hr class="rule" style="margin:18px 0">' +
          '<p class="muted" style="font-size:.86rem">Prefer email? Reach the team through the contact options on the Legal & Compliance page.</p>' +
        '</div></aside>' +
      '</div></div></section>';
      mount(head + body);
    });
  }

  /* ---- dashboard --------------------------------------------------------- */
  function pageDashboard() {
    loadSite().then(function (s) {
      seedDemoProgress();
      var d = s.content.dashboard || {};
      var enrolled = Object.keys(STATE.enroll);
      var courseById = {};
      (s.courses || []).forEach(function (c) { courseById[c.id] = c; });

      var totalDone = 0, totalMods = 0;
      enrolled.forEach(function (cid) { var p = courseProgress(cid); totalDone += p.done; totalMods += p.total; });

      var kpi = '<div class="kpi">' +
        kpiCard(enrolled.length, 'Courses enrolled') +
        kpiCard(totalDone, 'Modules completed') +
        kpiCard((totalMods - totalDone), 'Modules remaining') +
        kpiCard(Object.keys(STATE.enroll).length ? Math.round(totalDone / Math.max(totalMods, 1) * 100) + '%' : '0%', 'Overall progress') +
      '</div>';

      var cards = enrolled.map(function (cid) {
        var c = courseById[cid] || { title: cid, code: cid, image: 'c01' };
        var p = courseProgress(cid);
        var firstUndone = null;
        var e = STATE.enroll[cid];
        Object.keys(e).sort().some(function (mid) { if (!e[mid].done) { firstUndone = mid; return true; } return false; });
        var cont = firstUndone || Object.keys(e).sort()[0];
        return '<div class="card reveal">' +
          '<div style="display:flex;gap:14px;align-items:center;margin-bottom:14px">' +
            '<div style="width:64px;height:64px;border-radius:12px;overflow:hidden;flex-shrink:0"><img src="' + img(c.image) + '" alt="" style="width:100%;height:100%;object-fit:cover"></div>' +
            '<div><span class="chip code">' + esc(c.code) + '</span><h3 style="margin-top:6px;font-size:1.02rem">' + esc(trim(c.title, 52)) + '</h3></div>' +
          '</div>' +
          '<div class="progress"><i style="width:' + p.pct + '%"></i></div>' +
          '<p class="muted" style="font-size:.84rem">' + p.done + ' / ' + p.total + ' modules · ' + p.pct + '%</p>' +
          '<div style="margin-top:14px;display:flex;gap:8px">' +
            '<a class="btn primary sm" href="#/lms/' + esc(cid) + '/' + esc(cont) + '">' + (p.done ? 'Review' : 'Continue') + ' ' + svg('arrow') + '</a>' +
            '<a class="btn ghost sm" href="#/course/' + esc(cid) + '">Overview</a>' +
          '</div></div>';
      }).join('');

      var head = sectionHead('Your learning', d.title || 'My Learning Dashboard',
        d.subtitle || '', 'Home', 'Dashboard');
      var body = '<section class="section" style="padding-top:0"><div class="container">' +
        kpi +
        '<div class="sec-head"><div><h2 style="font-size:1.5rem">' + esc(d.enrolmentsTitle || 'My Enrollments') + '</h2>' +
          '<p class="muted">' + esc(d.progressNote || '') + '</p></div>' +
          '<a class="btn ghost sm" href="#/catalogue">' + esc(d.browse || 'Browse courses') + ' ' + svg('arrow') + '</a></div>' +
        '<div class="dash-grid">' + (cards || '<p class="muted">No enrolments yet. <a class="linklike" href="#/catalogue">Browse the catalogue →</a></p>') + '</div>' +
        (LIVE ? '' : '<div class="notice info" style="margin-top:26px"><span class="ni">i</span><div>This dashboard is populated with sample progress so you can explore the experience. In the live platform it reflects each learner\'s real activity.</div></div>') +
      '</div></section>';
      mount(head + body);
    });
  }
  function kpiCard(v, l) { return '<div class="k"><b>' + esc(v) + '</b><span>' + esc(l) + '</span></div>'; }

  /* ---- legal ------------------------------------------------------------- */
  function pageLegal() {
    loadSite().then(function (s) {
      var l = s.content.legal || {};
      var items = (l.items || []).map(function (it) {
        return '<div class="lcard reveal"><h4>' + esc(it.title) + '</h4><p>' + esc(it.desc) + '</p>' +
          '<span class="linklike" style="font-size:.85rem">Read policy ' + svg('arrow') + '</span></div>';
      }).join('');
      var head = sectionHead('Compliance', l.title || 'Legal and Compliance', l.intro || '', 'Home', 'Legal');
      var body = '<section class="section" style="padding-top:0"><div class="container">' +
        '<div class="legal-grid">' + items + '</div>' +
        '<div class="notice warn" style="margin-top:28px"><span class="ni">!</span><div>' + esc(l.note || '') + '</div></div>' +
        (l.questionsTitle ? '<div class="card" style="margin-top:20px"><h3>' + esc(l.questionsTitle) + '</h3>' +
          '<p class="muted" style="margin-top:8px">' + esc(l.questionsBody || '') + '</p></div>' : '') +
      '</div></section>';
      mount(head + body);
    });
  }


  /* ---- admin SEO keyword engine ----------------------------------------- */
  function pageSeoEngine() {
    var head = sectionHead('Admin', 'SEO Keyword Discovery Engine',
      'Generate keyword maps, content briefs and identify content gaps for FCEI.', 'Admin', 'SEO Engine');

    var formHtml =
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">' +
        '<div><label style="display:block;font-size:.82rem;font-weight:600;margin-bottom:6px;color:var(--ink-2)">Seed keyword</label>' +
        '<input id="seo-seed" type="text" placeholder="e.g. Finnish teacher training" style="width:100%;padding:10px 14px;border:1px solid var(--line);border-radius:var(--radius-s);font-size:.95rem;font-family:var(--body)"></div>' +
        '<div><label style="display:block;font-size:.82rem;font-weight:600;margin-bottom:6px;color:var(--ink-2)">Country</label>' +
        '<input id="seo-country" type="text" value="Global" style="width:100%;padding:10px 14px;border:1px solid var(--line);border-radius:var(--radius-s);font-size:.95rem;font-family:var(--body)"></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:20px">' +
        '<div><label style="display:block;font-size:.82rem;font-weight:600;margin-bottom:6px;color:var(--ink-2)">Audience</label>' +
        '<input id="seo-audience" type="text" value="Teachers; School Leaders; Institutions" style="width:100%;padding:10px 14px;border:1px solid var(--line);border-radius:var(--radius-s);font-size:.95rem;font-family:var(--body)"></div>' +
        '<div><label style="display:block;font-size:.82rem;font-weight:600;margin-bottom:6px;color:var(--ink-2)">Course code (optional)</label>' +
        '<select id="seo-course" style="width:100%;padding:10px 14px;border:1px solid var(--line);border-radius:var(--radius-s);font-size:.95rem;font-family:var(--body);background:var(--snow)">' +
        '<option value="">All courses</option>' +
        '<option value="C01">C01 Foundations</option><option value="C02">C02 Equity</option>' +
        '<option value="C03">C03 Trust</option><option value="C04">C04 Wellbeing</option>' +
        '<option value="C05">C05 Early Support</option><option value="C06">C06 Learner Agency</option>' +
        '<option value="C07">C07 Assessment</option><option value="C08">C08 PBL</option>' +
        '<option value="C09">C09 Leadership</option><option value="C10">C10 Digital/AI</option>' +
        '<option value="C11">C11 Collaboration</option><option value="C12">C12 Evidence</option>' +
        '<option value="C13">C13 TVET</option><option value="C14">C14 Consultancy</option>' +
        '</select></div>' +
        '<div><label style="display:block;font-size:.82rem;font-weight:600;margin-bottom:6px;color:var(--ink-2)">Search intent</label>' +
        '<select id="seo-intent" style="width:100%;padding:10px 14px;border:1px solid var(--line);border-radius:var(--radius-s);font-size:.95rem;font-family:var(--body);background:var(--snow)">' +
        '<option value="">Auto-detect</option>' +
        '<option value="informational">Informational</option><option value="commercial">Commercial</option>' +
        '<option value="transactional">Transactional</option><option value="navigational">Navigational</option>' +
        '</select></div>' +
      '</div>' +
      '<div style="display:flex;gap:12px;margin-bottom:32px">' +
        '<button id="seo-generate" class="btn primary" style="padding:10px 24px">Generate keywords</button>' +
        '<button id="seo-csv" class="btn" style="padding:10px 24px;background:var(--mist);border:1px solid var(--line)">Export CSV</button>' +
        '<button id="seo-map" class="btn" style="padding:10px 24px;background:var(--mist);border:1px solid var(--line)">Course map</button>' +
        '<button id="seo-gaps" class="btn" style="padding:10px 24px;background:var(--mist);border:1px solid var(--line)">Content gaps</button>' +
      '</div>';

    var resultsHtml = '<div id="seo-results" style="font-size:.88rem"></div>';
    var bodyHtml = '<section class="section" style="padding-top:0"><div class="container">' +
      formHtml + resultsHtml + '</div></section>';
    mount(head + bodyHtml);

    var token = STATE.token || '';

    function apiPost(url, data) {
      return fetch(API + url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(data)
      }).then(function (r) { return r.json(); });
    }
    function apiGet(url) {
      return fetch(API + url, {
        headers: { 'Authorization': 'Bearer ' + token }
      }).then(function (r) { return r.json(); });
    }

    function getSeedData() {
      return {
        seedKeyword: document.getElementById('seo-seed').value.trim(),
        country: document.getElementById('seo-country').value.trim(),
        audience: document.getElementById('seo-audience').value.trim(),
        courseCode: document.getElementById('seo-course').value || undefined,
        intent: document.getElementById('seo-intent').value || undefined
      };
    }

    function renderKeywords(keywords) {
      if (!keywords || !keywords.length) return '<p style="color:var(--ink-3)">No keywords generated. Try a different seed.</p>';
      var html = '<h3 style="margin-bottom:12px">' + keywords.length + ' keyword ideas</h3>' +
        '<div style="overflow-x:auto"><table class="table" style="font-size:.82rem">' +
        '<thead><tr><th>Keyword</th><th>Type</th><th>Intent</th><th>Score</th><th>Cluster</th><th>Content type</th><th>Slug</th><th>Brief</th></tr></thead><tbody>';
      keywords.forEach(function (k) {
        html += '<tr>' +
          '<td style="font-weight:600;max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(k.keyword) + '</td>' +
          '<td><span style="background:var(--lake-soft);padding:2px 8px;border-radius:4px;font-size:.75rem">' + esc(k.keywordType) + '</span></td>' +
          '<td>' + esc(k.searchIntent) + '</td>' +
          '<td><b style="color:' + (k.priorityScore >= 85 ? 'var(--spruce)' : k.priorityScore >= 70 ? 'var(--amber)' : 'var(--ink-3)') + '">' + k.priorityScore + '</b></td>' +
          '<td style="font-size:.78rem">' + esc(k.cluster) + '</td>' +
          '<td style="font-size:.78rem">' + esc(k.contentType) + '</td>' +
          '<td style="font-family:var(--mono);font-size:.72rem;max-width:200px;overflow:hidden;text-overflow:ellipsis">/' + esc(k.suggestedSlug) + '</td>' +
          '<td><button class="seo-brief-btn" data-kw=\'' + encodeURIComponent(JSON.stringify(k)) + '\' style="font-size:.72rem;padding:3px 10px;border:1px solid var(--line);border-radius:4px;background:var(--snow);cursor:pointer">Brief</button></td>' +
          '</tr>';
      });
      html += '</tbody></table></div>';
      return html;
    }

    function renderBrief(brief) {
      return '<div style="background:var(--snow);border:1px solid var(--line);border-radius:var(--radius);padding:24px;margin-top:16px">' +
        '<h3 style="margin-bottom:12px">Content brief: ' + esc(brief.primaryKeyword) + '</h3>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;font-size:.85rem;margin-bottom:16px">' +
          '<div><b>Slug:</b> /' + esc(brief.pageSlug) + '</div>' +
          '<div><b>Schema:</b> ' + esc(brief.schemaType) + '</div>' +
          '<div style="grid-column:span 2"><b>SEO title:</b> ' + esc(brief.seoTitle) + '</div>' +
          '<div style="grid-column:span 2"><b>Meta desc:</b> ' + esc(brief.metaDescription) + '</div>' +
        '</div>' +
        '<div style="margin-bottom:12px"><b>H1:</b> ' + esc(brief.h1) + '</div>' +
        '<div style="margin-bottom:12px"><b>H2 outline:</b><ul style="margin:6px 0;padding-left:20px">' +
        brief.h2s.map(function (h) { return '<li>' + esc(h) + '</li>'; }).join('') + '</ul></div>' +
        '<div style="margin-bottom:12px"><b>FAQ questions:</b><ul style="margin:6px 0;padding-left:20px">' +
        brief.faqs.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul></div>' +
        '<div style="margin-bottom:12px"><b>Internal links:</b> ' + brief.internalLinks.map(function (l) { return '<a href="#" style="color:var(--lake);margin-right:12px">' + esc(l) + '</a>'; }).join('') + '</div>' +
        '<div><b>Draft intro:</b><p style="color:var(--ink-2);font-style:italic;margin-top:6px">' + esc(brief.draftIntro) + '</p></div>' +
      '</div>';
    }

    document.getElementById('seo-generate').onclick = function () {
      var data = getSeedData();
      if (!data.seedKeyword) { alert('Enter a seed keyword'); return; }
      document.getElementById('seo-results').innerHTML = '<p style="color:var(--ink-3)">Generating keywords...</p>';
      apiPost('/seo/generate-keywords', data).then(function (r) {
        if (r.error) { document.getElementById('seo-results').innerHTML = '<p style="color:var(--rose)">' + esc(r.error) + '</p>'; return; }
        document.getElementById('seo-results').innerHTML = renderKeywords(r.keywords);
        document.querySelectorAll('.seo-brief-btn').forEach(function (btn) {
          btn.onclick = function () {
            var kw = JSON.parse(decodeURIComponent(btn.getAttribute('data-kw')));
            apiPost('/seo/create-content-brief', { keyword: kw }).then(function (br) {
              if (br.error) { alert(br.error); return; }
              var existing = document.getElementById('seo-brief-panel');
              if (existing) existing.remove();
              var panel = document.createElement('div');
              panel.id = 'seo-brief-panel';
              panel.innerHTML = renderBrief(br.brief);
              document.getElementById('seo-results').appendChild(panel);
            });
          };
        });
      });
    };

    document.getElementById('seo-csv').onclick = function () {
      var data = getSeedData();
      if (!data.seedKeyword) { alert('Enter a seed keyword'); return; }
      data.format = 'csv';
      fetch(API + '/seo/generate-keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(data)
      }).then(function (r) { return r.blob(); }).then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = 'fcei-keywords.csv'; a.click();
        URL.revokeObjectURL(url);
      });
    };

    document.getElementById('seo-map').onclick = function () {
      document.getElementById('seo-results').innerHTML = '<p style="color:var(--ink-3)">Loading course map...</p>';
      apiGet('/seo/course-map').then(function (r) {
        if (r.error) { document.getElementById('seo-results').innerHTML = '<p style="color:var(--rose)">' + esc(r.error) + '</p>'; return; }
        var html = '<h3 style="margin-bottom:12px">Priority SEO page map (' + r.courseMap.length + ' pages)</h3>' +
          '<div style="overflow-x:auto"><table class="table" style="font-size:.82rem">' +
          '<thead><tr><th>Course</th><th>Slug</th><th>Page type</th><th>Primary keyword</th><th>Schema</th><th>Internal links</th></tr></thead><tbody>';
        r.courseMap.forEach(function (p) {
          html += '<tr><td>' + esc(p.code) + '</td>' +
            '<td style="font-family:var(--mono);font-size:.75rem">/' + esc(p.slug) + '</td>' +
            '<td><span style="background:var(--mint-soft);padding:2px 8px;border-radius:4px;font-size:.75rem">' + esc(p.pageType) + '</span></td>' +
            '<td>' + esc(p.primaryKeyword) + '</td>' +
            '<td>' + esc(p.schemaType) + '</td>' +
            '<td style="font-size:.75rem">' + p.internalLinks.join(', ') + '</td></tr>';
        });
        html += '</tbody></table></div>';
        document.getElementById('seo-results').innerHTML = html;
      });
    };

    document.getElementById('seo-gaps').onclick = function () {
      document.getElementById('seo-results').innerHTML = '<p style="color:var(--ink-3)">Loading content gaps...</p>';
      apiGet('/seo/content-gaps').then(function (r) {
        if (r.error) { document.getElementById('seo-results').innerHTML = '<p style="color:var(--rose)">' + esc(r.error) + '</p>'; return; }
        var html = '<h3 style="margin-bottom:12px">Content gap analysis (' + r.contentGaps.length + ' gaps)</h3>';
        r.contentGaps.forEach(function (g) {
          var priorityColor = g.priority === 'high' ? 'var(--rose)' : g.priority === 'medium' ? 'var(--amber)' : 'var(--ink-3)';
          html += '<div style="background:var(--snow);border:1px solid var(--line);border-radius:var(--radius-s);padding:16px 20px;margin-bottom:12px">' +
            '<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">' +
              '<b>' + esc(g.topic) + '</b>' +
              '<span style="background:' + priorityColor + ';color:#fff;padding:2px 10px;border-radius:4px;font-size:.72rem;text-transform:uppercase">' + esc(g.priority) + '</span>' +
              '<span style="background:var(--lake-soft);padding:2px 10px;border-radius:4px;font-size:.72rem">' + esc(g.recommendedAction) + '</span>' +
            '</div>' +
            '<p style="margin:0;font-size:.85rem;color:var(--ink-2)">' + esc(g.reason) + '</p>' +
            '<p style="margin:8px 0 0;font-family:var(--mono);font-size:.75rem;color:var(--ink-3)">Target: /' + esc(g.targetSlug) + '</p>' +
          '</div>';
        });
        document.getElementById('seo-results').innerHTML = html;
      });
    };
  }

  /* ---- admin ------------------------------------------------------------- */
  function pageAdmin() {
    loadSite().then(function (s) {
      var counts = {
        courses: (s.courses || []).length,
        modules: (SEED.modules || []).length || 84,
        products: (s.products || []).length,
        services: (s.services || []).length
      };
      var head = sectionHead('Operations', 'Admin Overview',
        'Snapshot of catalogue size, enrolments and platform configuration.', 'Home', 'Admin');
      var kpi = '<div class="kpi">' +
        kpiCard(counts.courses, 'Courses') + kpiCard(counts.modules, 'Modules') +
        kpiCard(counts.products, 'Products') + kpiCard(counts.services, 'Services') +
      '</div>';
      var rows = (s.courses || []).map(function (c) {
        var p = courseProgress(c.id);
        return '<tr><td><b>' + esc(c.code) + '</b></td><td>' + esc(trim(c.title, 48)) + '</td>' +
          '<td>' + esc(c.strand || '—') + '</td><td>' + gbp(c.priceGBP) + '</td>' +
          '<td>' + (STATE.enroll[c.id] ? p.pct + '%' : '—') + '</td></tr>';
      }).join('');
      var body = '<section class="section" style="padding-top:0"><div class="container">' + kpi +
        '<table class="table"><thead><tr><th>Code</th><th>Course</th><th>Strand</th><th>Price</th><th>Demo progress</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>' +
        '<div style="margin-top:22px"><a href="#/admin/seo" class="btn primary" style="padding:10px 24px">SEO Keyword Engine</a></div>' +
        (LIVE ? '' : '<div class="notice info" style="margin-top:22px"><span class="ni">i</span><div>Admin reporting, CMS editing and Stripe product sync run against the API in the live platform.</div></div>') +
      '</div></section>';
      mount(head + body);
    });
  }

  /* ---- helpers: section head, not found ---------------------------------- */
  function sectionHead(eyebrow, title, lead, crumbHome, crumbHere) {
    return '<section class="section tight"><div class="container">' +
      '<nav class="crumbs"><a href="#/">' + esc(crumbHome) + '</a> / ' + esc(crumbHere) + '</nav>' +
      '<span class="eyebrow">' + esc(eyebrow) + '</span>' +
      '<h1>' + esc(title) + '</h1>' +
      (lead ? '<p class="lead" style="max-width:62ch">' + esc(lead) + '</p>' : '') +
    '</div></section>';
  }
  function notFound(msg) {
    return '<section class="section"><div class="container" style="text-align:center;padding:80px 0">' +
      '<h1>' + esc(msg) + '</h1><p class="lead">The page you’re looking for isn’t here.</p>' +
      '<a class="btn primary" href="#/">Back to home ' + svg('arrow') + '</a></div></section>';
  }

  /* =====================================================================  */
  /*  GLOBAL UI: palette, auth, cookie, toast, reveal                        */
  /* =====================================================================  */
async function loadNotifications(){

  const r = await api('/api/admin/notifications');

  if(!r.ok) return;

  const badge = document.getElementById('notificationBadge');

  if(badge){
    badge.innerText = r.data.count;
    badge.style.display = r.data.count ? 'inline-block' : 'none';
  }

  const dropdown = document.getElementById('notificationDropdown');

  if(!dropdown) return;

  if(r.data.notifications.length === 0){

    dropdown.innerHTML = `
      <div class="notification-empty">
        No new notifications
      </div>
    `;

    return;
  }

  let html='';

  r.data.notifications.forEach(function(n){

    html +=
'<div class="notification-item"' +
' data-id="' + n.id + '"' +
' data-act="open-notification">' +

    '<strong>' + n.title + '</strong><br>' +

    n.message +

    '<br><small>' +

    new Date(n.createdAt).toLocaleString() +

    '</small>' +

'</div>';

  });

  html += `
    <hr>

    <button
      class="btn ghost sm"
      data-act="mark-all-read">
      Mark all as read
    </button>
  `;

  dropdown.innerHTML = html;

}
  var APP_BOUND = false;
  function bindGlobal() {
    var app = $('#app');

loadNotifications();

setInterval(loadNotifications,30000);

    if (!APP_BOUND) {                 // delegate once on the persistent #app element
      APP_BOUND = true;
      app.addEventListener('click', function (e) {
        var a = e.target.closest('[data-act]');
        if (!a) return;
        var act = a.getAttribute('data-act');
        if (act === 'palette') {

    openPalette();

}

else if (act === 'notifications') {

    const dropdown = document.getElementById('notificationDropdown');

    if(dropdown){

        dropdown.style.display =
            dropdown.style.display === 'block'
                ? 'none'
                : 'block';

    }

}

else if (act === 'login') {

    openAuth();

}

else if (act === 'burger') {

    toggleBurger();

}

else if (act === 'mark-all-read') {

else if (act === 'open-notification') {

    var id = a.getAttribute('data-id');

    api('/api/admin/communications/' + id)

    .then(function(r){

        if(!r.ok){

            toast('Unable to open notification');

            return;

        }

        api('/api/admin/communications/' + id,{

            method:'PATCH',

            body:{
                status:'in_progress'
            }

        }).then(function(){

            loadNotifications();

        });

        go('#/admin');

    });

}

    api('/api/admin/notifications/read-all', {

        method: 'PATCH'

    }).then(function (r) {

        if (!r.ok) {

            toast('Failed to mark notifications as read');

            return;

        }

        loadNotifications();

        const dropdown = document.getElementById('notificationDropdown');

        if (dropdown)
            dropdown.style.display = 'none';

        toast('All notifications marked as read');

    });

}

        else if (act === 'finder-go') { var v = $('#finder-in'); STATE.kw = v ? v.value : ''; go('#/catalogue'); }
        else if (act === 'enrol') { doEnrol(a.getAttribute('data-course')); }
        else if (act === 'checkout') { doCheckout(a.getAttribute('data-course')); }
        else if (act === 'dl') { toast('Download starts in the live platform'); }
        else if (act === 'booking-submit') { submitBooking(); }
      });
    }
    var fin = $('#finder-in');         // fresh element each home render — safe to (re)bind
    if (fin) fin.addEventListener('keydown', function (e) { if (e.key === 'Enter') { STATE.kw = fin.value; go('#/catalogue'); } });
  }

  function doEnrol(courseId) {
    loadCourse(courseId).then(function (b) {
      var mods = b.modules && b.modules.length ? b.modules : (b.course.modules || []).map(function (x) { return { id: x, courseId: courseId }; });
      ensureEnroll(courseId, mods);
      toast('Enrolled in ' + b.course.code + ' ✓');
      var first = (mods[0] && (mods[0].id || mods[0])) || (b.course.modules || [])[0];
      go('#/lms/' + courseId + '/' + first);
    });
  }
  function doCheckout(courseId) {
    if (!LIVE) { loadCourse(courseId).then(function (b) { toast('Mock checkout complete · ' + gbp(b.course.priceGBP)); ensureEnroll(courseId, b.modules); }); return; }
    loadCourse(courseId).then(function (b) {
      var pid = b.product && b.product.id;
      if (!pid) { toast('No product configured for this course'); return; }
      api('/api/checkout/create', { method: 'POST', body: { productId: pid } }).then(function (r) {
        if (r.status === 401) { toast('Please sign in to check out'); openAuth(); return; }
        var order = r.data && r.data.order;
        if (!order) { toast((r.data && r.data.error) || 'Checkout failed'); return; }
        api('/api/payments/mock-confirm', { method: 'POST', body: { orderId: order.id } }).then(function (r2) {
          if (r2.ok) { toast('Payment confirmed (mock) ✓'); STATE.courseCache = {}; }
          else toast((r2.data && r2.data.error) || 'Confirmation failed');
        });
      });
    });
  }
  function submitBooking() {
    var msg = $('#booking-msg');
    if (msg) msg.innerHTML = '<div class="notice ok" style="margin-top:14px"><span class="ni">' + svg('check') + '</span><div>Thank you — your demo request has been noted. The team will follow up by email.</div></div>';
    toast('Booking request sent ✓');
  }

  /* palette */
  function openPalette() {
    loadSite().then(function (s) {
      var courses = s.courses || [];
      var scrim = makeScrim();
      scrim.innerHTML = '<div class="palette" role="dialog" aria-label="Search courses">' +
        '<div class="ph"><div><span class="eyebrow">Search</span>' +
        '<h3 style="margin-top:6px">Find a course or code</h3></div>' +
        '<button class="btn ghost sm" data-close>Esc</button></div>' +
        '<input id="pal-in" type="text" placeholder="Type a title, topic or code like C04…" autocomplete="off">' +
        '<div class="pal-list" id="pal-list"></div></div>';
      document.body.appendChild(scrim);
      requestAnimationFrame(function () { scrim.classList.add('open'); $('#pal-in').focus(); });
      function render(q) {
        q = (q || '').toLowerCase();
        var list = courses.filter(function (c) {
          return !q || (c.code + ' ' + c.title + ' ' + (c.tags || []).join(' ')).toLowerCase().indexOf(q) > -1;
        }).slice(0, 8);
        $('#pal-list').innerHTML = list.map(function (c) {
          return '<div class="pal-row" data-go="#/course/' + esc(c.id) + '">' +
            '<span class="pc">' + esc(c.code) + '</span><div><b>' + esc(trim(c.title, 52)) + '</b>' +
            '<span style="display:block">' + esc(c.strand || '') + '</span></div></div>';
        }).join('') || '<div class="pal-row"><span>No matches</span></div>';
      }
      render('');
      $('#pal-in').addEventListener('input', function () { render(this.value); });
      scrim.addEventListener('click', function (e) {
        if (e.target === scrim || e.target.closest('[data-close]')) closeScrim(scrim);
        var row = e.target.closest('[data-go]');
        if (row) { closeScrim(scrim); go(row.getAttribute('data-go')); }
      });
    });
  }
  /* auth */
  function openAuth() {
    var scrim = makeScrim();
    scrim.innerHTML = '<div class="palette auth-card" role="dialog" aria-label="Learner login">' +
      '<div class="ph"><div><span class="eyebrow">Learner</span><h3 style="margin-top:6px">Sign in or create an account</h3></div>' +
      '<button class="btn ghost sm" data-close>Esc</button></div>' +
      '<div style="padding:0 22px 22px"><div class="form-col">' +
        '<input id="au-email" type="email" placeholder="you@school.org">' +
        '<input id="au-pass" type="password" placeholder="Password">' +
        '<button class="btn primary block" data-auth="login">Sign in</button>' +
        '<button class="btn ghost block" data-auth="register">Create account</button>' +
      '</div>' +
      (LIVE ? '' : '<p class="muted" style="font-size:.8rem;margin-top:14px;text-align:center">Preview mode signs you in locally so you can explore the dashboard.</p>') +
    '</div></div>';
    document.body.appendChild(scrim);
    requestAnimationFrame(function () { scrim.classList.add('open'); var i = $('#au-email'); if (i) i.focus(); });
    scrim.addEventListener('click', function (e) {
      if (e.target === scrim || e.target.closest('[data-close]')) { closeScrim(scrim); return; }
      var ab = e.target.closest('[data-auth]');
      if (!ab) return;
      var mode = ab.getAttribute('data-auth');
      var email = ($('#au-email').value || 'learner@fcei.eu');
      if (!LIVE) { STATE.user = { email: email }; Store.set('fcei_token', 'demo'); closeScrim(scrim); toast('Signed in ✓'); go('#/dashboard'); return; }
      var path = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
      api(path, { method: 'POST', body: { email: email, password: $('#au-pass').value || '' } })
        .then(function (r) {
          if (r.ok && r.data && r.data.token) { Store.set('fcei_token', r.data.token); STATE.user = { email: email }; closeScrim(scrim); toast('Signed in ✓'); go('#/dashboard'); }
          else toast((r.data && r.data.error) || 'Sign-in failed');
        }).catch(function () { toast('Network error'); });
    });
  }
  function makeScrim() { var d = document.createElement('div'); d.className = 'scrim'; return d; }
  function closeScrim(s) { s.classList.remove('open'); setTimeout(function () { s.remove(); }, 220); }

  function toggleBurger() {
    var nav = $('.navlinks');
    if (!nav) return;
    var open = nav.style.display === 'flex';
    nav.style.cssText = open ? '' : 'display:flex;position:absolute;top:100%;left:0;right:0;flex-direction:column;background:var(--paper);border-bottom:1px solid var(--line);padding:12px 20px;gap:2px';
  }

  /* toast */
  var toastEl, toastT;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; document.body.appendChild(toastEl); }
    toastEl.innerHTML = '<span class="ti"></span>' + esc(msg);
    toastEl.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove('show'); }, 2600);
  }

  /* cookie */
  function cookieBanner() {
    if (Store.get('fcei_cookie')) return;
    var c = document.createElement('div');
    c.className = 'cookie';
    c.innerHTML = '<b>Cookies & privacy</b>' +
      '<p>We use essential cookies to run the platform. You can accept analytics cookies or keep only what’s necessary.</p>' +
      '<div class="row"><button class="btn primary sm" data-ck="all">Accept all</button>' +
      '<button class="btn ghost sm" data-ck="ess">Essential only</button></div>';
    document.body.appendChild(c);
    setTimeout(function () { c.classList.add('show'); }, 800);
    c.addEventListener('click', function (e) {
      var b = e.target.closest('[data-ck]'); if (!b) return;
      Store.set('fcei_cookie', b.getAttribute('data-ck'));
      if (LIVE) api('/api/cookie-consent', { method: 'POST', body: { choice: b.getAttribute('data-ck') } }).catch(function () {});
      c.classList.remove('show'); setTimeout(function () { c.remove(); }, 320);
    });
  }

  /* reveal on scroll */
  var io;
  function revealScan(reset) {
    if (!('IntersectionObserver' in window)) { $all('.reveal').forEach(function (n) { n.classList.add('in'); }); return; }
    if (!io) io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    $all('.reveal:not(.in)').forEach(function (n) { io.observe(n); });
  }

  /* =====================================================================  */
  /*  ROUTER                                                                 */
  /* =====================================================================  */
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

  var ROUTES = [
    [/^#\/$/, function () { pageHome(); }],
    [/^#\/catalogue$/, function () { pageCatalogue(); }],
    [/^#\/course\/([^/]+)$/, function (m) { pageCourse(m[1]); }],
    [/^#\/lms\/([^/]+)\/([^/]+)$/, function (m) { pageLMS(m[1], m[2]); }],
    [/^#\/tvet$/, function () { pageTVET(); }],
    [/^#\/consultancy$/, function () { pageConsultancy(); }],
    [/^#\/resources$/, function () { pageResources(); }],
    [/^#\/booking$/, function () { pageBooking(); }],
    [/^#\/dashboard$/, function () { pageDashboard(); }],
    [/^#\/legal$/, function () { pageLegal(); }],
    [/^#\/admin\/seo$/, function () { pageSeoEngine(); }],
    [/^#\/admin$/, function () { pageAdmin(); }]
  ];
  function route() {
    var h = location.hash || '#/';
    for (var i = 0; i < ROUTES.length; i++) {
      var m = h.match(ROUTES[i][0]);
      if (m) { ROUTES[i][1](m); return; }
    }
    mount(notFound('Page not found'));
  }

  /* keyboard: ⌘/Ctrl-K palette, Esc close */
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openPalette(); }
    if (e.key === 'Escape') { var s = $('.scrim.open'); if (s) closeScrim(s); }
  });

  var INITED = false;
  function init() {
    if (INITED) return;
    INITED = true;
    if (!location.hash) location.hash = '#/';
    seedDemoProgress();
    route();
    cookieBanner();
  }
  window.addEventListener('hashchange', route);
  window.addEventListener('DOMContentLoaded', init);
  // script sits at end of <body>: if the DOM is already parsed, init now
  if (document.readyState !== 'loading') init();
})();
