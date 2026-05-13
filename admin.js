const sessionsEl = document.getElementById("sessions");
const eventsEl = document.getElementById("events");
const uploadsEl = document.getElementById("frqUploads");
let currentImages = {};

// 1. LOAD DATA IN REAL-TIME FROM SUPABASE CODESPACE
async function loadLiveData() {
  try {
    // Fetch live session and event history directly from your live_sync table
    const { data: syncData, error } = await supabase
      .from('live_sync')
      .select('*')
      .order('id', { ascending: false })
      .limit(100);

    if (error) throw error;

    // Filter database rows into sessions and events lists
    const sessions = syncData.filter(item => item.event_type === 'session_update').map(i => i.payload);
    const events = syncData.filter(item => item.event_type !== 'session_update');

    renderSessions(sessions);
    renderEvents(events);
  } catch (err) {
    console.error("Error reading live dashboards:", err);
  }
}

// 2. LOAD FRQ IMAGES VIA STORAGE BUCKET HISTORY LISTS
async function loadUploads() {
  try {
    // Fetch all files sitting inside your 'better' storage bucket uploads folder
    const { data: files, error } = await supabase.storage.from('better').list('uploads');
    if (error) throw error;

    currentImages = {};
    if (files) {
      files.forEach(file => {
        // Parse out which FRQ question slot (1, 2, 3, 4) this image maps to based on its naming convention
        const match = file.name.match(/^frq_(\d+)_/);
        if (match) {
          const qNum = match[1];
          const { data: urlData } = supabase.storage.from('better').getPublicUrl(`uploads/${file.name}`);
          currentImages[qNum] = {
            url: urlData.publicUrl,
            uploadedAt: new Date(file.created_at).toLocaleTimeString(),
            storagePath: `uploads/${file.name}`
          };
        }
      });
    }
    renderUploads(currentImages);
  } catch (err) {
    console.error("Error downloading image feeds:", err);
  }
}

// 3. RENDER VISUAL LAYOUTS AND HANDLE CLOUD STORAGE INTERACTIONS
function renderUploads(images) {
  uploadsEl.innerHTML = [1, 2, 3, 4].map(q => {
    const image = images[String(q)];
    return `
      <article class="upload-card">
        <div>
          <strong>FRQ Question ${q}</strong>
          <p>${image ? `Uploaded ${esc(image.uploadedAt)}` : "No image uploaded"}</p>
        </div>
        ${image ? `<img src="${esc(image.url)}" alt="FRQ ${q} uploaded image" style="max-width:100%; height:auto;">` : ""}
        <form class="upload-form" data-question="${q}">
          <input type="file" name="image" accept="image/*" required>
          <button class="pill-btn blue" type="submit">Upload</button>
          <div class="upload-status" aria-live="polite"></div>
        </form>
        ${image ? `<button class="remove-upload" data-remove="${q}" data-path="${esc(image.storagePath)}" type="button">Remove image</button>` : ""}
      </article>
    `;
  }).join("");

  // Bind new submit handlers directly to your file picking fields
  document.querySelectorAll(".upload-form").forEach(form => {
    form.onsubmit = async (event) => {
      event.preventDefault();
      const file = form.querySelector("input[type=file]").files[0];
      if (!file) return;

      const qNum = form.dataset.question;
      const fileExt = file.name.split('.').pop();
      const fileName = `uploads/frq_${qNum}_${Date.now()}.${fileExt}`;

      const button = form.querySelector("button");
      const status = form.querySelector(".upload-status");
      button.disabled = true;
      button.textContent = "Uploading";
      status.textContent = "";

      try {
        // A. Upload image directly to your Supabase public bucket 'better'
        const { error: uploadError } = await supabase.storage.from('better').upload(fileName, file);
        if (uploadError) throw uploadError;

        // B. Grab the newly generated public link
        const { data: urlData } = supabase.storage.from('better').getPublicUrl(fileName);

        // C. Log a record inside live_sync table so the student screen downloads it instantly
        const { error: dbError } = await supabase.from('live_sync').insert([
          { event_type: 'file_uploaded', payload: { question: qNum, url: urlData.publicUrl, name: file.name } }
        ]);
        if (dbError) throw dbError;

        status.textContent = "Uploaded.";
        await loadUploads();
      } catch (error) {
        console.error(error);
        button.disabled = false;
        button.textContent = "Upload";
        status.textContent = "Upload failed. Try a PNG or JPG.";
      }
    };
  });

  // Bind element clicks to run cloud deletions directly out of your bucket folders
  document.querySelectorAll("[data-remove]").forEach(button => {
    button.onclick = async () => {
      button.disabled = true;
      button.textContent = "Removing";
      const filePath = button.dataset.path;
      const qNum = button.dataset.remove;

      try {
        // A. Remove asset binary from storage system bucket
        await supabase.storage.from('better').remove([filePath]);

        // B. Log removal alert inside public syncing table feeds
        await supabase.from('live_sync').insert([
          { event_type: 'file_removed', payload: { question: qNum } }
        ]);

        await loadUploads();
      } catch (err) {
        console.error("Removal failure:", err);
        button.disabled = false;
        button.textContent = "Remove image";
      }
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
      <strong>${esc(e.event_type)}</strong> at ${esc(new Date(e.created_at).toLocaleTimeString())}<br>
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
    "'": "'",
  }[ch]));
}

// 4. SUBSCRIBE TO THE LIVE CHANNELS AUTOMATICALLY FOR TWO COMPUTER MONITORING
supabase
  .channel('live-monitor')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'live_sync' }, () => {
    // Force dashboards to recalculate states on incoming data packets automatically
    loadLiveData();
    loadUploads();
  })
  .subscribe();

// Initial lifecycle invocations
loadUploads();
loadLiveData();
