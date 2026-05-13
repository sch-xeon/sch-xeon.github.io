const sessionsEl = document.getElementById("sessions");
const eventsEl = document.getElementById("events");
const uploadsEl = document.getElementById("frqUploads");
let currentImages = {};

async function loadLiveData() {
  const [sessions, events] = await Promise.all([
    fetch("/api/sessions").then(r => r.json()).catch(() => ({})),
    fetch("/api/events").then(r => r.json()).catch(() => []),
  ]);
  renderSessions(Object.values(sessions).sort((a, b) => (b.lastSeen || "").localeCompare(a.lastSeen || "")));
  renderEvents(events.slice(-80).reverse());
}

async function loadUploads() {
  currentImages = await fetch("/api/frq-images").then(r => r.json()).catch(() => ({}));
  renderUploads(currentImages);
}

function renderUploads(images) {
  uploadsEl.innerHTML = [1, 2, 3, 4].map(q => {
    const image = images[String(q)];
    return `
      <article class="upload-card">
        <div>
          <strong>FRQ Question ${q}</strong>
          <p>${image ? `Uploaded ${esc(image.uploadedAt)}` : "No image uploaded"}</p>
        </div>
        ${image ? `<img src="${esc(image.url)}?v=${encodeURIComponent(image.uploadedAt)}" alt="FRQ ${q} uploaded image">` : ""}
        <form class="upload-form" data-question="${q}">
          <input type="file" name="image" accept="image/*" required>
          <button class="pill-btn blue" type="submit">Upload</button>
          <div class="upload-status" aria-live="polite"></div>
        </form>
        ${image ? `<button class="remove-upload" data-remove="${q}" type="button">Remove image</button>` : ""}
      </article>
    `;
  }).join("");
  document.querySelectorAll(".upload-form").forEach(form => {
    form.onsubmit = async (event) => {
      event.preventDefault();
      const file = form.querySelector("input[type=file]").files[0];
      if (!file) return;
      const data = new FormData();
      data.append("question", form.dataset.question);
      data.append("image", file);
      const button = form.querySelector("button");
      const status = form.querySelector(".upload-status");
      button.disabled = true;
      button.textContent = "Uploading";
      status.textContent = "";
      try {
        const response = await fetch("/api/frq-image", { method: "POST", body: data });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || "Upload failed");
        status.textContent = "Uploaded.";
        await loadUploads();
      } catch (error) {
        button.disabled = false;
        button.textContent = "Upload";
        status.textContent = "Upload failed. Try a PNG or JPG.";
      }
    };
  });
  document.querySelectorAll("[data-remove]").forEach(button => {
    button.onclick = async () => {
      button.disabled = true;
      button.textContent = "Removing";
      await fetch("/api/frq-image-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: button.dataset.remove }),
      }).catch(() => {});
      await loadUploads();
    };
  });
}

function renderSessions(sessions) {
  sessionsEl.innerHTML = sessions.length ? sessions.map(s => `
    <article class="session-card">
      <strong>${esc(s.studentName || "Unknown student")}</strong><br>
      Session <code>${esc(s.sessionId)}</code><br>
      Last seen: ${esc(s.lastSeen || "-")} (${esc(s.lastType || "-")})<br>
      Room code: <code>${esc(s.roomCode || "-")}</code> Start code: <code>${esc(s.startCode || "-")}</code><br>
      Section: ${esc(s.section || "-")} Question/Page: ${esc(s.question || "-")} Answer: ${esc(s.answer || "-")}<br>
      MCQ answers: ${Object.keys(s.answers || {}).length}
    </article>
  `).join("") : "<p>No sessions yet.</p>";
}

function renderEvents(events) {
  eventsEl.innerHTML = events.length ? events.map(e => `
    <article class="event-card">
      <strong>${esc(e.type)}</strong> at ${esc(e.time)}<br>
      Session <code>${esc(e.sessionId || "-")}</code>
      <pre>${esc(JSON.stringify(e.payload || {}, null, 2))}</pre>
    </article>
  `).join("") : "<p>No events yet.</p>";
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

loadUploads();
loadLiveData();
setInterval(loadLiveData, 2000);
