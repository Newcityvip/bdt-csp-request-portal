const catalogState = { brands: [], requestTypes: [] };
const requestState = { dashboard: null, my: [], team: [], queue: [], loading: {}, loaded: {}, sequence: {}, mutating: {}, duplicatePayload: null, activeDetailId: null, refreshTimer: null, lastAutoRefresh: 0, filterTimers: {} };
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
  constructor(message, code = "REQUEST_ERROR", data = null) { super(message); this.name = "ApiError"; this.code = code; this.data = data; }
}
const FIELD_META = {
  Player_Username:["playerUsername","Player Username","text"], Affiliate_Username:["affiliateUsername","Affiliate Username","text"],
  Phone_Number:["phoneNumber","Phone Number","tel"], Email:["email","Email","email"], Current_Email:["currentEmail","Current Email","email"],
  New_Email:["newEmail","New Email","email"], Current_Name:["currentName","Current Name","text"], New_Full_Name:["newFullName","New Full Name","text"],
  Current_Player_Username:["currentPlayerUsername","Current Player Username","text"], New_Player_Username:["newPlayerUsername","New Player Username","text"],
  Transaction_ID:["transactionId","Transaction / Deposit ID","text"], Amount:["amount","Amount","number"], Notes:["notes","Notes","textarea"]
};
const DETAIL_LABELS = { Brand:"Brand", Requested_By_Name:"Requested By", Requested_At:"Requested At", Taken_By_Name:"Handler", Taken_At:"Taken At", Completed_By_Name:"Completed By", Completed_At:"Completed At", Unable_Reason:"Unable Reason", Waiting_Seconds:"Waiting Time", Handling_Seconds:"Handling Time", Total_Seconds:"Total Time" };

const $ = (selector, root=document) => root.querySelector(selector);
const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
const statusBadge = status => `<span class="badge ${String(status).toLowerCase()}">${escapeHtml(status)}</span>`;

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
    throw new ApiError("Unable to reach the service. Please try again.", "NETWORK_ERROR");
  }

  let result;
  try { result = await response.json(); }
  catch { throw new ApiError("The service returned an invalid response. Please try again.", "INVALID_RESPONSE"); }

  if (!result || result.ok !== true) {
    const code = result?.code || "REQUEST_ERROR";
    if (!options.skipExpiry && ["UNAUTHORIZED", "SESSION_EXPIRED"].includes(code)) handleSessionExpiry();
    throw new ApiError(typeof result?.error === "string" ? result.error : "The request could not be completed.", code, result?.data);
  }
  return result.data;
}

async function apiGet(action, params = {}, options = {}) {
  const url = new URL(API_URL);
  url.searchParams.set("action", action);
  Object.entries(params).forEach(([key, value]) => { if (value !== undefined && value !== null) url.searchParams.set(key, value); });
  let response;
  try { response = await fetch(url.toString(), { cache: "no-store" }); }
  catch { throw new ApiError("Unable to reach the service. Please try again.", "NETWORK_ERROR"); }
  let result;
  try { result = await response.json(); }
  catch { throw new ApiError("The service returned an invalid response. Please try again.", "INVALID_RESPONSE"); }
  if (!result || result.ok !== true) {
    const code = result?.code || "REQUEST_ERROR";
    if (!options.skipExpiry && ["UNAUTHORIZED", "SESSION_EXPIRED"].includes(code)) handleSessionExpiry();
    throw new ApiError(typeof result?.error === "string" ? result.error : "The request could not be completed.", code, result?.data);
  }
  return result.data;
}

function authenticatedPost(action, payload = {}) {
  if (!authState.token) return Promise.reject(new ApiError("Authentication is required.", "UNAUTHORIZED"));
  return apiPost(action, { token: authState.token, ...payload });
}

function allowedViews() { return ROLE_ACCESS[authState.user?.role]?.views || []; }
function defaultView() { return ROLE_ACCESS[authState.user?.role]?.defaultView || "dashboard"; }
function clearAuth() { localStorage.removeItem(TOKEN_STORAGE_KEY); authState.token = null; authState.user = null; adminState.users = []; adminState.loaded = false; clearInterval(requestState.refreshTimer); Object.values(requestState.filterTimers).forEach(clearTimeout); requestState.refreshTimer=null; requestState.filterTimers={}; }
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
  loadCatalogs();
  startAutoRefresh();
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
  if (view === "dashboard") loadDashboard();
  if (view === "my-requests") loadRequestList("my");
  if (view === "team-requests") loadRequestList("team");
  if (view === "csp-queue") { loadQueue(); loadDashboard(); }
}
function openSidebar(){ $("#sidebar").classList.add("open"); $("#sidebar-overlay").classList.add("show"); $("#menu-button").setAttribute("aria-expanded","true"); }
function closeSidebar(){ $("#sidebar").classList.remove("open"); $("#sidebar-overlay").classList.remove("show"); $("#menu-button").setAttribute("aria-expanded","false"); }

const getField = (row, name) => row?.[name] ?? "";
function normalizeRequest(raw={}){return {raw,requestId:raw.Request_ID??raw.requestId??"",brand:raw.Brand??raw.brand??"",requestType:raw.Request_Type??raw.requestType??"",status:raw.Status??raw.status??"",requestedByName:raw.Requested_By_Name??raw.requestedByName??"",requestedAt:raw.Requested_At??raw.requestedAt??"",takenById:raw.Taken_By_ID??raw.takenById??"",takenByName:raw.Taken_By_Name??raw.takenByName??"",takenAt:raw.Taken_At??raw.takenAt??"",completedByName:raw.Completed_By_Name??raw.completedByName??"",completedAt:raw.Completed_At??raw.completedAt??""}}
function formatDate(value) { if (!value) return "—"; const date=new Date(value); return Number.isNaN(date.getTime())?"—":new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"}).format(date); }
function formatDuration(seconds) { const total=Number(seconds); if(!Number.isFinite(total))return "—"; if(total<60)return `${Math.max(0,Math.floor(total))}s`; if(total<3600)return `${Math.floor(total/60)}m`; return `${Math.floor(total/3600)}h ${Math.floor((total%3600)/60)}m`; }
function ageFrom(value){const ms=Date.now()-new Date(value).getTime();return Number.isFinite(ms)?formatDuration(Math.max(0,ms/1000)):"—"}
function requestDetailsText(r){return [getField(r,"Player_Username"),getField(r,"Affiliate_Username"),getField(r,"Phone_Number"),getField(r,"Email"),getField(r,"Transaction_ID")].filter(Boolean)}
function statCards(metrics){const items=[["Pending",metrics?.pending||0,"…","pending"],["Processing",metrics?.processing||0,"↻","processing"],["Completed Today",metrics?.completedToday||0,"✓","completed"],["Unable Today",metrics?.unableToday||0,"!","unable"]];return items.map(i=>`<article class="stat-card"><div class="stat-icon ${i[3]}">${i[2]}</div><div><strong>${i[1]}</strong><span>${i[0]}</span></div></article>`).join("")}
function liveRow(r,team=false,my=false){const details=requestDetailsText(r);const id=getField(r,"Request_ID");return `<tr><td><button class="ticket-button" data-ticket="${escapeHtml(id)}">${escapeHtml(id)}</button></td><td><strong>${escapeHtml(getField(r,"Brand"))}</strong></td><td>${escapeHtml(getField(r,"Request_Type"))}</td><td><strong>${escapeHtml(details[0]||"—")}</strong><span class="sub-detail">${escapeHtml(details.slice(1).join(" / ")||"—")}</span></td>${team?`<td>${escapeHtml(getField(r,"Requested_By_Name")||"—")}</td>`:""}<td>${statusBadge(getField(r,"Status"))}</td><td>${escapeHtml(formatDate(getField(r,"Requested_At")))}</td><td>${escapeHtml(getField(r,"Taken_By_Name")||"—")}</td><td><div class="action-group"><button class="action-button" data-ticket="${escapeHtml(id)}">View</button>${my&&getField(r,"Status")==="Pending"?`<button class="action-button danger" data-cancel="${escapeHtml(id)}">Cancel</button>`:""}</div></td></tr>`}
function setTableLoading(id,cols){$(id).innerHTML=`<tr class="table-loading"><td colspan="${cols}">Loading requests…</td></tr>`}
async function loadDashboard({silent=false}={}){if(requestState.loading.dashboard)return;requestState.loading.dashboard=true;const initial=!requestState.loaded.dashboard,sequence=(requestState.sequence.dashboard||0)+1;requestState.sequence.dashboard=sequence;try{const data=await authenticatedPost("dashboard");if(sequence!==requestState.sequence.dashboard)return;requestState.dashboard=data;requestState.loaded.dashboard=true;$("#dashboard-stats").innerHTML=statCards(data.metrics);$("#queue-stats").innerHTML=statCards(data.metrics);const recent=data.recentRequests||[];$("#recent-requests").innerHTML=recent.map(r=>liveRow(r)).join("")||'<tr class="table-loading"><td colspan="8">No recent requests.</td></tr>';}catch(e){if(e.code!=="UNAUTHORIZED"&&!silent)showToast(e.message);if(initial)$("#recent-requests").innerHTML='<tr class="table-loading"><td colspan="8">Unable to load dashboard requests.</td></tr>';}finally{requestState.loading.dashboard=false}}
function requestFilters(kind){return {search:$(`#${kind}-search`).value,status:$(`#${kind}-status`).value,brand:$(`#${kind}-brand`).value,requestType:$(`#${kind}-type`)?.value||"",limit:100}}
async function loadRequestList(kind,{silent=false}={}){if(requestState.loading[kind])return;requestState.loading[kind]=true;const team=kind==="team",initial=!requestState.loaded[kind],sequence=(requestState.sequence[kind]||0)+1;requestState.sequence[kind]=sequence;if(initial)setTableLoading(`#${kind}-requests-table`,team?9:8);try{const data=await authenticatedPost(team?"teamRequests":"myRequests",requestFilters(kind));if(sequence!==requestState.sequence[kind])return;requestState[kind]=data.requests||[];requestState.loaded[kind]=true;$( `#${kind}-requests-table`).innerHTML=requestState[kind].map(r=>liveRow(r,team,!team)).join("");$(`#${kind}-result-summary`).textContent=`Showing ${requestState[kind].length} request${requestState[kind].length===1?"":"s"}`;$(`#${kind}-empty`).hidden=requestState[kind].length>0;}catch(e){if(e.code!=="UNAUTHORIZED"&&!silent)showToast(e.message);if(initial){$( `#${kind}-requests-table`).innerHTML="";$(`#${kind}-result-summary`).textContent=`Unable to load ${team?"team":"your"} requests.`;$(`#${kind}-empty`).hidden=false;}}finally{requestState.loading[kind]=false}}
function renderQueueRows(){const rows=requestState.queue,pending=rows.filter(r=>r.status==="Pending").length,processing=rows.filter(r=>r.status==="Processing").length;$("#queue-count").textContent=pending;if(requestState.dashboard?.metrics)$("#queue-stats").innerHTML=statCards({...requestState.dashboard.metrics,pending,processing});$("#queue-table").innerHTML=rows.map(r=>{const details=requestDetailsText(r.raw),canFinish=r.status==="Processing"&&(authState.user.role!=="CSP_STAFF"||r.takenById===authState.user.userId),handler=r.status==="Processing"?`<strong>Processing by ${escapeHtml(r.takenByName||"Unknown")}</strong>`:"—";return `<tr><td><strong>${ageFrom(r.requestedAt)}</strong></td><td><button class="ticket-button" data-ticket="${escapeHtml(r.requestId)}">${escapeHtml(r.requestId)}</button></td><td><strong>${escapeHtml(r.brand)}</strong></td><td>${escapeHtml(r.requestType)}</td><td><strong>${escapeHtml(details[0]||"—")}</strong><span class="sub-detail">${escapeHtml(details.slice(1).join(" / ")||"—")}</span></td><td>${escapeHtml(r.requestedByName||"—")}</td><td>${statusBadge(r.status)}</td><td>${handler}</td><td><div class="action-group"><button class="action-button" data-ticket="${escapeHtml(r.requestId)}">View</button>${r.status==="Pending"?`<button class="action-button primary" data-take="${escapeHtml(r.requestId)}">Take Request</button>`:canFinish?`<button class="action-button success" data-complete="${escapeHtml(r.requestId)}">Complete</button><button class="action-button danger" data-unable="${escapeHtml(r.requestId)}">Unable</button>`:""}</div></td></tr>`}).join("");$("#queue-empty").hidden=rows.length>0;$(".live-indicator").innerHTML='<i></i> Last updated '+new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
async function loadQueue({silent=false}={}){if(requestState.loading.queue||requestState.mutating.queue)return;requestState.loading.queue=true;const initial=!requestState.loaded.queue,sequence=(requestState.sequence.queue||0)+1;requestState.sequence.queue=sequence;if(initial)setTableLoading("#queue-table",9);try{const data=await authenticatedPost("cspQueue");if(sequence!==requestState.sequence.queue)return;requestState.queue=(data.requests||[]).map(normalizeRequest);requestState.loaded.queue=true;renderQueueRows();}catch(e){if(e.code!=="UNAUTHORIZED"&&!silent)showToast(e.message);if(initial){$("#queue-table").innerHTML='<tr class="table-loading"><td colspan="9">Unable to load the CSP queue. <button class="text-button" data-retry-queue>Retry</button></td></tr>';}}finally{requestState.loading.queue=false}}
async function loadCatalogs(){try{const [brands,types]=await Promise.all([apiGet("brands"),apiGet("requestTypes")]);catalogState.brands=brands||[];catalogState.requestTypes=types||[];const brandCodes=catalogState.brands.map(x=>x.code);["brand","my-brand","team-brand"].forEach(id=>replaceOptions($(`#${id}`),brandCodes,id==="brand"?"Select brand":"All brands"));const typeNames=catalogState.requestTypes.map(x=>x.requestType);["request-type","my-type","team-type"].forEach(id=>{const el=$(`#${id}`);if(el)replaceOptions(el,typeNames,id==="request-type"?"Select request type":"All request types")});}catch(e){showToast(e.message)}}
function replaceOptions(select,values,first){if(!select)return;select.innerHTML=`<option value="">${first}</option>`;fillSelect(select,values)}
function renderDynamicFields(type){const container=$("#dynamic-fields"),definition=catalogState.requestTypes.find(x=>x.requestType===type);if(!definition){container.innerHTML='<div class="form-placeholder"><span>↖</span><p>Select a request type to see the required details.</p></div>';return}const required=definition.requiredFields||[],fields=[...required,...(definition.optionalFields||[]).filter(x=>!required.includes(x))].filter(x=>FIELD_META[x]);container.innerHTML=`<div class="form-section-title"><span>2</span><div><h3>Request details</h3><p>Provide accurate information for ${escapeHtml(type.toLowerCase())}.</p></div></div><div class="form-grid two">${fields.map(name=>{const [key,label,inputType]=FIELD_META[name],req=required.includes(name);return `<div class="field ${inputType==="textarea"?"full-width":""}"><label for="field-${key}">${label}${req?' <em>*</em>':''}</label>${inputType==="textarea"?`<textarea id="field-${key}" name="${key}" rows="3" ${req?"required":""}></textarea>`:`<input id="field-${key}" name="${key}" type="${inputType}" ${req?"required":""}>`}<small class="error-text">This field is required.</small></div>`}).join("")}</div>`;}
function requestPayloadFromForm(){const data=new FormData($("#request-form")),payload={brand:data.get("brand"),requestType:data.get("requestType")};for(const meta of Object.values(FIELD_META)){const value=data.get(meta[0]);if(value!==null&&String(value).trim())payload[meta[0]]=String(value).trim()}return payload}
async function submitRequest(event){event.preventDefault();const form=event.currentTarget;if(!form.checkValidity()){form.reportValidity();return}await createLiveRequest(requestPayloadFromForm(),false,form)}
async function createLiveRequest(payload,confirmDuplicate,form=$("#request-form")){setFormBusy(form,true,"Submitting…");try{const data=await authenticatedPost("createRequest",{...payload,confirmDuplicate});if(data.duplicateWarning&&!confirmDuplicate){requestState.duplicatePayload=payload;renderDuplicates(data.similarRequests||[]);openModal("duplicate-modal");return}const ticket=data.ticket||data.request?.Request_ID;form.reset();renderDynamicFields("");showToast(`Request ${ticket} submitted successfully.`);navigate("my-requests");await Promise.all([loadRequestList("my"),loadDashboard()]);}catch(e){showToast(e.message)}finally{setFormBusy(form,false)}}
function renderDuplicates(items){$("#duplicate-list").innerHTML=items.map(r=>`<div class="duplicate-item"><strong>${escapeHtml(r.requestId)}</strong><span>${escapeHtml(r.brand)} · ${escapeHtml(r.requestType)} · ${escapeHtml(r.status)}</span><small>${escapeHtml(r.requestedBy||"—")} · ${escapeHtml(formatDate(r.requestedAt))}</small></div>`).join("")}
function detailsActionBar(raw){const r=normalizeRequest(raw),csp=["CSP_STAFF","CSP_ADMIN","SUPER_ADMIN"].includes(authState.user.role),canFinish=r.status==="Processing"&&(authState.user.role!=="CSP_STAFF"||r.takenById===authState.user.userId);if(!csp)return "";if(r.status==="Pending")return `<div class="details-action-bar"><button class="primary-button" data-take="${escapeHtml(r.requestId)}">Take Request</button></div>`;if(canFinish)return `<div class="details-action-bar"><span>Processing by ${escapeHtml(r.takenByName||authState.user.name)}</span><div><button class="action-button success" data-complete="${escapeHtml(r.requestId)}">Complete</button><button class="action-button danger" data-unable="${escapeHtml(r.requestId)}">Unable</button></div></div>`;if(r.status==="Processing")return `<div class="details-action-bar"><span>Processing by ${escapeHtml(r.takenByName||"another CSP staff member")}</span></div>`;return ""}
async function openDetails(ticket){requestState.activeDetailId=ticket;$("#details-content").innerHTML='<div class="details-body table-loading">Loading request details…</div>';openModal("details-modal");try{const data=await authenticatedPost("requestDetails",{requestId:ticket}),r=data.request||{};if(requestState.activeDetailId!==ticket)return;const fields=["Brand","Player_Username","Affiliate_Username","Phone_Number","Email","Current_Email","New_Email","Current_Name","New_Full_Name","Current_Player_Username","New_Player_Username","Transaction_ID","Amount","Notes","Requested_By_Name","Requested_At","Taken_By_Name","Taken_At","Completed_By_Name","Completed_At","Unable_Reason","Waiting_Seconds","Handling_Seconds","Total_Seconds"].filter(k=>r[k]!==""&&r[k]!=null);const timing=["Waiting_Seconds","Handling_Seconds","Total_Seconds"];$("#details-content").innerHTML=`<div class="details-head">${statusBadge(r.Status)}<h2 id="details-title">${escapeHtml(r.Request_ID)}</h2><p>${escapeHtml(r.Request_Type)}</p></div><div class="details-body"><div class="detail-grid">${fields.map(k=>{const label=(FIELD_META[k]?.[1]||DETAIL_LABELS[k]||k.replaceAll("_"," ")),value=timing.includes(k)?formatDuration(r[k]):k.endsWith("_At")?formatDate(r[k]):r[k],copy=FIELD_META[k]&&!timing.includes(k);return `<div class="detail-item"><label>${escapeHtml(label)}</label><div class="detail-value"><span>${escapeHtml(value)}</span>${copy?`<button class="copy-button" data-copy="${escapeHtml(value)}">Copy</button>`:""}</div></div>`}).join("")}</div>${detailsActionBar(r)}<div class="history-timeline"><h3>Request History</h3>${(data.history||[]).map(h=>`<div class="history-entry"><i></i><div><strong>${escapeHtml(h.Action)}</strong><span>${escapeHtml(h.Performed_By_Name||"System")} · ${escapeHtml(formatDate(h.Created_At))}</span>${h.Details?`<p>${escapeHtml(h.Details)}</p>`:""}</div></div>`).join("")||"<p>No history available.</p>"}</div></div>`;}catch(e){closeModals();showToast(e.message)}}
function openModal(id){const modal=$(`#${id}`);modal.hidden=false;document.body.style.overflow="hidden";setTimeout(()=>$(".modal-close",modal).focus(),0)}
function closeModals(){ $$(".modal-backdrop").forEach(m=>m.hidden=true); clearSensitiveFields(); document.body.style.overflow=""; }
async function copyValue(value){try{await navigator.clipboard.writeText(value);showToast("Copied to clipboard.")}catch{showToast("Clipboard access is unavailable in this browser.")}}

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

async function mutateRequest(action, requestId, payload, successMessage, button, options={}) {
  if (button) { button.disabled=true; button.dataset.oldText=button.textContent; button.textContent="Working…"; }
  if(["takeRequest","completeRequest","unableRequest"].includes(action))requestState.mutating.queue=true;
  try { const result=await authenticatedPost(action,{requestId,...payload});if(action==="takeRequest"&&result?.request){const updated=normalizeRequest(result.request),index=requestState.queue.findIndex(r=>r.requestId===requestId);if(index>=0)requestState.queue[index]=updated;renderQueueRows();}closeModals();showToast(successMessage);requestState.mutating.queue=false;await Promise.all([loadDashboard({silent:true}),allowedViews().includes("csp-queue")?loadQueue({silent:true}):Promise.resolve(),allowedViews().includes("my-requests")?loadRequestList("my",{silent:true}):Promise.resolve(),allowedViews().includes("team-requests")?loadRequestList("team",{silent:true}):Promise.resolve()]);if(action==="takeRequest"||options.reopenDetails)await openDetails(requestId); }
  catch(e){const handler=e.data?.handler?` Current handler: ${e.data.handler}.`:"";showToast(`${e.message}${handler}`);if(action==="takeRequest")setTimeout(()=>loadQueue({silent:true}),0)}
  finally { requestState.mutating.queue=false;if(button){button.disabled=false;button.textContent=button.dataset.oldText||"Confirm"} }
}
function confirmRequestAction(title,copy,label,callback){$("#request-confirm-title").textContent=title;$("#request-confirm-copy").textContent=copy;const button=$("#request-confirm-button");button.textContent=label;button.onclick=()=>callback(button);openModal("request-confirm-modal")}
function scheduleListLoad(kind){clearTimeout(requestState.filterTimers[kind]);requestState.filterTimers[kind]=setTimeout(()=>loadRequestList(kind),250)}
function startAutoRefresh(){clearInterval(requestState.refreshTimer);requestState.lastAutoRefresh=Date.now();requestState.refreshTimer=setInterval(()=>{if(!authState.user||document.hidden)return;const view=location.hash.slice(1),threshold=view==="csp-queue"?20000:30000;if(Date.now()-requestState.lastAutoRefresh<threshold)return;requestState.lastAutoRefresh=Date.now();if(view==="csp-queue")loadQueue({silent:true});else if(view==="dashboard")loadDashboard({silent:true});else if(view==="my-requests")loadRequestList("my",{silent:true});else if(view==="team-requests")loadRequestList("team",{silent:true})},5000)}

function initialize() {
  ["my-status","team-status"].forEach(id=>fillSelect($(`#${id}`),["Pending","Processing","Completed","Unable","Cancelled"]));
  $$(".nav-item").forEach(btn=>btn.addEventListener("click",()=>navigate(btn.dataset.view))); $$('[data-go]').forEach(btn=>btn.addEventListener("click",()=>navigate(btn.dataset.go)));
  $("#menu-button").addEventListener("click",openSidebar); $("#sidebar-overlay").addEventListener("click",closeSidebar); $("#request-type").addEventListener("change",e=>renderDynamicFields(e.target.value)); $("#request-form").addEventListener("submit",submitRequest);
  ["my-search","my-status","my-brand","my-type"].forEach(id=>$(`#${id}`).addEventListener("input",()=>scheduleListLoad("my"))); ["team-search","team-status","team-brand","team-type"].forEach(id=>$(`#${id}`).addEventListener("input",()=>scheduleListLoad("team")));
  $("#unable-reason").addEventListener("change",e=>{$("#other-reason-field").hidden=e.target.value!=="Other";$("#other-reason").required=e.target.value==="Other"});
  $("#unable-form").addEventListener("submit",async e=>{e.preventDefault();if(!e.currentTarget.checkValidity()){e.currentTarget.reportValidity();return}const reason=$("#unable-reason").value==="Other"?$("#other-reason").value.trim():$("#unable-reason").value;await mutateRequest("unableRequest",$("#unable-ticket").value,{reason},`Request ${$("#unable-ticket").value} marked unable.`,$('button[type="submit"]',e.currentTarget),{reopenDetails:requestState.reopenAfterMutation});requestState.reopenAfterMutation=false;e.currentTarget.reset();$("#other-reason-field").hidden=true});
  $("#submit-duplicate-button").addEventListener("click",async e=>{if(!requestState.duplicatePayload)return;const payload=requestState.duplicatePayload;requestState.duplicatePayload=null;closeModals();await createLiveRequest(payload,true,$("#request-form"))});
  document.addEventListener("click",e=>{const ticket=e.target.closest("[data-ticket]")?.dataset.ticket;if(ticket)openDetails(ticket);const take=e.target.closest("[data-take]")?.dataset.take;if(take&&["CSP_STAFF","CSP_ADMIN","SUPER_ADMIN"].includes(authState.user.role))mutateRequest("takeRequest",take,{},`Request ${take} is now processing.`,e.target);const complete=e.target.closest("[data-complete]")?.dataset.complete;if(complete&&["CSP_STAFF","CSP_ADMIN","SUPER_ADMIN"].includes(authState.user.role)){const reopen=!!e.target.closest("#details-modal");confirmRequestAction("Complete Request",`Mark ${complete} as completed?`,"Complete Request",button=>mutateRequest("completeRequest",complete,{},`Request ${complete} completed.`,button,{reopenDetails:reopen}))}const unable=e.target.closest("[data-unable]")?.dataset.unable;if(unable&&["CSP_STAFF","CSP_ADMIN","SUPER_ADMIN"].includes(authState.user.role)){requestState.reopenAfterMutation=!!e.target.closest("#details-modal");$("#unable-ticket").value=unable;openModal("unable-modal")}const cancel=e.target.closest("[data-cancel]")?.dataset.cancel;if(cancel&&["BDT_STAFF","SUPER_ADMIN"].includes(authState.user.role))confirmRequestAction("Cancel Request",`Cancel pending request ${cancel}?`,"Cancel Request",button=>mutateRequest("cancelRequest",cancel,{},`Request ${cancel} cancelled.`,button));if(e.target.closest("[data-retry-queue]"))loadQueue();if(e.target.closest("[data-close-modal]")||e.target.classList.contains("modal-backdrop"))closeModals();const copy=e.target.closest("[data-copy]")?.dataset.copy;if(copy)copyValue(copy)});
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
