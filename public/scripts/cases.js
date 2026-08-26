const firebaseConfig = {
    apiKey: "AIzaSyBKBFcZb7Qkw0NZOR-vhQ0hm54GAa_6Zj4",
    authDomain: "victorious-legal-lib.firebaseapp.com",
    projectId: "victorious-legal-lib",
    storageBucket: "victorious-legal-lib.firebasestorage.app",
    messagingSenderId: "52708605227",
    appId: "1:52708605227:web:c015708e9013eaee8a996e",
    measurementId: "G-RYL0ZB25EL"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// ---------- PASSWORD UTILITIES ----------
async function getPlainText(docId) {
    try {
        const docSnap = await db.collection('passwords').doc(docId).get();
        return docSnap.exists ? docSnap.data().plainText : null;
    } catch (err) { showToast("Error reading password: " + err.message, true); return null; }
}
async function setPlainText(docId, text) { await db.collection('passwords').doc(docId).set({ plainText: text }, { merge: true }); }
async function verifyAdminPassword(pwd) { const stored = await getPlainText('admin_password'); return { success: pwd === stored }; }
async function updateAdminPassword(current, newPw) {
    const currentPlain = await getPlainText('admin_password');
    if (current !== currentPlain) return { success: false, message: 'Current password incorrect' };
    if (newPw.length < 4) return { success: false, message: 'Minimum 4 characters' };
    await setPlainText('admin_password', newPw);
    return { success: true, message: 'Admin password updated!' };
}
async function resetAdminPasswordToDefault() {
    await setPlainText('admin_password', '0420');
    showToast('✅ Admin password reset to default: 0420');
    setTimeout(() => location.reload(), 1500);
}

// ---------- GLOBAL VARIABLES ----------
let allCases = [];
let unsubscribeCases = null;
let isAdminLoggedIn = false;
let dataLoaded = false;

// User saved dashboard (localStorage)
let userSaved = JSON.parse(localStorage.getItem('vt_user_saved') || '[]');

function saveUserDashboard() {
    localStorage.setItem('vt_user_saved', JSON.stringify(userSaved));
    updateDashboardUI();
}

function updateDashboardUI() {
    const grid = document.getElementById('savedGrid');
    const emptyMsg = document.getElementById('emptyDashboardMsg');
    const countSpan = document.getElementById('savedCountBadge');
    if (countSpan) countSpan.innerText = `${userSaved.length} saved`;
    if (userSaved.length === 0) {
        if (emptyMsg) emptyMsg.classList.remove('hidden');
        if (grid) grid.innerHTML = '';
        return;
    }
    if (emptyMsg) emptyMsg.classList.add('hidden');
    const savedArticles = allCases.filter(c => userSaved.includes(c.id));
    grid.innerHTML = savedArticles.map(c => `
      <div class="border border-gray-200 rounded-xl p-4 bg-white shadow-sm hover:shadow-md transition">
        <div class="flex justify-between items-start"><h3 class="font-bold text-blue-900">${escapeHtml(c.name)}</h3><i class="fas fa-check-circle text-green-500"></i></div>
        <p class="text-xs text-gray-500 mt-1">${escapeHtml(c.areaOfLaw)} • ${escapeHtml(c.court)}</p>
        <p class="text-sm text-gray-600 mt-2">${escapeHtml((c.ratio || '').substring(0, 100))}...</p>
        <div class="flex justify-between mt-3"><button class="read-saved-btn text-blue-600 text-sm font-medium" data-id="${c.id}"><i class="fas fa-eye"></i> Read Full</button><button class="remove-saved-btn text-rose-500 text-sm" data-id="${c.id}"><i class="fas fa-trash-alt"></i> Remove</button></div>
      </div>`).join('');
    document.querySelectorAll('.read-saved-btn').forEach(btn => btn.addEventListener('click', () => openCaseReader(btn.dataset.id)));
    document.querySelectorAll('.remove-saved-btn').forEach(btn => btn.addEventListener('click', () => {
        userSaved = userSaved.filter(id => id !== btn.dataset.id);
        saveUserDashboard();
        showToast('Removed from dashboard'); if (!document.getElementById('dashboardView').classList.contains('hidden'))
            updateDashboardUI();
    }));
}

function addToDashboard(caseId) {
    if (userSaved.includes(caseId)) { showToast('Already in your dashboard', true); return false; }
    userSaved.push(caseId);
    saveUserDashboard();
    showToast('✅ Saved to My Dashboard');
    return true;
}

function formatDate(dateStr) {
    if (!dateStr) return "Unknown"; const d = new Date(dateStr); return d.toLocaleDateString(
        'en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function escapeHtml(str) {
    if (!str) return ''; return str.replace(/[&<>]/g, (m) => ({
        '&': '&amp;', '<': '&lt;',
        '>': '&gt;'
    }[m] || m));
}

function showToast(msg, isError = false) {
    const toast = document.createElement('div');
    toast.className =
        `fixed bottom-6 right-6 bg-slate-800 text-white px-5 py-3 rounded-full z-50 shadow-lg text-sm ${isError ? 'bg-rose-700' : 'bg-slate-800'}`;
    toast.innerHTML = `<i class="fas ${isError ? 'fa-exclamation-circle' : 'fa-check-circle'} mr-2"></i>${msg}`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
}

function renderPublicCases(searchTerm = "") {
    const container = document.getElementById('casesContainer');
    let filtered = allCases;
    if (searchTerm) filtered = allCases.filter(c => (c.name || "").toLowerCase().includes(searchTerm) || (c
        .areaOfLaw || "").toLowerCase().includes(searchTerm) || (c.court || "").toLowerCase().includes(
            searchTerm) || (c.ratio || "").toLowerCase().includes(searchTerm) || (c.issues || "").toLowerCase()
                .includes(searchTerm) || (c.facts || "").toLowerCase().includes(searchTerm) || (c.keywords || "")
                    .toLowerCase().includes(searchTerm));
    document.getElementById('resultCount').innerText = `${filtered.length} case${filtered.length !== 1 ? 's' : ''}`;
    if (filtered.length === 0) {
        container.innerHTML =
        `<div class="text-center py-12 bg-gray-50 rounded-xl"><i class="fas fa-search text-gray-400 text-4xl mb-3"></i><p class="text-gray-500">No cases found.</p></div>`;
        return;
    }
    container.innerHTML = filtered.map(c =>
        `<div class="case-card bg-white border border-gray-200 rounded-xl p-5 shadow-sm hover:shadow-md" data-id="${c.id}"><div><h3 class="text-lg font-extrabold text-blue-900">${escapeHtml(c.name)}</h3><div class="flex flex-wrap gap-2 mt-1"><span class="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">${escapeHtml(c.areaOfLaw)}</span><span class="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">${escapeHtml(c.specificArea)}</span><span class="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">${escapeHtml(c.court)}</span><span class="text-xs text-gray-400">${formatDate(c.date)}</span></div></div><div class="mt-3"><p class="text-sm text-gray-600"><strong>Issue:</strong> ${escapeHtml((c.issues || "").substring(0, 120))}...</p></div><div class="flex justify-between items-center mt-2"><span class="text-xs text-blue-600 hover:underline cursor-pointer read-case-trigger" data-id="${c.id}"><i class="fas fa-book-open"></i> Read Complete Case →</span><button class="save-to-dashboard text-amber-600 text-xs font-medium bg-amber-50 px-3 py-1 rounded-full" data-id="${c.id}"><i class="fas fa-save mr-1"></i> Save to My Dashboard</button></div></div>`
    ).join('');
    document.querySelectorAll('.read-case-trigger').forEach(el => el.addEventListener('click', (e) => {
        e
            .stopPropagation();
        openCaseReader(el.dataset.id);
    }));
    document.querySelectorAll('.save-to-dashboard').forEach(el => el.addEventListener('click', (e) => {
        e
            .stopPropagation();
        addToDashboard(el.dataset.id);
    }));
    document.querySelectorAll('.case-card').forEach(card => card.addEventListener('click', (e) => {
        if (!e
            .target.closest('button')) openCaseReader(card.dataset.id);
    }));
}

// UPDATED READER: PRESERVES TEXT FORMATTING
function openCaseReader(caseId) {
    const c = allCases.find(c => c.id === caseId);
    if (!c) return;

    const formatBlock = (text) => {
        if (!text) return '';
        return `<div class="reader-text-block" style="white-space: pre-wrap; word-wrap: break-word; font-family: 'Georgia', serif; line-height: 1.7;">${escapeHtml(text)}</div>`;
    };

    const content = `
      <div class="reader-content">
        <h2 class="text-2xl font-bold text-amber-900">${escapeHtml(c.name)}</h2>
        <div class="flex flex-wrap gap-2 my-2 text-sm">
          <span class="bg-amber-100 px-2 py-0.5 rounded">${escapeHtml(c.areaOfLaw)}</span>
          <span class="bg-amber-100 px-2 py-0.5 rounded">${escapeHtml(c.court)}</span>
          <span class="text-gray-600">${formatDate(c.date)}</span>
        </div>

        <div class="mt-5">
          <div class="heading-holdings">FACTS</div>
          ${formatBlock(c.facts)}
        </div>

        <div class="mt-5">
          <div class="heading-holdings">ISSUES</div>
          ${formatBlock(c.issues)}
        </div>

        <div class="mt-5">
          <div class="heading-holdings">RATIO DECIDENDI & HOLDINGS</div>
          <div class="ratio-text" style="background: #fbf3e3; padding: 1.2rem 1.8rem; border-left: 8px solid #b45309; white-space: pre-wrap; font-family: 'Georgia', serif; line-height: 1.7;">
            ${escapeHtml(c.ratio)}
          </div>
        </div>

        <div class="mt-4 text-sm text-gray-600">
          <strong>Keywords:</strong> ${escapeHtml(c.keywords || '')}
        </div>

        <div class="mt-6">
          <button id="readerSaveBtn" class="bg-amber-600 text-white px-4 py-2 rounded-full text-sm" data-id="${c.id}">
            <i class="fas fa-save mr-1"></i> Save to My Dashboard
          </button>
        </div>
      </div>
      `;

    document.getElementById('readerContent').innerHTML = content;
    document.getElementById('readerModal').classList.remove('hidden');
    document.getElementById('readerSaveBtn')?.addEventListener('click', () => addToDashboard(c.id));
}

function refreshRecent() {
    const sorted = [...allCases].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
    const sidebar = document.getElementById('recentUpdatesContainer');
    if (sidebar) sidebar.innerHTML = sorted.map(c =>
        `<div class="border-l-4 border-blue-500 pl-3 pb-2 bg-gray-50 rounded-r-lg p-3 cursor-pointer recent-case-item" data-id="${c.id}"><p class="font-bold text-sm text-gray-800">${escapeHtml(c.name)}</p><p class="text-xs text-gray-500">${escapeHtml(c.areaOfLaw)} | ${escapeHtml(c.court)}</p><p class="text-xs text-blue-700 mt-1"><i class="fas fa-quote-left"></i> ${escapeHtml((c.ratio || "").substring(0, 80))}...</p><span class="text-green-700 text-xs font-semibold">Read Full →</span></div>`
    ).join('');
    document.querySelectorAll('.recent-case-item').forEach(el => el.addEventListener('click', () =>
        openCaseReader(el.dataset.id)));
    const drawer = document.getElementById('mobileDrawerRecentList');
    if (drawer) drawer.innerHTML = sorted.map(c =>
        `<div class="bg-white rounded-xl p-3 shadow-sm border cursor-pointer drawer-case-item" data-id="${c.id}"><div class="font-bold text-blue-900 text-sm">${escapeHtml(c.name)}</div><div class="text-xs text-gray-500">${escapeHtml(c.court)}</div><p class="text-xs text-gray-600 mt-1">${escapeHtml((c.ratio || "").substring(0, 90))}…</p><div class="text-right mt-1 text-amber-700 text-xs">read ratio</div></div>`
    ).join('');
    document.querySelectorAll('.drawer-case-item').forEach(el => el.addEventListener('click', () => {
        openCaseReader(el.dataset.id);
        closeMobileDrawer();
    }));
}

function renderAdminTable() {
    const tbody = document.getElementById('adminCasesTableBody');
    if (!tbody) return;
    tbody.innerHTML = allCases.map(c =>
        `<tr class="border-b"><td class="p-2">${c.id.slice(0, 6)}</td><td class="p-2 font-medium">${escapeHtml(c.name)}</td><td class="p-2">${escapeHtml(c.areaOfLaw)}</td><td class="p-2">${escapeHtml(c.court)}</td><td class="p-2">${formatDate(c.date)}</td><td class="p-2 text-center"><button class="edit-case-btn bg-yellow-500 text-white px-2 py-1 rounded text-xs mr-1" data-id="${c.id}">Edit</button><button class="delete-case-btn bg-red-600 text-white px-2 py-1 rounded text-xs" data-id="${c.id}">Del</button></td></tr>`
    ).join('');
    document.querySelectorAll('.delete-case-btn').forEach(btn => btn.addEventListener('click', async () => {
        if (
            confirm('Delete case?')) await db.collection('cases').doc(btn.dataset.id).delete().then(() =>
                showToast("Deleted")).catch(e => showToast("Delete failed: " + e.message, true));
    }));
    document.querySelectorAll('.edit-case-btn').forEach(btn => btn.addEventListener('click', async () => {
        const
        id = btn.dataset.id;
        const cas = allCases.find(c => c.id === id); if (cas) {
            const newName = prompt("Edit case name", cas
                .name); if (newName) await db.collection('cases').doc(id).update({ name: newName }).catch(
                    e => showToast("Edit failed: " + e.message, true));
        }
    }));
}

function startCasesListener() {
    if (unsubscribeCases) unsubscribeCases();
    unsubscribeCases = db.collection('cases').orderBy('date', 'desc').onSnapshot(snapshot => {
        allCases = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderPublicCases(document.getElementById('searchInput').value.toLowerCase());
        refreshRecent();
        document.getElementById('statCases').innerText = allCases.length + "+";
        if (isAdminLoggedIn && document.getElementById('adminDashboardArea') && !document.getElementById(
            'adminDashboardArea').classList.contains('hidden')) renderAdminTable();
        updateDashboardUI();
        dataLoaded = true;
        // Hide preloader once data is loaded
        const pre = document.getElementById('preloader');
        if (pre) {
            pre.classList.add('fade-out');
            setTimeout(() => pre.style.display = 'none', 600);
        }
    }, err => {
        console.error(err); if (err.code === 'permission-denied') showToast(
            "Read permission denied. Check Firestore rules.", true);
    });
}

// ---------- ADMIN UI LOGIC ----------
const adminModal = document.getElementById('adminModal');
const adminLoginDiv = document.getElementById('adminLoginArea');
const adminDashboardDiv = document.getElementById('adminDashboardArea');
const verifyBtn = document.getElementById('verifyAdminBtn');
const adminPasswordInput = document.getElementById('adminPasswordInput');
const loginError = document.getElementById('loginError');
const resetPassBtn = document.getElementById('resetPasswordsBtn');
const changeAdminPassBtn = document.getElementById('changeAdminPasswordBtn');
const adminPassMsg = document.getElementById('adminPassMsg');
const closeAdminModal = document.getElementById('closeAdminModalBtn');
const addNewCaseBtn = document.getElementById('addNewCaseAdminBtn');
const adminAddForm = document.getElementById('adminAddForm');
const cancelAdd = document.getElementById('cancelAdminAddForm');
const submitNewCase = document.getElementById('submitAdminNewCase');

async function handleAdminLogin() {
    const pwd = adminPasswordInput.value;
    const res = await verifyAdminPassword(pwd);
    if (res.success) {
        adminLoginDiv.classList.add('hidden');
        adminDashboardDiv.classList.remove('hidden');
        isAdminLoggedIn = true;
        renderAdminTable();
        showToast("Admin access granted");
    } else {
        loginError.innerText = "Invalid password";
        loginError.classList.remove('hidden');
    }
}
verifyBtn.addEventListener('click', handleAdminLogin);
resetPassBtn.addEventListener('click', async () => {
    if (confirm("Reset admin password to default '0420'?"))
        await resetAdminPasswordToDefault();
});
changeAdminPassBtn.addEventListener('click', async () => {
    const old = document.getElementById('oldAdminPass').value;
    const newP = document.getElementById('newAdminPass').value;
    const conf = document.getElementById('confirmAdminPass').value;
    if (newP !== conf) {
        adminPassMsg.innerHTML = '<span class="text-red-600">New password mismatch</span>';
        return;
    }
    const res = await updateAdminPassword(old, newP);
    adminPassMsg.innerHTML =
        `<span class="${res.success ? 'text-green-600' : 'text-red-600'}">${res.message}</span>`;
    if (res.success) {
        document.getElementById('oldAdminPass').value = '';
        document.getElementById('newAdminPass').value = '';
        document.getElementById('confirmAdminPass').value = '';
    }
});
addNewCaseBtn.addEventListener('click', () => adminAddForm.classList.toggle('hidden'));
cancelAdd.addEventListener('click', () => adminAddForm.classList.add('hidden'));
submitNewCase.addEventListener('click', async () => {
    const name = document.getElementById('adminCaseName').value.trim();
    const court = document.getElementById('adminCaseCourt').value.trim();
    const issues = document.getElementById('adminIssues').value.trim();
    const facts = document.getElementById('adminFacts').value.trim();
    const ratio = document.getElementById('adminRatio').value.trim();
    if (!name || !court || !issues || !facts || !ratio) return alert("Required fields missing");
    const newCase = {
        name,
        areaOfLaw: document.getElementById('adminAreaOfLaw').value,
        specificArea: document.getElementById('adminSpecificArea').value.trim() || "General",
        court,
        date: document.getElementById('adminCaseDate').value || new Date().toISOString().slice(0, 10),
        issues,
        facts,
        ratio,
        keywords: document.getElementById('adminKeywords').value.trim() || "custom"
    };
    try {
        await db.collection('cases').add(newCase);
        showToast("✅ Case added successfully!");
        adminAddForm.classList.add('hidden');
        document.getElementById('adminCaseName').value = '';
        document.getElementById('adminCaseCourt').value = '';
        document.getElementById('adminIssues').value = '';
        document.getElementById('adminFacts').value = '';
        document.getElementById('adminRatio').value = '';
        document.getElementById('adminSpecificArea').value = '';
        document.getElementById('adminKeywords').value = '';
    } catch (err) { showToast("Add failed: " + err.message, true); }
});

// Navigation
const libView = document.getElementById('libraryView');
const dashView = document.getElementById('dashboardView');

function showLibrary() {
    libView.classList.remove('hidden');
    dashView.classList.add('hidden');
}

function showDashboard() {
    libView.classList.add('hidden');
    dashView.classList.remove('hidden');
    updateDashboardUI();
}
document.getElementById('navLibraryBtn')?.addEventListener('click', showLibrary);
document.getElementById('navDashboardBtn')?.addEventListener('click', showDashboard);
document.getElementById('mobileNavLibrary')?.addEventListener('click', showLibrary);
document.getElementById('mobileNavDashboard')?.addEventListener('click', showDashboard);

// UI event listeners
document.getElementById('adminPanelBtn').addEventListener('click', () => adminModal.classList.remove('hidden'));
document.getElementById('mobileAdminBtn').addEventListener('click', () => adminModal.classList.remove('hidden'));
closeAdminModal.addEventListener('click', () => adminModal.classList.add('hidden'));
document.getElementById('searchBtn').addEventListener('click', () => renderPublicCases(document.getElementById(
    'searchInput').value.toLowerCase()));
document.getElementById('searchInput').addEventListener('keyup', (e) => {
    if (e.key === 'Enter')
        renderPublicCases(e.target.value.toLowerCase());
});
document.getElementById('closeReaderBtn').addEventListener('click', () => document.getElementById('readerModal')
    .classList.add('hidden'));
document.getElementById('readerModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById(
        'readerModal')) document.getElementById('readerModal').classList.add('hidden');
});

const mobileMenuBtn = document.getElementById('mobileMenuBtn'),
    mobileMenu = document.getElementById('mobileMenu');
if (mobileMenuBtn) mobileMenuBtn.addEventListener('click', () => mobileMenu.classList.toggle('hidden'));

const floatBtn = document.getElementById('mobileRecentFloatBtn'),
    overlay = document.getElementById('mobileRecentOverlay'),
    closeDrawer = document.getElementById('closeDrawerBtn');

function closeMobileDrawer() { overlay.classList.remove('show'); }
floatBtn.addEventListener('click', () => overlay.classList.add('show'));
closeDrawer.addEventListener('click', closeMobileDrawer);
overlay.addEventListener('click', (e) => { if (e.target === overlay) closeMobileDrawer(); });

// Initialize App
window.addEventListener('load', async () => {
    startCasesListener();
    // Fallback: hide preloader after 5 seconds even if data hasn't loaded
    setTimeout(() => {
        const pre = document.getElementById('preloader');
        if (pre && !pre.classList.contains('fade-out')) {
            pre.classList.add('fade-out');
            setTimeout(() => pre.style.display = 'none', 600);
        }
    }, 5000);
});
