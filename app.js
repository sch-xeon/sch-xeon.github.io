const app = document.getElementById("app");
const content = window.EXAM_CONTENT;
const mcq = window.CURATED_MCQ || content.mcq;
const frqQuestions = window.CURATED_FRQ || [];
const BREAK_SECONDS = 10 * 60;
const SESSION_KEY = "apc-practice-session";
const DEFAULT_NAME = "Conrad Abeygunawardena";
const state = {
  sessionId: localStorage.getItem(SESSION_KEY) || crypto.randomUUID(),
  page: "home",
  step: 1,
  studentName: DEFAULT_NAME,
  answers: JSON.parse(localStorage.getItem("answers") || "{}"),
  marked: JSON.parse(localStorage.getItem("marked") || "{}"),
  frq: JSON.parse(localStorage.getItem("frq") || "{}"),
  qIndex: Number(localStorage.getItem("qIndex") || 0),
  frqIndex: Number(localStorage.getItem("frqIndex") || 0),
  timers: {
    mcq: Number(localStorage.getItem("timer-mcq") || 80 * 60),
    break: Number(localStorage.getItem("timer-break") || BREAK_SECONDS),
    frq: Number(localStorage.getItem("timer-frq") || 100 * 60),
  },
  activeTimer: null,
  attachmentPoll: null,
  frqImages: {},
  hideTimer: false,
};
localStorage.setItem(SESSION_KEY, state.sessionId);

function api(type, payload = {}) {
  if (payload.roomCode) state.roomCode = payload.roomCode;
  if (payload.startCode) state.startCode = payload.startCode;

  const sessionPayload = {
    sessionId: state.sessionId,
    studentName: state.studentName || DEFAULT_NAME,
    lastSeen: new Date().toLocaleTimeString(),
    lastType: type,
    roomCode: state.roomCode || payload.roomCode || "-",
    startCode: state.startCode || payload.startCode || "-",
    section: payload.section || (state.page === "mcq" ? "MCQ" : state.page === "frq" ? "FRQ" : "-"),
    question: payload.question || (state.page === "mcq" ? mcq[state.qIndex]?.id : state.page === "frq" ? frqQuestions[state.frqIndex]?.id : "-"),
    answer: payload.answer || "-",
    answers: state.answers || {}
  };

    // We remove .catch and handle the database output inside a clean background thread
  supabase.from('live_sync')
    .insert([{ event_type: 'session_update', payload: sessionPayload }])
    .then(({ error }) => {
      if (error) console.error("Database sync failed:", error);
    });

  if (type !== 'progress' && type !== 'answer') {
    supabase.from('live_sync')
      .insert([{ event_type: `student_${type}`, payload: { studentName: state.studentName, data: payload } }])
      .then(({ error }) => {
        if (error) console.error("Timeline insert failed:", error);
      });
  }


  if (type !== 'progress' && type !== 'answer') {
    supabase.from('live_sync').insert([
      { event_type: `student_${type}`, payload: { studentName: state.studentName, data: payload } }
    ]).catch(() => {});
  }
}


function save() {
  localStorage.setItem("studentName", state.studentName);
  localStorage.setItem("answers", JSON.stringify(state.answers));
  localStorage.setItem("marked", JSON.stringify(state.marked));
  localStorage.setItem("frq", JSON.stringify(state.frq));
  localStorage.setItem("qIndex", String(state.qIndex));
  localStorage.setItem("frqIndex", String(state.frqIndex));
  localStorage.setItem("timer-mcq", String(state.timers.mcq));
  localStorage.setItem("timer-break", String(state.timers.break));
  localStorage.setItem("timer-frq", String(state.timers.frq));
}

function resetExamState() {
  state.answers = {};
  state.marked = {};
  state.frq = {};
  state.qIndex = 0;
  state.frqIndex = 0;
  state.timers.mcq = 80 * 60;
  state.timers.break = BREAK_SECONDS;
  state.timers.frq = 100 * 60;
  save();
}

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function stopTimer() {
  if (state.activeTimer) clearInterval(state.activeTimer);
  state.activeTimer = null;
}

function stopAttachmentPoll() {
  if (state.attachmentPoll) clearInterval(state.attachmentPoll);
  state.attachmentPoll = null;
}

function startTimer(key, done) {
  stopTimer();
  state.activeTimer = setInterval(() => {
    state.timers[key] = Math.max(0, state.timers[key] - 1);
    save();
    const node = document.querySelector("[data-timer]");
    const breakNode = document.querySelector("[data-break-time]");
    if (node && !state.hideTimer) node.textContent = fmt(state.timers[key]);
    if (breakNode) breakNode.textContent = fmt(state.timers[key]);
    if (state.timers[key] <= 300 && node) node.classList.add("low");
    if (state.timers[key] === 0) {
      stopTimer();
      done();
    }
  }, 1000);
}

function chrome(title = "Room Code") {
  return `
    <header class="topbar">
      <div class="left"><span class="icon">?</span><span>Help</span></div>
      <div class="right"><span>Return to Home</span><span class="home-icon"></span></div>
    </header>
  `;
}

function setupFrame(inner, step, nextLabel = "Next", nextDisabled = false) {
  app.innerHTML = `
    ${chrome()}
    <main class="setup-main">${inner}</main>
    <footer class="footer-nav">
      <button class="pill-btn" id="backBtn">Back</button>
      <div class="progress-wrap">
        <div class="progress-label">Step ${step} of 10</div>
        <div class="progress-track"><div class="progress-bar" style="width:${step * 10}%"></div></div>
      </div>
      <button class="pill-btn primary" id="nextBtn" ${nextDisabled ? "disabled" : ""}>${nextLabel}</button>
    </footer>
  `;
  document.getElementById("backBtn").onclick = goBackSetup;
}

function goBackSetup() {
  if (state.step <= 1) renderHome();
  else renderSetup(state.step - 1);
}

function renderHome() {
  stopTimer();
  stopAttachmentPoll();
  state.page = "home";
  app.className = "home";
  app.innerHTML = `
    <header class="bluebook-homebar">
      <div class="bluebook-logo">Bluebook</div>
      <div class="bluebook-user">${escapeHtml(DEFAULT_NAME)} <span class="avatar-dot"></span></div>
    </header>
    <main class="home-main bluebook-home">
      <h1>Welcome, Conrad. Good luck on test day!</h1>
      <section class="exam-card bluebook-card">
        <div class="card-head">
          <h2>Your Tests</h2>
          <button class="tab active">All</button>
          <button class="tab">Active</button>
        </div>
        <article class="test-card">
          <h3>AP Physics C: Mechanics</h3>
          <p class="meta">Digital AP Exam</p>
          <p class="meta">Tuesday, May 12, 2026</p>
          <p class="meta">Conrad Abeygunawardena</p>
          <div class="ready-line"><span class="ready-dot">&#10003;</span> Exam setup is complete. Check in right away.</div>
          <button class="pill-btn primary compact" id="checkin">Start Exam Setup</button>
        </article>
        <aside class="home-links">
          <a>Don't see your test here?</a>
          <a>Test Day Checklist</a>
          <a>Exam Directions</a>
        </aside>
      </section>
    </main>
  `;
  document.getElementById("checkin").onclick = () => {
    state.studentName = DEFAULT_NAME;
    resetExamState();
    save();
    api("sign-in", { studentName: state.studentName });
    renderSetup(1);
  };
}

function renderSetup(step) {
  stopTimer();
  stopAttachmentPoll();
  state.step = step;
  app.className = "";
  if (step === 1) {
    setupFrame(`
      <section class="setup-card">
        <h1>Confirm Your Information</h1>
        <p>${escapeHtml(state.studentName)}</p>
        <p class="small-copy">AP Physics C: Mechanics</p>
        <p class="small-copy">No approved accommodations are listed for this practice session.</p>
      </section>
    `, 1);
    document.getElementById("nextBtn").onclick = () => renderSetup(2);
  } else if (step === 2) {
    setupFrame(`
      <section class="setup-card">
        <h1>Testing Rules</h1>
        <p>Put away phones, smartwatches, notes, textbooks, and any other unauthorized materials.</p>
        <p class="small-copy">Stay in the app during testing and follow your proctor's instructions.</p>
      </section>
    `, 2);
    document.getElementById("nextBtn").onclick = () => renderSetup(3);
  } else if (step === 3) {
    renderRoomCode();
  } else if (step === 4) {
    renderFinalInstructions();
  } else {
    renderStartCode();
  }
}

function renderRoomCode() {
  setupFrame(`
    <section class="setup-card">
      <h1>Room Code</h1>
      <p>Enter your room code now to complete check-in.</p>
      <p>The room code contains <strong>letters only.</strong></p>
      <div class="success" id="roomSuccess" style="visibility:hidden"><span class="success-dot">&#10003;</span>Success! Click the Next button to complete check-in.</div>
      <div class="code-row" id="codeRow">
        ${Array.from({length: 5}, (_, i) => `<input class="code-box" maxlength="1" data-code="${i}" inputmode="text">`).join("")}
      </div>
    </section>
  `, 3, "Next", true);
  wireCodeInputs(5, /^[A-Za-z]$/, (code) => {
    document.getElementById("roomSuccess").style.visibility = "visible";
    document.getElementById("nextBtn").disabled = false;
    api("room-code", { studentName: state.studentName, roomCode: code.toUpperCase() });
  });
  document.getElementById("nextBtn").onclick = () => renderSetup(4);
}

function renderFinalInstructions() {
  setupFrame(`
    <section class="setup-card">
      <h1>You're Checked In</h1>
      <p>Wait here until your proctor gives the start code.</p>
      <p class="small-copy">Do not close this window or leave the practice app.</p>
    </section>
  `, 4);
  document.getElementById("nextBtn").onclick = () => renderSetup(5);
}

function renderStartCode() {
  setupFrame(`
    <section class="setup-card">
      <h1>Start Code</h1>
      <p>Enter the 6-digit start code to begin Section I.</p>
      <div class="success" id="roomSuccess" style="visibility:hidden"><span class="success-dot">&#10003;</span>Success! Click Next to start testing.</div>
      <div class="code-row" id="codeRow">
        ${Array.from({length: 6}, (_, i) => `<input class="code-box" maxlength="1" data-code="${i}" inputmode="numeric">`).join("")}
      </div>
    </section>
  `, 5, "Next", true);
  wireCodeInputs(6, /^[0-9]$/, (code) => {
    document.getElementById("roomSuccess").style.visibility = "visible";
    document.getElementById("nextBtn").disabled = false;
    api("start-code", { studentName: state.studentName, startCode: code });
  });
  document.getElementById("nextBtn").onclick = () => renderMCQ();
}

function wireCodeInputs(length, pattern, done) {
  const inputs = [...document.querySelectorAll(".code-box")];
  inputs[0].focus();
  const read = () => inputs.map((i) => i.value).join("");
  inputs.forEach((input, idx) => {
    input.addEventListener("input", () => {
      input.value = input.value.slice(-1).toUpperCase();
      if (!pattern.test(input.value)) input.value = "";
      if (input.value && inputs[idx + 1]) inputs[idx + 1].focus();
      const code = read();
      if (code.length === length) done(code);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !input.value && inputs[idx - 1]) inputs[idx - 1].focus();
    });
  });
}

function renderTestShell(section, timerKey, body, footer) {
  app.className = "";
  app.innerHTML = `
    <main class="test-shell">
      <header class="test-head">
        <div>
          <div class="section-name">${section}</div>
          <button class="directions">Directions <span>v</span></button>
        </div>
        <div class="timer"><span data-timer>${state.hideTimer ? "" : fmt(state.timers[timerKey])}</span><br><button id="hideTimer">${state.hideTimer ? "Show" : "Hide"}</button></div>
        <div class="tools">
          <button class="tool-btn" title="Calculator"><span class="tool-icon calc-icon"></span><span>Calculator</span></button>
          <button class="tool-btn" title="Reference"><span class="tool-icon">x<sup>2</sup></span><span>Reference</span></button>
          <button class="tool-btn" title="More"><span class="tool-icon">...</span><span>More</span></button>
        </div>
        <div class="battery">100%</div>
      </header>
      <section class="test-main">${body}</section>
      ${footer}
    </main>
  `;
  document.getElementById("hideTimer").onclick = () => {
    state.hideTimer = !state.hideTimer;
    renderCurrent();
  };
}

function renderMCQ() {
  stopAttachmentPoll();
  state.page = "mcq";
  const q = mcq[state.qIndex];
  renderTestShell("Section 1: Multiple Choice", "mcq", `
    <div class="question-wrap">
      <div class="question-title">
        <span class="qnum">${q.id}</span>
        <label class="mark"><input type="checkbox" id="markBtn" ${state.marked[q.id] ? "checked" : ""}> <span>Mark for Review</span></label>
      </div>
      <div class="stem">${q.stem || escapeHtml(trimHeader(q.stem))}</div>
      ${q.figure ? `<img class="question-figure" src="${q.figure}" alt="Question ${q.id} figure">` : ""}
      ${q.choices.map(c => `
        <button class="choice ${state.answers[q.id] === getLetter(c) ? "selected" : ""}" data-choice="${getLetter(c)}">
          <span class="letter">${getLetter(c)}</span><span>${getChoiceText(c)}</span>
        </button>
      `).join("")}
    </div>
  `, `
    <footer class="test-foot">
      <div class="test-name">${escapeHtml(DEFAULT_NAME)}</div>
      <button class="question-menu">Question ${q.id} of ${mcq.length} ^</button>
      <div class="nav-buttons">
        <button class="pill-btn blue" id="prevQ" ${state.qIndex === 0 ? "disabled" : ""}>Back</button>
        <button class="pill-btn blue" id="nextQ">${state.qIndex === mcq.length - 1 ? "Submit" : "Next"}</button>
      </div>
    </footer>
  `);
  document.getElementById("markBtn").onchange = (event) => {
    state.marked[q.id] = event.target.checked;
    save();
    renderMCQ();
  };
  document.querySelectorAll("[data-choice]").forEach(btn => {
    btn.onclick = () => {
      state.answers[q.id] = btn.dataset.choice;
      save();
      api("answer", { studentName: state.studentName, section: "MCQ", question: q.id, answer: btn.dataset.choice });
      renderMCQ();
    };
  });
  document.getElementById("prevQ").onclick = () => { state.qIndex--; save(); renderMCQ(); };
  document.getElementById("nextQ").onclick = () => {
    if (state.qIndex === mcq.length - 1) renderReview("mcq");
    else { state.qIndex++; save(); renderMCQ(); }
  };
  api("progress", { studentName: state.studentName, section: "MCQ", question: q.id });
  startTimer("mcq", () => renderReview("mcq"));
}

function renderBreak() {
  state.page = "break";
  stopTimer();
  stopAttachmentPoll();
  app.className = "";
  app.innerHTML = `
    <main class="break-body">
      <div class="battery-break">85%</div>
      <section class="break-card">
        <h2>Remaining Break Time:</h2>
        <div class="break-time" data-break-time>${fmt(state.timers.break)}</div>
        <button class="pill-btn primary" id="resume" style="display:${state.timers.break === 0 ? "inline-block" : "none"}; margin-top:22px">Resume Testing Now</button>
      </section>
      <section class="break-copy">
        <h1>Take a Break: Do Not Close Your Device</h1>
        <p>After the break, a <strong>Resume Testing Now</strong> button will appear and you'll start the next section.</p>
        <p><strong>Follow these rules during the break:</strong></p>
        <ol>
          <li>Do not disturb students who are still testing.</li>
          <li>Do not exit the app or close your laptop.</li>
          <li>Do not access phones, smartwatches, textbooks, notes, or the internet.</li>
          <li>Do not eat or drink near any testing device.</li>
          <li>Do not speak in the test room; outside the test room, do not discuss the exam with anyone.</li>
        </ol>
      </section>
      <div class="break-name">${escapeHtml(state.studentName)}</div>
    </main>
  `;
  api("progress", { studentName: state.studentName, section: "Break" });
  const resume = document.getElementById("resume");
  resume.onclick = renderFRQDirections;
  startTimer("break", renderFRQDirections);
}

function renderFRQDirections() {
  stopTimer();
  stopAttachmentPoll();
  setupFrame(`
    <section class="setup-card directions-page">
      <h1>Section II Directions</h1>
      <h2>Physics C: Mechanics</h2>
      <p>Section II has 4 questions and lasts 1 hour and 40 minutes.</p>
      <p>You may use the available paper for scratch work and planning, but only work written in the free-response booklet will be scored. Any work done on scratch paper will not be scored. Label parts (e.g., A, B, C) and sub-parts (e.g., i, ii, iii) as needed. Use a pencil or a pen with black or dark blue ink to write your responses.</p>
      <p>A calculator is allowed in this section, as well as a ruler and straightedge. You may use a handheld four-function, scientific, or graphing calculator, or the calculator available in this application. Reference information, including lists of equations, can be used throughout the exam. A digital version is available in this application.</p>
      <p>All final numerical answers should include appropriate units when applicable. Credit for your work depends on demonstrating that you know which physical principles to apply in a particular situation. Credit will be awarded only for work that is clearly designated as the solution to a specific part of a question. Credit also depends on the quality of your solutions and explanations. Therefore, you should show your work for each part in the space provided for that part. If you need more space, be sure to clearly indicate where you continue your work. When constructing a graph or diagram, use only one color of ink or pencil.</p>
      <p>You may pace yourself as you answer the questions in this section, or you may use these optional timing recommendations:</p>
      <p>It is suggested that you spend about 25 minutes each on Questions 1 and 3, about 30 minutes on Question 2, and about 20 minutes on Question 4. You can go back and forth between questions in this section until time expires. The clock will turn red when 5 minutes remain-the proctor will not give you any time updates or warnings.</p>
    </section>
  `, 6, "Resume Testing");
  document.getElementById("nextBtn").onclick = renderFRQ;
}

function renderFRQ() {
  state.page = "frq";
  const q = frqQuestions[state.frqIndex];
  const image = state.frqImages[String(q.id)];
  renderTestShell("Section 2: Free Response", "frq", `
    <div class="frq-question-wrap">
      <div class="question-title">
        <span class="qnum">${q.id}</span>
        <label class="mark"><input type="checkbox" id="markFrqBtn" ${state.marked["frq-" + q.id] ? "checked" : ""}> <span>Mark for Review</span></label>
      </div>
      <article class="frq-text">${q.html || formatText(q.text)}</article>
      <div class="frq-admin-image" id="frqAdminImage">
        ${image ? `<img src="${image.url}?v=${encodeURIComponent(image.uploadedAt || "")}" alt="Uploaded image for FRQ ${q.id}">` : ""}
      </div>
    </div>
  `, `
    <footer class="test-foot">
      <div class="test-name">${escapeHtml(DEFAULT_NAME)}</div>
      <button class="question-menu">Question ${q.id} of ${frqQuestions.length} ^</button>
      <div class="nav-buttons">
        <button class="pill-btn blue" id="prevFrq" ${state.frqIndex <= 0 ? "disabled" : ""}>Back</button>
        <button class="pill-btn blue" id="nextFrq">${state.frqIndex === frqQuestions.length - 1 ? "Next" : "Next"}</button>
      </div>
    </footer>
  `);
  document.getElementById("markFrqBtn").onchange = (event) => {
    state.marked["frq-" + q.id] = event.target.checked;
    save();
    renderFRQ();
  };
  document.getElementById("prevFrq").onclick = () => { state.frqIndex--; save(); renderFRQ(); };
  document.getElementById("nextFrq").onclick = () => {
    if (state.frqIndex === frqQuestions.length - 1) renderReview("frq");
    else { state.frqIndex++; save(); renderFRQ(); }
  };
  api("progress", { studentName: state.studentName, section: "FRQ", question: q.id });
  startAttachmentPoll();
  startTimer("frq", () => renderReview("frq"));
}

async function loadFrqImages() {
  try {
    const { data: files, error } = await supabase.storage.from('better').list('uploads');
    if (error) throw error;

    state.frqImages = {};
    if (files) {
      files.forEach(file => {
        const match = file.name.match(/^frq_(\d+)_/);
        if (match) {
          const qNum = match[1];
          const { data: urlData } = supabase.storage.from('better').getPublicUrl(`uploads/${file.name}`);
          state.frqImages[String(qNum)] = {
            url: urlData.publicUrl,
            uploadedAt: new Date(file.created_at).toLocaleTimeString()
          };
        }
      });
    }
    
    if (state.page === "frq") {
      const q = frqQuestions[state.frqIndex];
      const slot = document.getElementById("frqAdminImage");
      const image = q && state.frqImages[String(q.id)];
      if (slot) {
        slot.innerHTML = image ? `<img src="${image.url}" alt="Uploaded image for FRQ ${q.id}">` : "";
      }
    }
  } catch (error) {
    console.error("Failed loading bucket images:", error);
  }
}

function startAttachmentPoll() {
  loadFrqImages();
}


function renderReview(section) {
  stopTimer();
  stopAttachmentPoll();
  const isFrq = section === "frq";
  const items = isFrq ? frqQuestions : mcq;
  const title = isFrq ? "Section II Questions" : "Section I Questions";
  const sectionTitle = isFrq ? "Section II" : "Section I";
  state.page = isFrq ? "frq-review" : "mcq-review";
  renderTestShell(sectionTitle, isFrq ? "frq" : "mcq", `
    <section class="review-page">
      <h1>Check Your Work</h1>
      <p>On test day, you won't be able to move on to the next module until time expires.</p>
      <p>For these practice questions, you can click <strong>Next</strong> when you're ready to move on.</p>
      <div class="review-card">
        <div class="review-card-head">
          <h2>${title}</h2>
          <div class="review-legend"><span class="review-flag"></span> For Review</div>
        </div>
        <div class="review-grid">
          ${items.map(item => {
            const key = isFrq ? "frq-" + item.id : item.id;
            const answered = isFrq || Boolean(state.answers[item.id]);
            return `<button class="review-tile ${state.marked[key] ? "flagged" : ""} ${answered ? "answered" : "unanswered"}" data-review="${item.id}">${item.id}</button>`;
          }).join("")}
        </div>
      </div>
    </section>
  `, `
    <footer class="test-foot">
      <div class="test-name">${escapeHtml(DEFAULT_NAME)}</div>
      <div></div>
      <div class="nav-buttons">
        <button class="pill-btn blue" id="reviewBack">Back</button>
        <button class="pill-btn blue" id="reviewNext">Next</button>
      </div>
    </footer>
  `);
  document.querySelectorAll("[data-review]").forEach(btn => {
    btn.onclick = () => {
      if (isFrq) {
        state.frqIndex = Number(btn.dataset.review) - 1;
        save();
        renderFRQ();
      } else {
        state.qIndex = Number(btn.dataset.review) - 1;
        save();
        renderMCQ();
      }
    };
  });
  document.getElementById("reviewBack").onclick = () => {
    if (isFrq) {
      state.frqIndex = frqQuestions.length - 1;
      save();
      renderFRQ();
    } else {
      state.qIndex = mcq.length - 1;
      save();
      renderMCQ();
    }
  };
  document.getElementById("reviewNext").onclick = () => isFrq ? renderDone() : renderBreak();
}

function renderDone() {
  stopTimer();
  stopAttachmentPoll();
  api("submitted", { studentName: state.studentName, section: "Complete" });
  app.innerHTML = `
    <main class="done-screen">
      <header class="done-top">
        <div>Help</div>
        <button onclick="location.href='/'">Return to Home</button>
      </header>
      <section class="done-card">
        <h1>Congratulations!</h1>
        <p>The exam is over, and your answers have been submitted.</p>
        <div class="done-panel">
          <div class="laptop-illo">
            <div class="laptop-screen"><div class="smile-face">☺</div></div>
            <div class="laptop-base"></div>
          </div>
          <div class="done-divider"></div>
          <div class="done-copy">
            <p>Stay seated until your proctor dismisses you.</p>
            <p>Practice ended. Other students may still be testing.</p>
            <p>Go to application.myap to see when scores will be available.</p>
          </div>
        </div>
        <button class="pill-btn primary compact-home" onclick="location.href='/'">Return to Homepage</button>
      </section>
    </main>
  `;
}

function renderCurrent() {
  if (state.page === "mcq") renderMCQ();
  else if (state.page === "frq") renderFRQ();
  else if (state.page === "mcq-review") renderReview("mcq");
  else if (state.page === "frq-review") renderReview("frq");
  else renderHome();
}

function trimHeader(text) {
  return text.replace(/^AP Physics C:[\s\S]*?40 Questions\s*1\.\s*/, "");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function formatText(value) {
  return escapeHtml(value).replace(/\n/g, "<br>");
}

function getLetter(choice) {
  if (typeof choice === "string") return String.fromCharCode(65 + mcq[state.qIndex].choices.indexOf(choice));
  return choice.letter;
}

function getChoiceText(choice) {
  if (typeof choice === "string") return choice;
  return escapeHtml(choice.text);
}

renderHome();
supabase
  .channel('student-live-channel')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'live_sync' }, (payload) => {
    const change = payload.new;
    if (change.event_type === 'file_uploaded' || change.event_type === 'file_removed') {
      loadFrqImages();
    }
  })
  .subscribe();

loadFrqImages();
