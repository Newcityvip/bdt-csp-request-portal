const BRANDS = ["M1", "M2", "B1", "B2", "B3", "B4", "B5", "K1", "TK", "JW"];
const API_URL = "https://script.google.com/macros/s/AKfycbyanyavF31y_Z-q0PIjZkYJJCVZPmWXQgtJiuJh2KboaeHi4PSQwFpNqw8c7Lqn91vn/exec";
const TOKEN_STORAGE_KEY = "opsRequestHubSession";
const ROLE_ACCESS = {
  BDT_STAFF: { views: ["dashboard", "new-request", "my-requests", "team-requests"], defaultView: "dashboard", label: "BDT Staff" },
  CSP_STAFF: { views: ["dashboard", "csp-queue"], defaultView: "csp-queue", label: "CSP Staff" },
  CSP_ADMIN: { views: ["dashboard", "csp-queue"], defaultView: "csp-queue", label: "CSP Admin" },
  SUPER_ADMIN: { views: ["dashboard", "new-request", "my-requests", "team-requests", "csp-queue", "user-management"], defaultView: "dashboard", label: "Super Admin" }
};
const authState = { user: null, token: null };
const adminState = { users: [], loaded: false };

class ApiError extends Error {
  constructor(message, code = "REQUEST_ERROR") { super(message); this.name = "ApiError"; this.code = code; }
}
const REQUEST_FIELDS = {
  "Phone Number Deletion": [{name:"player",label:"Player Username",required:true},{name:"phone",label:"Phone Number",type:"tel",required:true},{name:"notes",label:"Notes",type:"textarea"}],
  "Phone Number Verify": [{name:"player",label:"Player Username",required:true},{name:"phone",label:"Phone Number",type:"tel",required:true},{name:"notes",label:"Notes",type:"textarea"}],
  "Email Verify": [{name:"player",label:"Player Username",required:true},{name:"email",label:"Email",type:"email",required:true},{name:"notes",label:"Notes",type:"textarea"}],
  "Add KYC Bonus": [{name:"player",label:"Player Username",required:true},{name:"notes",label:"Notes",type:"textarea"}],
  "Cancel Turnover": [{name:"player",label:"Player Username",required:true},{name:"transaction",label:"Transaction / Deposit ID",required:true},{name:"amount",label:"Amount",type:"number"},{name:"notes",label:"Reason / Notes",type:"textarea",required:true}],
  "Reset Password": [{name:"player",label:"Player Username",required:true},{name:"notes",label:"Notes",type:"textarea"}],
  "Account Unlock": [{name:"player",label:"Player Username",required:true},{name:"notes",label:"Notes",type:"textarea"}],
  "Add Phone Number": [{name:"player",label:"Player Username",required:true},{name:"phone",label:"New Phone Number",type:"tel",required:true},{name:"notes",label:"Notes",type:"textarea"}],
  "Change Email": [{name:"player",label:"Player Username",required:true},{name:"currentEmail",label:"Current Email",type:"email"},{name:"email",label:"New Email",type:"email",required:true},{name:"notes",label:"Notes",type:"textarea"}],
  "Change Full Name": [{name:"player",label:"Player Username",required:true},{name:"currentName",label:"Current Name"},{name:"newName",label:"New Full Name",required:true},{name:"notes",label:"Reason / Notes",type:"textarea",required:true}],
  "Change Linked Player": [{name:"affiliate",label:"Affiliate Username",required:true},{name:"currentPlayer",label:"Current Player Username",required:true},{name:"newPlayer",label:"New Player Username",required:true},{name:"notes",label:"Reason / Notes",type:"textarea",required:true}]
};

const requests = [
  {ticket:"REQ-001842",brand:"B4",type:"Phone Number Verify",player:"user123",phone:"01795021979",status:"Pending",submitted:"Today, 2:14 PM",age:"12m",handler:"—",requestedBy:"Nabil"},
  {ticket:"REQ-001841",brand:"M2",type:"Phone Number Deletion",player:"player555",phone:"01844215671",status:"Processing",submitted:"Today, 1:58 PM",age:"28m",handler:"Kim",requestedBy:"Nabil"},
  {ticket:"REQ-001840",brand:"B1",type:"Email Verify",player:"raihan77",email:"raihan77@example.com",status:"Pending",submitted:"Today, 1:42 PM",age:"44m",handler:"—",requestedBy:"Farhan"},
  {ticket:"REQ-001839",brand:"TK",type:"Cancel Turnover",player:"emon22",transaction:"DEP-883291",amount:"৳5,000",status:"Unable",reason:"Incorrect information",submitted:"Today, 12:51 PM",age:"1h 35m",handler:"Anna",requestedBy:"Nabil"},
  {ticket:"REQ-001838",brand:"K1",type:"Account Unlock",player:"user888",status:"Completed",submitted:"Today, 12:36 PM",age:"1h 50m",handler:"Kim",requestedBy:"Nabil"},
  {ticket:"REQ-001837",brand:"M1",type:"Reset Password",player:"samir89",status:"Completed",submitted:"Today, 11:20 AM",age:"3h 6m",handler:"Anna",requestedBy:"Tasnim"},
  {ticket:"REQ-001836",brand:"B5",type:"Change Email",player:"rifat03",email:"newmail@example.com",status:"Pending",submitted:"Today, 10:45 AM",age:"3h 41m",handler:"—",requestedBy:"Nabil"},
  {ticket:"REQ-001835",brand:"JW",type:"Add KYC Bonus",player:"maria91",status:"Completed",submitted:"Yesterday, 5:22 PM",age:"21h",handler:"Kim",requestedBy:"Sadia"}
];

const $ = (selector, root=document) => root.querySelector(selector);
const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
const statusBadge = status => `<span class="badge ${status.toLowerCase()}">${status}</span>`;
const detailText = r => [r.player || r.affiliate, r.phone || r.email || r.transaction || r.newPlayer].filter(Boolean).join(" / ");
const findRequest = ticket => requests.find(r => r.ticket === ticket);

function fillSelect(select, values) { values.forEach(value => select.insertAdjacentHTML("beforeend", `<option value="${value}">${value}</option>`)); }
function showToast(message) { const toast=$("#toast"); toast.textContent=message; toast.classList.add("show"); clearTimeout(showToast.timer); showToast.timer=setTimeout(()=>toast.classList.remove("show"),3200); }

async function apiPost(action, payload = {}, options = {}) {
  let response;
  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      cache: "no-store",
      body: JSON.stringify({ action, ...payload })
    });
  } catch {
    throw new ApiError("Unable to connect. Please check your connection and try again.", "NETWORK_ERROR");
  }

  let result;
  try { result = await response.json(); }
  catch { throw new ApiError("The service returned an invalid response. Please try again.", "INVALID_RESPONSE"); }

  if (!result || result.ok !== true) {
    const code = result?.code || "REQUEST_ERROR";
    if (!options.skipExpiry && ["UNAUTHORIZED", "SESSION_EXPIRED"].includes(code)) handleSessionExpiry();
    throw new ApiError(typeof result?.error === "string" ? result.error : "The request could not be completed.", code);
  }
  return result.data;
}

async function apiGet(action, params = {}, options = {}) {
  const url = new URL(API_URL);
  url.searchParams.set("action", action);
  Object.entries(params).forEach(([key, value]) => { if (value !== undefined && value !== null) url.searchParams.set(key, value); });
  let response;
  try { response = await fetch(url.toString(), { cache: "no-store" }); }
  catch { throw new ApiError("Unable to connect. Please check your connection and try again.", "NETWORK_ERROR"); }
  let result;
  try { result = await response.json(); }
  catch { throw new ApiError("The service returned an invalid response. Please try again.", "INVALID_RESPONSE"); }
  if (!result || result.ok !== true) {
    const code = result?.code || "REQUEST_ERROR";
    if (!options.skipExpiry && ["UNAUTHORIZED", "SESSION_EXPIRED"].includes(code)) handleSessionExpiry();
    throw new ApiError(typeof result?.error === "string" ? result.error : "The request could not be completed.", code);
  }
  return result.data;
}

function authenticatedPost(action, payload = {}) {
  if (!authState.token) return Promise.reject(new ApiError("Authentication is required.", "UNAUTHORIZED"));
  return apiPost(action, { token: authState.token, ...payload });
}

function allowedViews() { return ROLE_ACCESS[authState.user?.role]?.views || []; }
function defaultView() { return ROLE_ACCESS[authState.user?.role]?.defaultView || "dashboard"; }
function clearAuth() { localStorage.removeItem(TOKEN_STORAGE_KEY); authState.token = null; authState.user = null; adminState.users = []; adminState.loaded = false; }
function showLogin(message = "") {
  $("#app-shell").hidden = true;
  $("#auth-shell").hidden = false;
  $("#auth-loading").hidden = true;
  $("#login-card").hidden = false;
  $("#login-error").textContent = message;
  $("#login-error").hidden = !message;
  $("#login-password").value = "";
  setTimeout(() => $("#login-username").focus(), 0);
}
function handleSessionExpiry() {
  clearAuth();
  history.replaceState(null, "", location.pathname + location.search);
  showLogin("Your session has expired. Please sign in again.");
}
function showPortal(user, token) {
  const permissions = ROLE_ACCESS[user?.role];
  if (!permissions) { clearAuth(); showLogin("This account is not authorized to access the portal."); return; }
  authState.user = user;
  authState.token = token;
  updateAuthenticatedUi();
  $("#auth-shell").hidden = true;
  $("#app-shell").hidden = false;
  const requested = location.hash.slice(1);
  navigate(permissions.views.includes(requested) ? requested : permissions.defaultView);
}
function updateAuthenticatedUi() {
  const user = authState.user;
  const role = ROLE_ACCESS[user.role];
  const initial = (user.name || user.username || "U").trim().charAt(0).toUpperCase();
  $("#profile-name").textContent = user.name || user.username;
  $("#profile-role").textContent = role.label;
  $("#sidebar-avatar").textContent = initial;
  $("#topbar-avatar").textContent = initial;
  $("#welcome-name").textContent = (user.name || user.username).split(/\s+/)[0];
  $$('[data-roles]').forEach(element => {
    element.hidden = !element.dataset.roles.split(/\s+/).includes(user.role);
  });
}

function navigate(view) {
  if (!authState.user) return;
  if (!allowedViews().includes(view)) view = defaultView();
  $$(".view").forEach(el=>el.classList.toggle("active",el.id===`${view}-view`));
  $$(".nav-item").forEach(el=>el.classList.toggle("active",el.dataset.view===view));
  const active=$(`#${view}-view`); $("#page-title").textContent=active?.dataset.title || "Ops Request Hub";
  history.replaceState(null,"",`#${view}`); closeSidebar(); window.scrollTo(0,0);
  if (view === "user-management") loadUsers();
}
function openSidebar(){ $("#sidebar").classList.add("open"); $("#sidebar-overlay").classList.add("show"); $("#menu-button").setAttribute("aria-expanded","true"); }
function closeSidebar(){ $("#sidebar").classList.remove("open"); $("#sidebar-overlay").classList.remove("show"); $("#menu-button").setAttribute("aria-expanded","false"); }

function renderStats() {
  const data=[{label:"Pending",value:requests.filter(r=>r.status==="Pending").length,icon:"…"},{label:"Processing",value:requests.filter(r=>r.status==="Processing").length,icon:"↻"},{label:"Completed Today",value:requests.filter(r=>r.status==="Completed"&&r.submitted.startsWith("Today")).length,icon:"✓",className:"completed"},{label:"Unable",value:requests.filter(r=>r.status==="Unable").length,icon:"!"}];
  $("#dashboard-stats").innerHTML=data.map(s=>`<article class="stat-card"><div class="stat-icon ${s.className||s.label.toLowerCase().split(" ")[0]}">${s.icon}</div><div><strong>${s.value}</strong><span>${s.label}</span></div></article>`).join("");
  const q=[{label:"Pending",value:requests.filter(r=>r.status==="Pending").length,icon:"…"},{label:"Processing",value:requests.filter(r=>r.status==="Processing").length,icon:"↻"},{label:"Completed Today",value:requests.filter(r=>r.status==="Completed"&&r.submitted.startsWith("Today")).length,icon:"✓",className:"completed"},{label:"Unable Today",value:requests.filter(r=>r.status==="Unable"&&r.submitted.startsWith("Today")).length,icon:"!",className:"unable"}];
  $("#queue-stats").innerHTML=q.map(s=>`<article class="stat-card"><div class="stat-icon ${s.className||s.label.toLowerCase()}">${s.icon}</div><div><strong>${s.value}</strong><span>${s.label}</span></div></article>`).join("");
  $("#queue-count").textContent=requests.filter(r=>r.status==="Pending").length;
}
function rowMarkup(r, team=false) { return `<tr><td><button class="ticket-button" data-ticket="${r.ticket}">${r.ticket}</button></td><td><strong>${r.brand}</strong></td><td>${r.type}</td><td><strong>${detailText(r).split(" / ")[0]}</strong><span class="sub-detail">${detailText(r).split(" / ").slice(1).join(" / ")||"—"}</span></td>${team?`<td>${r.requestedBy}</td>`:""}<td>${statusBadge(r.status)}</td><td>${r.submitted}</td>${team?"":`<td>${r.handler}</td>`}<td><button class="action-button" data-ticket="${r.ticket}">View</button></td></tr>`; }
function renderTables() {
  $("#recent-requests").innerHTML=requests.slice(0,5).map(r=>rowMarkup(r)).join("");
  renderFiltered("my"); renderFiltered("team"); renderQueue(); renderStats();
}
function matches(r, search, status, brand, type="") { const haystack=[r.ticket,r.player,r.phone,r.email,r.type,r.requestedBy].filter(Boolean).join(" ").toLowerCase(); return (!search||haystack.includes(search.toLowerCase()))&&(!status||r.status===status)&&(!brand||r.brand===brand)&&(!type||r.type===type); }
function renderFiltered(kind) {
  const mine=kind==="my"; const data=requests.filter(r=>(!mine||r.requestedBy==="Nabil")&&matches(r,$(`#${kind}-search`).value,$(`#${kind}-status`).value,$(`#${kind}-brand`).value,mine?$("#my-type").value:""));
  $(`#${kind}-requests-table`).innerHTML=data.map(r=>rowMarkup(r,!mine)).join(""); $(`#${kind}-result-summary`).textContent=`Showing ${data.length} request${data.length===1?"":"s"}`; $(`#${kind}-empty`).hidden=data.length>0;
}
function renderQueue() {
  const active=requests.filter(r=>["Pending","Processing"].includes(r.status));
  $("#queue-table").innerHTML=active.map(r=>`<tr><td><strong>${r.age}</strong></td><td><button class="ticket-button" data-ticket="${r.ticket}">${r.ticket}</button></td><td><strong>${r.brand}</strong></td><td>${r.type}</td><td><strong>${detailText(r).split(" / ")[0]}</strong><span class="sub-detail">${detailText(r).split(" / ").slice(1).join(" / ")||"—"}</span></td><td>${r.requestedBy}</td><td>${statusBadge(r.status)}</td><td>${r.status==="Processing"?`<strong>Kim</strong><span class="sub-detail">Processing now</span>`:"—"}</td><td>${r.status==="Pending"?`<button class="action-button primary" data-take="${r.ticket}">Take Request</button>`:`<div class="action-group"><button class="action-button success" data-complete="${r.ticket}">Complete</button><button class="action-button danger" data-unable="${r.ticket}">Unable</button></div>`}</td></tr>`).join("");
  $("#queue-empty").hidden=active.length>0;
}

function renderDynamicFields(type) {
  const container=$("#dynamic-fields"); if(!type){container.innerHTML='<div class="form-placeholder"><span>↖</span><p>Select a request type to see the required details.</p></div>';return;}
  const fields=REQUEST_FIELDS[type]; container.innerHTML=`<div class="form-section-title"><span>2</span><div><h3>Request details</h3><p>Provide accurate information for ${type.toLowerCase()}.</p></div></div><div class="form-grid two">${fields.map(field=>`<div class="field ${field.type==="textarea"?"full-width":""}"><label for="field-${field.name}">${field.label}${field.required?' <em>*</em>':''}</label>${field.type==="textarea"?`<textarea id="field-${field.name}" name="${field.name}" rows="3" ${field.required?"required":""} placeholder="Enter ${field.label.toLowerCase()}"></textarea>`:`<input id="field-${field.name}" name="${field.name}" type="${field.type||"text"}" ${field.required?"required":""} placeholder="Enter ${field.label.toLowerCase()}">`}<small class="error-text">This field is required.</small></div>`).join("")}</div>`;
  $$(".full-width",container).forEach(el=>el.style.gridColumn="1 / -1");
}
function submitRequest(event) { event.preventDefault(); const form=event.currentTarget; $$(".field",form).forEach(f=>f.classList.remove("invalid")); if(!form.checkValidity()){ $$('[required]',form).filter(el=>!el.validity.valid).forEach(el=>el.closest(".field").classList.add("invalid")); form.querySelector(":invalid")?.focus(); return; } showToast("Request form is ready. Backend connection will be added next."); form.reset(); renderDynamicFields(""); }

function openDetails(ticket) {
  const r=findRequest(ticket); if(!r)return; const values=[...[{label:"Brand",value:r.brand},{label:"Player Username",value:r.player,copy:true},{label:"Phone Number",value:r.phone,copy:true},{label:"Email",value:r.email,copy:true},{label:"Transaction ID",value:r.transaction,copy:true},{label:"Amount",value:r.amount},{label:"Requested by",value:r.requestedBy},{label:"Submitted",value:r.submitted},{label:"Handler",value:r.handler}], ...(r.reason?[{label:"Unable reason",value:r.reason}]:[])].filter(x=>x.value&&x.value!=="—");
  $("#details-content").innerHTML=`<div class="details-head"><span class="badge ${r.status.toLowerCase()}">${r.status}</span><h2 id="details-title">${r.ticket}</h2><p>${r.type}</p></div><div class="details-body"><div class="detail-grid">${values.map(v=>`<div class="detail-item"><label>${v.label}</label><div class="detail-value"><span>${v.value}</span>${v.copy?`<button class="copy-button" data-copy="${v.value}">Copy</button>`:""}</div></div>`).join("")}</div><div class="details-status"><span>This request uses sample data and is not persisted.</span>${statusBadge(r.status)}</div></div>`; openModal("details-modal");
}
function openModal(id){const modal=$(`#${id}`);modal.hidden=false;document.body.style.overflow="hidden";setTimeout(()=>$(".modal-close",modal).focus(),0)}
function closeModals(){ $$(".modal-backdrop").forEach(m=>m.hidden=true); clearSensitiveFields(); document.body.style.overflow=""; }
async function copyValue(value){try{await navigator.clipboard.writeText(value);showToast("Copied to clipboard.")}catch{showToast("Clipboard access is unavailable in this browser.")}}
function updateRequest(ticket,status,reason=""){const r=findRequest(ticket);if(!r)return;r.status=status;r.handler=status==="Processing"?"Kim":r.handler;if(reason)r.reason=reason;renderTables();showToast(status==="Processing"?`${ticket} is now processing by Kim.`:`${ticket} marked ${status.toLowerCase()}.`)}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}
function roleLabel(role) { return ROLE_ACCESS[role]?.label || role || "—"; }
function formatAdminDate(value) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function setFormMessage(id, message = "", success = false) {
  const element = $(`#${id}`);
  element.textContent = message;
  element.classList.toggle("success", success);
  element.hidden = !message;
}
function setFormBusy(form, busy, busyText) {
  const button = $('button[type="submit"]', form);
  if (!button.dataset.defaultText) button.dataset.defaultText = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? busyText : button.dataset.defaultText;
}
function clearSensitiveFields() {
  ["add-user-password", "add-user-confirm", "reset-password-new", "reset-password-confirm"].forEach(id => { const field = $(`#${id}`); if (field) { field.value = ""; field.type = "password"; } });
  $$('[data-password-toggle]').forEach(button => button.textContent = "Show");
}
function findAdminUser(userId) { return adminState.users.find(user => user.userId === userId); }

async function loadUsers() {
  if (authState.user?.role !== "SUPER_ADMIN") return;
  $("#user-result-summary").textContent = "Loading users…";
  $("#users-table").innerHTML = '<tr class="table-loading"><td colspan="9">Loading user accounts…</td></tr>';
  $("#users-empty").hidden = true;
  try {
    const data = await authenticatedPost("listUsers");
    adminState.users = Array.isArray(data?.users) ? data.users : [];
    adminState.loaded = true;
    renderUsers();
  } catch (error) {
    if (error.code === "UNAUTHORIZED") return;
    $("#users-table").innerHTML = "";
    $("#user-result-summary").textContent = error.message;
    $("#users-empty").hidden = false;
    $("#users-empty h3").textContent = "Unable to load users";
    $("#users-empty p").textContent = "Please try again.";
  }
}

function renderUsers() {
  const search = $("#user-search").value.trim().toLowerCase();
  const team = $("#user-team-filter").value;
  const role = $("#user-role-filter").value;
  const status = $("#user-status-filter").value;
  const filtered = adminState.users.filter(user => {
    const matchesSearch = !search || [user.userId, user.name, user.username].some(value => String(value || "").toLowerCase().includes(search));
    return matchesSearch && (!team || user.team === team) && (!role || user.role === role) && (!status || user.status === status);
  });
  $("#total-users").textContent = adminState.users.length;
  $("#bdt-users").textContent = adminState.users.filter(user => user.team === "BDT").length;
  $("#csp-users").textContent = adminState.users.filter(user => user.team === "CSP").length;
  $("#inactive-users").textContent = adminState.users.filter(user => user.status === "Inactive").length;
  $("#user-result-summary").textContent = `Showing ${filtered.length} of ${adminState.users.length} users`;
  $("#users-table").innerHTML = filtered.map(user => `<tr><td><strong>${escapeHtml(user.userId)}</strong></td><td><strong>${escapeHtml(user.name)}</strong></td><td><span class="username-text">${escapeHtml(user.username)}</span></td><td>${escapeHtml(user.team)}</td><td><span class="user-role">${escapeHtml(roleLabel(user.role))}</span></td><td>${statusBadge(user.status || "Inactive")}</td><td>${escapeHtml(formatAdminDate(user.lastLogin))}</td><td>${escapeHtml(formatAdminDate(user.updatedAt))}</td><td><div class="user-actions"><button class="action-button" data-edit-user="${escapeHtml(user.userId)}">Edit</button><button class="action-button primary" data-reset-user="${escapeHtml(user.userId)}">Reset Password</button><button class="action-button ${user.status === "Active" ? "danger" : "success"} status-button" data-status-user="${escapeHtml(user.userId)}">${user.status === "Active" ? "Deactivate" : "Activate"}</button></div></td></tr>`).join("");
  $("#users-empty").hidden = filtered.length > 0;
  if (!filtered.length) { $("#users-empty h3").textContent = "No users found"; $("#users-empty p").textContent = "Try changing or clearing your filters."; }
}

function openAddUserModal() {
  $("#add-user-form").reset();
  setFormMessage("add-user-message");
  openModal("add-user-modal");
}
function openEditUserModal(userId) {
  const user = findAdminUser(userId); if (!user) return;
  $("#edit-user-id").value = user.userId;
  $("#edit-user-name").value = user.name;
  $("#edit-user-team").value = user.team;
  $("#edit-user-role").value = user.role;
  $("#edit-user-identity").textContent = `${user.username} · ${user.userId}`;
  setFormMessage("edit-user-message");
  openModal("edit-user-modal");
}
function openResetPasswordModal(userId) {
  const user = findAdminUser(userId); if (!user) return;
  $("#reset-password-form").reset();
  $("#reset-password-user-id").value = user.userId;
  $("#reset-password-user").textContent = `Set a new password for ${user.name} (${user.username}).`;
  setFormMessage("reset-password-message");
  openModal("reset-password-modal");
}
function openUserStatusModal(userId) {
  const user = findAdminUser(userId); if (!user) return;
  const nextStatus = user.status === "Active" ? "Inactive" : "Active";
  const deactivating = nextStatus === "Inactive";
  $("#status-user-id").value = user.userId;
  $("#status-user-value").value = nextStatus;
  $("#user-status-title").textContent = `${deactivating ? "Deactivate" : "Activate"} User`;
  $("#user-status-copy").textContent = deactivating ? `${user.name} will immediately lose portal access.` : `${user.name} will be able to sign in again.`;
  const button = $("#confirm-user-status");
  button.textContent = deactivating ? "Deactivate" : "Activate";
  button.className = deactivating ? "danger-button" : "primary-button";
  $("#user-status-icon").classList.toggle("danger", deactivating);
  setFormMessage("user-status-message");
  openModal("user-status-modal");
}
function enforceTeamForRole(roleSelect, teamSelect) {
  const expected = { BDT_STAFF: "BDT", CSP_STAFF: "CSP", CSP_ADMIN: "CSP", SUPER_ADMIN: "ADMIN" };
  if (expected[roleSelect.value]) teamSelect.value = expected[roleSelect.value];
}

async function submitAddUser(event) {
  event.preventDefault(); const form = event.currentTarget;
  setFormMessage("add-user-message");
  if (!form.checkValidity()) { form.reportValidity(); return; }
  const password = $("#add-user-password").value;
  if (password !== $("#add-user-confirm").value) { setFormMessage("add-user-message", "Passwords do not match."); return; }
  setFormBusy(form, true, "Creating…");
  try {
    await authenticatedPost("createUser", { name: $("#add-user-name").value, username: $("#add-user-username").value, team: $("#add-user-team").value, role: $("#add-user-role").value, password });
    closeModals(); showToast("User created successfully."); await loadUsers();
  } catch (error) { setFormMessage("add-user-message", error.message); }
  finally { setFormBusy(form, false); clearSensitiveFields(); }
}
async function submitEditUser(event) {
  event.preventDefault(); const form = event.currentTarget;
  setFormMessage("edit-user-message");
  if (!form.checkValidity()) { form.reportValidity(); return; }
  setFormBusy(form, true, "Saving…");
  try {
    await authenticatedPost("updateUser", { userId: $("#edit-user-id").value, name: $("#edit-user-name").value, team: $("#edit-user-team").value, role: $("#edit-user-role").value });
    closeModals(); showToast("User updated successfully."); await loadUsers();
  } catch (error) { setFormMessage("edit-user-message", error.message); }
  finally { setFormBusy(form, false); }
}
async function submitResetPassword(event) {
  event.preventDefault(); const form = event.currentTarget;
  setFormMessage("reset-password-message");
  if (!form.checkValidity()) { form.reportValidity(); return; }
  const newPassword = $("#reset-password-new").value;
  if (newPassword !== $("#reset-password-confirm").value) { setFormMessage("reset-password-message", "Passwords do not match."); return; }
  setFormBusy(form, true, "Updating…");
  try {
    await authenticatedPost("resetUserPassword", { userId: $("#reset-password-user-id").value, newPassword });
    closeModals(); showToast("Password reset successfully.");
  } catch (error) { setFormMessage("reset-password-message", error.message); }
  finally { setFormBusy(form, false); clearSensitiveFields(); }
}
async function submitUserStatus(event) {
  event.preventDefault(); const form = event.currentTarget;
  setFormMessage("user-status-message");
  setFormBusy(form, true, "Updating…");
  const status = $("#status-user-value").value;
  try {
    await authenticatedPost("setUserStatus", { userId: $("#status-user-id").value, status });
    closeModals(); showToast(`User ${status === "Active" ? "activated" : "deactivated"}.`); await loadUsers();
  } catch (error) { setFormMessage("user-status-message", error.message); }
  finally { setFormBusy(form, false); }
}

async function restoreSession() {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (!token) { showLogin(); return; }
  try {
    const data = await apiPost("session", { token }, { skipExpiry: true });
    if (!data?.user) throw new ApiError("Invalid session.", "UNAUTHORIZED");
    showPortal(data.user, token);
  } catch {
    clearAuth();
    showLogin();
  }
}

async function submitLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const username = $("#login-username").value.trim();
  const password = $("#login-password").value;
  const error = $("#login-error");
  error.hidden = true;
  if (!username || !password) { error.textContent = "Enter your username and password."; error.hidden = false; return; }
  const button = $("#login-button");
  button.disabled = true;
  button.textContent = "Signing In…";
  try {
    const data = await apiPost("login", { username, password }, { skipExpiry: true });
    if (!data?.token || !data?.user) throw new ApiError("Invalid login response.", "INVALID_RESPONSE");
    localStorage.setItem(TOKEN_STORAGE_KEY, data.token);
    form.reset();
    showPortal(data.user, data.token);
  } catch (apiError) {
    error.textContent = apiError.code === "INVALID_CREDENTIALS" ? "Invalid username or password." : apiError.message;
    error.hidden = false;
    $("#login-password").value = "";
    $("#login-password").focus();
  } finally {
    button.disabled = false;
    button.textContent = "Sign In";
  }
}

async function logout() {
  const token = authState.token;
  try { if (token) await apiPost("logout", { token }, { skipExpiry: true }); }
  catch { /* Local logout must complete even if the service is unavailable. */ }
  finally { clearAuth(); closeSidebar(); closeModals(); history.replaceState(null, "", location.pathname + location.search); showLogin(); }
}

function initialize() {
  fillSelect($("#brand"),BRANDS); fillSelect($("#request-type"),Object.keys(REQUEST_FIELDS));
  ["my-brand","team-brand"].forEach(id=>fillSelect($(`#${id}`),BRANDS)); ["my-status","team-status"].forEach(id=>fillSelect($(`#${id}`),["Pending","Processing","Completed","Unable"])); fillSelect($("#my-type"),Object.keys(REQUEST_FIELDS));
  renderTables();
  $$(".nav-item").forEach(btn=>btn.addEventListener("click",()=>navigate(btn.dataset.view))); $$('[data-go]').forEach(btn=>btn.addEventListener("click",()=>navigate(btn.dataset.go)));
  $("#menu-button").addEventListener("click",openSidebar); $("#sidebar-overlay").addEventListener("click",closeSidebar); $("#request-type").addEventListener("change",e=>renderDynamicFields(e.target.value)); $("#request-form").addEventListener("submit",submitRequest);
  ["my-search","my-status","my-brand","my-type"].forEach(id=>$(`#${id}`).addEventListener("input",()=>renderFiltered("my"))); ["team-search","team-status","team-brand"].forEach(id=>$(`#${id}`).addEventListener("input",()=>renderFiltered("team")));
  $("#unable-reason").addEventListener("change",e=>{$("#other-reason-field").hidden=e.target.value!=="Other";$("#other-reason").required=e.target.value==="Other"});
  $("#unable-form").addEventListener("submit",e=>{e.preventDefault();if(!e.currentTarget.checkValidity()){e.currentTarget.reportValidity();return}const reason=$("#unable-reason").value==="Other"?$("#other-reason").value:$("#unable-reason").value;updateRequest($("#unable-ticket").value,"Unable",reason);closeModals();e.currentTarget.reset();$("#other-reason-field").hidden=true});
  document.addEventListener("click",e=>{const ticket=e.target.closest("[data-ticket]")?.dataset.ticket;if(ticket)openDetails(ticket);const take=e.target.closest("[data-take]")?.dataset.take;if(take)updateRequest(take,"Processing");const complete=e.target.closest("[data-complete]")?.dataset.complete;if(complete)updateRequest(complete,"Completed");const unable=e.target.closest("[data-unable]")?.dataset.unable;if(unable){$("#unable-ticket").value=unable;openModal("unable-modal")}if(e.target.closest("[data-close-modal]")||e.target.classList.contains("modal-backdrop"))closeModals();const copy=e.target.closest("[data-copy]")?.dataset.copy;if(copy)copyValue(copy)});
  document.addEventListener("keydown",e=>{if(e.key==="Escape")closeModals()});
  window.addEventListener("hashchange", () => { if (authState.user) navigate(location.hash.slice(1)); });
  $("#login-form").addEventListener("submit", submitLogin);
  $(".logout-button").addEventListener("click", logout);
  $("#add-user-button").addEventListener("click", openAddUserModal);
  $("#add-user-form").addEventListener("submit", submitAddUser);
  $("#edit-user-form").addEventListener("submit", submitEditUser);
  $("#reset-password-form").addEventListener("submit", submitResetPassword);
  $("#user-status-form").addEventListener("submit", submitUserStatus);
  ["user-search", "user-team-filter", "user-role-filter", "user-status-filter"].forEach(id => $(`#${id}`).addEventListener("input", renderUsers));
  $("#add-user-role").addEventListener("change", () => enforceTeamForRole($("#add-user-role"), $("#add-user-team")));
  $("#edit-user-role").addEventListener("change", () => enforceTeamForRole($("#edit-user-role"), $("#edit-user-team")));
  $("#users-table").addEventListener("click", event => {
    const editId = event.target.closest("[data-edit-user]")?.dataset.editUser;
    const resetId = event.target.closest("[data-reset-user]")?.dataset.resetUser;
    const statusId = event.target.closest("[data-status-user]")?.dataset.statusUser;
    if (editId) openEditUserModal(editId);
    if (resetId) openResetPasswordModal(resetId);
    if (statusId) openUserStatusModal(statusId);
  });
  $$('[data-password-toggle]').forEach(button => button.addEventListener("click", () => {
    const field = $(`#${button.dataset.passwordToggle}`);
    const showing = field.type === "text";
    field.type = showing ? "password" : "text";
    button.textContent = showing ? "Show" : "Hide";
  }));
  restoreSession();
}
document.addEventListener("DOMContentLoaded",initialize);
