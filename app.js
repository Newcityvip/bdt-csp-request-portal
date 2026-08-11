const BRANDS = ["M1", "M2", "B1", "B2", "B3", "B4", "B5", "K1", "TK", "JW"];
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

function navigate(view) {
  $$(".view").forEach(el=>el.classList.toggle("active",el.id===`${view}-view`));
  $$(".nav-item").forEach(el=>el.classList.toggle("active",el.dataset.view===view));
  const active=$(`#${view}-view`); $("#page-title").textContent=active?.dataset.title || "Ops Request Hub";
  history.replaceState(null,"",`#${view}`); closeSidebar(); window.scrollTo(0,0);
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
function submitRequest(event) { event.preventDefault(); const form=event.currentTarget; $$(".field",form).forEach(f=>f.classList.remove("invalid")); if(!form.checkValidity()){ $$('[required]',form).filter(el=>!el.validity.valid).forEach(el=>el.closest(".field").classList.add("invalid")); form.querySelector(":invalid")?.focus(); return; } showToast("Demo mode — request form is ready. Backend connection will be added next."); form.reset(); renderDynamicFields(""); }

function openDetails(ticket) {
  const r=findRequest(ticket); if(!r)return; const values=[...[{label:"Brand",value:r.brand},{label:"Player Username",value:r.player,copy:true},{label:"Phone Number",value:r.phone,copy:true},{label:"Email",value:r.email,copy:true},{label:"Transaction ID",value:r.transaction,copy:true},{label:"Amount",value:r.amount},{label:"Requested by",value:r.requestedBy},{label:"Submitted",value:r.submitted},{label:"Handler",value:r.handler}], ...(r.reason?[{label:"Unable reason",value:r.reason}]:[])].filter(x=>x.value&&x.value!=="—");
  $("#details-content").innerHTML=`<div class="details-head"><span class="badge ${r.status.toLowerCase()}">${r.status}</span><h2 id="details-title">${r.ticket}</h2><p>${r.type}</p></div><div class="details-body"><div class="detail-grid">${values.map(v=>`<div class="detail-item"><label>${v.label}</label><div class="detail-value"><span>${v.value}</span>${v.copy?`<button class="copy-button" data-copy="${v.value}">Copy</button>`:""}</div></div>`).join("")}</div><div class="details-status"><span>This is demonstration data and is not persisted.</span>${statusBadge(r.status)}</div></div>`; openModal("details-modal");
}
function openModal(id){const modal=$(`#${id}`);modal.hidden=false;document.body.style.overflow="hidden";setTimeout(()=>$(".modal-close",modal).focus(),0)}
function closeModals(){ $$(".modal-backdrop").forEach(m=>m.hidden=true);document.body.style.overflow=""; }
async function copyValue(value){try{await navigator.clipboard.writeText(value);showToast("Copied to clipboard.")}catch{showToast("Clipboard access is unavailable in this browser.")}}
function updateRequest(ticket,status,reason=""){const r=findRequest(ticket);if(!r)return;r.status=status;r.handler=status==="Processing"?"Kim":r.handler;if(reason)r.reason=reason;renderTables();showToast(status==="Processing"?`${ticket} is now processing by Kim.`:`${ticket} marked ${status.toLowerCase()}.`)}

function initialize() {
  fillSelect($("#brand"),BRANDS); fillSelect($("#request-type"),Object.keys(REQUEST_FIELDS));
  ["my-brand","team-brand"].forEach(id=>fillSelect($(`#${id}`),BRANDS)); ["my-status","team-status"].forEach(id=>fillSelect($(`#${id}`),["Pending","Processing","Completed","Unable"])); fillSelect($("#my-type"),Object.keys(REQUEST_FIELDS));
  renderTables(); const initial=location.hash.slice(1); if($(`#${initial}-view`))navigate(initial);
  $$(".nav-item").forEach(btn=>btn.addEventListener("click",()=>navigate(btn.dataset.view))); $$('[data-go]').forEach(btn=>btn.addEventListener("click",()=>navigate(btn.dataset.go)));
  $("#menu-button").addEventListener("click",openSidebar); $("#sidebar-overlay").addEventListener("click",closeSidebar); $("#request-type").addEventListener("change",e=>renderDynamicFields(e.target.value)); $("#request-form").addEventListener("submit",submitRequest);
  ["my-search","my-status","my-brand","my-type"].forEach(id=>$(`#${id}`).addEventListener("input",()=>renderFiltered("my"))); ["team-search","team-status","team-brand"].forEach(id=>$(`#${id}`).addEventListener("input",()=>renderFiltered("team")));
  $("#unable-reason").addEventListener("change",e=>{$("#other-reason-field").hidden=e.target.value!=="Other";$("#other-reason").required=e.target.value==="Other"});
  $("#unable-form").addEventListener("submit",e=>{e.preventDefault();if(!e.currentTarget.checkValidity()){e.currentTarget.reportValidity();return}const reason=$("#unable-reason").value==="Other"?$("#other-reason").value:$("#unable-reason").value;updateRequest($("#unable-ticket").value,"Unable",reason);closeModals();e.currentTarget.reset();$("#other-reason-field").hidden=true});
  document.addEventListener("click",e=>{const ticket=e.target.closest("[data-ticket]")?.dataset.ticket;if(ticket)openDetails(ticket);const take=e.target.closest("[data-take]")?.dataset.take;if(take)updateRequest(take,"Processing");const complete=e.target.closest("[data-complete]")?.dataset.complete;if(complete)updateRequest(complete,"Completed");const unable=e.target.closest("[data-unable]")?.dataset.unable;if(unable){$("#unable-ticket").value=unable;openModal("unable-modal")}if(e.target.closest("[data-close-modal]")||e.target.classList.contains("modal-backdrop"))closeModals();const copy=e.target.closest("[data-copy]")?.dataset.copy;if(copy)copyValue(copy)});
  document.addEventListener("keydown",e=>{if(e.key==="Escape")closeModals()}); $(".logout-button").addEventListener("click",()=>showToast("Logout is a placeholder in this frontend demo."));
}
document.addEventListener("DOMContentLoaded",initialize);
