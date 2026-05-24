// ════════════════════════════════
//  STATE
// ════════════════════════════════
const state = {
  view: 'home',       // home | test | results
  officialTests: [],
  customTests: [],
  loadingOfficial: false,
  // active test
  test: null,
  answers: [],
  current: 0,
  revealed: false,
  submitted: false,
  // timer
  timerSeconds: 0,
  timerInterval: null,
  // modals
  showImport: false,
  // toasts
  toasts: [],
};

// ════════════════════════════════
//  HELPERS
// ════════════════════════════════
function setState(patch) {
  Object.assign(state, patch);
  render();
}

let toastId = 0;
function toast(msg, type = 'default', duration = 3500) {
  const id = ++toastId;
  state.toasts.push({ id, msg, type });
  render();
  setTimeout(() => {
    state.toasts = state.toasts.filter(t => t.id !== id);
    render();
  }, duration);
}

function formatTime(s) {
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  const sec = (s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

function scoreColor(pct) {
  if (pct >= 80) return '#52b788';
  if (pct >= 50) return '#f4d35e';
  return '#e65f5c';
}

function gradeLabel(pct) {
  if (pct === 100) return 'Perfect Score';
  if (pct >= 90) return 'Excellent';
  if (pct >= 75) return 'Good Job';
  if (pct >= 50) return 'Keep Practicing';
  return 'Needs Work';
}

// Fisher-Yates Shuffle Utility
function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ════════════════════════════════
//  JSON SCHEMA VALIDATION
// ════════════════════════════════
function validateTest(data) {
  if (!data.title || typeof data.title !== 'string') throw new Error('Missing "title" field');
  if (!Array.isArray(data.questions) || data.questions.length === 0) throw new Error('Missing or empty "questions" array');
  data.questions.forEach((q, i) => {
    if (!q.question) throw new Error(`Question ${i + 1}: missing "question" field`);
    if (!Array.isArray(q.options) || q.options.length < 2) throw new Error(`Question ${i + 1}: "options" must have at least 2 items`);
    if (typeof q.answer !== 'number' || q.answer < 0 || q.answer >= q.options.length)
      throw new Error(`Question ${i + 1}: "answer" must be a valid option index`);
  });
  return true;
}

// ════════════════════════════════
//  AUTOMATIC LOCAL REPO DISCOVERY
// ════════════════════════════════
async function loadRepoTests() {
  setState({ loadingOfficial: true });
  try {
    const res = await fetch('./manifest.json');
    if (!res.ok) throw new Error(`Could not find local manifest.json (${res.status})`);
    const manifest = await res.json();
    if (!Array.isArray(manifest.tests)) throw new Error('manifest.json must contain a "tests" array');

    const tests = await Promise.all(
      manifest.tests.map(async (entry) => {
        try {
          const r = await fetch(`./${entry.file}`);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const t = await r.json();
          validateTest(t);
          return { ...t, _id: entry.id || entry.file, _source: 'official' };
        } catch (e) {
          console.warn('Failed to load local file:', entry.file, e);
          return null;
        }
      })
    );
    setState({ officialTests: tests.filter(Boolean), loadingOfficial: false });
    if (tests.filter(Boolean).length > 0) {
      toast(`Loaded ${tests.filter(Boolean).length} repository test(s)`, 'success');
    }
  } catch (e) {
    setState({ loadingOfficial: false });
    console.log('Local repository manifest check skipped or failed:', e.message);
  }
}

function handleFileImport(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      validateTest(data);
      const id = 'custom_' + Date.now();
      const test = { ...data, _id: id, _source: 'custom' };
      const existing = state.customTests.findIndex(t => t.title === data.title);
      let newCustom;
      if (existing >= 0) {
        newCustom = [...state.customTests];
        newCustom[existing] = test;
        toast('Test updated: ' + data.title, 'success');
      } else {
        newCustom = [...state.customTests, test];
        toast('Test imported: ' + data.title, 'success');
      }
      setState({ customTests: newCustom, showImport: false });
    } catch (err) {
      toast('Invalid JSON: ' + err.message, 'error', 5000);
    }
  };
  reader.readAsText(file);
}

function startTest(originalTest) {
  // Randomize questions list configuration per session
  const shuffledQuestions = shuffleArray(originalTest.questions);
  const test = {
    ...originalTest,
    questions: shuffledQuestions
  };

  const seconds = test.timeLimit ? test.timeLimit * 60 : 0;
  if (state.timerInterval) clearInterval(state.timerInterval);
  let interval = null;
  if (seconds > 0) {
    let remaining = seconds;
    interval = setInterval(() => {
      remaining--;
      state.timerSeconds = remaining;
      if (remaining <= 0) {
        clearInterval(interval);
        submitTest();
        return;
      }
      render();
    }, 1000);
  }
  setState({
    view: 'test',
    test,
    answers: new Array(test.questions.length).fill(null),
    current: 0,
    revealed: false,
    submitted: false,
    timerSeconds: seconds,
    timerInterval: interval,
  });
}

function selectAnswer(idx) {
  if (state.submitted) return;
  const answers = [...state.answers];
  answers[state.current] = idx;
  setState({ answers, revealed: true });
}

function jumpToQuestion(idx) {
  setState({ current: idx, revealed: state.answers[idx] !== null });
}

function goNext() {
  if (state.current < state.test.questions.length - 1) {
    setState({ current: state.current + 1, revealed: state.answers[state.current + 1] !== null });
  }
}

function goPrev() {
  if (state.current > 0) {
    setState({ current: state.current - 1, revealed: state.answers[state.current - 1] !== null });
  }
}

function submitTest() {
  if (state.timerInterval) clearInterval(state.timerInterval);
  setState({ submitted: true, view: 'results' });
}

function removeCustomTest(id) {
  setState({ customTests: state.customTests.filter(t => t._id !== id) });
}

// ════════════════════════════════
//  RENDER
// ════════════════════════════════
function render() {
  const app = document.getElementById('app');
  app.innerHTML = '';

  const header = renderHeader();
  app.appendChild(header);

  let content;
  if (state.view === 'home') content = renderHome();
  else if (state.view === 'test') content = renderTest();
  else if (state.view === 'results') content = renderResults();
  app.appendChild(content);

  if (state.showImport) app.appendChild(renderImportModal());

  if (state.toasts.length > 0) {
    const tc = document.createElement('div');
    tc.className = 'toast-container';
    state.toasts.forEach(t => {
      const el = document.createElement('div');
      el.className = `toast ${t.type !== 'default' ? t.type : ''}`;
      el.textContent = t.msg;
      tc.appendChild(el);
    });
    app.appendChild(tc);
  }
}

// ── HEADER ──
function renderHeader() {
  const h = document.createElement('header');
  h.className = 'header';
  h.innerHTML = `
<div class="logo">Sleepy<span>Test</span></div>
<div style="display:flex;gap:8px">
  ${state.view !== 'home' ? `<button class="btn btn-ghost btn-sm" id="btn-home">← Home</button>` : ''}
</div>`;
  h.querySelector('#btn-home')?.addEventListener('click', () => {
    if (state.timerInterval) clearInterval(state.timerInterval);
    setState({ view: 'home' });
  });
  return h;
}

// ── HOME ──
function renderHome() {
  const page = document.createElement('div');
  page.className = 'page';

  const hero = document.createElement('div');
  hero.className = 'home-hero';
  hero.innerHTML = `
<h1>Sharpen Your <em>Knowledge</em></h1>
<p>Take tests saved locally inside your repository folder or upload external datasets instantly.</p>
<div class="hero-actions">
  <button class="btn btn-primary" id="btn-import">📂 Upload JSON File</button>
</div>`;
  page.appendChild(hero);
  hero.querySelector('#btn-import')?.addEventListener('click', () => setState({ showImport: true }));

  const sec = document.createElement('div');
  sec.innerHTML = `
<div class="section-header">
  <div>
    <div class="section-title">Repository Tests</div>
    <div class="section-sub">Discovered relative to your workspace directory</div>
  </div>
  <button class="btn btn-ghost btn-sm" id="btn-reload">↻ Refresh</button>
</div>`;
  sec.querySelector('#btn-reload').addEventListener('click', loadRepoTests);
  page.appendChild(sec);

  if (state.loadingOfficial) {
    const ld = document.createElement('div');
    ld.className = 'loading-state';
    ld.innerHTML = `<div class="spinner"></div><p>Scanning repository files…</p>`;
    page.appendChild(ld);
  } else if (state.officialTests.length === 0) {
    const em = document.createElement('div');
    em.className = 'empty-state';
    em.innerHTML = `<div class="icon">📁</div><p>No local repository tests connected. Ensure a <code>manifest.json</code> sits alongside this HTML file.</p>
<p style="margin-top:4px;font-size:.78rem"><a href="#" id="show-manifest-help" style="color:var(--accent)">Show manifest setup</a></p>`;
    em.querySelector('#show-manifest-help').addEventListener('click', (e) => { e.preventDefault(); showManifestHelp(); });
    page.appendChild(em);
  } else {
    const grid = document.createElement('div');
    grid.className = 'tests-grid';
    state.officialTests.forEach(t => {
      grid.appendChild(makeTestCard(t, true));
    });
    page.appendChild(grid);
  }

  const sec2 = document.createElement('div');
  sec2.innerHTML = `
<div class="section-header" style="margin-top: 32px;">
  <div>
    <div class="section-title">Sandbox Imports</div>
    <div class="section-sub">Temporary tests cached for this session</div>
  </div>
</div>`;
  page.appendChild(sec2);

  if (state.customTests.length === 0) {
    const em = document.createElement('div');
    em.className = 'empty-state';
    em.style.padding = '24px';
    em.innerHTML = `<p style="font-size: .85rem;">No active temporary file uploads. Drag files here to add on the fly.</p>`;
    page.appendChild(em);
  } else {
    const grid = document.createElement('div');
    grid.className = 'tests-grid';
    state.customTests.forEach(t => {
      grid.appendChild(makeTestCard(t, false));
    });
    page.appendChild(grid);
  }

  return page;
}

function makeTestCard(test, official) {
  const card = document.createElement('div');
  card.className = 'card card-clickable test-card';
  const qCount = test.questions.length;
  const timer = test.timeLimit ? `⏱ ${test.timeLimit}m` : 'No limit';
  card.innerHTML = `
<div class="test-card-tag ${official ? 'official' : ''}">${official ? 'Workspace' : 'Imported'}</div>
<h3>${esc(test.title)}</h3>
<p>${esc(test.description || 'No description provided.')}</p>
<div class="test-card-meta">
  <span>❓ ${qCount} question${qCount !== 1 ? 's' : ''}</span>
  <span>${timer}</span>
</div>
${!official ? `<button class="btn btn-ghost btn-sm remove-btn" style="margin-top:12px;color:var(--error);padding:4px 8px">✕ Remove</button>` : ''}`;

  card.addEventListener('click', (e) => {
    if (e.target.classList.contains('remove-btn')) {
      e.stopPropagation();
      removeCustomTest(test._id);
      return;
    }
    startTest(test);
  });
  return card;
}

// ── TEST SCREEN ──
function renderTest() {
  const { test, current, answers, revealed, timerSeconds } = state;
  const q = test.questions[current];
  const total = test.questions.length;
  const answered = answers.filter(a => a !== null).length;
  const isLast = current === total - 1;

  const page = document.createElement('div');
  page.className = 'page-narrow';

  const hdr = document.createElement('div');
  hdr.className = 'test-header';
  hdr.innerHTML = `
<div class="test-title">${esc(test.title)}</div>
<div style="display:flex;align-items:center;gap:12px">
  ${timerSeconds > 0 ? `<div class="timer ${timerSeconds <= 60 ? 'danger' : timerSeconds <= 120 ? 'warn' : ''}">⏱ ${formatTime(timerSeconds)}</div>` : ''}
  <div class="q-counter">${answered}/${total}</div>
</div>`;
  page.appendChild(hdr);

  const pb = document.createElement('div');
  pb.className = 'progress-bar';
  pb.innerHTML = `<div class="progress-fill" style="width:${((current + 1) / total * 100).toFixed(1)}%"></div>`;
  page.appendChild(pb);

  const qNum = document.createElement('div');
  qNum.className = 'question-num';
  qNum.textContent = `Question ${current + 1} of ${total}`;
  page.appendChild(qNum);

  const qText = document.createElement('div');
  qText.className = 'question-text';
  qText.textContent = q.question;
  page.appendChild(qText);

  const opts = document.createElement('div');
  opts.className = 'options';
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];

  q.options.forEach((opt, idx) => {
    const el = document.createElement('div');
    let cls = 'option';
    if (answers[current] === idx) {
      if (revealed) {
        cls += idx === q.answer ? ' correct' : ' incorrect';
      } else {
        cls += ' selected';
      }
    } else if (revealed && idx === q.answer) {
      cls += ' reveal-correct';
    }
    el.className = cls;
    el.innerHTML = `
  <div class="option-letter">${letters[idx]}</div>
  <div class="option-text">${esc(opt)}</div>`;
    el.addEventListener('click', () => selectAnswer(idx));
    opts.appendChild(el);
  });
  page.appendChild(opts);

  if (revealed && q.explanation) {
    const exp = document.createElement('div');
    exp.className = 'explanation';
    exp.style.cssText = "margin-top:20px; padding:16px; background:rgba(82,183,136,0.1); border-left:4px solid var(--success); border-radius:4px;";
    exp.innerHTML = `<strong style="display:block; margin-bottom:4px; color:var(--success);">💡 Explanation:</strong> ${esc(q.explanation)}`;
    page.appendChild(exp);
  }

  const nav = document.createElement('div');
  nav.className = 'test-nav';
  nav.innerHTML = `
<button class="btn btn-outline" id="btn-prev" ${current === 0 ? 'disabled' : ''}>← Back</button>
<div style="display:flex;gap:10px">
  ${isLast
      ? `<button class="btn btn-primary" id="btn-submit">Submit Test ✓</button>`
      : `<button class="btn btn-primary" id="btn-next" ${answers[current] === null ? 'disabled' : ''}>Next →</button>`
    }
</div>`;
  page.appendChild(nav);
  nav.querySelector('#btn-prev')?.addEventListener('click', goPrev);
  nav.querySelector('#btn-next')?.addEventListener('click', goNext);
  nav.querySelector('#btn-submit')?.addEventListener('click', submitTest);

  if (total > 4) {
    const jump = document.createElement('div');
    jump.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:28px;justify-content:center';
    for (let i = 0; i < total; i++) {
      const b = document.createElement('button');
      const ans = answers[i];
      let bg = 'transparent';
      let col = 'var(--muted)';
      let bc = 'var(--border)';
      if (i === current) { bg = 'var(--surface2)'; col = 'var(--accent2)'; bc = 'var(--accent)'; }
      else if (ans !== null) { bg = 'rgba(82,183,136,.06)'; col = 'var(--success)'; bc = 'rgba(82,183,136,.2)'; }
      b.style.cssText = `width:32px;height:32px;border-radius:4px;border:1px solid ${bc};background:${bg};color:${col};font-size:.78rem;cursor:pointer;font-family:'JetBrains Mono',monospace;transition:all .1s;`;
      b.textContent = i + 1;
      b.addEventListener('click', () => jumpToQuestion(i));
      jump.appendChild(b);
    }
    page.appendChild(jump);
  }

  return page;
}

// ── RESULTS ──
function renderResults() {
  const { test, answers } = state;
  const total = test.questions.length;
  const correct = answers.filter((a, i) => a === test.questions[i].answer).length;
  const wrong = answers.filter((a, i) => a !== null && a !== test.questions[i].answer).length;
  const skipped = answers.filter(a => a === null).length;
  const pct = Math.round((correct / total) * 100);
  const color = scoreColor(pct);

  const page = document.createElement('div');
  page.className = 'page-narrow';

  const r = 54, cx = 70, cy = 70, circumference = 2 * Math.PI * r;
  const filled = circumference * (pct / 100);

  const hero = document.createElement('div');
  hero.className = 'results-hero';
  hero.innerHTML = `
<div class="score-ring">
  <svg width="140" height="140" viewBox="0 0 140 140">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--surface2)" stroke-width="6"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="6"
      stroke-dasharray="${filled} ${circumference - filled}"
      stroke-linecap="round"/>
  </svg>
  <div class="score-ring-text">
    <div class="score-pct" style="color:${color}">${pct}%</div>
    <div class="score-label">${correct}/${total}</div>
  </div>
</div>
<h2>${gradeLabel(pct)}</h2>
<p>${esc(test.title)}</p>`;
  page.appendChild(hero);

  const stats = document.createElement('div');
  stats.className = 'results-stats';
  stats.innerHTML = `
<div class="stat-box"><div class="stat-val green">${correct}</div><div class="stat-key">Correct</div></div>
<div class="stat-box"><div class="stat-val red">${wrong}</div><div class="stat-key">Wrong</div></div>
<div class="stat-box"><div class="stat-val" style="color:var(--muted)">${skipped}</div><div class="stat-key">Skipped</div></div>`;
  page.appendChild(stats);

  const actions = document.createElement('div');
  actions.className = 'results-actions';
  actions.innerHTML = `
<button class="btn btn-primary" id="btn-retry">↺ Retry Test</button>
<button class="btn btn-outline" id="btn-home">← Home</button>`;
  page.appendChild(actions);
  actions.querySelector('#btn-retry').addEventListener('click', () => startTest(test));
  actions.querySelector('#btn-home').addEventListener('click', () => setState({ view: 'home' }));

  const rev = document.createElement('div');
  rev.innerHTML = `<div class="section-title" style="margin-top:36px;margin-bottom:16px;font-size:1.2rem">Review Answers</div>`;
  const list = document.createElement('div');
  list.className = 'review-list';

  test.questions.forEach((q, i) => {
    const userAns = answers[i];
    const isCorrect = userAns === q.answer;
    const item = document.createElement('div');
    item.className = `review-item ${isCorrect ? 'correct-item' : 'wrong-item'}`;
    item.innerHTML = `
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
    <span class="badge ${isCorrect ? 'badge-success' : 'badge-error'}">${isCorrect ? '✓' : '✗'}</span>
    <span style="font-size:.78rem;color:var(--muted)">Q${i + 1}</span>
  </div>
  <div class="review-q">${esc(q.question)}</div>
  <div class="review-answers" style="display:flex; flex-direction:column; gap:4px;">
    ${userAns === null
        ? `<span style="color:var(--muted)">— Skipped</span>`
        : `<span class="review-your ${isCorrect ? 'was-correct' : ''}">Your answer: ${esc(q.options[userAns])}</span>`}
    ${!isCorrect ? `<span class="review-correct-ans" style="color:var(--success); font-weight:500;">Correct: ${esc(q.options[q.answer])}</span>` : ''}
    ${q.explanation ? `<div class="review-explanation" style="margin-top:8px; padding:8px 12px; background:var(--surface2); border-left:3px solid var(--accent); font-size:.82rem; border-radius:2px; color:var(--text); line-height:1.4;"><strong>💡 Explanation:</strong> ${esc(q.explanation)}</div>` : ''}
  </div>`;
    list.appendChild(item);
  });
  rev.appendChild(list);
  page.appendChild(rev);

  return page;
}

// ── IMPORT MODAL ──
function renderImportModal() {
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop open';
  bd.innerHTML = `
<div class="modal">
  <h2>📂 Upload File</h2>
  <p>Import standalone JSON files into your local staging session.</p>
  <div class="drop-zone" id="drop-zone">
    <div class="icon">📄</div>
    <p><strong>Click or drag</strong> a JSON file here</p>
  </div>
  <input type="file" accept=".json" id="file-input" style="display:none" />
  <div class="modal-actions">
    <button class="btn btn-ghost" id="close-import">Cancel</button>
  </div>
</div>`;
  bd.addEventListener('click', (e) => { if (e.target === bd) setState({ showImport: false }); });
  bd.querySelector('#close-import').addEventListener('click', () => setState({ showImport: false }));

  const dz = bd.querySelector('#drop-zone');
  const fi = bd.querySelector('#file-input');
  dz.addEventListener('click', () => fi.click());
  dz.addEventListener('dragover', (e) => { e.preventDefault(); });
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFileImport(file);
  });
  fi.addEventListener('change', () => { if (fi.files[0]) handleFileImport(fi.files[0]); });
  return bd;
}

function showManifestHelp() {
  const sample = JSON.stringify({
    "tests": [
      { "id": "test-t3", "file": "test_t3_temario_final.json" }
    ]
  }, null, 2);

  const bd = document.createElement('div');
  bd.className = 'modal-backdrop open';
  bd.innerHTML = `
<div class="modal" style="max-width:520px">
  <h2>Local Repository Setup</h2>
  <p>To let the app automatically find files on your local repository workspace, place a file named <code>manifest.json</code> right beside this HTML file containing:</p>
  <pre style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:14px;overflow:auto;font-family:'JetBrains Mono',monospace;font-size:.78rem;color:var(--accent2);max-height:240px">${esc(sample)}</pre>
  <div class="modal-actions">
    <button class="btn btn-primary btn-sm" id="close-help">Got it</button>
  </div>
</div>`;
  bd.querySelector('#close-help').addEventListener('click', () => bd.remove());
  document.getElementById('app').appendChild(bd);
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ════════════════════════════════
//  INIT
// ════════════════════════════════
render();
loadRepoTests();