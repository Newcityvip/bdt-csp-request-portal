const catalogState = { brands: [], requestTypes: [], loaded: false, loading: false };
const requestState = { dashboard: null, my: [], team: [], queue: [], queueMaster: [], bdtQueue: [], bdtQueueMaster: [], cspRequests: [], reports: [], reportCache: {}, activeReportKey: "", detailCache: {}, queueStatus: "Active", bdtQueueStatus: "Active", cspRequestsStatus: "All", queueVersion: 0, loading: {}, loaded: {}, sequence: {}, inFlight: {}, mutating: {}, duplicatePayload: null, submittedTicket: null, activeDetailId: null, refreshTimer: null, lastAutoRefresh: 0, filterTimers: {} };
const cspToolsState = { searchResults: [], inboxThreads: [], activeThread: "", inboxLoading: false, requestTypeFilters: [] };
const API_URL = "/api";
const API_TIMEOUT_MS = 28000;
const TOKEN_STORAGE_KEY = "opsRequestHubSession";
const DATA_CACHE_KEY = "opsRequestHubData";
const ROLE_ACCESS = {
  BDT_STAFF: { views: ["dashboard", "new-request", "my-requests", "team-requests", "bdt-queue"], defaultView: "dashboard", label: "BDT Staff" },
  CSP_STAFF: { views: ["dashboard", "csp-queue", "inbox", "ticket-search", "csp-requests", "new-csp-case"], defaultView: "csp-queue", label: "CSP Staff" },
  CSP_ADMIN: { views: ["dashboard", "csp-queue", "inbox", "ticket-search", "csp-requests", "new-csp-case", "reports"], defaultView: "csp-queue", label: "CSP Admin" },
  SUPER_ADMIN: { views: ["dashboard", "new-request", "my-requests", "team-requests", "csp-queue", "inbox", "ticket-search", "csp-requests", "new-csp-case", "reports", "user-management"], defaultView: "dashboard", label: "Super Admin" }
};
const authState = { user: null, token: null, loginPending: false };
const adminState = { users: [], loaded: false, loading: false };

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
const DETAIL_LABELS = { Brand:"Brand", Requested_By_Name:"Requested By", Requested_At:"Requested At", Taken_By_Name:"Handler", Taken_At:"Taken At", Completed_By_Name:"Completed By", Completed_At:"Completed At", Unable_Reason:"Unable Reason", Resolution_Remark:"Resolution Remark", Waiting_Seconds:"Waiting Time", Handling_Seconds:"Handling Time", Total_Seconds:"Total Time" };

const $ = (selector, root=document) => root.querySelector(selector);
const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
const statusBadge = status => `<span class="badge ${String(status).toLowerCase()}">${escapeHtml(status)}</span>`;

function fillSelect(select, values) { values.forEach(value => select.insertAdjacentHTML("beforeend", `<option value="${value}">${value}</option>`)); }
function showToast(message) { const toast=$("#toast"); toast.textContent=message; toast.classList.add("show"); clearTimeout(showToast.timer); showToast.timer=setTimeout(()=>toast.classList.remove("show"),3200); }

async function apiPost(action, payload = {}, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout || API_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      cache: "no-store",
      body: JSON.stringify({ action, ...payload }),
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new ApiError(options.timeoutMessage || "The service is taking too long. Please try again.", "UPSTREAM_TIMEOUT");
    throw new ApiError("Unable to reach the service. Please try again.", "NETWORK_ERROR");
  } finally {
    clearTimeout(timeout);
  }

  let result;
  try { result = await response.json(); }
  catch { throw new ApiError("The service returned an invalid response. Please try again.", "INVALID_RESPONSE"); }

  if (!result || result.ok !== true) {
    const code = result?.code || "REQUEST_ERROR";
    if (!options.skipExpiry && ["UNAUTHORIZED", "SESSION_EXPIRED", "AUTH_EXPIRED"].includes(code)) handleSessionExpiry();
    throw new ApiError(typeof result?.error === "string" ? result.error : "The request could not be completed.", code, result?.data);
  }
  return result.data;
}

async function apiGet(action, params = {}, options = {}) {
  return apiPost(action, params, options);
}

function authenticatedPost(action, payload = {}) {
  if (!authState.token) return Promise.reject(new ApiError("Authentication is required.", "UNAUTHORIZED"));
  return apiPost(action, { token: authState.token, ...payload });
}
function authenticatedRead(action,payload={}){const key=cacheKey(action,payload);if(requestState.inFlight[key])return requestState.inFlight[key];const promise=authenticatedPost(action,payload).finally(()=>delete requestState.inFlight[key]);requestState.inFlight[key]=promise;return promise}

function allowedViews() { return ROLE_ACCESS[authState.user?.role]?.views || []; }
function defaultView() { return ROLE_ACCESS[authState.user?.role]?.defaultView || "dashboard"; }
function cacheKey(resource,params={}){return `${resource}:${JSON.stringify(params)}`}
function saveSessionCache(){if(!authState.user)return;sessionStorage.setItem(DATA_CACHE_KEY,JSON.stringify({userId:authState.user.userId,catalogs:{brands:catalogState.brands,requestTypes:catalogState.requestTypes},dashboard:requestState.dashboard,my:requestState.my,team:requestState.team,queueMaster:requestState.queueMaster.map(row=>row.raw),cspRequests:requestState.cspRequests,reportCache:requestState.reportCache,detailCache:requestState.detailCache,adminUsers:authState.user.role==="SUPER_ADMIN"&&adminState.loaded?adminState.users:undefined,loaded:{dashboard:!!requestState.loaded.dashboard,my:!!requestState.loaded.my,team:!!requestState.loaded.team,queue:!!requestState.loaded.queue,cspRequests:!!requestState.loaded.cspRequests,reports:!!requestState.loaded.reports}}))}
function restoreSessionCache(user){try{const data=JSON.parse(sessionStorage.getItem(DATA_CACHE_KEY)||"null");if(!data||data.userId!==user.userId)return;catalogState.brands=data.catalogs?.brands||[];catalogState.requestTypes=data.catalogs?.requestTypes||[];catalogState.loaded=!!(catalogState.brands.length||catalogState.requestTypes.length);requestState.dashboard=data.dashboard||null;requestState.my=data.my||[];requestState.team=data.team||[];requestState.queueMaster=(data.queueMaster||[]).map(normalizeRequest);requestState.cspRequests=data.cspRequests||[];requestState.reportCache=data.reportCache||{};requestState.detailCache=data.detailCache||{};if(user.role==="SUPER_ADMIN"&&Array.isArray(data.adminUsers)){adminState.users=data.adminUsers;adminState.loaded=true}requestState.loaded={...requestState.loaded,...data.loaded,queue:!!requestState.queueMaster.length,cspRequests:data.loaded?.cspRequests===true};}catch{sessionStorage.removeItem(DATA_CACHE_KEY)}}
function clearAuth() { localStorage.removeItem(TOKEN_STORAGE_KEY); sessionStorage.removeItem(DATA_CACHE_KEY); authState.token = null; authState.user = null; adminState.users = []; adminState.loaded = false; adminState.loading=false; catalogState.brands=[];catalogState.requestTypes=[];catalogState.loaded=false;cspToolsState.searchResults=[];cspToolsState.inboxThreads=[];cspToolsState.activeThread="";cspToolsState.inboxLoading=false;cspToolsState.requestTypeFilters=[];requestState.dashboard=null;requestState.my=[];requestState.team=[];requestState.queue=[];requestState.queueMaster=[];requestState.bdtQueue=[];requestState.bdtQueueMaster=[];requestState.cspRequests=[];requestState.queueVersion=0;requestState.reports=[];requestState.reportCache={};requestState.activeReportKey="";requestState.detailCache={};requestState.loaded={};requestState.inFlight={};requestState.mutating={};clearInterval(requestState.refreshTimer); Object.values(requestState.filterTimers).forEach(clearTimeout); requestState.refreshTimer=null; requestState.filterTimers={}; }
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
  restoreSessionCache(user);
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
  if(view==="dashboard"&&requestState.dashboard)renderDashboard(requestState.dashboard);
  if(view==="my-requests"&&requestState.loaded.my)renderRequestList("my");
  if(view==="team-requests"&&requestState.loaded.team)renderRequestList("team");
  if(view==="csp-queue")setQueueStatus(requestState.queueStatus);
  if(view==="csp-queue"&&requestState.loaded.queue)applyQueueFilter();
  if(view==="bdt-queue")setBdtQueueStatus(requestState.bdtQueueStatus);
  if(view==="bdt-queue"&&requestState.loaded.bdtQueue)applyBdtQueueFilter();
  if(view==="csp-requests"&&requestState.loaded.cspRequests)renderCspRequests();
  if (view === "user-management") loadUsers();
  if (view === "dashboard") loadDashboard();
  if (view === "my-requests") loadRequestList("my");
  if (view === "team-requests") loadRequestList("team");
  if (view === "csp-queue") { loadQueue(); loadDashboard(); }
  if (view === "bdt-queue") loadBdtQueue();
  if (view === "csp-requests") loadCspRequests();
  if (["my-requests","team-requests","reports"].includes(view)) loadRequestTypeFilters();
  if (view === "reports") loadReports();
  if (view === "inbox") loadInbox();
}
function openSidebar(){ $("#sidebar").classList.add("open"); $("#sidebar-overlay").classList.add("show"); $("#menu-button").setAttribute("aria-expanded","true"); }
function closeSidebar(){ $("#sidebar").classList.remove("open"); $("#sidebar-overlay").classList.remove("show"); $("#menu-button").setAttribute("aria-expanded","false"); }

const getField = (row, name) => row?.[name] ?? "";
function normalizeRequest(raw={}){return {raw,requestId:raw.Request_ID??raw.requestId??"",brand:raw.Brand??raw.brand??"",requestType:raw.Request_Type??raw.requestType??"",status:raw.Status??raw.status??"",requestedByName:raw.Requested_By_Name??raw.requestedByName??"",requestedAt:raw.Requested_At??raw.requestedAt??"",takenById:raw.Taken_By_ID??raw.takenById??"",takenByName:raw.Taken_By_Name??raw.takenByName??"",takenAt:raw.Taken_At??raw.takenAt??"",completedByName:raw.Completed_By_Name??raw.completedByName??"",completedAt:raw.Completed_At??raw.completedAt??""}}
function formatDate(value) { if (!value) return "—"; const date=new Date(value); return Number.isNaN(date.getTime())?"—":new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"}).format(date); }
function formatDuration(seconds) { const total=Number(seconds); if(!Number.isFinite(total))return "—"; if(total<60)return `${Math.max(0,Math.floor(total))}s`; if(total<3600)return `${Math.floor(total/60)}m`; return `${Math.floor(total/3600)}h ${Math.floor((total%3600)/60)}m`; }
function ageFrom(value){const ms=Date.now()-new Date(value).getTime();return Number.isFinite(ms)?formatDuration(Math.max(0,ms/1000)):"—"}
function requestDetailsText(r){return [getField(r,"Player_Username"),getField(r,"Affiliate_Username"),getField(r,"Phone_Number"),getField(r,"Email"),getField(r,"Transaction_ID")].filter(Boolean)}
function statCards(metrics){const items=[["Pending",metrics?.pending||0,"…","Pending"],["Processing",metrics?.processing||0,"↻","Processing"],["Completed Today",metrics?.completedToday||0,"✓","Completed"],["Unable Today",metrics?.unableToday||0,"!","Unable"]];return items.map(i=>`<button class="stat-card" data-metric-status="${i[3]}"><div class="stat-icon ${i[3].toLowerCase()}">${i[2]}</div><div><strong>${i[1]}</strong><span>${i[0]}</span></div></button>`).join("")}
function liveRow(r,team=false,my=false){const details=requestDetailsText(r);const id=getField(r,"Request_ID");return `<tr><td><button class="ticket-button" data-ticket="${escapeHtml(id)}">${escapeHtml(id)}</button></td><td><strong>${escapeHtml(getField(r,"Brand"))}</strong></td><td>${escapeHtml(getField(r,"Request_Type"))}</td><td><strong>${escapeHtml(details[0]||"—")}</strong><span class="sub-detail">${escapeHtml(details.slice(1).join(" / ")||"—")}</span></td>${team?`<td>${escapeHtml(getField(r,"Requested_By_Name")||"—")}</td>`:""}<td>${statusBadge(getField(r,"Status"))}</td><td>${escapeHtml(formatDate(getField(r,"Requested_At")))}</td><td>${escapeHtml(getField(r,"Taken_By_Name")||"—")}</td><td><div class="action-group"><button class="action-button" data-ticket="${escapeHtml(id)}">View</button>${my&&getField(r,"Status")==="Pending"?`<button class="action-button danger" data-cancel="${escapeHtml(id)}">Cancel</button>`:""}</div></td></tr>`}
function setTableLoading(id,cols){$(id).innerHTML=`<tr class="table-loading"><td colspan="${cols}">Loading requests…</td></tr>`}
function renderDashboard(data){$("#dashboard-stats").innerHTML=statCards(data.metrics);$("#queue-stats").innerHTML=statCards(data.metrics);const recent=data.recentRequests||[];$("#recent-requests").innerHTML=recent.map(r=>liveRow(r)).join("")||'<tr class="table-loading"><td colspan="8">No recent requests.</td></tr>'}
async function loadDashboard({silent=false}={}){if(requestState.loading.dashboard)return;requestState.loading.dashboard=true;const initial=!requestState.loaded.dashboard,sequence=(requestState.sequence.dashboard||0)+1;requestState.sequence.dashboard=sequence;try{const data=await authenticatedRead("dashboard");if(sequence!==requestState.sequence.dashboard)return;requestState.dashboard=data;requestState.loaded.dashboard=true;renderDashboard(data);saveSessionCache()}catch(e){if(e.code!=="UNAUTHORIZED"&&!silent)showToast(e.message);if(initial)$("#recent-requests").innerHTML='<tr class="table-loading"><td colspan="8">Unable to load dashboard requests.</td></tr>';}finally{requestState.loading.dashboard=false}}
function requestFilters(kind){return {search:$(`#${kind}-search`).value.trim().toLowerCase(),status:$(`#${kind}-status`).value,brand:$(`#${kind}-brand`).value,requestType:$(`#${kind}-type`)?.value||""}}
function filteredRequests(kind){const filters=requestFilters(kind);return requestState[kind].filter(row=>{const search=["Request_ID","Player_Username","Affiliate_Username","Phone_Number","Email","Transaction_ID"].map(field=>getField(row,field)).join(" ").toLowerCase();return(!filters.search||search.includes(filters.search))&&(!filters.status||getField(row,"Status")===filters.status)&&(!filters.brand||getField(row,"Brand")===filters.brand)&&(!filters.requestType||getField(row,"Request_Type")===filters.requestType)})}
function renderRequestList(kind){const team=kind==="team",rows=filteredRequests(kind);$( `#${kind}-requests-table`).innerHTML=rows.map(r=>liveRow(r,team,!team)).join("");$(`#${kind}-result-summary`).innerHTML=`Showing <strong>${rows.length}</strong> of ${requestState[kind].length} requests${requestState.loading[kind]?' <span class="refreshing-label">Refreshing…</span>':""}`;$(`#${kind}-empty`).hidden=rows.length>0}
async function loadRequestList(kind,{silent=false}={}){if(requestState.loading[kind])return;requestState.loading[kind]=true;const team=kind==="team",initial=!requestState.loaded[kind],sequence=(requestState.sequence[kind]||0)+1;requestState.sequence[kind]=sequence;if(initial)setTableLoading(`#${kind}-requests-table`,team?9:8);else renderRequestList(kind);try{const data=await authenticatedRead(team?"teamRequests":"myRequests",{limit:500});if(sequence!==requestState.sequence[kind])return;requestState[kind]=data.requests||[];requestState.loaded[kind]=true;saveSessionCache()}catch(e){if(e.code!=="UNAUTHORIZED"&&!silent)showToast(e.message);if(initial){$( `#${kind}-requests-table`).innerHTML="";$(`#${kind}-result-summary`).innerHTML=`Unable to load ${team?"team":"your"} requests. <button class="text-button" data-retry-list="${kind}">Retry</button>`;$(`#${kind}-empty`).hidden=false;}else $(`#${kind}-result-summary`).innerHTML+=` <span class="refresh-error">Refresh failed.</span> <button class="text-button" data-retry-list="${kind}">Retry</button>`}finally{requestState.loading[kind]=false;renderRequestList(kind)}}
function renderQueueRows(){const rows=requestState.queue,master=requestState.queueMaster,pending=master.filter(r=>r.status==="Pending").length,processing=master.filter(r=>r.status==="Processing").length;$("#queue-count").textContent=pending;if(requestState.dashboard?.metrics)$("#queue-stats").innerHTML=statCards({...requestState.dashboard.metrics,pending,processing});$("#queue-table").innerHTML=rows.map(r=>{const details=requestDetailsText(r.raw),canFinish=r.status==="Processing"&&(authState.user.role!=="CSP_STAFF"||r.takenById===authState.user.userId),handler=r.status==="Processing"?`<strong>Processing by ${escapeHtml(r.takenByName||"Unknown")}</strong>`:"—";return `<tr><td><strong>${ageFrom(r.requestedAt)}</strong></td><td><button class="ticket-button" data-ticket="${escapeHtml(r.requestId)}">${escapeHtml(r.requestId)}</button></td><td><strong>${escapeHtml(r.brand)}</strong></td><td>${escapeHtml(r.requestType)}</td><td><strong>${escapeHtml(details[0]||"—")}</strong><span class="sub-detail">${escapeHtml(details.slice(1).join(" / ")||"—")}</span></td><td>${escapeHtml(r.requestedByName||"—")}</td><td>${statusBadge(r.status)}</td><td>${handler}</td><td><div class="action-group"><button class="action-button" data-ticket="${escapeHtml(r.requestId)}">View</button>${r.status==="Pending"?`<button class="action-button primary" data-take="${escapeHtml(r.requestId)}">Take Request</button>`:canFinish?`<button class="action-button success" data-complete="${escapeHtml(r.requestId)}">Complete</button><button class="action-button danger" data-unable="${escapeHtml(r.requestId)}">Unable</button>`:""}</div></td></tr>`}).join("");$("#queue-empty").hidden=rows.length>0;$(".live-indicator").innerHTML='<i></i> Last updated '+new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
function setQueueStatus(status){requestState.queueStatus=status;$$('[data-queue-status]').forEach(button=>button.classList.toggle("active",button.dataset.queueStatus===status))}
function applyQueueFilter(){const status=requestState.queueStatus,search=($("#queue-search")?.value||"").trim().toLowerCase();requestState.queue=requestState.queueMaster.filter(row=>(status==="All"||(status==="Active"?["Pending","Processing"].includes(row.status):row.status===status))&&(!search||requestDetailsText(row.raw).concat([row.requestId,row.brand,row.requestType,row.requestedByName,row.takenByName]).join(" ").toLowerCase().includes(search)));renderQueueRows()}
async function loadQueue({silent=false,force=false}={}){if(requestState.loaded.queue){applyQueueFilter();if(!force&&requestState.loading.queue)return;$(".live-indicator").innerHTML="<i></i> Refreshing…"}if(requestState.loading.queue||Object.keys(requestState.mutating).length)return;requestState.loading.queue=true;const initial=!requestState.loaded.queue,version=requestState.queueVersion,sequence=(requestState.sequence.queue||0)+1;requestState.sequence.queue=sequence;if(initial)setTableLoading("#queue-table",9);try{const data=await authenticatedRead("cspQueue",{status:"All",limit:500});if(sequence!==requestState.sequence.queue||version!==requestState.queueVersion)return;requestState.queueMaster=(data.requests||[]).map(normalizeRequest);requestState.loaded.queue=true;applyQueueFilter();saveSessionCache()}catch(e){if(e.code!=="UNAUTHORIZED"&&!silent)showToast(e.message);if(initial)$("#queue-table").innerHTML='<tr class="table-loading"><td colspan="9">Unable to load the CSP queue. <button class="text-button" data-retry-queue>Retry</button></td></tr>';else $(".live-indicator").innerHTML='<span class="refresh-error">Refresh failed —</span> <button class="text-button" data-retry-queue>Retry</button>'}finally{requestState.loading.queue=false}}
function renderBdtQueueRows(){const rows=requestState.bdtQueue,master=requestState.bdtQueueMaster,pending=master.filter(r=>r.status==="Pending").length,processing=master.filter(r=>r.status==="Processing").length;$("#bdt-queue-count").textContent=pending;$("#bdt-queue-stats").innerHTML=statCards({pending,processing,completedToday:0,unableToday:0});$("#bdt-queue-table").innerHTML=rows.map(r=>{const details=requestDetailsText(r.raw),canFinish=r.status==="Processing"&&r.takenById===authState.user.userId,handler=r.status==="Processing"?`<strong>Processing by ${escapeHtml(r.takenByName||"Unknown")}</strong>`:"—";return `<tr><td><strong>${ageFrom(r.requestedAt)}</strong></td><td><button class="ticket-button" data-ticket="${escapeHtml(r.requestId)}">${escapeHtml(r.requestId)}</button></td><td><strong>${escapeHtml(r.brand)}</strong></td><td>${escapeHtml(r.requestType)}</td><td><strong>${escapeHtml(details[0]||"—")}</strong><span class="sub-detail">${escapeHtml(details.slice(1).join(" / ")||"—")}</span></td><td>${escapeHtml(r.requestedByName||"—")}</td><td>${statusBadge(r.status)}</td><td>${handler}</td><td><div class="action-group"><button class="action-button" data-ticket="${escapeHtml(r.requestId)}">View</button>${r.status==="Pending"?`<button class="action-button primary" data-take="${escapeHtml(r.requestId)}">Take Request</button>`:canFinish?`<button class="action-button success" data-complete="${escapeHtml(r.requestId)}">Complete</button><button class="action-button danger" data-unable="${escapeHtml(r.requestId)}">Unable</button>`:""}</div></td></tr>`}).join("");$("#bdt-queue-empty").hidden=rows.length>0;$("#bdt-live-indicator").innerHTML='<i></i> Last updated '+new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
function setBdtQueueStatus(status){requestState.bdtQueueStatus=status;$$('[data-bdt-queue-status]').forEach(button=>button.classList.toggle("active",button.dataset.bdtQueueStatus===status))}
function applyBdtQueueFilter(){const status=requestState.bdtQueueStatus,search=($("#bdt-queue-search")?.value||"").trim().toLowerCase();requestState.bdtQueue=requestState.bdtQueueMaster.filter(row=>(status==="All"||(status==="Active"?["Pending","Processing"].includes(row.status):row.status===status))&&(!search||requestDetailsText(row.raw).concat([row.requestId,row.brand,row.requestType,row.requestedByName,row.takenByName]).join(" ").toLowerCase().includes(search)));renderBdtQueueRows()}
async function loadBdtQueue({silent=false,force=false}={}){if(requestState.loaded.bdtQueue){applyBdtQueueFilter();if(!force&&requestState.loading.bdtQueue)return;$("#bdt-live-indicator").innerHTML="<i></i> Refreshing…"}if(requestState.loading.bdtQueue||Object.keys(requestState.mutating).length)return;requestState.loading.bdtQueue=true;const initial=!requestState.loaded.bdtQueue,version=requestState.queueVersion,sequence=(requestState.sequence.bdtQueue||0)+1;requestState.sequence.bdtQueue=sequence;if(initial)setTableLoading("#bdt-queue-table",9);try{const data=await authenticatedRead("bdtQueue",{status:"All",limit:500});if(sequence!==requestState.sequence.bdtQueue||version!==requestState.queueVersion)return;requestState.bdtQueueMaster=(data.requests||[]).map(normalizeRequest);requestState.loaded.bdtQueue=true;applyBdtQueueFilter()}catch(e){if(e.code!=="UNAUTHORIZED"&&!silent)showToast(e.message);if(initial)$("#bdt-queue-table").innerHTML='<tr class="table-loading"><td colspan="9">Unable to load CSP requests. <button class="text-button" data-retry-bdt-queue>Retry</button></td></tr>';else $("#bdt-live-indicator").innerHTML='<span class="refresh-error">Refresh failed —</span> <button class="text-button" data-retry-bdt-queue>Retry</button>'}finally{requestState.loading.bdtQueue=false}}
function renderCspRequests(){const status=requestState.cspRequestsStatus,rows=requestState.cspRequests.filter(r=>status==="All"||getField(r,"Status")===status);$$('[data-csp-requests-status]').forEach(button=>button.classList.toggle("active",button.dataset.cspRequestsStatus===status));$("#csp-requests-table").innerHTML=rows.map(r=>{const id=getField(r,"Request_ID"),details=requestDetailsText(r);return `<tr><td><button class="ticket-button" data-ticket="${escapeHtml(id)}">${escapeHtml(id)}</button></td><td>${escapeHtml(getField(r,"Request_Type"))}</td><td><strong>${escapeHtml(details[0]||"—")}</strong><span class="sub-detail">${escapeHtml(details.slice(1).join(" / ")||"—")}</span></td><td>${statusBadge(getField(r,"Status"))}</td><td>${escapeHtml(formatDate(getField(r,"Requested_At")))}</td><td>${escapeHtml(getField(r,"Taken_By_Name")||"—")}</td><td>${escapeHtml(getField(r,"Resolution_Remark")||"—")}</td><td><button class="action-button" data-ticket="${escapeHtml(id)}">View</button></td></tr>`}).join("");$("#csp-requests-summary").innerHTML=`Showing <strong>${rows.length}</strong> of ${requestState.cspRequests.length} requests${requestState.loading.cspRequests?' <span class="refreshing-label">Refreshing…</span>':""}`;$("#csp-requests-empty").hidden=rows.length>0}
async function loadCspRequests({silent=false,force=false}={}){if(requestState.loading.cspRequests)return;if(requestState.loaded.cspRequests){renderCspRequests();if(!force)return}requestState.loading.cspRequests=true;const initial=!requestState.loaded.cspRequests,version=requestState.queueVersion,sequence=(requestState.sequence.cspRequests||0)+1;requestState.sequence.cspRequests=sequence;if(initial)setTableLoading("#csp-requests-table",8);else renderCspRequests();try{const data=await authenticatedRead("cspRequests",{limit:500});if(sequence!==requestState.sequence.cspRequests||version!==requestState.queueVersion)return;requestState.cspRequests=data.requests||[];requestState.loaded.cspRequests=true;saveSessionCache()}catch(e){if(e.code!=="UNAUTHORIZED"&&!silent)showToast(e.message);if(initial)$("#csp-requests-table").innerHTML='<tr class="table-loading"><td colspan="8">Unable to load CSP requests.</td></tr>'}finally{requestState.loading.cspRequests=false;if(requestState.loaded.cspRequests)renderCspRequests()}}
function populateCatalogs(){const brandCodes=catalogState.brands.map(x=>x.code);["brand","my-brand","team-brand","report-brand","csp-case-brand"].forEach(id=>replaceOptions($(`#${id}`),brandCodes,["brand","csp-case-brand"].includes(id)?"Select brand":"All brands"));const typeNames=catalogState.requestTypes.map(x=>x.requestType);["request-type","my-type","team-type","report-type"].forEach(id=>{const el=$(`#${id}`);if(el)replaceOptions(el,typeNames,id==="request-type"?"Select request type":"All request types")})}
async function loadCatalogs(){if(catalogState.loaded){populateCatalogs();return}if(catalogState.loading)return;catalogState.loading=true;try{const [brands,types]=await Promise.all([authenticatedRead("brands"),authenticatedRead("requestTypes")]);catalogState.brands=brands||[];catalogState.requestTypes=types||[];catalogState.loaded=true;populateCatalogs();saveSessionCache()}catch(e){showToast(e.message)}finally{catalogState.loading=false}}
function replaceOptions(select,values,first){if(!select)return;select.innerHTML=`<option value="">${first}</option>`;fillSelect(select,values)}
async function loadRequestTypeFilters(){if(cspToolsState.requestTypeFilters.length)return;try{const data=await authenticatedRead("requestTypeFilters");cspToolsState.requestTypeFilters=data.requestTypes||[];["my-type","team-type","report-type"].forEach(id=>replaceOptions($(`#${id}`),cspToolsState.requestTypeFilters,"All request types"))}catch(e){showToast(e.message)}}
function renderDynamicFields(type){const container=$("#dynamic-fields"),definition=catalogState.requestTypes.find(x=>x.requestType===type);if(!definition){container.innerHTML='<div class="form-placeholder"><span>↖</span><p>Select a request type to see the required details.</p></div>';return}const required=definition.requiredFields||[],fields=[...required,...(definition.optionalFields||[]).filter(x=>!required.includes(x))].filter(x=>FIELD_META[x]);container.innerHTML=`<div class="form-section-title"><span>2</span><div><h3>Request details</h3><p>Provide accurate information for ${escapeHtml(type.toLowerCase())}.</p></div></div><div class="form-grid two">${fields.map(name=>{const [key,label,inputType]=FIELD_META[name],req=required.includes(name);return `<div class="field ${inputType==="textarea"?"full-width":""}"><label for="field-${key}">${label}${req?' <em>*</em>':''}</label>${inputType==="textarea"?`<textarea id="field-${key}" name="${key}" rows="3" ${req?"required":""}></textarea>`:`<input id="field-${key}" name="${key}" type="${inputType}" ${req?"required":""}>`}<small class="error-text">This field is required.</small></div>`}).join("")}</div>`;}
function requestPayloadFromForm(){const data=new FormData($("#request-form")),payload={brand:data.get("brand"),requestType:data.get("requestType")};for(const meta of Object.values(FIELD_META)){const value=data.get(meta[0]);if(value!==null&&String(value).trim())payload[meta[0]]=String(value).trim()}return payload}
async function submitRequest(event){event.preventDefault();const form=event.currentTarget;if(!form.checkValidity()){form.reportValidity();return}await createLiveRequest(requestPayloadFromForm(),false,form)}
function submissionMatch(row,payload,started){const fields=[["Brand","brand"],["Request_Type","requestType"],["Player_Username","playerUsername"],["Affiliate_Username","affiliateUsername"],["Phone_Number","phoneNumber"],["Email","email"],["Transaction_ID","transactionId"]];return new Date(row.Requested_At).getTime()>=started-5000&&fields.every(([column,key])=>!payload[key]||String(row[column]||"").trim().toLowerCase()===String(payload[key]).trim().toLowerCase())}
async function reconcileSubmission(payload,started){try{const data=await authenticatedPost("myRequests",{limit:20});return (data.requests||[]).find(row=>submissionMatch(row,payload,started))||null}catch{return null}}
function showSubmissionSuccess(request){requestState.submittedTicket=getField(request,"Request_ID");const index=requestState.my.findIndex(r=>getField(r,"Request_ID")===requestState.submittedTicket);if(index<0)requestState.my.unshift(request);requestState.loaded.my=true;$("#request-success-ticket").textContent=requestState.submittedTicket;saveSessionCache();openModal("request-success-modal");Promise.allSettled([loadRequestList("my",{silent:true}),loadDashboard({silent:true})])}
async function createLiveRequest(payload,confirmDuplicate,form=$("#request-form")){const started=Date.now();setFormBusy(form,true,"Submitting…");try{const data=await authenticatedPost("createRequest",{...payload,confirmDuplicate});if(data.duplicateWarning&&!confirmDuplicate){requestState.duplicatePayload=payload;renderDuplicates(data.similarRequests||[]);openModal("duplicate-modal");return}const request=data.request||{Request_ID:data.ticket,Brand:payload.brand,Request_Type:payload.requestType,Status:"Pending",Requested_By_Name:authState.user.name,Requested_At:new Date().toISOString()};form.reset();renderDynamicFields("");showSubmissionSuccess(request)}catch(e){if(["TIMEOUT","UPSTREAM_TIMEOUT"].includes(e.code)){showToast("Confirming whether your request was received…");const committed=await reconcileSubmission(payload,started);if(committed){form.reset();renderDynamicFields("");showSubmissionSuccess(committed);return}showToast("Submission could not be confirmed. Check My Requests before trying again.")}else showToast(e.message)}finally{setFormBusy(form,false)}}

function renderTicketSearch(){const rows=cspToolsState.searchResults;$("#ticket-search-results").innerHTML=rows.map(r=>`<tr><td><button class="ticket-button" data-ticket="${escapeHtml(r.Request_ID)}">${escapeHtml(r.Request_ID)}</button></td><td><strong>${escapeHtml(r.Brand||"—")}</strong></td><td>${escapeHtml(r.Request_Type||"—")}</td><td><strong>${escapeHtml(r.Player_Username||r.Affiliate_Username||"—")}</strong><span class="sub-detail">${escapeHtml(r.Player_Username&&r.Affiliate_Username?r.Affiliate_Username:"")}</span></td><td>${statusBadge(r.Status)}</td><td>${escapeHtml(r.Requested_By_Name||"—")}</td><td>${escapeHtml(r.Taken_By_Name||"—")}</td><td>${escapeHtml(formatDate(r.Requested_At))}</td><td><button class="action-button" data-ticket="${escapeHtml(r.Request_ID)}">View</button></td></tr>`).join("");$("#ticket-search-empty").hidden=rows.length>0}
async function submitTicketSearch(event){event.preventDefault();const form=event.currentTarget,query=$("#ticket-search-query").value.trim();if(!form.checkValidity()){form.reportValidity();return}setFormBusy(form,true,"Searching…");try{const data=await authenticatedPost("searchTickets",{query});cspToolsState.searchResults=data.requests||[];renderTicketSearch();$("#ticket-search-summary").textContent=`${data.count||0} ticket${data.count===1?"":"s"} found${data.count===data.limit?` (showing first ${data.limit})`:""}.`}catch(e){showToast(e.message)}finally{setFormBusy(form,false)}}

function renderCspCaseFields(type){const container=$("#csp-case-fields"),notes='<div class="field full-width"><label for="csp-case-notes">Notes</label><textarea id="csp-case-notes" rows="3" maxlength="2000"></textarea></div>',head=copy=>`<div class="form-section-title"><span>2</span><div><h3>Case details</h3><p>${copy}</p></div></div>`;if(type==="Wrong Currency Signup")container.innerHTML=`${head("Record the currency correction.")}<div class="form-grid two"><div class="field"><label for="csp-case-affiliate">Affiliate Username <em>*</em></label><input id="csp-case-affiliate" required maxlength="150"></div><div></div><div class="field"><label for="csp-case-current-currency">Current Currency <em>*</em></label><input id="csp-case-current-currency" required maxlength="30"></div><div class="field"><label for="csp-case-correct-currency">Correct Currency <em>*</em></label><input id="csp-case-correct-currency" required maxlength="30"></div>${notes}</div>`;else if(type==="High Balance Unlock")container.innerHTML=`${head("Identify the player account.")}<div class="form-grid two"><div class="field"><label for="csp-case-player">Player Username <em>*</em></label><input id="csp-case-player" required maxlength="150"></div>${notes}</div>`;else if(type==="MAC Signup")container.innerHTML=`${head("Record the related affiliate accounts.")}<div class="form-grid two"><div class="field"><label for="csp-case-affiliate">Affiliate Username <em>*</em></label><input id="csp-case-affiliate" required maxlength="150"></div><div></div><div class="field"><label for="csp-case-account1-email">Account 1 Email</label><input id="csp-case-account1-email" type="email" maxlength="500"></div><div class="field"><label for="csp-case-account1-phone">Account 1 Phone Number</label><input id="csp-case-account1-phone" type="tel" maxlength="500"></div><div class="field"><label for="csp-case-account2-email">Account 2 Email</label><input id="csp-case-account2-email" type="email" maxlength="500"></div><div class="field"><label for="csp-case-account2-phone">Account 2 Phone Number</label><input id="csp-case-account2-phone" type="tel" maxlength="500"></div>${notes}</div>`;else if(type==="Affiliate Change Full Name & DOB")container.innerHTML=`${head("Record the affiliate identity change.")}<div class="form-grid two"><div class="field"><label for="csp-case-affiliate">Affiliate Username <em>*</em></label><input id="csp-case-affiliate" required maxlength="150"></div><div></div><div class="field"><label for="csp-case-current-name">Current Full Name <em>*</em></label><input id="csp-case-current-name" required maxlength="500"></div><div class="field"><label for="csp-case-new-name">New Full Name <em>*</em></label><input id="csp-case-new-name" required maxlength="500"></div><div class="field"><label for="csp-case-current-dob">Current DOB <em>*</em></label><input id="csp-case-current-dob" type="date" required></div><div class="field"><label for="csp-case-new-dob">New DOB <em>*</em></label><input id="csp-case-new-dob" type="date" required></div><div class="field full-width"><label for="csp-case-attachment">Attachment</label><input id="csp-case-attachment" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"><small>Optional · JPG, JPEG, PNG or WEBP · maximum 5 MB</small></div>${notes}</div>`;else container.innerHTML='<div class="form-placeholder"><span>↖</span><p>Select a case type to see the required details.</p></div>'}
async function cspAttachmentPayload(){const file=$("#csp-case-attachment")?.files?.[0];if(!file)return null;const allowed=["image/jpeg","image/png","image/webp"];if(!allowed.includes(file.type))throw new ApiError("Attachment must be a JPG, JPEG, PNG, or WEBP image.","INVALID_ATTACHMENT_TYPE");if(file.size>5*1024*1024)throw new ApiError("Attachment must be 5 MB or smaller.","ATTACHMENT_TOO_LARGE");const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new ApiError("The attachment could not be read.","INVALID_ATTACHMENT"));reader.readAsDataURL(file)});return {fileName:file.name,mimeType:file.type,base64:String(dataUrl).split(",")[1]||""}}
function cspCaseSubmissionMatch(row,payload,started){return new Date(row.Requested_At).getTime()>=started-5000&&row.Brand===payload.brand&&row.Request_Type===payload.requestType&&(!payload.playerUsername||row.Player_Username===payload.playerUsername)&&(!payload.affiliateUsername||row.Affiliate_Username===payload.affiliateUsername)&&row.Requested_By_ID===authState.user.userId}
async function reconcileCspCase(payload,started){try{const data=await authenticatedPost("cspRequests",{limit:20});return (data.requests||[]).find(row=>cspCaseSubmissionMatch(row,payload,started))||null}catch{return null}}
function showCreatedCspCase(data){showToast(`${data.ticket} created — sent to BDT as Pending`);if(data.request){requestState.queueVersion+=1;requestState.cspRequests.unshift(data.request);requestState.loaded.cspRequests=true;requestState.detailCache[data.ticket]={request:data.request,history:[]};saveSessionCache();openDetails(data.ticket);setTimeout(()=>loadDashboard({silent:true}),0)}}
async function submitCspCase(event){event.preventDefault();const form=event.currentTarget;if(!form.checkValidity()){form.reportValidity();return}const type=$("#csp-case-type").value,payload={brand:$("#csp-case-brand").value,requestType:type,playerUsername:$("#csp-case-player")?.value.trim()||"",affiliateUsername:$("#csp-case-affiliate")?.value.trim()||"",currentCurrency:$("#csp-case-current-currency")?.value.trim()||"",correctCurrency:$("#csp-case-correct-currency")?.value.trim()||"",account1Email:$("#csp-case-account1-email")?.value.trim()||"",account1Phone:$("#csp-case-account1-phone")?.value.trim()||"",account2Email:$("#csp-case-account2-email")?.value.trim()||"",account2Phone:$("#csp-case-account2-phone")?.value.trim()||"",currentFullName:$("#csp-case-current-name")?.value.trim()||"",newFullName:$("#csp-case-new-name")?.value.trim()||"",currentDob:$("#csp-case-current-dob")?.value||"",newDob:$("#csp-case-new-dob")?.value||"",notes:$("#csp-case-notes")?.value.trim()||""},started=Date.now();setFormBusy(form,true,"Creating…");try{payload.attachment=await cspAttachmentPayload();const data=await authenticatedPost("createCspCase",payload);form.reset();renderCspCaseFields("");showCreatedCspCase(data)}catch(e){if(["TIMEOUT","UPSTREAM_TIMEOUT"].includes(e.code)){showToast("Confirming whether your CSP request was received…");const committed=await reconcileCspCase(payload,started);if(committed){form.reset();renderCspCaseFields("");showCreatedCspCase({ticket:committed.Request_ID,request:committed});return}showToast("Submission could not be confirmed. Check CSP Requests before trying again.")}else showToast(e.message)}finally{setFormBusy(form,false)}}

function inboxIsAdmin(){return ["CSP_ADMIN","SUPER_ADMIN"].includes(authState.user?.role)}
function renderInboxList(data){cspToolsState.inboxThreads=data.threads||[];const badge=$("#inbox-count");badge.textContent=data.unreadCount||0;badge.hidden=!data.unreadCount;$("#inbox-summary").textContent=`${cspToolsState.inboxThreads.length} conversation${cspToolsState.inboxThreads.length===1?"":"s"}`;$("#inbox-threads").innerHTML=cspToolsState.inboxThreads.map(item=>`<button class="inbox-thread${item.unread?" unread":""}${item.Thread_ID===cspToolsState.activeThread?" active":""}" data-inbox-thread="${escapeHtml(item.Thread_ID)}"><span><strong>${escapeHtml(item.Subject)}</strong>${item.Priority==="Important"?'<b class="priority-tag">Important</b>':""}</span><small>${escapeHtml(item.Sender_Name)} · ${escapeHtml(formatDate(item.Created_At))}</small><p>${escapeHtml(item.Message)}</p></button>`).join("")||'<div class="empty-state"><span>✉</span><h3>Inbox is clear</h3><p>No conversations yet.</p></div>'}
async function loadInbox({silent=false}={}){if(cspToolsState.inboxLoading)return;cspToolsState.inboxLoading=true;try{const data=await authenticatedRead("inboxList");renderInboxList(data)}catch(e){if(!silent)showToast(e.message)}finally{cspToolsState.inboxLoading=false}}
function renderInboxThread(data){const messages=data.messages||[],first=messages[0];$("#inbox-conversation").innerHTML=first?`<div class="conversation-head"><p class="eyebrow">${escapeHtml(first.Priority||"Normal")} priority</p><h2>${escapeHtml(first.Subject)}</h2></div><div class="message-stream">${messages.map(message=>`<article class="inbox-message${message.Sender_User_ID===authState.user.userId?" own":""}"><div><strong>${escapeHtml(message.Sender_Name)}</strong><span>${escapeHtml(formatDate(message.Created_At))}</span></div><p>${escapeHtml(message.Message)}</p></article>`).join("")}</div><form id="inbox-reply-form" class="reply-form"><textarea id="inbox-reply-message" rows="3" maxlength="5000" placeholder="Write a reply…" required></textarea><button class="primary-button" type="submit">Reply</button></form>`:"";$("#inbox-reply-form")?.addEventListener("submit",submitInboxReply)}
async function openInboxThread(threadId){cspToolsState.activeThread=threadId;renderInboxList({threads:cspToolsState.inboxThreads,unreadCount:cspToolsState.inboxThreads.filter(x=>x.unread).length});$("#inbox-conversation").innerHTML='<div class="table-loading">Loading conversation…</div>';try{const data=await authenticatedPost("inboxThread",{threadId});renderInboxThread(data);authenticatedPost("inboxMarkRead",{threadId}).then(()=>loadInbox({silent:true})).catch(()=>{})}catch(e){showToast(e.message)}}
async function submitInboxReply(event){event.preventDefault();const form=event.currentTarget,message=$("#inbox-reply-message").value.trim();if(!message)return;setFormBusy(form,true,"Sending…");try{await authenticatedPost("inboxReply",{threadId:cspToolsState.activeThread,message});await openInboxThread(cspToolsState.activeThread);await loadInbox({silent:true})}catch(e){showToast(e.message)}finally{setFormBusy(form,false)}}
async function openInboxCompose(){const admin=inboxIsAdmin();$$('.inbox-admin-field').forEach(field=>field.hidden=!admin);$("#inbox-compose-title").textContent=admin?"New Announcement":"Message Supervisor";if(admin){try{const data=await authenticatedRead("inboxRecipients");replaceOptions($("#inbox-recipient"),(data.users||[]).map(user=>user.userId),"Select staff member");(data.users||[]).forEach(user=>{const option=[...$("#inbox-recipient").options].find(item=>item.value===user.userId);if(option)option.textContent=user.name})}catch(e){showToast(e.message);return}}openModal("inbox-compose-modal")}
async function submitInboxCompose(event){event.preventDefault();const form=event.currentTarget;if(!form.checkValidity()){form.reportValidity();return}const payload={subject:$("#inbox-subject").value.trim(),message:$("#inbox-message").value.trim()};if(inboxIsAdmin()){payload.recipientType=$("#inbox-audience").value;payload.recipientUserId=$("#inbox-recipient").value;payload.priority=$("#inbox-priority").value}setFormBusy(form,true,"Sending…");try{await authenticatedPost("inboxSend",payload);form.reset();closeModals();showToast("Message sent.");await loadInbox()}catch(e){showToast(e.message)}finally{setFormBusy(form,false)}}

function reportFilters(){return {fromDate:$("#report-from").value,toDate:$("#report-to").value,brand:$("#report-brand").value,requestType:$("#report-type").value,status:$("#report-status").value,requestedBy:$("#report-requester").value.trim(),handledBy:$("#report-handler").value.trim(),limit:500}}
function reportFilterLabels(){const f=reportFilters(),labels=[];if(f.fromDate||f.toDate)labels.push(`Date: ${f.fromDate||"Any"} → ${f.toDate||"Any"}`);if(f.brand)labels.push(`Brand: ${f.brand}`);if(f.requestType)labels.push(`Type: ${f.requestType}`);if(f.status)labels.push(`Status: ${f.status}`);if(f.requestedBy)labels.push(`Requested By: ${f.requestedBy}`);if(f.handledBy)labels.push(`Handled By: ${f.handledBy}`);return labels}
function renderReportFilters(){const labels=reportFilterLabels(),bar=$("#report-active-filters");bar.hidden=!labels.length;bar.innerHTML=labels.length?`<strong>Active filters</strong>${labels.map(label=>`<span>${escapeHtml(label)}</span>`).join("")}`:""}
function resetReportFilters(){["report-from","report-to","report-brand","report-type","report-status","report-requester","report-handler"].forEach(id=>{$(`#${id}`).value=""});renderReportFilters();loadReports()}
function updateReportEmpty(){if(requestState.reports.length)return;$("#report-table").innerHTML='<tr><td colspan="8"><div class="report-empty"><strong>No requests match the current filters.</strong><span>Review the active filters above or clear them to see all available requests.</span><button class="secondary-button" data-clear-report-filters type="button">Clear Filters</button></div></td></tr>'}
function reportCacheKey(){return cacheKey("reports",reportFilters())}
function cacheReport(key,data){requestState.reportCache[key]=data;const keys=Object.keys(requestState.reportCache);if(keys.length>6)delete requestState.reportCache[keys[0]]}
function renderReportData(data,refreshing=false){requestState.reports=data.requests||[];const m=data.metrics||{},cards=[["Total Requests",m.total],["Completed",m.completed],["Unable",m.unable],["Pending",m.pending],["Avg Waiting",formatDuration(m.averageWaiting)],["Avg Handling",formatDuration(m.averageHandling)],["Avg Resolution",formatDuration(m.averageTotal)]];$("#report-stats").innerHTML=cards.map(x=>`<article class="stat-card"><div><strong>${escapeHtml(x[1]??"—")}</strong><span>${escapeHtml(x[0])}</span></div></article>`).join("");$("#report-summary").innerHTML=`${requestState.reports.length} matching request${requestState.reports.length===1?"":"s"}${refreshing?' <span class="refreshing-label">Refreshing…</span>':""}`;$("#report-table").innerHTML=requestState.reports.map(r=>`<tr><td><button class="ticket-button" data-ticket="${escapeHtml(r.Request_ID)}">${escapeHtml(r.Request_ID)}</button></td><td>${escapeHtml(r.Brand)}</td><td>${escapeHtml(r.Request_Type)}</td><td>${statusBadge(r.Status)}</td><td>${escapeHtml(r.Requested_By_Name||"—")}</td><td>${escapeHtml(r.Taken_By_Name||"—")}</td><td>${escapeHtml(formatDate(r.Requested_At))}</td><td>${escapeHtml(formatDuration(r.Total_Seconds))}</td></tr>`).join("");if(!requestState.reports.length)updateReportEmpty()}
async function loadReports(){if(!["CSP_ADMIN","SUPER_ADMIN"].includes(authState.user?.role))return;const filters=reportFilters(),key=reportCacheKey(),cached=requestState.reportCache[key];requestState.activeReportKey=key;if(cached)renderReportData(cached,true);if(requestState.loading[key])return;requestState.loading[key]=true;if(!cached){$("#report-summary").textContent="Loading report…";$("#report-table").innerHTML='<tr class="table-loading"><td colspan="8">Loading report results…</td></tr>'}try{const data=await authenticatedRead("reports",filters);cacheReport(key,data);requestState.loaded.reports=true;if(requestState.activeReportKey===key)renderReportData(data);saveSessionCache()}catch(e){if(requestState.activeReportKey!==key)return;if(cached){renderReportData(cached);$("#report-summary").innerHTML+=` <span class="refresh-error">Refresh failed —</span> <button class="text-button" data-retry-reports>Retry</button>`}else{$("#report-summary").innerHTML=`Unable to load report. <button class="text-button" data-retry-reports>Retry</button>`;$("#report-table").innerHTML=""}}finally{delete requestState.loading[key]}}
function csvCell(value){const text=String(value??"");return `"${text.replaceAll('"','""')}"`}
function exportReports(){const fields=["Request_ID","Brand","Request_Type","Player_Username","Affiliate_Username","Phone_Number","Email","Status","Requested_By_ID","Requested_By_Name","Requested_At","Taken_By_ID","Taken_By_Name","Taken_At","Completed_By_ID","Completed_By_Name","Completed_At","Unable_Reason","Cancelled_By_ID","Cancelled_At","Waiting_Seconds","Handling_Seconds","Total_Seconds"],csv=[fields.join(","),...requestState.reports.map(r=>fields.map(f=>csvCell(r[f])).join(","))].join("\r\n"),url=URL.createObjectURL(new Blob(["\uFEFF",csv],{type:"text/csv;charset=utf-8"})),link=document.createElement("a");link.href=url;link.download=`ops-request-report-${new Date().toISOString().slice(0,10)}.csv`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function renderDuplicates(items){$("#duplicate-list").innerHTML=items.map(r=>`<div class="duplicate-item"><strong>${escapeHtml(r.requestId)}</strong><span>${escapeHtml(r.brand)} · ${escapeHtml(r.requestType)} · ${escapeHtml(r.status)}</span><small>${escapeHtml(r.requestedBy||"—")} · ${escapeHtml(formatDate(r.requestedAt))}</small></div>`).join("")}
function detailsActionBar(raw){const r=normalizeRequest(raw),cspToBdt=raw.Processing_Team==="BDT";if(cspToBdt){if(authState.user.role!=="BDT_STAFF")return "";if(r.status==="Pending")return `<div class="details-action-bar"><button class="primary-button" data-take="${escapeHtml(r.requestId)}">Take Request</button></div>`;if(r.status==="Processing"&&r.takenById===authState.user.userId)return `<div class="details-action-bar"><span>Processing by ${escapeHtml(r.takenByName||authState.user.name)}</span><div><button class="action-button success" data-complete="${escapeHtml(r.requestId)}">Complete</button><button class="action-button danger" data-unable="${escapeHtml(r.requestId)}">Unable</button></div></div>`;if(r.status==="Processing")return `<div class="details-action-bar"><span>Processing by ${escapeHtml(r.takenByName||"another BDT staff member")}</span></div>`;return ""}const csp=["CSP_STAFF","CSP_ADMIN","SUPER_ADMIN"].includes(authState.user.role),canFinish=r.status==="Processing"&&(authState.user.role!=="CSP_STAFF"||r.takenById===authState.user.userId);if(!csp)return "";if(r.status==="Pending")return `<div class="details-action-bar"><button class="primary-button" data-take="${escapeHtml(r.requestId)}">Take Request</button></div>`;if(canFinish)return `<div class="details-action-bar"><span>Processing by ${escapeHtml(r.takenByName||authState.user.name)}</span><div><button class="action-button success" data-complete="${escapeHtml(r.requestId)}">Complete</button><button class="action-button danger" data-unable="${escapeHtml(r.requestId)}">Unable</button></div></div>`;if(r.status==="Processing")return `<div class="details-action-bar"><span>Processing by ${escapeHtml(r.takenByName||"another CSP staff member")}</span></div>`;return ""}
function cachedRequest(ticket){return requestState.detailCache[ticket]?.request||requestState.queue.find(r=>r.requestId===ticket)?.raw||requestState.bdtQueue.find(r=>r.requestId===ticket)?.raw||[...requestState.my,...requestState.team,...requestState.cspRequests].find(r=>getField(r,"Request_ID")===ticket)||requestState.dashboard?.recentRequests?.find(r=>getField(r,"Request_ID")===ticket)}
function detailsCloseButton(){return '<button class="modal-close details-modal-close" data-close-modal aria-label="Close request details">×</button>'}
function detailSection(title,keys,r,timing=false){const fields=keys.filter(key=>r[key]!==""&&r[key]!=null);if(!fields.length)return "";return `<section class="detail-section"><h3>${escapeHtml(title)}</h3><div class="detail-grid">${fields.map(key=>{const label=FIELD_META[key]?.[1]||DETAIL_LABELS[key]||key.replaceAll("_"," "),value=timing?formatDuration(r[key]):key.endsWith("_At")?formatDate(r[key]):r[key],copy=!!FIELD_META[key]&&!timing,wide=key==="Notes"||key==="Unable_Reason"||key==="Resolution_Remark";return `<div class="detail-item${wide?" detail-item-wide":""}"><label>${escapeHtml(label)}</label><div class="detail-value"><span>${escapeHtml(value)}</span>${copy?`<button class="copy-button" data-copy="${escapeHtml(value)}">Copy</button>`:""}</div></div>`}).join("")}</div></section>`}
function timelineTone(history){const value=String(history.New_Status||history.Action||"").toLowerCase();return value.includes("complete")?"completed":value.includes("unable")?"unable":value.includes("cancel")?"cancelled":value.includes("taken")||value.includes("process")?"processing":"submitted"}
function detailsSkeleton(ticket){const raw=cachedRequest(ticket),r=raw?normalizeRequest(raw):null;return `<div class="details-head">${detailsCloseButton()}${r?statusBadge(r.status):'<span class="skeleton skeleton-badge"></span>'}<h2 id="details-title">${escapeHtml(r?.requestId||ticket)}</h2><p>${escapeHtml(r?[r.brand,r.requestType].filter(Boolean).join(" · "):"Loading request overview…")}</p></div><div class="details-body"><div class="detail-skeleton" aria-label="Loading request details"><span></span><span></span><span></span><span></span></div></div>`}
function renderDetails(data){const r=data.request||{},requestFields=["Brand","Player_Username","Affiliate_Username","Phone_Number","Email","Current_Email","New_Email","Current_Name","New_Full_Name","Current_Player_Username","New_Player_Username","Transaction_ID","Amount","Notes","Requested_By_Name"],workflowFields=["Requested_At","Taken_By_Name","Taken_At","Completed_By_Name","Completed_At","Unable_Reason","Resolution_Remark","Cancelled_At"],timingFields=["Waiting_Seconds","Handling_Seconds","Total_Seconds"],history=data.history||[],attachment=r.Has_Attachment?`<section class="detail-section"><h3>Attachment</h3><button class="secondary-button" data-view-attachment="${escapeHtml(r.Request_ID)}">View Attachment</button></section>`:"";$("#details-content").innerHTML=`<div class="details-head">${detailsCloseButton()}${statusBadge(r.Status)}<h2 id="details-title">${escapeHtml(r.Request_ID)}</h2><p>${escapeHtml([r.Brand,r.Request_Type].filter(Boolean).join(" · "))}</p><span class="details-meta">Service desk request overview</span></div><div class="details-body">${detailSection("Request Information",requestFields,r)}${attachment}${detailSection("Workflow",workflowFields,r)}${detailSection("Performance / Timing",timingFields,r,true)}<section class="detail-section history-timeline"><h3>Activity Timeline</h3>${history.map(h=>`<div class="history-entry ${timelineTone(h)}"><span class="history-icon" aria-hidden="true"></span><div><strong>${escapeHtml(h.Action)}</strong><span>${escapeHtml(h.Performed_By_Name||"System")} · ${escapeHtml(formatDate(h.Created_At))}</span>${h.Details?`<p>${escapeHtml(h.Details)}</p>`:""}</div></div>`).join("")||'<p class="timeline-empty">No activity recorded.</p>'}</section>${detailsActionBar(r)}</div>`}
async function openDetails(ticket){requestState.activeDetailId=ticket;const cached=requestState.detailCache[ticket],known=cached?.request||cachedRequest(ticket);if(cached)renderDetails(cached);else if(known)renderDetails({request:known,history:[]});else $("#details-content").innerHTML=detailsSkeleton(ticket);openModal("details-modal");try{const data=await authenticatedRead("requestDetails",{requestId:ticket});if(requestState.activeDetailId!==ticket)return;requestState.detailCache[ticket]=data;renderDetails(data);saveSessionCache()}catch(e){if(requestState.activeDetailId!==ticket)return;if(cached||known){$("#details-content").insertAdjacentHTML("afterbegin",`<div class="details-refresh-warning">Details could not be refreshed. <button class="text-button" data-retry-details="${escapeHtml(ticket)}">Retry</button></div>`)}else $("#details-content").innerHTML=`<div class="details-head details-head-error">${detailsCloseButton()}<h2 id="details-title">Request details</h2></div><div class="details-error"><span>!</span><h3>Unable to load request details</h3><p>${escapeHtml(e.message)}</p><div><button class="secondary-button" data-close-modal>Close</button><button class="primary-button" data-retry-details="${escapeHtml(ticket)}">Retry</button></div></div>`}}
async function openAttachment(ticket){$("#attachment-file-name").textContent="Loading attachment…";$("#attachment-image").removeAttribute("src");openModal("attachment-modal");try{const data=await authenticatedPost("requestAttachment",{requestId:ticket});$("#attachment-file-name").textContent=data.fileName||"Attachment";$("#attachment-image").src=`data:${data.mimeType};base64,${data.base64}`}catch(e){closeModals();showToast(e.message)}}
function openModal(id){const modal=$(`#${id}`);modal.hidden=false;document.body.style.overflow="hidden";setTimeout(()=>$(".modal-close",modal).focus(),0)}
function closeModals(){ $$(".modal-backdrop").forEach(m=>m.hidden=true); $("#attachment-image")?.removeAttribute("src"); clearSensitiveFields(); document.body.style.overflow=""; }
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

async function loadUsers({force=false}={}) {
  if (authState.user?.role !== "SUPER_ADMIN") return;
  if(adminState.loaded){renderUsers();$("#user-result-summary").innerHTML+= ' <span class="refreshing-label">Refreshing…</span>'}
  if(adminState.loading)return;
  adminState.loading=true;
  if(!adminState.loaded){$("#user-result-summary").textContent = "Loading users…";$("#users-table").innerHTML = '<tr class="table-loading"><td colspan="10">Loading user accounts…</td></tr>';$("#users-empty").hidden = true}
  try {
    const data = await authenticatedRead("listUsers");
    adminState.users = Array.isArray(data?.users) ? data.users : [];
    adminState.loaded = true;
    renderUsers();saveSessionCache();
  } catch (error) {
    if (error.code === "UNAUTHORIZED") return;
    if(adminState.loaded){renderUsers();$("#user-result-summary").innerHTML+= ' <span class="refresh-error">Refresh failed —</span> <button class="text-button" data-retry-users>Retry</button>'}
    else{$("#users-table").innerHTML = "";$("#user-result-summary").innerHTML = `Unable to load users. <button class="text-button" data-retry-users>Retry</button>`;$("#users-empty").hidden = false;$("#users-empty h3").textContent = "Unable to load users";$("#users-empty p").textContent = "Please retry when the service is available."}
  } finally {adminState.loading=false}
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
  $("#users-table").innerHTML = filtered.map(user => `<tr><td><strong>${escapeHtml(user.userId)}</strong></td><td><strong>${escapeHtml(user.name)}</strong></td><td><span class="username-text">${escapeHtml(user.username)}</span></td><td>${escapeHtml(user.team)}</td><td><span class="user-role">${escapeHtml(roleLabel(user.role))}</span></td><td>${statusBadge(user.status || "Inactive")}</td><td><span class="password-version">${escapeHtml(user.passwordVersion || "unknown")}</span></td><td>${escapeHtml(formatAdminDate(user.lastLogin))}</td><td>${escapeHtml(formatAdminDate(user.updatedAt))}</td><td><div class="user-actions"><button class="action-button" data-edit-user="${escapeHtml(user.userId)}">Edit</button><button class="action-button primary" data-reset-user="${escapeHtml(user.userId)}">Reset Password</button><button class="action-button ${user.status === "Active" ? "danger" : "success"} status-button" data-status-user="${escapeHtml(user.userId)}">${user.status === "Active" ? "Deactivate" : "Activate"}</button></div></td></tr>`).join("");
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
    const result=await authenticatedPost("createUser", { name: $("#add-user-name").value, username: $("#add-user-username").value, team: $("#add-user-team").value, role: $("#add-user-role").value, password });
    if(result?.user){adminState.users.push(result.user);adminState.loaded=true;renderUsers();saveSessionCache()}closeModals(); showToast("User created successfully."); setTimeout(()=>loadUsers({force:true}),0);
  } catch (error) { setFormMessage("add-user-message", error.message); }
  finally { setFormBusy(form, false); clearSensitiveFields(); }
}
async function submitEditUser(event) {
  event.preventDefault(); const form = event.currentTarget;
  setFormMessage("edit-user-message");
  if (!form.checkValidity()) { form.reportValidity(); return; }
  setFormBusy(form, true, "Saving…");
  try {
    const result=await authenticatedPost("updateUser", { userId: $("#edit-user-id").value, name: $("#edit-user-name").value, team: $("#edit-user-team").value, role: $("#edit-user-role").value });
    if(result?.user){const index=adminState.users.findIndex(user=>user.userId===result.user.userId);if(index>=0)adminState.users[index]=result.user;renderUsers();saveSessionCache()}closeModals(); showToast("User updated successfully."); setTimeout(()=>loadUsers({force:true}),0);
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
    closeModals(); showToast("Password reset successfully."); setTimeout(()=>loadUsers({force:true}),0);
  } catch (error) { setFormMessage("reset-password-message", error.message); }
  finally { setFormBusy(form, false); clearSensitiveFields(); }
}
async function submitUserStatus(event) {
  event.preventDefault(); const form = event.currentTarget;
  setFormMessage("user-status-message");
  setFormBusy(form, true, "Updating…");
  const status = $("#status-user-value").value;
  try {
    const result=await authenticatedPost("setUserStatus", { userId: $("#status-user-id").value, status });
    const userId=$("#status-user-id").value,index=adminState.users.findIndex(user=>user.userId===userId);if(result?.user&&index>=0)adminState.users[index]=result.user;else if(index>=0)adminState.users[index]={...adminState.users[index],status};renderUsers();saveSessionCache();closeModals(); showToast(`User ${status === "Active" ? "activated" : "deactivated"}.`); setTimeout(()=>loadUsers({force:true}),0);
  } catch (error) { setFormMessage("user-status-message", error.message); }
  finally { setFormBusy(form, false); }
}

async function restoreSession() {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (!token) { showLogin(); return; }
  try {
    const data = await apiPost("session", { token }, { skipExpiry: true, timeoutMessage: "Unable to restore your previous session." });
    if (!data?.user) throw new ApiError("Invalid session.", "UNAUTHORIZED");
    showPortal(data.user, token);
  } catch {
    clearAuth();
    showLogin("Unable to restore your previous session. Please sign in again.");
  }
}

async function submitLogin(event) {
  event.preventDefault();
  if (authState.loginPending) return;
  const form = event.currentTarget;
  const username = $("#login-username").value.trim();
  const password = $("#login-password").value;
  const error = $("#login-error");
  error.hidden = true;
  if (!username || !password) { error.textContent = "Enter your username and password."; error.hidden = false; return; }
  const button = $("#login-button");
  let failed = false;
  authState.loginPending = true;
  button.disabled = true;
  button.textContent = "Signing In…";
  try {
    const data = await apiPost("login", { username, password }, { skipExpiry: true, timeoutMessage: "Sign in is taking too long. Please try again." });
    if (!data?.token || !data?.user) throw new ApiError("Invalid login response.", "INVALID_RESPONSE");
    localStorage.setItem(TOKEN_STORAGE_KEY, data.token);
    form.reset();
    showPortal(data.user, data.token);
  } catch (apiError) {
    failed = true;
    if (apiError.code === "INVALID_CREDENTIALS") error.textContent = "Invalid username or password.";
    else if (["TIMEOUT", "UPSTREAM_TIMEOUT", "UPSTREAM_UNAVAILABLE", "NETWORK_ERROR"].includes(apiError.code)) error.textContent = "The authentication service is temporarily unavailable. Please try again.";
    else if (["UNAUTHORIZED", "SESSION_EXPIRED", "AUTH_EXPIRED"].includes(apiError.code)) error.textContent = "Authentication could not be completed. Please try again.";
    else error.textContent = apiError.message;
    error.hidden = false;
    $("#login-password").value = "";
    $("#login-password").focus();
  } finally {
    authState.loginPending = false;
    button.disabled = false;
    button.textContent = failed ? "Try Again" : "Sign In";
  }
}

async function logout() {
  const token = authState.token;
  try { if (token) await apiPost("logout", { token }, { skipExpiry: true }); }
  catch { /* Local logout must complete even if the service is unavailable. */ }
  finally { clearAuth(); closeSidebar(); closeModals(); history.replaceState(null, "", location.pathname + location.search); showLogin(); }
}

async function mutateRequest(action, requestId, payload, successMessage, button, options={}) {
  const busyLabels={takeRequest:"Taking…",completeRequest:"Completing…",unableRequest:"Updating…",cancelRequest:"Cancelling…"};
  if(requestState.mutating[requestId])return;
  requestState.mutating[requestId]=action;
  if (button) { button.disabled=true; button.dataset.oldText=button.textContent; button.textContent=busyLabels[action]||"Working…"; }
  const applyResult=result=>{if(!result?.request)return;const updated=normalizeRequest(result.request);requestState.queueVersion+=1;[["queueMaster","queue"],["bdtQueueMaster","bdtQueue"]].forEach(([master,loaded])=>{const index=requestState[master].findIndex(row=>row.requestId===requestId);if(index>=0)requestState[master][index]=updated;if(requestState.loaded[loaded])loaded==="queue"?applyQueueFilter():applyBdtQueueFilter()});const cspIndex=requestState.cspRequests.findIndex(row=>getField(row,"Request_ID")===requestId);if(cspIndex>=0)requestState.cspRequests[cspIndex]={...requestState.cspRequests[cspIndex],...result.request};if(requestState.loaded.cspRequests)renderCspRequests();const cached=requestState.detailCache[requestId];requestState.detailCache[requestId]=cached?{...cached,request:{...cached.request,...result.request}}:{request:result.request,history:[]};saveSessionCache()};
  try { const result=await authenticatedPost(action,{requestId,...payload});applyResult(result);closeModals();showToast(action==="takeRequest"?`${requestId} taken successfully — now in Processing`:successMessage);if(action==="takeRequest"||options.reopenDetails)openDetails(requestId);setTimeout(()=>{loadDashboard({silent:true});if(allowedViews().includes("csp-queue"))loadQueue({silent:true,force:true});if(allowedViews().includes("bdt-queue"))loadBdtQueue({silent:true,force:true});if(allowedViews().includes("csp-requests"))loadCspRequests({silent:true,force:true})},0);return true; }
  catch(e){if(["TIMEOUT","UPSTREAM_TIMEOUT"].includes(e.code)){try{const confirmed=await authenticatedPost("requestDetails",{requestId}),expected={takeRequest:"Processing",completeRequest:"Completed",unableRequest:"Unable",cancelRequest:"Cancelled"}[action],record=confirmed?.request;if(record?.Status===expected){if(action==="takeRequest"&&record.Taken_By_ID!==authState.user.userId){showToast(`Request already taken by ${record.Taken_By_Name||"another CSP user"}.`);return false}applyResult({request:record});closeModals();showToast(action==="takeRequest"?`${requestId} taken successfully — now in Processing`:successMessage);if(action==="takeRequest"||options.reopenDetails)openDetails(requestId);return true}if(action==="takeRequest"&&record?.Status==="Processing")showToast(`Request already taken by ${record.Taken_By_Name||"another CSP user"}.`);else showToast("The update was not confirmed. You can safely retry.")}catch{showToast("The update could not be confirmed. Refresh before retrying.")}}else{const handler=e.data?.handler?` Current handler: ${e.data.handler}.`:"";showToast(`${e.message}${handler}`)}return false}
  finally { delete requestState.mutating[requestId];if(button){button.disabled=false;button.textContent=button.dataset.oldText||"Confirm"} }
}
function confirmRequestAction(title,copy,label,callback,showResolution=false){$("#request-confirm-title").textContent=title;$("#request-confirm-copy").textContent=copy;$("#complete-resolution-field").hidden=!showResolution;$("#complete-resolution-remark").value="";const button=$("#request-confirm-button");button.textContent=label;button.onclick=()=>callback(button);openModal("request-confirm-modal")}
function applyListFilters(kind,debounce=false){clearTimeout(requestState.filterTimers[kind]);if(!debounce){renderRequestList(kind);return}requestState.filterTimers[kind]=setTimeout(()=>renderRequestList(kind),150)}
function startAutoRefresh(){clearInterval(requestState.refreshTimer);requestState.lastAutoRefresh=Date.now();requestState.refreshTimer=setInterval(()=>{if(!authState.user||document.hidden||Object.keys(requestState.mutating).length)return;const view=location.hash.slice(1),threshold=["csp-queue","bdt-queue"].includes(view)?20000:30000;if(Date.now()-requestState.lastAutoRefresh<threshold)return;requestState.lastAutoRefresh=Date.now();if(view==="csp-queue")loadQueue({silent:true,force:true});else if(view==="bdt-queue")loadBdtQueue({silent:true,force:true});else if(view==="csp-requests")loadCspRequests({silent:true,force:true});else if(view==="dashboard")loadDashboard({silent:true});else if(view==="my-requests")loadRequestList("my",{silent:true});else if(view==="team-requests")loadRequestList("team",{silent:true});else if(view==="inbox")loadInbox({silent:true})},5000)}

function initialize() {
  const reportActions=$("#run-reports").parentElement;reportActions.classList.add("report-filter-actions");reportActions.insertAdjacentHTML("afterbegin",'<button class="secondary-button" id="reset-reports" type="button">Reset Filters</button>');$(".report-filters").insertAdjacentHTML("beforeend",'<div class="active-filter-bar" id="report-active-filters" hidden></div>');
  ["my-status","team-status"].forEach(id=>fillSelect($(`#${id}`),["Pending","Processing","Completed","Unable","Cancelled"]));
  $$(".nav-item").forEach(btn=>btn.addEventListener("click",()=>navigate(btn.dataset.view))); $$('[data-go]').forEach(btn=>btn.addEventListener("click",()=>navigate(btn.dataset.go)));
  $("#menu-button").addEventListener("click",openSidebar); $("#sidebar-overlay").addEventListener("click",closeSidebar); $("#request-type").addEventListener("change",e=>renderDynamicFields(e.target.value)); $("#request-form").addEventListener("submit",submitRequest);
  $("#ticket-search-form").addEventListener("submit",submitTicketSearch);$("#csp-case-type").addEventListener("change",e=>renderCspCaseFields(e.target.value));$("#csp-case-form").addEventListener("submit",submitCspCase);$("#new-inbox-message").addEventListener("click",openInboxCompose);$("#refresh-inbox").addEventListener("click",()=>loadInbox());$("#inbox-compose-form").addEventListener("submit",submitInboxCompose);$("#inbox-audience").addEventListener("change",e=>{$("#inbox-recipient-field").hidden=e.target.value!=="INDIVIDUAL_CSP"});
  ["my-status","my-brand","my-type"].forEach(id=>$(`#${id}`).addEventListener("change",()=>applyListFilters("my")));["team-status","team-brand","team-type"].forEach(id=>$(`#${id}`).addEventListener("change",()=>applyListFilters("team")));$("#my-search").addEventListener("input",()=>applyListFilters("my",true));$("#team-search").addEventListener("input",()=>applyListFilters("team",true));
  $("#unable-reason").addEventListener("change",e=>{$("#other-reason-field").hidden=e.target.value!=="Other";$("#other-reason").required=e.target.value==="Other"});
  $("#unable-form").addEventListener("submit",async e=>{e.preventDefault();if(!e.currentTarget.checkValidity()){e.currentTarget.reportValidity();return}const reason=$("#unable-reason").value==="Other"?$("#other-reason").value.trim():$("#unable-reason").value,remark=$("#unable-resolution-field").hidden?"":$("#unable-resolution-remark").value.trim(),updated=await mutateRequest("unableRequest",$("#unable-ticket").value,{reason,remark},`Request ${$("#unable-ticket").value} marked unable.`,$('button[type="submit"]',e.currentTarget),{reopenDetails:requestState.reopenAfterMutation});if(updated){requestState.reopenAfterMutation=false;e.currentTarget.reset();$("#other-reason-field").hidden=true}});
  $("#submit-duplicate-button").addEventListener("click",async e=>{if(!requestState.duplicatePayload)return;const payload=requestState.duplicatePayload;requestState.duplicatePayload=null;closeModals();await createLiveRequest(payload,true,$("#request-form"))});
  $("#queue-status-tabs").addEventListener("click",e=>{const status=e.target.closest("[data-queue-status]")?.dataset.queueStatus;if(!status)return;setQueueStatus(status);if(requestState.loaded.queue)applyQueueFilter();else loadQueue()});
  $("#queue-search").addEventListener("input",()=>{clearTimeout(requestState.filterTimers.queue);requestState.filterTimers.queue=setTimeout(()=>requestState.loaded.queue?applyQueueFilter():loadQueue({silent:true}),120)});
  $("#bdt-queue-status-tabs").addEventListener("click",e=>{const status=e.target.closest("[data-bdt-queue-status]")?.dataset.bdtQueueStatus;if(!status)return;setBdtQueueStatus(status);if(requestState.loaded.bdtQueue)applyBdtQueueFilter();else loadBdtQueue()});
  $("#bdt-queue-search").addEventListener("input",()=>{clearTimeout(requestState.filterTimers.bdtQueue);requestState.filterTimers.bdtQueue=setTimeout(()=>requestState.loaded.bdtQueue?applyBdtQueueFilter():loadBdtQueue({silent:true}),120)});
  $("#csp-requests-status-tabs").addEventListener("click",e=>{const status=e.target.closest("[data-csp-requests-status]")?.dataset.cspRequestsStatus;if(!status)return;requestState.cspRequestsStatus=status;renderCspRequests()});
  $("#run-reports").addEventListener("click",async()=>{renderReportFilters();await loadReports();updateReportEmpty()});$("#reset-reports").addEventListener("click",resetReportFilters);$("#export-reports").addEventListener("click",exportReports);
  $("#submit-another").addEventListener("click",()=>{closeModals();navigate("new-request")});$("#view-submitted-request").addEventListener("click",()=>{const ticket=requestState.submittedTicket;closeModals();navigate("my-requests");if(ticket)openDetails(ticket)});
  document.addEventListener("click",e=>{const metric=e.target.closest("[data-metric-status]")?.dataset.metricStatus;if(metric){if(e.target.closest("#bdt-queue-view")){requestState.bdtQueueStatus=metric;navigate("bdt-queue")}else if(["CSP_STAFF","CSP_ADMIN","SUPER_ADMIN"].includes(authState.user.role)){requestState.queueStatus=metric;navigate("csp-queue")}else{$("#my-status").value=metric;navigate("my-requests")}}const ticket=e.target.closest("[data-ticket]")?.dataset.ticket;if(ticket)openDetails(ticket);const attachment=e.target.closest("[data-view-attachment]")?.dataset.viewAttachment;if(attachment)openAttachment(attachment);const inboxThread=e.target.closest("[data-inbox-thread]")?.dataset.inboxThread;if(inboxThread)openInboxThread(inboxThread);const retryDetails=e.target.closest("[data-retry-details]")?.dataset.retryDetails;if(retryDetails)openDetails(retryDetails);const handlerRole=["BDT_STAFF","CSP_STAFF","CSP_ADMIN","SUPER_ADMIN"].includes(authState.user.role);const take=e.target.closest("[data-take]")?.dataset.take;if(take&&handlerRole)mutateRequest("takeRequest",take,{},`Request ${take} is now processing.`,e.target);const complete=e.target.closest("[data-complete]")?.dataset.complete;if(complete&&handlerRole){const reopen=!!e.target.closest("#details-modal"),cspToBdt=cachedRequest(complete)?.Processing_Team==="BDT";confirmRequestAction("Complete Request",`Mark ${complete} as completed?`,"Complete Request",button=>mutateRequest("completeRequest",complete,cspToBdt?{remark:$("#complete-resolution-remark").value.trim()}:{},`Request ${complete} completed.`,button,{reopenDetails:reopen}),cspToBdt)}const unable=e.target.closest("[data-unable]")?.dataset.unable;if(unable&&handlerRole){requestState.reopenAfterMutation=!!e.target.closest("#details-modal");$("#unable-ticket").value=unable;$("#unable-resolution-field").hidden=cachedRequest(unable)?.Processing_Team!=="BDT";$("#unable-resolution-remark").value="";openModal("unable-modal")}const cancel=e.target.closest("[data-cancel]")?.dataset.cancel;if(cancel&&["BDT_STAFF","SUPER_ADMIN"].includes(authState.user.role))confirmRequestAction("Cancel Request",`Cancel pending request ${cancel}?`,"Cancel Request",button=>mutateRequest("cancelRequest",cancel,{},`Request ${cancel} cancelled.`,button));if(e.target.closest("[data-retry-queue]"))loadQueue();if(e.target.closest("[data-retry-bdt-queue]"))loadBdtQueue();if(e.target.closest("[data-close-modal]")||e.target.classList.contains("modal-backdrop"))closeModals();const copy=e.target.closest("[data-copy]")?.dataset.copy;if(copy)copyValue(copy)});
  document.addEventListener("click",e=>{if(e.target.closest("[data-clear-report-filters]"))resetReportFilters();if(e.target.closest("[data-retry-reports]"))loadReports();if(e.target.closest("[data-retry-users]"))loadUsers({force:true});const kind=e.target.closest("[data-retry-list]")?.dataset.retryList;if(kind)loadRequestList(kind)});
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
