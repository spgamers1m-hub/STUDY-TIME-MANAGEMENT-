/* =========================================
   MY SIR TRACKER — JAVASCRIPT SYSTEM
   Supabase version (shared data + real admin login)
========================================= */

(() => {
  "use strict";

  /* -----------------------------------------
     SUPABASE SETTINGS
     Paste your publishable (anon) key below.
     Find it in: Supabase -> Settings -> API
     (this key is safe to put in website code)
  ----------------------------------------- */
  const SUPABASE_URL = "https://isdepqpvuiggxgnnsnrr.supabase.co";
  const SUPABASE_KEY = "sb_publishable_yGiK5UDlpKcJ3EcfUOea1A_reEulCXb";

  let sb = null;
  try {
    if (window.supabase && !SUPABASE_KEY.startsWith("PASTE_")) {
      sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    }
  } catch (err) {
    console.error("Supabase init failed:", err);
  }

  const $ = (id) => document.getElementById(id);

  const on = (id, evt, fn) => {
    const el = $(id);
    if (el) el.addEventListener(evt, fn);
  };

  let attendance = [];
  let schedules = [];
  let activities = [];
  let adminLoggedIn = false;

  /* =========================================
     UTILITIES
  ========================================= */

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[char]));
  }

  function isValidDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const d = new Date(value + "T00:00:00");
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
  }

  function isValidTime(value) {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  }

  function formatDate(date) {
    if (!date) return "No date";
    const d = new Date(date + "T00:00:00");
    if (isNaN(d.getTime())) return date;

    return d.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric"
    });
  }

  function formatTime(time) {
    if (!time) return "";
    const [h, m] = time.split(":");
    const d = new Date();
    d.setHours(Number(h), Number(m));
    if (isNaN(d.getTime())) return time;
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function showToast(message) {
    const toast = $("toast");
    if (!toast) return;

    toast.textContent = message;
    toast.classList.add("show");

    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
      toast.classList.remove("show");
    }, 2600);
  }

  /* =========================================
     DATABASE (SUPABASE)
  ========================================= */

  async function logActivity(message) {
    if (!sb) return;
    const { error } = await sb.from("activities").insert({ message });
    if (error) console.error("Activity log failed:", error);
  }

  async function loadAll() {
    if (!sb) return;

    const [a, s, act] = await Promise.all([
      sb.from("attendance").select("*")
        .order("date", { ascending: false })
        .order("created_at", { ascending: false }),
      sb.from("schedules").select("*")
        .order("date", { ascending: true })
        .order("time", { ascending: true }),
      sb.from("activities").select("*")
        .order("created_at", { ascending: false })
        .limit(20)
    ]);

    if (a.error || s.error || act.error) {
      console.error("Load failed:", a.error || s.error || act.error);
      showToast("Could not load data. Check your connection.");
      return;
    }

    attendance = a.data || [];
    schedules = s.data || [];
    activities = act.data || [];
    renderAll();
  }

  // Live updates: when anyone changes data, everyone's screen refreshes.
  let refreshTimer;
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(loadAll, 250);
  }

  function subscribeRealtime() {
    if (!sb) return;

    sb.channel("mst-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "schedules" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "activities" }, scheduleRefresh)
      .subscribe();

    // Phones can pause the live connection in the background.
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) loadAll();
    });
  }

  /* =========================================
     NAVIGATION
  ========================================= */

  let currentPage = "dashboard";
  let historyIndex = 0;

  function showPage(pageId) {
    if (pageId === "admin" && !adminLoggedIn) {
      $("adminLoginCard")?.classList.remove("hidden");
      $("adminDashboard")?.classList.add("hidden");
    }

    document.querySelectorAll(".page").forEach(page => {
      page.classList.toggle("active", page.id === pageId);
    });

    document.querySelectorAll(".nav-item").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.page === pageId);
    });

    $("navMenu")?.classList.remove("open");
    currentPage = pageId;

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function navigate(pageId) {
    if (pageId === currentPage) {
      showPage(pageId);
      return;
    }
    historyIndex += 1;
    try {
      history.pushState({ page: pageId, idx: historyIndex }, "", "#" + pageId);
    } catch { /* history API unavailable: still works without it */ }
    showPage(pageId);
  }

  function goBack() {
    if (historyIndex > 0) {
      history.back();
    } else {
      showPage("dashboard");
    }
  }

  window.addEventListener("popstate", (e) => {
    historyIndex = e.state?.idx ?? 0;
    showPage(e.state?.page || "dashboard");
  });

  try {
    history.replaceState({ page: "dashboard", idx: 0 }, "", location.pathname + location.search);
  } catch { /* ignore */ }

  document.querySelectorAll("[data-back]").forEach(btn => {
    btn.addEventListener("click", goBack);
  });

  document.querySelectorAll("[data-page]").forEach(btn => {
    btn.addEventListener("click", () => navigate(btn.dataset.page));
  });

  on("menuBtn", "click", () => {
    $("navMenu")?.classList.toggle("open");
  });

  /* =========================================
     ADMIN LOGIN (real Supabase Auth)
  ========================================= */

  // Logged in AND listed in the "admins" table?
  async function checkAdmin() {
    if (!sb) return false;

    const { data: { session } } = await sb.auth.getSession();
    if (!session) return false;

    const { data, error } = await sb.from("admins").select("email").maybeSingle();
    return !error && !!data;
  }

  function applyAdminState(isAdmin) {
    adminLoggedIn = isAdmin;
    $("adminLoginCard")?.classList.toggle("hidden", isAdmin);
    $("adminDashboard")?.classList.toggle("hidden", !isAdmin);
    renderAll();
  }

  on("adminLoginForm", "submit", async (e) => {
    e.preventDefault();

    const email = $("adminUsername").value.trim();
    const password = $("adminPassword").value;
    const message = $("loginMessage");

    if (!sb) {
      message.textContent = "Database is not connected yet.";
      return;
    }

    message.textContent = "";

    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      message.textContent = "Incorrect email or password.";
      return;
    }

    if (!(await checkAdmin())) {
      await sb.auth.signOut();
      message.textContent = "This account is not an admin.";
      return;
    }

    $("adminLoginForm").reset();
    showToast("Admin access opened!");
    applyAdminState(true);
  });

  on("logoutBtn", "click", async () => {
    if (sb) await sb.auth.signOut();

    $("adminLoginForm")?.reset();
    const msg = $("loginMessage");
    if (msg) msg.textContent = "";

    showToast("Logged out.");
    applyAdminState(false);
  });

  if (sb) {
    // No awaits/queries inside this callback (Supabase recommendation).
    sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") applyAdminState(false);
    });
  }

  /* =========================================
     ADMIN TABS
  ========================================= */

  document.querySelectorAll(".admin-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      if (!adminLoggedIn) return;

      const target = tab.dataset.adminTab;

      document.querySelectorAll(".admin-tab").forEach(t => {
        t.classList.toggle("active", t === tab);
      });

      document.querySelectorAll(".admin-section").forEach(section => {
        section.classList.toggle("active", section.id === target);
      });
    });
  });

  /* =========================================
     ATTENDANCE
  ========================================= */

  on("attendanceForm", "submit", async (e) => {
    e.preventDefault();
    if (!adminLoggedIn || !sb) return;

    const record = {
      subject: $("attendanceSubject").value.trim(),
      date: $("attendanceDate").value,
      status: $("attendanceStatus").value,
      note: $("attendanceNote").value.trim() || null
    };

    if (!record.subject) {
      showToast("Please enter a subject.");
      return;
    }

    const { error } = await sb.from("attendance").insert(record);

if (error) {
  console.error(error);
  showToast("Could not save. Check your admin permission.");
  return;
}

// ===== ATTENDANCE PUSH TRIGGER =====
const { error: pushError } = await sb.functions.invoke(
  "send-attendance-notification",
  {
    body: {
      studentName: record.subject,
      status: record.status,
      date: record.date,
      note: record.note
    }
  }
);

if (pushError) {
  console.error("Push notification error:", pushError);
}

await logActivity(`${record.subject} attendance added — ${record.status}`);

$("attendanceForm").reset();
showToast("Attendance saved!");
await loadAll();
});

  /* =========================================
     SCHEDULE

  /* =========================================
     SCHEDULE
  ========================================= */

  on("scheduleForm", "submit", async (e) => {
    e.preventDefault();
    if (!adminLoggedIn || !sb) return;

    const record = {
      subject: $("scheduleSubject").value.trim(),
      date: $("scheduleDate").value,
      time: $("scheduleTime").value || null,
      details: $("scheduleDetails").value.trim() || null
    };

    if (!record.subject) {
      showToast("Please enter a subject.");
      return;
    }

    const { error } = await sb.from("schedules").insert(record);
    if (error) {
      console.error(error);
      showToast("Could not save. Check your admin permission.");
      return;
    }

    await logActivity(`${record.subject} schedule added`);

    $("scheduleForm").reset();
    showToast("Schedule saved!");
    await loadAll();
  });

  /* =========================================
     DELETE & EDIT ACTIONS
  ========================================= */

  document.addEventListener("click", async (e) => {
    if (!adminLoggedIn || !sb) return;

    const deleteAttendanceBtn = e.target.closest("[data-delete-attendance]");
    const editAttendanceBtn = e.target.closest("[data-edit-attendance]");
    const deleteScheduleBtn = e.target.closest("[data-delete-schedule]");
    const editScheduleBtn = e.target.closest("[data-edit-schedule]");
    const deleteActivityBtn = e.target.closest("[data-delete-activity]");
    const clearActivitiesBtn = e.target.closest("[data-clear-activities]");

    if (deleteActivityBtn) {
      const id = deleteActivityBtn.dataset.deleteActivity;
      const { data, error } = await sb.from("activities").delete().eq("id", id).select();

      if (error || !data?.length) {
        console.error("Activity delete failed:", error);
        showToast("Could not delete activity.");
        return;
      }

      showToast("Activity deleted.");
      await loadAll();
      return;
    }

    if (clearActivitiesBtn) {
      if (!confirm("Delete ALL recent activity?")) return;

      const { data, error } = await sb.from("activities").delete().not("id", "is", null).select();

      if (error || !data?.length) {
        console.error("Clear activities failed:", error);
        showToast("Could not clear activity.");
        return;
      }

      showToast("Activity cleared.");
      await loadAll();
      return;
    }

    if (deleteAttendanceBtn) {
      if (!confirm("Delete this attendance record?")) return;

      const id = deleteAttendanceBtn.dataset.deleteAttendance;
      const { data, error } = await sb.from("attendance").delete().eq("id", id).select();

      if (error || !data?.length) {
        showToast("Could not delete.");
        return;
      }

      await logActivity("An attendance record was deleted");
      showToast("Attendance deleted.");
      await loadAll();
      return;
    }

    if (editAttendanceBtn) {
      const id = editAttendanceBtn.dataset.editAttendance;
      const record = attendance.find(r => r.id === id);
      if (!record) return;

      const subject = prompt("Edit subject:", record.subject);
      if (subject === null) return;

      const date = prompt("Edit date (YYYY-MM-DD):", record.date);
      if (date === null) return;

      const status = prompt(
        "Status (Present / Absent / Class Cancelled):",
        record.status
      );
      if (status === null) return;

      const allowed = ["Present", "Absent", "Class Cancelled"];
      if (!subject.trim()) {
        showToast("Subject cannot be empty.");
        return;
      }
      if (!isValidDate(date.trim())) {
        showToast("Invalid date. Use YYYY-MM-DD.");
        return;
      }
      if (!allowed.includes(status.trim())) {
        showToast("Invalid attendance status.");
        return;
      }

      const { data, error } = await sb.from("attendance")
        .update({
          subject: subject.trim(),
          date: date.trim(),
          status: status.trim()
        })
        .eq("id", id)
        .select();

      if (error || !data?.length) {
        showToast("Could not update.");
        return;
      }

      await logActivity(`${subject.trim()} attendance updated`);
      showToast("Attendance updated.");
      await loadAll();
      return;
    }

    if (deleteScheduleBtn) {
      if (!confirm("Delete this schedule?")) return;

      const id = deleteScheduleBtn.dataset.deleteSchedule;
      const { data, error } = await sb.from("schedules").delete().eq("id", id).select();

      if (error || !data?.length) {
        showToast("Could not delete.");
        return;
      }

      await logActivity("A schedule was deleted");
      showToast("Schedule deleted.");
      await loadAll();
      return;
    }

    if (editScheduleBtn) {
      const id = editScheduleBtn.dataset.editSchedule;
      const record = schedules.find(r => r.id === id);
      if (!record) return;

      const subject = prompt("Edit subject:", record.subject);
      if (subject === null) return;

      const date = prompt("Edit date (YYYY-MM-DD):", record.date);
      if (date === null) return;

      const time = prompt("Edit time (HH:MM):", (record.time || "").slice(0, 5));
      if (time === null) return;

      const details = prompt("Edit details:", record.details || "");
      if (details === null) return;

      if (!subject.trim()) {
        showToast("Subject cannot be empty.");
        return;
      }
      if (!isValidDate(date.trim())) {
        showToast("Invalid date. Use YYYY-MM-DD.");
        return;
      }
      if (time.trim() && !isValidTime(time.trim())) {
        showToast("Invalid time. Use HH:MM (24h).");
        return;
      }

      const { data, error } = await sb.from("schedules")
        .update({
          subject: subject.trim(),
          date: date.trim(),
          time: time.trim() || null,
          details: details.trim() || null
        })
        .eq("id", id)
        .select();

      if (error || !data?.length) {
        showToast("Could not update.");
        return;
      }

      await logActivity(`${subject.trim()} schedule updated`);
      showToast("Schedule updated.");
      await loadAll();
    }
  });

  /* =========================================
     RENDER ATTENDANCE
  ========================================= */

  function renderAttendance() {
    const container = $("attendanceList");
    if (!container) return;

    if (!attendance.length) {
      container.innerHTML =
        '<p class="empty-state">No attendance records available.</p>';
      return;
    }

    container.innerHTML = attendance.map(record => `
      <article class="record-item">
        <h4>${escapeHTML(record.subject)}</h4>
        <p>${escapeHTML(record.note || "No additional note.")}</p>

        <div class="record-meta">
          <span>${escapeHTML(formatDate(record.date))}</span>
          <span class="${record.status === "Present" ? "status-present" :
            record.status === "Absent" ? "status-absent" : ""}">
            ${escapeHTML(record.status)}
          </span>
        </div>

        ${adminLoggedIn ? `
          <div class="record-actions">
            <button class="outline-btn" data-edit-attendance="${escapeHTML(record.id)}">Edit</button>
            <button class="outline-btn" data-delete-attendance="${escapeHTML(record.id)}">Delete</button>
          </div>
        ` : ""}
      </article>
    `).join("");
  }

  /* =========================================
     RENDER SCHEDULE
  ========================================= */

  function renderSchedules() {
    const container = $("scheduleList");
    if (!container) return;

    const sorted = [...schedules].sort((a, b) =>
      ((a.date || "") + (a.time || "")).localeCompare((b.date || "") + (b.time || ""))
    );

    if (!sorted.length) {
      container.innerHTML =
        '<p class="empty-state">No schedules available.</p>';
      return;
    }

    container.innerHTML = sorted.map(record => `
      <article class="record-item">
        <h4>${escapeHTML(record.subject)}</h4>
        <p>${escapeHTML(record.details || "No additional details.")}</p>

        <div class="record-meta">
          <span>${escapeHTML(formatDate(record.date))}</span>
          <span>${escapeHTML(formatTime(record.time))}</span>
        </div>

        ${adminLoggedIn ? `
          <div class="record-actions">
            <button class="outline-btn" data-edit-schedule="${escapeHTML(record.id)}">Edit</button>
            <button class="outline-btn" data-delete-schedule="${escapeHTML(record.id)}">Delete</button>
          </div>
        ` : ""}
      </article>
    `).join("");
  }

  /* =========================================
     RENDER HISTORY
  ========================================= */

  function renderHistory() {
    const container = $("historyList");
    if (!container) return;

    if (!attendance.length) {
      container.innerHTML =
        '<p class="empty-state">Your history will appear here.</p>';
      return;
    }

    container.innerHTML = attendance.map(record => `
      <article class="record-item">
        <h4>${escapeHTML(record.subject)}</h4>
        <div class="record-meta">
          <span>${escapeHTML(formatDate(record.date))}</span>
          <span>${escapeHTML(record.status)}</span>
        </div>
      </article>
    `).join("");
  }

  /* =========================================
     RECENT ACTIVITY
  ========================================= */

  function renderActivity() {
    const container = $("recentActivity");
    if (!container) return;

    if (!activities.length) {
      container.innerHTML =
        '<p class="empty-state">No activity yet.</p>';
      return;
    }

    container.innerHTML = activities.slice(0, 5).map(item => {
      const date = new Date(item.created_at);
      const formatted = isNaN(date.getTime())
        ? ""
        : date.toLocaleString();

      return `
        <div class="activity-item">
          <div class="activity-dot"></div>
          <div class="activity-text">
            <p>${escapeHTML(item.message)}</p>
            <small>${escapeHTML(formatted)}</small>
          </div>
        </div>
      `;
    }).join("");
  }

  /* Admin panel: manage (delete) recent activity */
  function renderAdminActivity() {
    const box = $("adminActivityList");
    if (!box) return;

    if (!adminLoggedIn || !activities.length) {
      box.innerHTML = '<p class="empty-state">No activity to manage.</p>';
      return;
    }

    box.innerHTML =
      '<div class="activity-toolbar"><button type="button" class="activity-clear" data-clear-activities>Clear all</button></div>' +
      activities.map(item => {
        const date = new Date(item.created_at);
        const formatted = isNaN(date.getTime()) ? "" : date.toLocaleString();

        return `
          <div class="activity-item">
            <div class="activity-dot"></div>
            <div class="activity-text">
              <p>${escapeHTML(item.message)}</p>
              <small>${escapeHTML(formatted)}</small>
            </div>
            <button type="button" class="activity-delete" data-delete-activity="${escapeHTML(String(item.id))}" aria-label="Delete activity">✕</button>
          </div>
        `;
      }).join("");
  }

  /* =========================================
     DASHBOARD COUNTERS
  ========================================= */

  function renderStats() {
    const set = (id, value) => {
      const el = $(id);
      if (el) el.textContent = value;
    };

    const present = attendance.filter(r => r.status === "Present").length;

    set("totalClasses", attendance.length);
    set("totalAttendance", present);
    set("totalSchedules", schedules.length);
  }

  /* =========================================
     RENDER ALL
  ========================================= */

  function renderAll() {
    renderAttendance();
    renderSchedules();
    renderHistory();
    renderActivity();
    renderAdminActivity();
    renderStats();
  }

  /* =========================================
     ANIMATED PARTICLES
  ========================================= */

  function initParticles() {
    const canvas = $("particles");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let particles = [];
    let raf = 0;

    function resize() {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;

      const count = Math.min(48, Math.floor(width / 16));

      particles = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: Math.random() * 1.5 + .3,
        speed: Math.random() * .35 + .1,
        alpha: Math.random() * .35 + .1
      }));
    }

    function draw() {
      ctx.clearRect(0, 0, width, height);

      particles.forEach(p => {
        p.y -= p.speed;

        if (p.y < -5) {
          p.y = height + 5;
          p.x = Math.random() * width;
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(218,145,172,${p.alpha})`;
        ctx.shadowBlur = 8;
        ctx.shadowColor = "rgba(165,67,105,.5)";
        ctx.fill();
      });

      raf = requestAnimationFrame(draw);
    }

    resize();
    draw();

    window.addEventListener("resize", resize);

    document.addEventListener("visibilitychange", () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) draw();
    });
  }

  /* =========================================
     INIT
  ========================================= */

  renderAll();
  initParticles();

  if (!sb) {
    showToast("Database is not connected yet. Add your Supabase key in script.js.");
  } else {
    loadAll();
    subscribeRealtime();
    checkAdmin().then(applyAdminState);
  }
})();

/* =========================================
   3D LIQUID ORB UP BUTTON
========================================= */
(() => {
  const btn = document.getElementById("liquidUp");
  const canvas = document.getElementById("liquidOrb");

  if (!btn || !canvas || !window.THREE) return;

  let visible = false;

  window.addEventListener("scroll", () => {
    visible = window.scrollY > 300;
    btn.classList.toggle("show", visible);
  }, { passive: true });

  btn.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.z = 4;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true
  });

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(130, 130, false);
  renderer.setClearColor(0x000000, 0);
  if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;

  const material = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: `
      uniform float time;
      varying vec3 vNormal;
      varying vec3 vPos;

      void main() {
        vec3 p = position;

        float wave =
          sin(p.x * 3.0 + time) * 0.06 +
          cos(p.y * 4.0 + time * 0.8) * 0.045 +
          sin(p.z * 3.0 + time * 0.7) * 0.035;

        p += normal * wave;

        vNormal = normalize(normalMatrix * normal);
        vPos = p;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: `
      uniform float time;
      varying vec3 vNormal;
      varying vec3 vPos;

      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = vec3(0.0, 0.0, 1.0);

        float fresnel = pow(1.0 - max(dot(N, V), 0.0), 2.5);

        float pattern =
          sin(vPos.y * 5.0 + time) *
          cos(vPos.x * 5.0 - time * 0.7);

        vec3 base = vec3(0.10, 0.005, 0.025);
        vec3 wine = vec3(0.55, 0.015, 0.10);
        vec3 pink = vec3(1.0, 0.30, 0.55);

        vec3 color = mix(base, wine, pattern * 0.5 + 0.5);
        color += pink * fresnel * 0.8;

        float shine = pow(
          max(dot(N, normalize(vec3(-0.4, 0.8, 1.0))), 0.0),
          18.0
        );

        color += vec3(1.0) * shine;

        gl_FragColor = vec4(color, 0.96);
      }
    `,
    transparent: true
  });

  const orb = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 64), material);
  scene.add(orb);

  const clock = new THREE.Clock();

  function animate() {
    if (!document.body.contains(btn)) return;

    requestAnimationFrame(animate);

    if (!visible) return;

    const t = clock.getElapsedTime();

    orb.rotation.y = t * 0.35;
    orb.rotation.x = Math.sin(t * 0.6) * 0.18;
    orb.position.y = Math.sin(t * 1.2) * 0.06;

    material.uniforms.time.value = t;

    renderer.render(scene, camera);
  }

  animate();
})();

/* =========================================
   MT LOADER (CSS orb loader)
========================================= */
(() => {
  const settings = {
    duration: 2200,        // milliseconds
    title: "MY SIR TRACKER"
  };

  const loader = document.getElementById("mtLoader");
  if (!loader) return;

  const title = loader.querySelector(".liquid-title") || loader.querySelector("h1");
  const bar = document.getElementById("mtProgress");
  const percent = document.getElementById("mtPercent");

  const start = performance.now();
  let pageLoaded = document.readyState === "complete";
  if (!pageLoaded) {
    window.addEventListener("load", () => { pageLoaded = true; }, { once: true });
  }

  function update(now) {
    let progress = Math.min((now - start) / settings.duration, 1);
    if (!pageLoaded) progress = Math.min(progress, 0.9);
    const value = Math.floor(progress * 100);

    if (bar) bar.style.width = value + "%";
    if (percent) percent.textContent = value + "%";

    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      setTimeout(() => {
        loader.classList.add("mtHide");
        setTimeout(() => loader.remove(), 850);
      }, 200);
    }
  }

  requestAnimationFrame(update);
})();
/* =========================================
   MY SIR TRACKER — theme changer + liquid glass refraction
========================================= */
(() => {
  "use strict";

  const root = document.documentElement;
  const $ = (id) => document.getElementById(id);

  /* ---------- THEMES ---------- */
  const THEMES = [
    { id: "wine",   name: "Wine",   s1: "#d58aa6", s2: "#7f2947" },
    { id: "ocean",  name: "Ocean",  s1: "#5cc8ff", s2: "#0a5a8f" },
    { id: "aurora", name: "Aurora", s1: "#5fe3a1", s2: "#0f7a55" },
    { id: "violet", name: "Violet", s1: "#b794ff", s2: "#5b2bd1" },
    { id: "sunset", name: "Sunset", s1: "#ffa05c", s2: "#be185d" },
    { id: "light",  name: "Light",  s1: "#ffffff", s2: "#e6b6cb" }
  ];

  const panel = $("themePanel");
  const list = $("themeList");
  const btn = $("themeBtn");

  function currentTheme() {
    const t = root.dataset.theme;
    return THEMES.some(x => x.id === t) ? t : "wine";
  }

  function markActive() {
    if (!list) return;
    const cur = currentTheme();
    list.querySelectorAll(".swatch").forEach(s => s.classList.toggle("on", s.dataset.theme === cur));
  }

  function applyTheme(id) {
    root.dataset.theme = id;
    try { localStorage.setItem("mst-theme", id); } catch { /* storage blocked */ }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(root).getPropertyValue("--bgA").trim() || "#0b0609";
    markActive();
  }

  if (list) {
    list.innerHTML = THEMES.map(t => `
      <button class="swatch" type="button" data-theme="${t.id}" style="--s1:${t.s1};--s2:${t.s2}">
        <i></i><span>${t.name}</span>
      </button>`).join("");

    list.addEventListener("click", (e) => {
      const s = e.target.closest(".swatch");
      if (s) applyTheme(s.dataset.theme);
    });
  }

  function togglePanel(open) {
    if (!panel) return;
    const show = open ?? panel.classList.contains("hidden");
    panel.classList.toggle("hidden", !show);
    btn?.setAttribute("aria-expanded", String(show));
  }

  btn?.addEventListener("click", (e) => { e.stopPropagation(); togglePanel(); });
  document.addEventListener("click", (e) => {
    if (panel && !panel.contains(e.target) && !btn?.contains(e.target)) togglePanel(false);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") togglePanel(false); });

  applyTheme(currentTheme());

  /* ---------- SCROLL-TO-TOP (glass button) ---------- */
  const up = $("liquidUp");
  if (up) {
    window.addEventListener("scroll", () => {
      up.classList.toggle("show", window.scrollY > 300);
    }, { passive: true });
    up.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  }

  /* ---------- REFRACTION (Chromium only: SVG displacement, no blur) ---------- */
  if (!root.classList.contains("refract")) return;

  const NS = "http://www.w3.org/2000/svg";
  const defs = document.querySelector("#lgDefs defs");
  if (!defs) return;

  let count = 0;

  const ramp = (w, h, axis, stops) => {
    const ch = axis === "x" ? (v) => `rgb(${v},0,0)` : (v) => `rgb(0,${v},0)`;
    const st = stops.map(([o, v]) => `<stop offset="${o}" stop-color="${ch(v)}"/>`).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="${axis === "x" ? 1 : 0}" y2="${axis === "x" ? 0 : 1}">${st}</linearGradient></defs>` +
      `<rect width="100%" height="100%" fill="url(#g)"/></svg>`;
    return "data:image/svg+xml," + encodeURIComponent(svg);
  };

  function build(el) {
    const r = el.getBoundingClientRect();
    const w = Math.round(r.width), h = Math.round(r.height);
    if (w < 8 || h < 8) return;

    const orb = el.classList.contains("lq-lens");
    const round = orb || el.id === "liquidUp";
    let sx, sy, scale;

    if (round) {
      sx = [[0, 255], [1, 0]];
      sy = [[0, 255], [1, 0]];
      scale = orb ? 46 : 22;
    } else {
      const ex = Math.min(.5, 26 / w), ey = Math.min(.5, 26 / h);
      sx = [[0, 36], [ex, 128], [1 - ex, 128], [1, 220]];
      sy = [[0, 36], [ey, 128], [1 - ey, 128], [1, 220]];
      scale = 34;
    }

    let f = el._lg;
    if (!f) {
      f = document.createElementNS(NS, "filter");
      f.id = "lg" + (++count);
      f.setAttribute("filterUnits", "userSpaceOnUse");
      f.setAttribute("color-interpolation-filters", "sRGB");
      defs.appendChild(f);
      el._lg = f;
      el.style.setProperty("--lg", `url(#${f.id})`);
    }

    f.setAttribute("x", 0);
    f.setAttribute("y", 0);
    f.setAttribute("width", w);
    f.setAttribute("height", h);
    f.innerHTML =
      `<feImage href="${ramp(w, h, "x", sx)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="mx"/>` +
      `<feImage href="${ramp(w, h, "y", sy)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="my"/>` +
      `<feComposite in="mx" in2="my" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="map"/>` +
      `<feDisplacementMap in="SourceGraphic" in2="map" scale="${scale}" xChannelSelector="R" yChannelSelector="G"/>`;
  }

  const ro = new ResizeObserver((entries) => {
    entries.forEach(en => requestAnimationFrame(() => build(en.target)));
  });

  document.querySelectorAll(".glass, .toast, #liquidUp, .lq-lens").forEach(el => ro.observe(el));
})();
/* ===== MST STAR GENERATOR ===== */
(() => {
  if (document.getElementById("mstStarLayer")) return;

  const layer = document.createElement("div");
  layer.id = "mstStarLayer";
  document.body.prepend(layer);

  // 100 twinkling stars
  for (let i = 0; i < 100; i++) {
    const star = document.createElement("span");
    star.className = "mst-star";

    const size = Math.random() * 2.5 + 0.5;

    star.style.left = Math.random() * 100 + "%";
    star.style.top = Math.random() * 100 + "%";
    star.style.width = size + "px";
    star.style.height = size + "px";

    star.style.setProperty(
      "--twinkle-speed",
      (Math.random() * 3 + 1.5) + "s"
    );

    star.style.setProperty(
      "--star-opacity",
      (Math.random() * 0.6 + 0.2)
    );

    star.style.animationDelay = Math.random() * 4 + "s";

    layer.appendChild(star);
  }

  // Shooting stars
  for (let i = 0; i < 3; i++) {
    const meteor = document.createElement("span");
    meteor.className = "mst-shooting-star";

    meteor.style.top = Math.random() * 65 + "%";
    meteor.style.left = (Math.random() * 100 + 20) + "%";
    meteor.style.animationDelay = (i * 4 + Math.random() * 4) + "s";

    layer.appendChild(meteor);
  }
})();
/* ===== MST STAR GENERATOR ===== */
(() => {
  if (document.getElementById("mstStarLayer")) return;

  const layer = document.createElement("div");
  layer.id = "mstStarLayer";
  document.body.prepend(layer);

  // 100 twinkling stars
  for (let i = 0; i < 100; i++) {
    const star = document.createElement("span");
    star.className = "mst-star";

    const size = Math.random() * 2.5 + 0.5;

    star.style.left = Math.random() * 100 + "%";
    star.style.top = Math.random() * 100 + "%";
    star.style.width = size + "px";
    star.style.height = size + "px";

    star.style.setProperty(
      "--twinkle-speed",
      (Math.random() * 3 + 1.5) + "s"
    );

    star.style.setProperty(
      "--star-opacity",
      (Math.random() * 0.6 + 0.2)
    );

    star.style.animationDelay = Math.random() * 4 + "s";

    layer.appendChild(star);
  }

  // Shooting stars
  for (let i = 0; i < 3; i++) {
    const meteor = document.createElement("span");
    meteor.className = "mst-shooting-star";

    meteor.style.top = Math.random() * 65 + "%";
    meteor.style.left = (Math.random() * 100 + 20) + "%";
    meteor.style.animationDelay = (i * 4 + Math.random() * 4) + "s";

    layer.appendChild(meteor);
  }
})();
/* =================================
   MST — COSMIC TOUCH SYSTEM
================================= */

(() => {
  if (window.mstTouchEffectLoaded) return;
  window.mstTouchEffectLoaded = true;

  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  if (reduceMotion) return;

  function createTouchEffect(x, y) {
    const ring = document.createElement("div");
    ring.className = "mst-touch-ring";
    ring.style.left = x + "px";
    ring.style.top = y + "px";

    const core = document.createElement("div");
    core.className = "mst-touch-core";
    core.style.left = x + "px";
    core.style.top = y + "px";

    document.body.append(ring, core);

    ring.addEventListener("animationend", () => ring.remove());
    core.addEventListener("animationend", () => core.remove());

    // Tiny particles
    for (let i = 0; i < 8; i++) {
      const particle = document.createElement("span");
      particle.className = "mst-touch-particle";

      const angle = (Math.PI * 2 * i) / 8;
      const distance = 25 + Math.random() * 45;

      particle.style.setProperty("--tx", x + "px");
      particle.style.setProperty("--ty", y + "px");
      particle.style.setProperty("--tdx", Math.cos(angle) * distance + "px");
      particle.style.setProperty("--tdy", Math.sin(angle) * distance + "px");

      document.body.appendChild(particle);
      particle.addEventListener("animationend", () => particle.remove());
    }
  }

  document.addEventListener("pointerdown", (e) => {
    // Ignore UI controls
    if (e.target.closest(
      "button, a, input, textarea, select, label"
    )) return;

    createTouchEffect(e.clientX, e.clientY);
  }, { passive: true });
})();
/* ===== LOADER STAR BURST SYSTEM ===== */

(() => {
  if (window.mstBurstLoaded) return;
  window.mstBurstLoaded = true;

  const loader = document.getElementById("mtLoader");
  const orb = loader?.querySelector(".liquid-orb");
  const bg = loader?.querySelector(".liquid-bg");

  if (!loader || !orb || !bg) return;

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  const layer = document.createElement("div");
  layer.className = "mstBurst-layer";
  bg.appendChild(layer);

  // Floating stars
  for (let i = 0; i < 55; i++) {
    const star = document.createElement("span");

    star.className = "mstBurst-star mstBurst-drift";
    star.style.left = Math.random() * 100 + "%";
    star.style.top = Math.random() * 100 + "%";

    star.style.setProperty(
      "--duration",
      (1.5 + Math.random() * 4) + "s"
    );

    star.style.setProperty(
      "--drift",
      (4 + Math.random() * 9) + "s"
    );

    layer.appendChild(star);
  }

  // Star burst around logo
  function createBurst() {
    const loaderRect = loader.getBoundingClientRect();
    const orbRect = orb.getBoundingClientRect();

    const centerX =
      orbRect.left + orbRect.width / 2 - loaderRect.left;

    const centerY =
      orbRect.top + orbRect.height / 2 - loaderRect.top;

    for (let i = 0; i < 18; i++) {
      const particle = document.createElement("span");
      particle.className = "mstBurst-particle";

      const angle = (Math.PI * 2 * i) / 18;
      const distance = 45 + Math.random() * 65;

      particle.style.left = centerX + "px";
      particle.style.top = centerY + "px";

      particle.style.setProperty(
        "--dx",
        Math.cos(angle) * distance + "px"
      );

      particle.style.setProperty(
        "--dy",
        Math.sin(angle) * distance + "px"
      );

      layer.appendChild(particle);

      particle.addEventListener("animationend", () => {
        particle.remove();
      }, { once: true });
    }
  }

  setTimeout(createBurst, 700);

  const burstTimer = setInterval(() => {
    if (!loader.isConnected || loader.classList.contains("mtHide")) {
      clearInterval(burstTimer);
      return;
    }
    createBurst();
  }, 4500);

})();

/* ===== SHOOTING STAR GENERATOR ===== */

(() => {
  const galaxy = document.getElementById("galaxyStars");

  if (!galaxy || galaxy.dataset.shootingReady) return;

  galaxy.dataset.shootingReady = "true";

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  for (let i = 0; i < 16; i++) {
    const star = document.createElement("span");

    star.className = "shooting-star";

    star.style.top = Math.random() * 85 + "%";
    star.style.left = (35 + Math.random() * 75) + "%";

    star.style.setProperty(
      "--duration",
      (4 + Math.random() * 5) + "s"
    );

    star.style.setProperty(
      "--delay",
      (Math.random() * 15) + "s"
    );

    galaxy.appendChild(star);
  }
})();

/* ===== SHOOTING STAR GENERATOR ===== */

(() => {
  const galaxy = document.getElementById("galaxyStars");

  if (!galaxy || galaxy.dataset.shootingReady) return;

  galaxy.dataset.shootingReady = "true";

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  for (let i = 0; i < 16; i++) {
    const star = document.createElement("span");

    star.className = "shooting-star";

    star.style.top = Math.random() * 85 + "%";
    star.style.left = (35 + Math.random() * 75) + "%";

    star.style.setProperty(
      "--duration",
      (4 + Math.random() * 5) + "s"
    );

    star.style.setProperty(
      "--delay",
      (Math.random() * 15) + "s"
    );

    galaxy.appendChild(star);
  }
})();

/* REGISTER NOTIFICATION SERVICE WORKER */

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("./sw.js");
      console.log("Notification Service Worker Ready");
    } catch (error) {
      console.error("Service Worker Error:", error);
    }
  });
}

/* ===== MY SIR TRACKER — STUDENT PUSH SETUP ===== */

(() => {
  const enableBtn = document.getElementById("enableNotifications");
  const statusText = document.getElementById("notificationStatus");
  const studentSelect = document.getElementById("studentName");

  if (!enableBtn || !statusText || !studentSelect) return;

  const SUPABASE_FUNCTION_URL =
    "https://isdepqpvuiggxgnnsnrr.supabase.co/functions/v1/register-push-subscription";

  // নতুন Public VAPID Key বসাবে এখানে
  const VAPID_PUBLIC_KEY = 'BL6xs6fdW3MA5e-g63Yliq3DEm4iDOvl2Hm6nqOKJ9z2aEp71IOGI1_FV-ohhkCCCPkgcsrVNip9SfGsW14WZlO';

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, "+")
      .replace(/_/g, "/");

    const raw = atob(base64);
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  }

  enableBtn.addEventListener("click", async () => {
    const studentName = studentSelect.value;

    if (!studentName) {
      statusText.textContent = "Please select your name first.";
      return;
    }

    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      statusText.textContent = "Notifications are not supported.";
      return;
    }

    enableBtn.disabled = true;
    statusText.textContent = "Setting up notifications...";

    try {
      const permission = await Notification.requestPermission();

      if (permission !== "granted") {
        statusText.textContent = "Notification permission not granted.";
        return;
      }

      const registration = await navigator.serviceWorker.ready;

      let subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey:
            urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        });
      }

      const response = await fetch(SUPABASE_FUNCTION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": "YOUR_SUPABASE_ANON_KEY"
        },
        body: JSON.stringify({
          studentName,
          subscription: subscription.toJSON()
        })
      });

      if (!response.ok) {
        throw new Error("Subscription save failed");
      }

      statusText.textContent =
        "Notifications enabled successfully! ✓";

      enableBtn.textContent = "Notifications Enabled ✓";

    } catch (error) {
      console.error(error);
      statusText.textContent =
        "Setup failed. Please try again.";
    } finally {
      enableBtn.disabled = false;
    }
  });
})(); 

/* =========================================
   LOADER EXTRA — status text, quote, floating study icons
   (paste at the END of script.js)
========================================= */
(() => {
  const loader = document.getElementById("mtLoader");
  const content = loader && loader.querySelector(".loader-content");
  const percent = document.getElementById("mtPercent");
  if (!loader || !content || !percent || loader.dataset.extraReady) return;
  loader.dataset.extraReady = "true";

  /* ---- status line that follows the progress ---- */
  const steps = [
    { at: 0,   text: "📖 Opening your books..." },
    { at: 25,  text: "🔄 Syncing attendance..." },
    { at: 50,  text: "🗓️ Checking today's schedule..." },
    { at: 75,  text: "✏️ Sharpening pencils..." },
    { at: 100, text: "✨ Ready! Let's study" }
  ];

  const status = document.createElement("div");
  status.className = "mst-loader-status";
  status.setAttribute("aria-live", "polite");
  content.appendChild(status);

  let lastStep = -1;
  function showStatus(value) {
    let idx = 0;
    steps.forEach((s, i) => { if (value >= s.at) idx = i; });
    if (idx === lastStep) return;
    lastStep = idx;
    status.innerHTML = "";
    const span = document.createElement("span");
    span.textContent = steps[idx].text;
    status.appendChild(span);
  }
  showStatus(0);

  new MutationObserver(() => {
    showStatus(parseInt(percent.textContent, 10) || 0);
  }).observe(percent, { childList: true, characterData: true, subtree: true });

  /* ---- a random study line ---- */
  const quotes = [
    "Small steps every day beat big plans someday.",
    "Today's effort is tomorrow's result.",
    "Focus for 25 minutes, then take a short break.",
    "Don't stop when you're tired. Stop when you're done.",
    "Every expert was once a beginner.",
    "Consistency is your superpower.",
    "Study now, relax later.",
    "One more page, one more step closer."
  ];

  const quote = document.createElement("div");
  quote.className = "mst-loader-quote";
  quote.textContent = "“" + quotes[Math.floor(Math.random() * quotes.length)] + "”";
  content.appendChild(quote);

  /* ---- floating study icons in the background ---- */
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const layer = document.createElement("div");
  layer.className = "mst-float-layer";
  loader.insertBefore(layer, loader.firstChild);

  const icons = ["📚", "✏️", "🎓", "⭐", "💡", "📝", "🔖", "☕"];
  for (let i = 0; i < 14; i++) {
    const el = document.createElement("span");
    el.className = "mst-float-icon";
    el.textContent = icons[i % icons.length];
    el.style.left = (4 + Math.random() * 92) + "%";
    el.style.fontSize = (16 + Math.random() * 18) + "px";
    el.style.animationDuration = (7 + Math.random() * 7) + "s";
    el.style.animationDelay = (Math.random() * 8) + "s";
    el.style.setProperty("--rot", (Math.random() * 90 - 45) + "deg");
    layer.appendChild(el);
  }
})();

/* =========================================
   SMOOTH PATCH — paste at the END of script.js
   Particles behind the loader stop using the expensive canvas glow
   (shadowBlur) while the loader is visible. After the loader is gone
   the normal glow comes back.
========================================= */
(() => {
  if (window.mstSmoothPatch) return;
  window.mstSmoothPatch = true;

  try {
    const proto = CanvasRenderingContext2D.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "shadowBlur");
    if (!desc || !desc.set) return;

    Object.defineProperty(proto, "shadowBlur", {
      configurable: true,
      enumerable: desc.enumerable,
      get() { return desc.get.call(this); },
      set(value) {
        const loader = document.getElementById("mtLoader");
        desc.set.call(this, loader && loader.isConnected ? 0 : value);
      }
    });
  } catch (err) {
    console.warn("Smooth patch skipped:", err);
  }
})();

/* =========================================
   LOADER MORE — greeting pill + step dots
   (paste at the END of script.js)
========================================= */
(() => {
  const loader = document.getElementById("mtLoader");
  const content = loader && loader.querySelector(".loader-content");
  const percent = document.getElementById("mtPercent");
  if (!loader || !content || !percent || loader.dataset.moreReady) return;
  loader.dataset.moreReady = "true";

  /* ---- greeting + today's date ---- */
  const now = new Date();
  const h = now.getHours();
  const hello =
    h < 5  ? "🌙 Late night study" :
    h < 12 ? "☀️ Good morning" :
    h < 17 ? "🌤️ Good afternoon" :
    h < 21 ? "🌆 Good evening" : "🌙 Good night";

  const date = now.toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short"
  });

  const greeting = document.createElement("div");
  greeting.className = "mst-greeting";
  greeting.innerHTML = "<b></b><i>•</i><span></span>";
  greeting.querySelector("b").textContent = hello;
  greeting.querySelector("span").textContent = date;

  const orb = content.querySelector(".liquid-orb");
  if (orb && orb.nextSibling) {
    content.insertBefore(greeting, orb.nextSibling);
  } else {
    content.insertBefore(greeting, content.firstChild);
  }
  // keep the pill centered even if the content is a flex column
  greeting.style.alignSelf = "center";

  /* ---- 5 dots that light up with the progress ---- */
  const dots = document.createElement("div");
  dots.className = "mst-dots";
  const items = [0, 25, 50, 75, 100].map(() => {
    const d = document.createElement("span");
    dots.appendChild(d);
    return d;
  });
  content.appendChild(dots);

  function update(value) {
    const marks = [0, 25, 50, 75, 100];
    let current = 0;
    marks.forEach((m, i) => { if (value >= m) current = i; });

    items.forEach((d, i) => {
      d.classList.toggle("on", i <= current);
      d.classList.toggle("now", i === current && value < 100);
    });
  }
  update(0);

  new MutationObserver(() => {
    update(parseInt(percent.textContent, 10) || 0);
  }).observe(percent, { childList: true, characterData: true, subtree: true });
})();

/* =========================================
   LOADER EFFECTS — logo shine, sparkles, touch parallax, finish burst
   (paste at the END of script.js)
========================================= */
(() => {
  const loader = document.getElementById("mtLoader");
  const orb = loader && loader.querySelector(".liquid-orb");
  const percent = document.getElementById("mtPercent");
  if (!loader || !orb || !percent || loader.dataset.fxReady) return;
  loader.dataset.fxReady = "true";

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---- 1) shine sweep over the logo ---- */
  const shine = document.createElement("div");
  shine.className = "mst-logo-shine";
  orb.appendChild(shine);

  /* ---- 2) sparkles around the logo ---- */
  const spots = [
    { x: 6,  y: 10 }, { x: 92, y: 6  }, { x: 100, y: 55 },
    { x: 82, y: 98 }, { x: 14, y: 92 }, { x: -2,  y: 50 }
  ];
  spots.forEach((s, i) => {
    const sp = document.createElement("span");
    sp.className = "mst-sparkle";
    sp.textContent = i % 2 ? "✦" : "✧";
    sp.style.left = s.x + "%";
    sp.style.top = s.y + "%";
    sp.style.fontSize = (12 + (i % 3) * 5) + "px";
    sp.style.animationDelay = (0.4 + i * 0.45) + "s";
    sp.style.animationDuration = (2.2 + (i % 3) * 0.6) + "s";
    orb.appendChild(sp);
  });

  /* ---- 3) touch / mouse parallax ---- */
  if (!reduce) {
    let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;

    function frame() {
      cx += (tx - cx) * 0.12;
      cy += (ty - cy) * 0.12;
      loader.style.setProperty("--px", cx.toFixed(3));
      loader.style.setProperty("--py", cy.toFixed(3));

      raf = (Math.abs(tx - cx) > 0.002 || Math.abs(ty - cy) > 0.002)
        ? requestAnimationFrame(frame)
        : 0;
    }

    function move(e) {
      tx = (e.clientX / window.innerWidth  - 0.5) * 2;
      ty = (e.clientY / window.innerHeight - 0.5) * 2;
      if (!raf) raf = requestAnimationFrame(frame);
    }

    function release() {
      tx = 0; ty = 0;
      if (!raf) raf = requestAnimationFrame(frame);
    }

    loader.addEventListener("pointermove", move, { passive: true });
    loader.addEventListener("pointerup", release, { passive: true });
    loader.addEventListener("pointerleave", release, { passive: true });
  }

  /* ---- 4) finish burst at 100% ---- */
  let done = false;

  function finish() {
    if (done || reduce) return;
    done = true;

    const flash = document.createElement("div");
    flash.className = "mst-flash";
    loader.appendChild(flash);
    flash.addEventListener("animationend", () => flash.remove(), { once: true });

    const box = document.createElement("div");
    box.className = "mst-finish";
    const icons = ["✨", "⭐", "🎓", "📚", "💡", "✦"];

    for (let i = 0; i < 18; i++) {
      const s = document.createElement("span");
      const angle = (Math.PI * 2 * i) / 18 + Math.random() * 0.3;
      const dist = 90 + Math.random() * 110;
      s.textContent = icons[i % icons.length];
      s.style.setProperty("--fx", Math.cos(angle) * dist + "px");
      s.style.setProperty("--fy", Math.sin(angle) * dist + "px");
      s.style.setProperty("--fr", (Math.random() * 200 - 100) + "deg");
      s.style.animationDelay = (Math.random() * 0.12) + "s";
      box.appendChild(s);
    }

    loader.appendChild(box);
    setTimeout(() => box.remove(), 1400);
  }

  new MutationObserver(() => {
    if ((parseInt(percent.textContent, 10) || 0) >= 100) finish();
  }).observe(percent, { childList: true, characterData: true, subtree: true });
})();

/* =========================================
   WEBSITE EFFECTS — scroll bar, touch glow, 3D tilt, list reveal
   (paste at the END of script.js)
========================================= */
(() => {
  if (window.mstWebsiteFx) return;
  window.mstWebsiteFx = true;

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;

  /* ---- 1) scroll progress bar ---- */
  const bar = document.createElement("div");
  bar.className = "mst-scroll-bar";
  document.body.appendChild(bar);

  let ticking = false;
  function updateBar() {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const p = max > 0 ? Math.min(window.scrollY / max, 1) : 0;
    bar.style.transform = "scaleX(" + p.toFixed(4) + ")";
    ticking = false;
  }
  window.addEventListener("scroll", () => {
    if (!ticking) { ticking = true; requestAnimationFrame(updateBar); }
  }, { passive: true });
  window.addEventListener("resize", updateBar, { passive: true });
  updateBar();

  /* ---- 2) glow that follows the pointer ---- */
  const glow = document.createElement("div");
  glow.className = "mst-pointer-glow";
  document.body.appendChild(glow);

  let gx = 0, gy = 0, glowRaf = 0, idle;
  function moveGlow() {
    glow.style.transform = "translate3d(" + gx + "px," + gy + "px,0)";
    glowRaf = 0;
  }
  document.addEventListener("pointermove", (e) => {
    gx = e.clientX; gy = e.clientY;
    if (!glowRaf) glowRaf = requestAnimationFrame(moveGlow);
    glow.classList.add("on");
    clearTimeout(idle);
    idle = setTimeout(() => glow.classList.remove("on"), 1400);
  }, { passive: true });
  document.addEventListener("pointerdown", (e) => {
    gx = e.clientX; gy = e.clientY;
    if (!glowRaf) glowRaf = requestAnimationFrame(moveGlow);
    glow.classList.add("on");
    clearTimeout(idle);
    idle = setTimeout(() => glow.classList.remove("on"), 1400);
  }, { passive: true });

  /* ---- 3) 3D tilt on cards ---- */
  const tiltTargets = ".stat-card, .quick-card";
  let tilted = null;

  function tilt(e) {
    const card = e.target.closest && e.target.closest(tiltTargets);
    if (tilted && tilted !== card) resetTilt();
    if (!card) return;

    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width  - 0.5;
    const y = (e.clientY - r.top)  / r.height - 0.5;

    card.style.setProperty("--ry", (x * 16).toFixed(2) + "deg");
    card.style.setProperty("--rx", (-y * 16).toFixed(2) + "deg");
    card.classList.add("mst-tilting");
    tilted = card;
  }

  function resetTilt() {
    if (!tilted) return;
    tilted.classList.remove("mst-tilting");
    tilted.style.removeProperty("--rx");
    tilted.style.removeProperty("--ry");
    tilted = null;
  }

  document.addEventListener("pointermove", tilt, { passive: true });
  document.addEventListener("pointerup", resetTilt, { passive: true });
  document.addEventListener("pointercancel", resetTilt, { passive: true });
  document.addEventListener("pointerleave", resetTilt, { passive: true });

  /* ---- 4) lists slide in once per item ---- */
  const seen = new Set();
  const io = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          const el = en.target;
          io.unobserve(el);
          el.classList.add("mst-in");
          setTimeout(() => {
            el.classList.remove("mst-reveal", "mst-in");
            el.style.removeProperty("--i");
          }, 1400);
        });
      }, { threshold: 0.12 })
    : null;

  function prepare(container) {
    let n = 0;
    container.querySelectorAll(".record-item, .activity-item").forEach((el) => {
      if (el.dataset.fx) return;
      el.dataset.fx = "1";

      const key = container.id + "|" + el.textContent.replace(/\s+/g, " ").trim();
      if (seen.has(key) || !io) { seen.add(key); return; }
      seen.add(key);

      el.style.setProperty("--i", Math.min(n++, 8));
      el.classList.add("mst-reveal");
      io.observe(el);
    });
  }

  ["attendanceList", "scheduleList", "historyList", "recentActivity", "adminActivityList"]
    .forEach((id) => {
      const box = document.getElementById(id);
      if (!box) return;
      prepare(box);
      new MutationObserver(() => prepare(box)).observe(box, { childList: true });
    });
})();

/* =========================================
   WEBSITE LIVE — "Today" widget + confetti
   (paste at the END of script.js)
========================================= */
(() => {
  if (window.mstLiveWidget) return;
  window.mstLiveWidget = true;

  const hero = document.querySelector(".welcome-section");
  const statsGrid = document.querySelector(".stats-grid");
  if (!hero || !statsGrid) return;

  /* ---------- build the card ---------- */
  const card = document.createElement("div");
  card.className = "mst-today glass";
  card.innerHTML = `
    <div class="mst-today-left">
      <div class="mst-clock"><span class="h">00</span><i>:</i><span class="m">00</span><i>:</i><span class="s">00</span></div>
      <div class="mst-today-date"></div>
      <div class="mst-next">Checking your schedule...</div>
    </div>
    <div class="mst-ring">
      <svg viewBox="0 0 80 80" aria-hidden="true">
        <defs>
          <linearGradient id="mstRingGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#ffb3cd"/>
            <stop offset="100%" stop-color="#b84c72"/>
          </linearGradient>
        </defs>
        <circle class="track" cx="40" cy="40" r="34"/>
        <circle class="fill"  cx="40" cy="40" r="34"/>
      </svg>
      <div class="mst-ring-text"><b>0%</b><small>ATTENDED</small></div>
    </div>`;
  statsGrid.parentNode.insertBefore(card, statsGrid);

  const elH = card.querySelector(".h");
  const elM = card.querySelector(".m");
  const elS = card.querySelector(".s");
  const elDate = card.querySelector(".mst-today-date");
  const elNext = card.querySelector(".mst-next");
  const elFill = card.querySelector(".fill");
  const elPct = card.querySelector(".mst-ring-text b");

  const pad = (n) => String(n).padStart(2, "0");

  /* ---------- clock ---------- */
  function tick() {
    const d = new Date();
    elH.textContent = pad(d.getHours());
    elM.textContent = pad(d.getMinutes());
    elS.textContent = pad(d.getSeconds());
    renderNext();
  }

  elDate.textContent = new Date().toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long"
  });

  /* ---------- next class (read from the schedule list) ---------- */
  const MONTHS = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
  let upcoming = [];

  function parseWhen(dateText, timeText) {
    const dm = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/.exec(dateText || "");
    if (!dm) return null;

    let hh = 23, mm = 59;
    const tm = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(timeText || "");
    if (tm) {
      hh = Number(tm[1]) % 12;
      mm = Number(tm[2]);
      if (/pm/i.test(tm[3])) hh += 12;
    }
    const month = MONTHS[dm[2].toLowerCase()];
    if (month === undefined) return null;
    return new Date(Number(dm[3]), month, Number(dm[1]), hh, mm, 0);
  }

  function readSchedule() {
    const list = document.getElementById("scheduleList");
    upcoming = [];
    if (!list) return;

    list.querySelectorAll(".record-item").forEach((item) => {
      const subject = item.querySelector("h4")?.textContent.trim();
      const spans = item.querySelectorAll(".record-meta span");
      if (!subject || spans.length < 1) return;

      const when = parseWhen(spans[0].textContent, spans[1]?.textContent);
      if (when) upcoming.push({ subject, when, hasTime: !!spans[1]?.textContent.trim() });
    });

    upcoming.sort((a, b) => a.when - b.when);
    renderNext();
  }

  function renderNext() {
    const now = Date.now();
    const next = upcoming.find((u) => u.when.getTime() > now);

    if (!next) {
      elNext.innerHTML = "<b>No upcoming class</b>Enjoy your free time 🎉";
      return;
    }

    let s = Math.floor((next.when.getTime() - now) / 1000);
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600);  s -= h * 3600;
    const m = Math.floor(s / 60);    s -= m * 60;

    const left = d > 0 ? `${d}d ${h}h`
               : h > 0 ? `${h}h ${m}m`
               : `${m}m ${pad(s)}s`;

    const subject = document.createElement("b");
    subject.textContent = "📚 " + next.subject;
    const em = document.createElement("em");
    em.textContent = left;

    elNext.textContent = "";
    elNext.appendChild(subject);
    elNext.append("Starts in ", em);
  }

  /* ---------- attendance ring (reads the stat numbers) ---------- */
  function updateRing() {
    const total = Number(document.getElementById("totalClasses")?.dataset.value
                  ?? document.getElementById("totalClasses")?.textContent) || 0;
    const att = Number(document.getElementById("totalAttendance")?.dataset.value
                ?? document.getElementById("totalAttendance")?.textContent) || 0;

    const pct = total ? Math.round((att / total) * 100) : 0;
    elPct.textContent = pct + "%";
    elFill.style.strokeDashoffset = String(214 * (1 - pct / 100));
  }

  ["totalClasses", "totalAttendance"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) new MutationObserver(updateRing).observe(el, { childList: true, characterData: true, subtree: true, attributes: true });
  });

  const list = document.getElementById("scheduleList");
  if (list) new MutationObserver(readSchedule).observe(list, { childList: true });

  readSchedule();
  updateRing();
  tick();
  setInterval(tick, 1000);

  /* ---------- confetti when something is saved ---------- */
  const toast = document.getElementById("toast");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function confetti() {
    if (reduce) return;
    const box = document.createElement("div");
    box.className = "mst-confetti";
    const colors = ["#ff7aa8", "#ffd0e2", "#b84c72", "#ffffff", "#ffb347", "#8be9c8"];

    for (let i = 0; i < 34; i++) {
      const p = document.createElement("span");
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.9;
      const dist = 140 + Math.random() * 190;
      p.style.background = colors[i % colors.length];
      p.style.setProperty("--cx", Math.cos(angle) * dist + "px");
      p.style.setProperty("--cy", Math.sin(angle) * dist + 130 + "px");
      p.style.setProperty("--cr", (Math.random() * 720 - 360) + "deg");
      p.style.animationDelay = (Math.random() * 0.12) + "s";
      box.appendChild(p);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 1900);
  }

  if (toast) {
    new MutationObserver(() => {
      if (/saved|updated/i.test(toast.textContent)) confetti();
    }).observe(toast, { childList: true, characterData: true, subtree: true });
  }
})();
