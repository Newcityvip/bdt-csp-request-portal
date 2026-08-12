const catalogState = { brands: [], requestTypes: [], loaded: false, loading: false };
const requestState = { dashboard: null, my: [], team: [], queue: [], queueCache: {}, reports: [], detailCache: {}, queueStatus: "Active", loading: {}, loaded: {}, sequence: {}, inFlight: {}, mutating: {}, duplicatePayload: null, submittedTicket: null, activeDetailId: null, refreshTimer: null, lastAutoRefresh: 0, filterTimers: {} };
const API_URL = "/api";
const API_TIMEOUT_MS = 28000;
const TOKEN_STORAGE_KEY = "opsRequestHubSession";
const DATA_CACHE_KEY = "opsRequestHubData";
const ROLE_ACCESS = {
  BDT_STAFF: { views: ["dashboard", "new-request", "my-requests", "team-requests"], defaultView: "dashboard", label: "BDT Staff" },
  CSP_STAFF: { views: ["dashboard", "csp-queue"], defaultView: "csp-queue", label: "CSP Staff" },
  CSP_ADMIN: { views: ["dashboard", "csp-queue", "reports"], defaultView: "csp-queue", label: "CSP Admin" },
  SUPER_ADMIN: { views: ["dashboard", "new-request", "my-requests", "team-requests", "csp-queue", "reports", "user-management"], defaultView: "dashboard", label: "Super Admin" }
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
function authenticatedRead(action,payload={}){const key=cacheKey(action,payload);if(requestState.inFlight[key])return requestState.inFlight[key];const promise=(async()=>{try{return await authenticatedPost(action,payload)}catch(error){if(!["TIMEOUT","UPSTREAM_TIMEOUT","UPSTREAM_UNAVAILABLE","NETWORK_ERROR"].includes(error.code))throw error;return authenticatedPost(action,payload)}})().finally(()=>delete requestState.inFlight[key]);requestState.inFlight[key]=promise;return promise}

function allowedViews() { return ROLE_ACCESS[authState.user?.role]?.views || []; }
function defaultView() { return ROLE_ACCESS[authState.user?.role]?.defaultView || "dashboard"; }
function cacheKey(resource,params={}){return `${resource}:${JSON.stringify(params)}`}
function saveSessionCache(){if(!authState.user)return;sessionStorage.setItem(DATA_CACHE_KEY,JSON.stringify({userId:authState.user.userId,catalogs:{brands:catalogState.brands,requestTypes:catalogState.requestTypes},dashboard:requestState.dashboard,my:requestState.my,team:requestState.team,queueCache:requestState.queueCache,reports:requestState.reports,detailCache:requestState.detailCache,loaded:{dashboard:!!requestState.loaded.dashboard,my:!!requestState.loaded.my,team:!!requestState.loaded.team,reports:!!requestState.loaded.reports}}))}
function restoreSessionCache(user){try{const data=JSON.parse(sessionStorage.getItem(DATA_CACHE_KEY)||"null");if(!data||data.userId!==user.userId)return;catalogState.brands=data.catalogs?.brands||[];catalogState.requestTypes=data.catalogs?.requestTypes||[];catalogState.loaded=!!(catalogState.brands.length||catalogState.requestTypes.length);requestState.dashboard=data.dashboard||null;requestState.my=data.my||[];requestState.team=data.team||[];requestState.queueCache=data.queueCache||{};requestState.reports=data.reports||[];requestState.detailCache=data.detailCache||{};requestState.loaded={...requestState.loaded,...data.loaded};}catch{sessionStorage.removeItem(DATA_CACHE_KEY)}}
function clearAuth() { localStorage.removeItem(TOKEN_STORAGE_KEY); sessionStorage.removeItem(DATA_CACHE_KEY); authState.token = null; authState.user = null; adminState.users = []; adminState.loaded = false; catalogState.brands=[];catalogState.requestTypes=[];catalogState.loaded=false;requestState.dashboard=null;requestState.my=[];requestState.team=[];requestState.queue=[];requestState.queueCache={};requestState.reports=[];requestState.detailCache={};requestState.loaded={};requestState.inFlight={};clearInterval(requestState.refreshTimer); Object.values(requestState.filterTimers).forEach(clearTimeout); requestState.refreshTimer=null; requestState.filterTimers={}; }
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
  if(view==="csp-queue"){const cached=requestState.queueCache[queueCacheKey()];if(cached){requestState.queue=cached;requestState.loaded.queue=true;renderQueueRows()}}
  if (view === "user-management") loadUsers();
  if (view === "dashboard") loadDashboard();
  if (view === "my-requests") loadRequestList("my");
  if (view === "team-requests") loadRequestList("team");
  if (view === "csp-queue") { loadQueue(); loadDashboard(); }
  if (view === "reports") loadReports();
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
function renderQueueRows(){const rows=requestState.queue,pending=rows.filter(r=>r.status==="Pending").length,processing=rows.filter(r=>r.status==="Processing").length;$("#queue-count").textContent=pending;if(requestState.dashboard?.metrics)$("#queue-stats").innerHTML=statCards({...requestState.dashboard.metrics,pending,processing});$("#queue-table").innerHTML=rows.map(r=>{const details=requestDetailsText(r.raw),canFinish=r.status==="Processing"&&(authState.user.role!=="CSP_STAFF"||r.takenById===authState.user.userId),handler=r.status==="Processing"?`<strong>Processing by ${escapeHtml(r.takenByName||"Unknown")}</strong>`:"—";return `<tr><td><strong>${ageFrom(r.requestedAt)}</strong></td><td><button class="ticket-button" data-ticket="${escapeHtml(r.requestId)}">${escapeHtml(r.requestId)}</button></td><td><strong>${escapeHtml(r.brand)}</strong></td><td>${escapeHtml(r.requestType)}</td><td><strong>${escapeHtml(details[0]||"—")}</strong><span class="sub-detail">${escapeHtml(details.slice(1).join(" / ")||"—")}</span></td><td>${escapeHtml(r.requestedByName||"—")}</td><td>${statusBadge(r.status)}</td><td>${handler}</td><td><div class="action-group"><button class="action-button" data-ticket="${escapeHtml(r.requestId)}">View</button>${r.status==="Pending"?`<button class="action-button primary" data-take="${escapeHtml(r.requestId)}">Take Request</button>`:canFinish?`<button class="action-button success" data-complete="${escapeHtml(r.requestId)}">Complete</button><button class="action-button danger" data-unable="${escapeHtml(r.requestId)}">Unable</button>`:""}</div></td></tr>`}).join("");$("#queue-empty").hidden=rows.length>0;$(".live-indicator").innerHTML='<i></i> Last updated '+new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
function setQueueStatus(status){requestState.queueStatus=status;$$('[data-queue-status]').forEach(button=>button.classList.toggle("active",button.dataset.queueStatus===status))}
function queueCacheKey(){return cacheKey(requestState.queueStatus,{search:$("#queue-search")?.value||""})}
async function loadQueue({silent=false}={}){if(requestState.loading.queue||requestState.mutating.queue)return;const key=queueCacheKey(),cached=requestState.queueCache[key];if(cached){requestState.queue=cached;requestState.loaded.queue=true;renderQueueRows();$(".live-indicator").innerHTML="<i></i> Refreshing…"}requestState.loading.queue=true;const initial=!cached&&!requestState.loaded.queue,sequence=(requestState.sequence.queue||0)+1,params={status:requestState.queueStatus,search:$("#queue-search")?.value||"",limit:200};requestState.sequence.queue=sequence;if(initial)setTableLoading("#queue-table",9);try{const data=await authenticatedRead("cspQueue",params);if(sequence!==requestState.sequence.queue)return;requestState.queue=(data.requests||[]).map(normalizeRequest);requestState.queueCache[key]=requestState.queue;requestState.loaded.queue=true;renderQueueRows();saveSessionCache()}catch(e){if(e.code!=="UNAUTHORIZED"&&!silent)showToast(e.message);if(initial)$("#queue-table").innerHTML='<tr class="table-loading"><td colspan="9">Unable to load the CSP queue. <button class="text-button" data-retry-queue>Retry</button></td></tr>';else $(".live-indicator").innerHTML='<span class="refresh-error">Refresh failed</span> <button class="text-button" data-retry-queue>Retry</button>'}finally{requestState.loading.queue=false}}
function populateCatalogs(){const brandCodes=catalogState.brands.map(x=>x.code);["brand","my-brand","team-brand","report-brand"].forEach(id=>replaceOptions($(`#${id}`),brandCodes,id==="brand"?"Select brand":"All brands"));const typeNames=catalogState.requestTypes.map(x=>x.requestType);["request-type","my-type","team-type","report-type"].forEach(id=>{const el=$(`#${id}`);if(el)replaceOptions(el,typeNames,id==="request-type"?"Select request type":"All request types")})}
async function loadCatalogs(){if(catalogState.loaded){populateCatalogs();return}if(catalogState.loading)return;catalogState.loading=true;try{const [brands,types]=await Promise.all([authenticatedRead("brands"),authenticatedRead("requestTypes")]);catalogState.brands=brands||[];catalogState.requestTypes=types||[];catalogState.loaded=true;populateCatalogs();saveSessionCache()}catch(e){showToast(e.message)}finally{catalogState.loading=false}}
function replaceOptions(select,values,first){if(!select)return;select.innerHTML=`<option value="">${first}</option>`;fillSelect(select,values)}
function renderDynamicFields(type){const container=$("#dynamic-fields"),definition=catalogState.requestTypes.find(x=>x.requestType===type);if(!definition){container.innerHTML='<div class="form-placeholder"><span>↖</span><p>Select a request type to see the required details.</p></div>';return}const required=definition.requiredFields||[],fields=[...required,...(definition.optionalFields||[]).filter(x=>!required.includes(x))].filter(x=>FIELD_META[x]);container.innerHTML=`<div class="form-section-title"><span>2</span><div><h3>Request details</h3><p>Provide accurate information for ${escapeHtml(type.toLowerCase())}.</p></div></div><div class="form-grid two">${fields.map(name=>{const [key,label,inputType]=FIELD_META[name],req=required.includes(name);return `<div class="field ${inputType==="textarea"?"full-width":""}"><label for="field-${key}">${label}${req?' <em>*</em>':''}</label>${inputType==="textarea"?`<textarea id="field-${key}" name="${key}" rows="3" ${req?"required":""}></textarea>`:`<input id="field-${key}" name="${key}" type="${inputType}" ${req?"required":""}>`}<small class="error-text">This field is required.</small></div>`}).join("")}</div>`;}
function requestPayloadFromForm(){const data=new FormData($("#request-form")),payload={brand:data.get("brand"),requestType:data.get("requestType")};for(const meta of Object.values(FIELD_META)){const value=data.get(meta[0]);if(value!==null&&String(value).trim())payload[meta[0]]=String(value).trim()}return payload}
async function submitRequest(event){event.preventDefault();const form=event.currentTarget;if(!form.checkValidity()){form.reportValidity();return}await createLiveRequest(requestPayloadFromForm(),false,form)}
function submissionMatch(row,payload,started){const fields=[["Brand","brand"],["Request_Type","requestType"],["Player_Username","playerUsername"],["Affiliate_Username","affiliateUsername"],["Phone_Number","phoneNumber"],["Email","email"],["Transaction_ID","transactionId"]];return new Date(row.Requested_At).getTime()>=started-5000&&fields.every(([column,key])=>!payload[key]||String(row[column]||"").trim().toLowerCase()===String(payload[key]).trim().toLowerCase())}
async function reconcileSubmission(payload,started){try{const data=await authenticatedPost("myRequests",{limit:20});return (data.requests||[]).find(row=>submissionMatch(row,payload,started))||null}catch{return null}}
function showSubmissionSuccess(request){requestState.submittedTicket=getField(request,"Request_ID");const index=requestState.my.findIndex(r=>getField(r,"Request_ID")===requestState.submittedTicket);if(index<0)requestState.my.unshift(request);requestState.loaded.my=true;$("#request-success-ticket").textContent=requestState.submittedTicket;saveSessionCache();openModal("request-success-modal");Promise.allSettled([loadRequestList("my",{silent:true}),loadDashboard({silent:true})])}
async function createLiveRequest(payload,confirmDuplicate,form=$("#request-form")){const started=Date.now();setFormBusy(form,true,"Submitting…");try{const data=await authenticatedPost("createRequest",{...payload,confirmDuplicate});if(data.duplicateWarning&&!confirmDuplicate){requestState.duplicatePayload=payload;renderDuplicates(data.similarRequests||[]);openModal("duplicate-modal");return}const request=data.request||{Request_ID:data.ticket,Brand:payload.brand,Request_Type:payload.requestType,Status:"Pending",Requested_By_Name:authState.user.name,Requested_At:new Date().toISOString()};form.reset();renderDynamicFields("");showSubmissionSuccess(request)}catch(e){if(["TIMEOUT","UPSTREAM_TIMEOUT"].includes(e.code)){showToast("Confirming whether your request was received…");const committed=await reconcileSubmission(payload,started);if(committed){form.reset();renderDynamicFields("");showSubmissionSuccess(committed);return}showToast("Submission could not be confirmed. Check My Requests before trying again.")}else showToast(e.message)}finally{setFormBusy(form,false)}}

function reportFilters(){return {fromDate:$("#report-from").value,toDate:$("#report-to").value,brand:$("#report-brand").value,requestType:$("#report-type").value,status:$("#report-status").value,requestedBy:$("#report-requester").value.trim(),handledBy:$("#report-handler").value.trim(),limit:500}}
function reportFilterLabels(){const f=reportFilters(),labels=[];if(f.fromDate||f.toDate)labels.push(`Date: ${f.fromDate||"Any"} → ${f.toDate||"Any"}`);if(f.brand)labels.push(`Brand: ${f.brand}`);if(f.requestType)labels.push(`Type: ${f.requestType}`);if(f.status)labels.push(`Status: ${f.status}`);if(f.requestedBy)labels.push(`Requested By: ${f.requestedBy}`);if(f.handledBy)labels.push(`Handled By: ${f.handledBy}`);return labels}
function renderReportFilters(){const labels=reportFilterLabels(),bar=$("#report-active-filters");bar.hidden=!labels.length;bar.innerHTML=labels.length?`<strong>Active filters</strong>${labels.map(label=>`<span>${escapeHtml(label)}</span>`).join("")}`:""}
function resetReportFilters(){["report-from","report-to","report-brand","report-type","report-status","report-requester","report-handler"].forEach(id=>{$(`#${id}`).value=""});renderReportFilters();loadReports()}
function updateReportEmpty(){if(requestState.reports.length)return;$("#report-table").innerHTML='<tr><td colspan="8"><div class="report-empty"><strong>No requests match the current filters.</strong><span>Review the active filters above or clear them to see all available requests.</span><button class="secondary-button" data-clear-report-filters type="button">Clear Filters</button></div></td></tr>'}
async function loadReports(){if(!["CSP_ADMIN","SUPER_ADMIN"].includes(authState.user?.role)||requestState.loading.reports)return;requestState.loading.reports=true;try{const data=await authenticatedRead("reports",reportFilters());requestState.reports=data.requests||[];const m=data.metrics||{},cards=[["Total Requests",m.total],["Completed",m.completed],["Unable",m.unable],["Pending",m.pending],["Avg Waiting",formatDuration(m.averageWaiting)],["Avg Handling",formatDuration(m.averageHandling)],["Avg Resolution",formatDuration(m.averageTotal)]];$("#report-stats").innerHTML=cards.map(x=>`<article class="stat-card"><div><strong>${escapeHtml(x[1]??"—")}</strong><span>${escapeHtml(x[0])}</span></div></article>`).join("");$("#report-summary").textContent=`${requestState.reports.length} matching request${requestState.reports.length===1?"":"s"}`;$("#report-table").innerHTML=requestState.reports.map(r=>`<tr><td><button class="ticket-button" data-ticket="${escapeHtml(r.Request_ID)}">${escapeHtml(r.Request_ID)}</button></td><td>${escapeHtml(r.Brand)}</td><td>${escapeHtml(r.Request_Type)}</td><td>${statusBadge(r.Status)}</td><td>${escapeHtml(r.Requested_By_Name||"—")}</td><td>${escapeHtml(r.Taken_By_Name||"—")}</td><td>${escapeHtml(formatDate(r.Requested_At))}</td><td>${escapeHtml(formatDuration(r.Total_Seconds))}</td></tr>`).join("")||'<tr class="table-loading"><td colspan="8">No matching requests.</td></tr>';saveSessionCache()}catch(e){showToast(e.message)}finally{requestState.loading.reports=false}}
function csvCell(value){const text=String(value??"");return `"${text.replaceAll('"','""')}"`}
function exportReports(){const fields=["Request_ID","Brand","Request_Type","Player_Username","Affiliate_Username","Phone_Number","Email","Status","Requested_By_ID","Requested_By_Name","Requested_At","Taken_By_ID","Taken_By_Name","Taken_At","Completed_By_ID","Completed_By_Name","Completed_At","Unable_Reason","Cancelled_By_ID","Cancelled_At","Waiting_Seconds","Handling_Seconds","Total_Seconds"],csv=[fields.join(","),...requestState.reports.map(r=>fields.map(f=>csvCell(r[f])).join(","))].join("\r\n"),url=URL.createObjectURL(new Blob(["\uFEFF",csv],{type:"text/csv;charset=utf-8"})),link=document.createElement("a");link.href=url;link.download=`ops-request-report-${new Date().toISOString().slice(0,10)}.csv`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function renderDuplicates(items){$("#duplicate-list").innerHTML=items.map(r=>`<div class="duplicate-item"><strong>${escapeHtml(r.requestId)}</strong><span>${escapeHtml(r.brand)} · ${escapeHtml(r.requestType)} · ${escapeHtml(r.status)}</span><small>${escapeHtml(r.requestedBy||"—")} · ${escapeHtml(formatDate(r.requestedAt))}</small></div>`).join("")}
function detailsActionBar(raw){const r=normalizeRequest(raw),csp=["CSP_STAFF","CSP_ADMIN","SUPER_ADMIN"].includes(authState.user.role),canFinish=r.status==="Processing"&&(authState.user.role!=="CSP_STAFF"||r.takenById===authState.user.userId);if(!csp)return "";if(r.status==="Pending")return `<div class="details-action-bar"><button class="primary-button" data-take="${escapeHtml(r.requestId)}">Take Request</button></div>`;if(canFinish)return `<div class="details-action-bar"><span>Processing by ${escapeHtml(r.takenByName||authState.user.name)}</span><div><button class="action-button success" data-complete="${escapeHtml(r.requestId)}">Complete</button><button class="action-button danger" data-unable="${escapeHtml(r.requestId)}">Unable</button></div></div>`;if(r.status==="Processing")return `<div class="details-action-bar"><span>Processing by ${escapeHtml(r.takenByName||"another CSP staff member")}</span></div>`;return ""}
function cachedRequest(ticket){return requestState.detailCache[ticket]?.request||requestState.queue.find(r=>r.requestId===ticket)?.raw||[...requestState.my,...requestState.team].find(r=>getField(r,"Request_ID")===ticket)||requestState.dashboard?.recentRequests?.find(r=>getField(r,"Request_ID")===ticket)}
function detailsSkeleton(ticket){const raw=cachedRequest(ticket),r=raw?normalizeRequest(raw):null;return `<div class="details-head">${r?statusBadge(r.status):'<span class="skeleton skeleton-badge"></span>'}<h2 id="details-title">${escapeHtml(r?.requestId||ticket)}</h2><p>${escapeHtml(r?[r.brand,r.requestType].filter(Boolean).join(" · "):"Loading request overview…")}</p></div><div class="details-body"><div class="detail-skeleton" aria-label="Loading request details"><span></span><span></span><span></span><span></span></div></div>`}
function renderDetails(data){const r=data.request||{},fields=["Brand","Player_Username","Affiliate_Username","Phone_Number","Email","Current_Email","New_Email","Current_Name","New_Full_Name","Current_Player_Username","New_Player_Username","Transaction_ID","Amount","Notes","Requested_By_Name","Requested_At","Taken_By_Name","Taken_At","Completed_By_Name","Completed_At","Unable_Reason","Waiting_Seconds","Handling_Seconds","Total_Seconds"].filter(k=>r[k]!==""&&r[k]!=null),timing=["Waiting_Seconds","Handling_Seconds","Total_Seconds"];$("#details-content").innerHTML=`<div class="details-head">${statusBadge(r.Status)}<h2 id="details-title">${escapeHtml(r.Request_ID)}</h2><p>${escapeHtml([r.Brand,r.Request_Type].filter(Boolean).join(" · "))}</p></div><div class="details-body"><h3 class="details-section-title">Request information</h3><div class="detail-grid">${fields.map(k=>{const label=(FIELD_META[k]?.[1]||DETAIL_LABELS[k]||k.replaceAll("_"," ")),value=timing.includes(k)?formatDuration(r[k]):k.endsWith("_At")?formatDate(r[k]):r[k],copy=FIELD_META[k]&&!timing.includes(k);return `<div class="detail-item"><label>${escapeHtml(label)}</label><div class="detail-value"><span>${escapeHtml(value)}</span>${copy?`<button class="copy-button" data-copy="${escapeHtml(value)}">Copy</button>`:""}</div></div>`}).join("")}</div>${detailsActionBar(r)}<div class="history-timeline"><h3>Activity timeline</h3>${(data.history||[]).map(h=>`<div class="history-entry"><i></i><div><strong>${escapeHtml(h.Action)}</strong><span>${escapeHtml(h.Performed_By_Name||"System")} · ${escapeHtml(formatDate(h.Created_At))}</span>${h.Details?`<p>${escapeHtml(h.Details)}</p>`:""}</div></div>`).join("")||"<p>No activity recorded.</p>"}</div></div>`}
async function openDetails(ticket){requestState.activeDetailId=ticket;const cached=requestState.detailCache[ticket];$("#details-content").innerHTML=cached?"":detailsSkeleton(ticket);openModal("details-modal");if(cached)renderDetails(cached);try{const data=await authenticatedRead("requestDetails",{requestId:ticket});if(requestState.activeDetailId!==ticket)return;requestState.detailCache[ticket]=data;renderDetails(data);saveSessionCache()}catch(e){if(requestState.activeDetailId!==ticket)return;if(cached){$("#details-content").insertAdjacentHTML("afterbegin",`<div class="details-refresh-warning">Details could not be refreshed. <button class="text-button" data-retry-details="${escapeHtml(ticket)}">Retry</button></div>`)}else $("#details-content").innerHTML=`<div class="details-error"><span>!</span><h2 id="details-title">Unable to load request details</h2><p>${escapeHtml(e.message)}</p><div><button class="secondary-button" data-close-modal>Close</button><button class="primary-button" data-retry-details="${escapeHtml(ticket)}">Retry</button></div></div>`}}
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
  $("#users-table").innerHTML = '<tr class="table-loading"><td colspan="10">Loading user accounts…</td></tr>';
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
  const form = event.currentTarget;
  const username = $("#login-username").value.trim();
  const password = $("#login-password").value;
  const error = $("#login-error");
  error.hidden = true;
  if (!username || !password) { error.textContent = "Enter your username and password."; error.hidden = false; return; }
  const button = $("#login-button");
  if (button.disabled) return;
  button.disabled = true;
  button.textContent = "Signing In…";
  try {
    const data = await apiPost("login", { username, password }, { skipExpiry: true, timeoutMessage: "Sign in is taking too long. Please try again." });
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
  const busyLabels={takeRequest:"Taking…",completeRequest:"Completing…",unableRequest:"Updating…",cancelRequest:"Cancelling…"};
  if (button) { button.disabled=true; button.dataset.oldText=button.textContent; button.textContent=busyLabels[action]||"Working…"; }
  if(["takeRequest","completeRequest","unableRequest"].includes(action))requestState.mutating.queue=true;
  try { const result=await authenticatedPost(action,{requestId,...payload});if(result?.request){const updated=normalizeRequest(result.request),index=requestState.queue.findIndex(r=>r.requestId===requestId);if(index>=0){if(["Completed","Unable","Cancelled"].includes(updated.status))requestState.queue.splice(index,1);else requestState.queue[index]=updated;renderQueueRows()}const cached=requestState.detailCache[requestId];requestState.detailCache[requestId]=cached?{...cached,request:{...cached.request,...result.request}}:{request:result.request,history:[]};requestState.queueCache={};saveSessionCache()}closeModals();showToast(successMessage);requestState.mutating.queue=false;if(action==="takeRequest"||options.reopenDetails)openDetails(requestId);Promise.allSettled([loadDashboard({silent:true}),allowedViews().includes("csp-queue")?loadQueue({silent:true}):Promise.resolve(),allowedViews().includes("my-requests")?loadRequestList("my",{silent:true}):Promise.resolve(),allowedViews().includes("team-requests")?loadRequestList("team",{silent:true}):Promise.resolve()]); }
  catch(e){if(["TIMEOUT","UPSTREAM_TIMEOUT"].includes(e.code)){try{const confirmed=await authenticatedPost("requestDetails",{requestId}),expected={takeRequest:"Processing",completeRequest:"Completed",unableRequest:"Unable",cancelRequest:"Cancelled"}[action];if(confirmed?.request?.Status===expected){const updated=normalizeRequest(confirmed.request),index=requestState.queue.findIndex(r=>r.requestId===requestId);if(index>=0){if(["Completed","Unable","Cancelled"].includes(updated.status))requestState.queue.splice(index,1);else requestState.queue[index]=updated;renderQueueRows()}closeModals();showToast(successMessage);return}}catch{}showToast("The update could not be confirmed. Refresh before trying again.")}else{const handler=e.data?.handler?` Current handler: ${e.data.handler}.`:"";showToast(`${e.message}${handler}`)}if(action==="takeRequest")setTimeout(()=>loadQueue({silent:true}),0)}
  finally { requestState.mutating.queue=false;if(button){button.disabled=false;button.textContent=button.dataset.oldText||"Confirm"} }
}
function confirmRequestAction(title,copy,label,callback){$("#request-confirm-title").textContent=title;$("#request-confirm-copy").textContent=copy;const button=$("#request-confirm-button");button.textContent=label;button.onclick=()=>callback(button);openModal("request-confirm-modal")}
function applyListFilters(kind,debounce=false){clearTimeout(requestState.filterTimers[kind]);if(!debounce){renderRequestList(kind);return}requestState.filterTimers[kind]=setTimeout(()=>renderRequestList(kind),150)}
function startAutoRefresh(){clearInterval(requestState.refreshTimer);requestState.lastAutoRefresh=Date.now();requestState.refreshTimer=setInterval(()=>{if(!authState.user||document.hidden)return;const view=location.hash.slice(1),threshold=view==="csp-queue"?20000:30000;if(Date.now()-requestState.lastAutoRefresh<threshold)return;requestState.lastAutoRefresh=Date.now();if(view==="csp-queue")loadQueue({silent:true});else if(view==="dashboard")loadDashboard({silent:true});else if(view==="my-requests")loadRequestList("my",{silent:true});else if(view==="team-requests")loadRequestList("team",{silent:true})},5000)}

function initialize() {
  const reportActions=$("#run-reports").parentElement;reportActions.classList.add("report-filter-actions");reportActions.insertAdjacentHTML("afterbegin",'<button class="secondary-button" id="reset-reports" type="button">Reset Filters</button>');$(".report-filters").insertAdjacentHTML("beforeend",'<div class="active-filter-bar" id="report-active-filters" hidden></div>');
  ["my-status","team-status"].forEach(id=>fillSelect($(`#${id}`),["Pending","Processing","Completed","Unable","Cancelled"]));
  $$(".nav-item").forEach(btn=>btn.addEventListener("click",()=>navigate(btn.dataset.view))); $$('[data-go]').forEach(btn=>btn.addEventListener("click",()=>navigate(btn.dataset.go)));
  $("#menu-button").addEventListener("click",openSidebar); $("#sidebar-overlay").addEventListener("click",closeSidebar); $("#request-type").addEventListener("change",e=>renderDynamicFields(e.target.value)); $("#request-form").addEventListener("submit",submitRequest);
  ["my-status","my-brand","my-type"].forEach(id=>$(`#${id}`).addEventListener("change",()=>applyListFilters("my")));["team-status","team-brand","team-type"].forEach(id=>$(`#${id}`).addEventListener("change",()=>applyListFilters("team")));$("#my-search").addEventListener("input",()=>applyListFilters("my",true));$("#team-search").addEventListener("input",()=>applyListFilters("team",true));
  $("#unable-reason").addEventListener("change",e=>{$("#other-reason-field").hidden=e.target.value!=="Other";$("#other-reason").required=e.target.value==="Other"});
  $("#unable-form").addEventListener("submit",async e=>{e.preventDefault();if(!e.currentTarget.checkValidity()){e.currentTarget.reportValidity();return}const reason=$("#unable-reason").value==="Other"?$("#other-reason").value.trim():$("#unable-reason").value;await mutateRequest("unableRequest",$("#unable-ticket").value,{reason},`Request ${$("#unable-ticket").value} marked unable.`,$('button[type="submit"]',e.currentTarget),{reopenDetails:requestState.reopenAfterMutation});requestState.reopenAfterMutation=false;e.currentTarget.reset();$("#other-reason-field").hidden=true});
  $("#submit-duplicate-button").addEventListener("click",async e=>{if(!requestState.duplicatePayload)return;const payload=requestState.duplicatePayload;requestState.duplicatePayload=null;closeModals();await createLiveRequest(payload,true,$("#request-form"))});
  $("#queue-status-tabs").addEventListener("click",e=>{const status=e.target.closest("[data-queue-status]")?.dataset.queueStatus;if(!status)return;setQueueStatus(status);loadQueue({silent:requestState.loaded.queue})});
  $("#queue-search").addEventListener("input",()=>{clearTimeout(requestState.filterTimers.queue);requestState.filterTimers.queue=setTimeout(()=>loadQueue({silent:true}),250)});
  $("#run-reports").addEventListener("click",async()=>{renderReportFilters();await loadReports();updateReportEmpty()});$("#reset-reports").addEventListener("click",resetReportFilters);$("#export-reports").addEventListener("click",exportReports);
  $("#submit-another").addEventListener("click",()=>{closeModals();navigate("new-request")});$("#view-submitted-request").addEventListener("click",()=>{const ticket=requestState.submittedTicket;closeModals();navigate("my-requests");if(ticket)openDetails(ticket)});
  document.addEventListener("click",e=>{const metric=e.target.closest("[data-metric-status]")?.dataset.metricStatus;if(metric){if(["CSP_STAFF","CSP_ADMIN","SUPER_ADMIN"].includes(authState.user.role)){requestState.queueStatus=metric;navigate("csp-queue")}else{$("#my-status").value=metric;navigate("my-requests")}}const ticket=e.target.closest("[data-ticket]")?.dataset.ticket;if(ticket)openDetails(ticket);const retryDetails=e.target.closest("[data-retry-details]")?.dataset.retryDetails;if(retryDetails)openDetails(retryDetails);const take=e.target.closest("[data-take]")?.dataset.take;if(take&&["CSP_STAFF","CSP_ADMIN","SUPER_ADMIN"].includes(authState.user.role))mutateRequest("takeRequest",take,{},`Request ${take} is now processing.`,e.target);const complete=e.target.closest("[data-complete]")?.dataset.complete;if(complete&&["CSP_STAFF","CSP_ADMIN","SUPER_ADMIN"].includes(authState.user.role)){const reopen=!!e.target.closest("#details-modal");confirmRequestAction("Complete Request",`Mark ${complete} as completed?`,"Complete Request",button=>mutateRequest("completeRequest",complete,{},`Request ${complete} completed.`,button,{reopenDetails:reopen}))}const unable=e.target.closest("[data-unable]")?.dataset.unable;if(unable&&["CSP_STAFF","CSP_ADMIN","SUPER_ADMIN"].includes(authState.user.role)){requestState.reopenAfterMutation=!!e.target.closest("#details-modal");$("#unable-ticket").value=unable;openModal("unable-modal")}const cancel=e.target.closest("[data-cancel]")?.dataset.cancel;if(cancel&&["BDT_STAFF","SUPER_ADMIN"].includes(authState.user.role))confirmRequestAction("Cancel Request",`Cancel pending request ${cancel}?`,"Cancel Request",button=>mutateRequest("cancelRequest",cancel,{},`Request ${cancel} cancelled.`,button));if(e.target.closest("[data-retry-queue]"))loadQueue();if(e.target.closest("[data-close-modal]")||e.target.classList.contains("modal-backdrop"))closeModals();const copy=e.target.closest("[data-copy]")?.dataset.copy;if(copy)copyValue(copy)});
  document.addEventListener("click",e=>{if(e.target.closest("[data-clear-report-filters]"))resetReportFilters();const kind=e.target.closest("[data-retry-list]")?.dataset.retryList;if(kind)loadRequestList(kind)});
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
