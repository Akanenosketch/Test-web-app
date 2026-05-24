// ════════════════════════════════
//  PRINT STYLES (injected once)
// ════════════════════════════════
(function injectPrintStyles() {
  const s = document.createElement('style');
  s.textContent = `
    @media print {
      body * { visibility: hidden !important; }
      #print-area, #print-area * { visibility: visible !important; }
      #print-area {
        position: fixed; inset: 0;
        background: #fff; color: #111;
        font-family: Georgia, serif;
        padding: 32px 40px;
        overflow: visible;
      }
      .print-question { margin-bottom: 24px; page-break-inside: avoid; }
      .print-q-text { font-size: 13px; font-weight: bold; margin-bottom: 6px; }
      .print-badge { display: inline-block; padding: 1px 8px; border-radius: 3px; font-size: 10px; font-weight: bold; margin-bottom: 6px; }
      .print-badge-wrong   { background: #fde; color: #c00; }
      .print-badge-skipped { background: #ffe; color: #850; }
      .print-answer { font-size: 12px; margin: 2px 0; }
      .print-answer-wrong   { color: #c00; }
      .print-answer-correct { color: #060; font-weight: bold; }
      .print-answer-skipped { color: #850; }
      .print-explanation { font-size: 11.5px; color: #333; margin-top: 8px; padding: 8px 12px; border-left: 3px solid #999; background: #f8f8f8; }
      .print-header { border-bottom: 2px solid #111; margin-bottom: 24px; padding-bottom: 12px; }
      .print-header h1 { font-size: 18px; margin-bottom: 4px; }
      .print-header p  { font-size: 12px; color: #555; }
      .print-stats { display: flex; gap: 24px; margin-bottom: 24px; font-size: 12px; }
      .print-stats span { font-weight: bold; }
      .print-section-title { font-size: 14px; font-weight: bold; margin-bottom: 16px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
    }
  `;
  document.head.appendChild(s);
})();

// ════════════════════════════════
//  STATE
// ════════════════════════════════
const state = {
  view: 'home',
  officialTests: [],
  customTests: [],
  loadingOfficial: false,
  // active test
  test: null,
  answers: [],   // null = untouched | 'skip' = skipped | number = answered (locked)
  current: 0,
  startTime: null,
  elapsedSeconds: 0,
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
  if (pct >= 90)  return 'Excellent';
  if (pct >= 75)  return 'Good Job';
  if (pct >= 50)  return 'Keep Practicing';
  return 'Needs Work';
}

function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Returns 'unanswered' | 'correct' | 'wrong' | 'skipped'
function getAnswerStatus(questionIndex) {
  const a = state.answers[questionIndex];
  if (a === null)     return 'unanswered';
  if (a === 'skip')   return 'skipped';
  return a === state.test.questions[questionIndex].answer ? 'correct' : 'wrong';
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
//  REPO DISCOVERY
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

// ════════════════════════════════
//  TEST ACTIONS
// ════════════════════════════════
function startTest(originalTest) {
  const shuffledQuestions = shuffleArray(originalTest.questions);
  const test = { ...originalTest, questions: shuffledQuestions };
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
    startTime: Date.now(),
    elapsedSeconds: 0,
    timerSeconds: seconds,
    timerInterval: interval,
  });
}

// Lock: once a numeric answer is set, it cannot be changed
function selectAnswer(idx) {
  const cur = state.answers[state.current];
  if (typeof cur === 'number') return; // already answered — locked
  const answers = [...state.answers];
  answers[state.current] = idx;
  setState({ answers });
}

// Skip current question and advance
function skipQuestion() {
  const cur = state.answers[state.current];
  if (typeof cur === 'number') return; // answered, can't skip
  const answers = [...state.answers];
  answers[state.current] = 'skip';
  const next = state.current < state.test.questions.length - 1
    ? state.current + 1
    : state.current;
  setState({ answers, current: next });
}

function jumpToQuestion(idx) {
  setState({ current: idx });
}

function goNext() {
  if (state.current < state.test.questions.length - 1) {
    setState({ current: state.current + 1 });
  }
}

function goPrev() {
  if (state.current > 0) {
    setState({ current: state.current - 1 });
  }
}

function submitTest() {
  if (state.timerInterval) clearInterval(state.timerInterval);
  const elapsed = state.startTime ? Math.floor((Date.now() - state.startTime) / 1000) : 0;
  setState({ view: 'results', elapsedSeconds: elapsed });
}

function removeCustomTest(id) {
  setState({ customTests: state.customTests.filter(t => t._id !== id) });
}

// ════════════════════════════════
//  PDF EXPORT
// ════════════════════════════════
function exportPDF() {
  const { test, answers, elapsedSeconds } = state;
  const total    = test.questions.length;
  const correct  = answers.filter((a, i) => typeof a === 'number' && a === test.questions[i].answer).length;
  const wrong    = answers.filter((a, i) => typeof a === 'number' && a !== test.questions[i].answer).length;
  const skipped  = answers.filter(a => a === 'skip' || a === null).length;
  const pct      = Math.round((correct / total) * 100);

  // Collect questions that need review (wrong or skipped/unanswered)
  const reviewItems = test.questions
    .map((q, i) => ({ q, i, status: getAnswerStatus(i), answer: answers[i] }))
    .filter(item => item.status === 'wrong' || item.status === 'skipped' || item.status === 'unanswered');

  // Remove old print area if any
  document.getElementById('print-area')?.remove();

  const area = document.createElement('div');
  area.id = 'print-area';

  area.innerHTML = `
    <div class="print-header">
      <h1>${esc(test.title)}</h1>
      <p>Results report — generated ${new Date().toLocaleString()}</p>
    </div>
    <div class="print-stats">
      <div>Score: <span>${pct}% (${correct}/${total})</span></div>
      <div>Correct: <span style="color:#060">${correct}</span></div>
      <div>Wrong: <span style="color:#c00">${wrong}</span></div>
      <div>Skipped: <span style="color:#850">${skipped}</span></div>
      <div>Time: <span>${formatTime(elapsedSeconds)}</span></div>
    </div>
    <div class="print-section-title">Questions to review (${reviewItems.length})</div>
    ${reviewItems.map(({ q, i, status, answer }) => {
      const badgeCls  = status === 'wrong' ? 'print-badge-wrong' : 'print-badge-skipped';
      const badgeTxt  = status === 'wrong' ? '✗ Wrong' : '— Skipped';
      const userLine  = typeof answer === 'number'
        ? `<div class="print-answer print-answer-wrong">Your answer: ${esc(q.options[answer])}</div>`
        : `<div class="print-answer print-answer-skipped">Skipped</div>`;
      return `
        <div class="print-question">
          <span class="print-badge ${badgeCls}">${badgeTxt}</span>
          <div class="print-q-text">Q${i + 1}. ${esc(q.question)}</div>
          ${userLine}
          <div class="print-answer print-answer-correct">✓ Correct: ${esc(q.options[q.answer])}</div>
          ${q.explanation ? `<div class="print-explanation">${esc(q.explanation)}</div>` : ''}
        </div>`;
    }).join('')}
  `;

  document.body.appendChild(area);
  window.print();
  // Remove after print dialog closes
  setTimeout(() => area.remove(), 1000);
}

// ════════════════════════════════
//  RENDER
// ════════════════════════════════
function render() {
  const app = document.getElementById('app');
  app.innerHTML = '';
  app.appendChild(renderHeader());
  let content;
  if (state.view === 'home')    content = renderHome();
  else if (state.view === 'test')    content = renderTest();
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

// ── HEADER ──────────────────────────────────────────────
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

// ── HOME ────────────────────────────────────────────────
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
    state.officialTests.forEach(t => grid.appendChild(makeTestCard(t, true)));
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
    state.customTests.forEach(t => grid.appendChild(makeTestCard(t, false)));
    page.appendChild(grid);
  }

  return page;
}

function makeTestCard(test, official) {
  const card = document.createElement('div');
  card.className = 'card card-clickable test-card';
  const qCount = test.questions.length;
  const timer  = test.timeLimit ? `⏱ ${test.timeLimit}m` : 'No limit';
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
    if (e.target.classList.contains('remove-btn')) { e.stopPropagation(); removeCustomTest(test._id); return; }
    startTest(test);
  });
  return card;
}

// ── TEST SCREEN ──────────────────────────────────────────
function renderTest() {
  const { test, current, answers, timerSeconds } = state;
  const q       = test.questions[current];
  const total   = test.questions.length;
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];

  const curAnswer  = answers[current];
  const isAnswered = typeof curAnswer === 'number';   // locked
  const isSkipped  = curAnswer === 'skip';
  const revealed   = isAnswered;                       // show feedback only if answered
  const isLast     = current === total - 1;

  const answered  = answers.filter(a => typeof a === 'number').length;
  const skippedN  = answers.filter(a => a === 'skip').length;
  const remaining = total - answered - skippedN;

  const page = document.createElement('div');
  page.className = 'page-narrow';

  // Header
  const hdr = document.createElement('div');
  hdr.className = 'test-header';
  hdr.innerHTML = `
<div class="test-title">${esc(test.title)}</div>
<div style="display:flex;align-items:center;gap:12px">
  ${timerSeconds > 0 ? `<div class="timer ${timerSeconds <= 60 ? 'danger' : timerSeconds <= 120 ? 'warn' : ''}">⏱ ${formatTime(timerSeconds)}</div>` : ''}
  <div class="q-counter">${answered}/${total}</div>
</div>`;
  page.appendChild(hdr);

  // Progress bar
  const pb = document.createElement('div');
  pb.className = 'progress-bar';
  pb.innerHTML = `<div class="progress-fill" style="width:${((current + 1) / total * 100).toFixed(1)}%"></div>`;
  page.appendChild(pb);

  // Question label
  const qNum = document.createElement('div');
  qNum.className = 'question-num';
  qNum.textContent = `Question ${current + 1} of ${total}`;
  page.appendChild(qNum);

  // Question text
  const qText = document.createElement('div');
  qText.className = 'question-text';
  qText.textContent = q.question;
  page.appendChild(qText);

  // Options
  const opts = document.createElement('div');
  opts.className = 'options';

  q.options.forEach((opt, idx) => {
    const el = document.createElement('div');
    let cls = 'option';

    if (isAnswered) {
      // Question is locked — show correct/incorrect
      if (idx === curAnswer) {
        cls += curAnswer === q.answer ? ' correct' : ' incorrect';
      } else if (idx === q.answer) {
        cls += ' reveal-correct';
      }
    } else if (isSkipped) {
      // Skipped — still clickable (user can answer a previously skipped question)
      // No special styling on options
    }

    el.className = cls;
    el.innerHTML = `
  <div class="option-letter">${letters[idx]}</div>
  <div class="option-text">${esc(opt)}</div>`;

    // Click is allowed only if not already answered with a number
    el.addEventListener('click', () => selectAnswer(idx));
    opts.appendChild(el);
  });
  page.appendChild(opts);

  // Explanation (only when answered)
  if (revealed && q.explanation) {
    const exp = document.createElement('div');
    exp.className = 'explanation';
    exp.style.cssText = 'margin-top:20px;padding:16px;background:rgba(82,183,136,0.1);border-left:4px solid var(--success);border-radius:4px;';
    exp.innerHTML = `<strong style="display:block;margin-bottom:4px;color:var(--success);">💡 Explanation:</strong> ${esc(q.explanation)}`;
    page.appendChild(exp);
  }

  // Navigation
  const nav = document.createElement('div');
  nav.className = 'test-nav';

  const canSkip = !isAnswered; // can skip if not locked
  const nextDisabled = !isAnswered && !isSkipped; // Next requires an answer or a skip

  nav.innerHTML = `
<button class="btn btn-outline" id="btn-prev" ${current === 0 ? 'disabled' : ''}>← Back</button>
<div style="display:flex;gap:8px">
  ${canSkip ? `<button class="btn btn-outline" id="btn-skip" style="color:var(--warning);border-color:var(--warning);">Skip →</button>` : ''}
  ${isLast
    ? `<button class="btn btn-primary" id="btn-submit">Submit ✓</button>`
    : `<button class="btn btn-primary" id="btn-next" ${nextDisabled ? 'disabled' : ''}>Next →</button>`
  }
</div>`;

  page.appendChild(nav);
  nav.querySelector('#btn-prev')?.addEventListener('click', goPrev);
  nav.querySelector('#btn-skip')?.addEventListener('click', skipQuestion);
  nav.querySelector('#btn-next')?.addEventListener('click', goNext);
  nav.querySelector('#btn-submit')?.addEventListener('click', submitTest);

  // Jump bar
  if (total > 4) {
    const jump = document.createElement('div');
    jump.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:28px;justify-content:center';

    for (let i = 0; i < total; i++) {
      const b      = document.createElement('button');
      const status = i === current ? 'current' : getAnswerStatus(i);

      const styles = {
        current:    { bg: 'var(--surface2)', col: 'var(--accent2)', bc: 'var(--accent)' },
        correct:    { bg: 'rgba(82,183,136,.1)',  col: 'var(--success)',  bc: 'rgba(82,183,136,.4)' },
        wrong:      { bg: 'rgba(230,115,137,.1)', col: 'var(--error)',    bc: 'rgba(230,115,137,.4)' },
        skipped:    { bg: 'rgba(241,207,131,.1)', col: 'var(--warning)',  bc: 'rgba(241,207,131,.5)' },
        unanswered: { bg: 'transparent',          col: 'var(--muted)',    bc: 'var(--border)' },
      }[status];

      b.style.cssText = `width:32px;height:32px;border-radius:4px;border:1px solid ${styles.bc};background:${styles.bg};color:${styles.col};font-size:.78rem;cursor:pointer;font-family:'JetBrains Mono',monospace;transition:all .1s;`;
      b.textContent = i + 1;
      b.title = status.charAt(0).toUpperCase() + status.slice(1);
      b.addEventListener('click', () => jumpToQuestion(i));
      jump.appendChild(b);
    }

    // Legend
    const legend = document.createElement('div');
    legend.style.cssText = 'display:flex;gap:14px;margin-top:12px;justify-content:center;flex-wrap:wrap;';
    [
      { col: 'var(--success)', label: 'Correct' },
      { col: 'var(--error)',   label: 'Wrong' },
      { col: 'var(--warning)', label: 'Skipped' },
      { col: 'var(--muted)',   label: 'Unanswered' },
    ].forEach(({ col, label }) => {
      const d = document.createElement('div');
      d.style.cssText = 'display:flex;align-items:center;gap:5px;font-size:.72rem;color:var(--muted)';
      d.innerHTML = `<span style="width:10px;height:10px;border-radius:2px;background:${col};display:inline-block;opacity:.7;"></span>${label}`;
      legend.appendChild(d);
    });
    page.appendChild(jump);
    page.appendChild(legend);
  }

  return page;
}

// ── RESULTS ─────────────────────────────────────────────
function renderResults() {
  const { test, answers, elapsedSeconds } = state;
  const total    = test.questions.length;
  const correct  = answers.filter((a, i) => typeof a === 'number' && a === test.questions[i].answer).length;
  const wrong    = answers.filter((a, i) => typeof a === 'number' && a !== test.questions[i].answer).length;
  const skipped  = answers.filter(a => a === 'skip' || a === null).length;
  const pct      = Math.round((correct / total) * 100);
  const color    = scoreColor(pct);

  const page = document.createElement('div');
  page.className = 'page-narrow';

  // Score ring
  const r = 54, cx = 70, cy = 70, circumference = 2 * Math.PI * r;
  const filled = circumference * (pct / 100);

  const hero = document.createElement('div');
  hero.className = 'results-hero';
  hero.innerHTML = `
<div class="score-ring">
  <svg width="140" height="140" viewBox="0 0 140 140">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--surface2)" stroke-width="6"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="6"
      stroke-dasharray="${filled} ${circumference - filled}" stroke-linecap="round"/>
  </svg>
  <div class="score-ring-text">
    <div class="score-pct" style="color:${color}">${pct}%</div>
    <div class="score-label">${correct}/${total}</div>
  </div>
</div>
<h2>${gradeLabel(pct)}</h2>
<p>${esc(test.title)}</p>`;
  page.appendChild(hero);

  // Stats grid
  const stats = document.createElement('div');
  stats.className = 'results-stats';
  stats.innerHTML = `
<div class="stat-box"><div class="stat-val green">${correct}</div><div class="stat-key">Correct</div></div>
<div class="stat-box"><div class="stat-val red">${wrong}</div><div class="stat-key">Wrong</div></div>
<div class="stat-box"><div class="stat-val" style="color:var(--warning)">${skipped}</div><div class="stat-key">Skipped</div></div>`;
  page.appendChild(stats);

  // Breakdown bars
  const bars = document.createElement('div');
  bars.style.cssText = 'margin:20px 0 4px;';
  const barData = [
    { label: 'Correct',  pct: (correct / total * 100), color: 'var(--success)' },
    { label: 'Wrong',    pct: (wrong   / total * 100), color: 'var(--error)' },
    { label: 'Skipped',  pct: (skipped / total * 100), color: 'var(--warning)' },
  ];
  barData.forEach(({ label, pct: bPct, color: bCol }) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:8px;font-size:.8rem;';
    row.innerHTML = `
      <span style="width:60px;color:var(--muted);text-align:right;">${label}</span>
      <div style="flex:1;height:8px;background:var(--surface2);border-radius:99px;overflow:hidden;">
        <div style="height:100%;width:${bPct.toFixed(1)}%;background:${bCol};border-radius:99px;transition:width .6s;"></div>
      </div>
      <span style="width:32px;color:var(--muted);">${Math.round(bPct)}%</span>`;
    bars.appendChild(row);
  });

  // Time taken
  const timeLine = document.createElement('div');
  timeLine.style.cssText = 'text-align:center;font-size:.82rem;color:var(--muted);margin-bottom:4px;';
  timeLine.innerHTML = `⏱ Time: <strong style="color:var(--text)">${formatTime(elapsedSeconds)}</strong>`;
  page.appendChild(bars);
  page.appendChild(timeLine);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'results-actions';
  actions.style.cssText = 'margin-top:24px;';
  actions.innerHTML = `
<button class="btn btn-primary"  id="btn-retry">↺ Retry</button>
<button class="btn btn-outline"  id="btn-pdf">⬇ Export PDF</button>
<button class="btn btn-ghost"    id="btn-home">← Home</button>`;
  page.appendChild(actions);
  actions.querySelector('#btn-retry').addEventListener('click', () => startTest(test));
  actions.querySelector('#btn-pdf').addEventListener('click', exportPDF);
  actions.querySelector('#btn-home').addEventListener('click', () => setState({ view: 'home' }));

  // Review — only wrong and skipped
  const reviewItems = test.questions
    .map((q, i) => ({ q, i, status: getAnswerStatus(i), answer: answers[i] }))
    .filter(item => item.status !== 'correct');

  if (reviewItems.length === 0) {
    const perfect = document.createElement('div');
    perfect.style.cssText = 'text-align:center;margin-top:36px;color:var(--success);font-size:1rem;padding:24px;border:1px solid rgba(82,183,136,.2);border-radius:var(--radius);';
    perfect.innerHTML = '🎉 All answers correct — nothing to review!';
    page.appendChild(perfect);
    return page;
  }

  const rev = document.createElement('div');
  rev.innerHTML = `<div class="section-title" style="margin-top:36px;margin-bottom:4px;font-size:1.1rem">Review</div>
    <div style="font-size:.8rem;color:var(--muted);margin-bottom:16px;">${reviewItems.length} question${reviewItems.length !== 1 ? 's' : ''} to go over</div>`;
  const list = document.createElement('div');
  list.className = 'review-list';

  reviewItems.forEach(({ q, i, status, answer }) => {
    const item = document.createElement('div');
    const isWrong   = status === 'wrong';
    const isSkipAns = status === 'skipped' || status === 'unanswered';

    item.className = `review-item ${isWrong ? 'wrong-item' : ''}`;
    item.style.cssText = `border-left: 3px solid ${isWrong ? 'var(--error)' : 'var(--warning)'};`;

    const badgeColor  = isWrong ? 'var(--error)' : 'var(--warning)';
    const badgeBg     = isWrong ? 'rgba(230,115,137,.12)' : 'rgba(241,207,131,.12)';
    const badgeText   = isWrong ? '✗ Wrong' : '— Skipped';

    item.innerHTML = `
<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
  <span style="font-size:.72rem;font-weight:600;padding:2px 8px;border-radius:4px;background:${badgeBg};color:${badgeColor};">${badgeText}</span>
  <span style="font-size:.78rem;color:var(--muted)">Q${i + 1}</span>
</div>
<div class="review-q">${esc(q.question)}</div>
<div class="review-answers" style="display:flex;flex-direction:column;gap:4px;">
  ${typeof answer === 'number'
    ? `<span style="color:var(--error);">Your answer: ${esc(q.options[answer])}</span>`
    : `<span style="color:var(--warning);">Skipped — no answer given</span>`}
  <span style="color:var(--success);font-weight:500;">✓ Correct: ${esc(q.options[q.answer])}</span>
  ${q.explanation ? `<div style="margin-top:10px;padding:12px 14px;background:var(--surface2);border-left:3px solid var(--accent);font-size:.82rem;border-radius:2px;color:var(--text);line-height:1.5;"><strong style="display:block;margin-bottom:4px;color:var(--accent2);">💡 Explanation</strong>${esc(q.explanation)}</div>` : ''}
</div>`;
    list.appendChild(item);
  });

  rev.appendChild(list);
  page.appendChild(rev);
  return page;
}

// ── IMPORT MODAL ────────────────────────────────────────
function renderImportModal() {
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop open';
  bd.innerHTML = `
<div class="modal">
  <h2>Upload File</h2>
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
  dz.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFileImport(f); });
  fi.addEventListener('change', () => { if (fi.files[0]) handleFileImport(fi.files[0]); });
  return bd;
}

function showManifestHelp() {
  const sample = JSON.stringify({ tests: [{ id: 'test-t3', file: 'test_t3_temario_final.json' }] }, null, 2);
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop open';
  bd.innerHTML = `
<div class="modal" style="max-width:520px">
  <h2>Local Repository Setup</h2>
  <p>Place a file named <code>manifest.json</code> beside this HTML file:</p>
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
