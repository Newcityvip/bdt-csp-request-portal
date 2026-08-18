/**
 * Ops Request Hub — Google Apps Script backend source.
 *
 * Copy this file into the existing "Ops Request Hub Backend" Apps Script
 * project. It is reference source and is not deployed by Cloudflare Pages.
 */

const SHEETS = {
  USERS: "Users",
  REQUESTS: "Requests",
  HISTORY: "Request_History",
  TYPES: "Request_Types",
  BRANDS: "Brands",
  CONFIG: "Config",
  // Reference/admin data only. Cloudflare ALLOWED_IPS is the authoritative edge access list.
  ALLOWED_IPS: "Allowed_IPs",
  INBOX: "CSP_Inbox",
  INBOX_READ: "CSP_Inbox_Read",
};

const HEADERS = {
  Users: ["User_ID", "Name", "Username", "Password_Hash", "Team", "Role", "Status", "Created_At", "Updated_At", "Last_Login"],
  Requests: ["Request_ID", "Brand", "Request_Type", "Player_Username", "Affiliate_Username", "Phone_Number", "Email", "Current_Email", "New_Email", "Current_Name", "New_Full_Name", "Current_Player_Username", "New_Player_Username", "Transaction_ID", "Amount", "Notes", "Status", "Requested_By_ID", "Requested_By_Name", "Requested_At", "Taken_By_ID", "Taken_By_Name", "Taken_At", "Completed_By_ID", "Completed_By_Name", "Completed_At", "Unable_Reason", "Cancelled_By_ID", "Cancelled_At", "Waiting_Seconds", "Handling_Seconds", "Total_Seconds", "Last_Updated_At", "Affiliate_Username_2"],
  Request_History: ["History_ID", "Request_ID", "Action", "Old_Status", "New_Status", "Performed_By_ID", "Performed_By_Name", "Performed_By_Team", "Details", "Created_At"],
  Request_Types: ["Type_ID", "Request_Type", "Required_Fields", "Optional_Fields", "Active", "Sort_Order"],
  Brands: ["Brand_ID", "Brand_Code", "Brand_Name", "Active", "Sort_Order"],
  Config: ["Config_Key", "Config_Value", "Description", "Updated_At"],
  Allowed_IPs: ["IP_ID", "IP_Address", "Label", "Team", "Active", "Created_At", "Notes"],
  CSP_Inbox: ["Message_ID", "Thread_ID", "Parent_Message_ID", "Message_Type", "Subject", "Message", "Sender_User_ID", "Sender_Name", "Sender_Role", "Recipient_Type", "Recipient_User_ID", "Recipient_Name", "Priority", "Created_At", "Active"],
  CSP_Inbox_Read: ["Message_ID", "User_ID", "Read_At"],
};

const ROLES = {
  BDT: "BDT_STAFF",
  CSP: "CSP_STAFF",
  CSP_ADMIN: "CSP_ADMIN",
  SUPER: "SUPER_ADMIN",
};

const CSP_CASE_TYPES = {
  "Customer Available for Call": true,
  "Wrong Currency Signup": true,
  "High Balance Unlock / Verify": true,
  "High Balance Unlock": true,
  "MAC Signup": true,
  "Affiliate Change Full Name & DOB": true,
};

const CSP_CREATABLE_CASE_TYPES = {
  "Wrong Currency Signup": true,
  "High Balance Unlock": true,
  "MAC Signup": true,
  "Affiliate Change Full Name & DOB": true,
};
const ATTACHMENT_HEADER = "Attachment_File_ID";
const ATTACHMENT_FOLDER_PROPERTY = "OPS_REQUEST_ATTACHMENT_FOLDER_ID";
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const SESSION_SECONDS = 8 * 60 * 60;
const SESSION_CACHE_SECONDS = 6 * 60 * 60;
const PASSWORD_VERSION = "v3";
const PASSWORD_ITERATIONS = 500;
const SUPPORTED_PASSWORD_VERSIONS = ["v1", "v2", "v3"];
const MAX_LIMIT = 500;
const ACTIVE_REQUEST_STATUSES = ["Pending", "Processing"];
const STATIC_CACHE_SECONDS = 180;
let requestTables_ = {};
let requestStatic_ = {};

const REQUEST_INPUTS = {
  brand: "Brand",
  requestType: "Request_Type",
  playerUsername: "Player_Username",
  affiliateUsername: "Affiliate_Username",
  phoneNumber: "Phone_Number",
  email: "Email",
  currentEmail: "Current_Email",
  newEmail: "New_Email",
  currentName: "Current_Name",
  newFullName: "New_Full_Name",
  currentPlayerUsername: "Current_Player_Username",
  newPlayerUsername: "New_Player_Username",
  transactionId: "Transaction_ID",
  amount: "Amount",
  notes: "Notes",
};

const SAFE_REQUEST_FIELDS = [
  "Request_ID", "Brand", "Request_Type", "Player_Username", "Affiliate_Username", "Affiliate_Username_2",
  "Phone_Number", "Email", "Current_Email", "New_Email", "Current_Name",
  "New_Full_Name", "Current_Player_Username", "New_Player_Username",
  "Transaction_ID", "Amount", "Notes", "Status", "Requested_By_ID",
  "Requested_By_Name", "Requested_At", "Taken_By_ID", "Taken_By_Name",
  "Taken_At", "Completed_By_ID", "Completed_By_Name", "Completed_At",
  "Unable_Reason", "Cancelled_By_ID", "Cancelled_At", "Waiting_Seconds",
  "Handling_Seconds", "Total_Seconds", "Last_Updated_At",
];

function doGet(e) {
  return handleApi_(e, "GET");
}

function doPost(e) {
  return handleApi_(e, "POST");
}

function handleApi_(e, method) {
  try {
    requestTables_ = {};
    requestStatic_ = {};
    const input = method === "POST" ? parsePostBody_(e) : copyObject_((e && e.parameter) || {});
    const action = cleanString_(input.action, 50);

    if (!action) throw new ApiError_("An action is required.", "ACTION_REQUIRED");

    const publicActions = {
      health: health_,
      checkIp: function () { return checkIp_(input.ip); },
      brands: brands_,
      requestTypes: requestTypes_,
    };

    if (publicActions[action]) return json_(publicActions[action]());
    if (method !== "POST") throw new ApiError_("This action requires POST.", "METHOD_NOT_ALLOWED");

    const actions = {
      login: function () { return success_(login_(input)); },
      logout: function () { return success_(logout_(input)); },
      session: function () { return success_({ user: publicSession_(requireSession_(input.token)) }); },
      createRequest: function () { return success_(createRequest_(input)); },
      myRequests: function () { return success_(myRequests_(input)); },
      teamRequests: function () { return success_(teamRequests_(input)); },
      cspQueue: function () { return success_(cspQueue_(input)); },
      bdtQueue: function () { return success_(bdtQueue_(input)); },
      cspRequests: function () { return success_(cspRequests_(input)); },
      takeRequest: function () { return success_(takeRequest_(input)); },
      completeRequest: function () { return success_(completeRequest_(input)); },
      unableRequest: function () { return success_(unableRequest_(input)); },
      cancelRequest: function () { return success_(cancelRequest_(input)); },
      requestDetails: function () { return success_(requestDetails_(input)); },
      requestAttachment: function () { return success_(requestAttachment_(input)); },
      dashboard: function () { return success_(dashboard_(input)); },
      listUsers: function () { return success_(listUsers_(input)); },
      createUser: function () { return success_(createUser_(input)); },
      updateUser: function () { return success_(updateUser_(input)); },
      resetUserPassword: function () { return success_(resetUserPassword_(input)); },
      setUserStatus: function () { return success_(setUserStatus_(input)); },
      reports: function () { return success_(reports_(input)); },
      requestTypeFilters: function () { return success_(requestTypeFilters_(input)); },
      searchTickets: function () { return success_(searchTickets_(input)); },
      createCspCase: function () { return success_(createCspCase_(input)); },
      inboxList: function () { return success_(inboxList_(input)); },
      inboxThread: function () { return success_(inboxThread_(input)); },
      inboxSend: function () { return success_(inboxSend_(input)); },
      inboxReply: function () { return success_(inboxReply_(input)); },
      inboxRecipients: function () { return success_(inboxRecipients_(input)); },
      inboxMarkRead: function () { return success_(inboxMarkRead_(input)); },
    };

    if (!actions[action]) throw new ApiError_("Unknown action.", "UNKNOWN_ACTION");
    return json_(actions[action]());
  } catch (error) {
    if (error && error.isApiError) return json_(failure_(error.message, error.code, error.extra));
    return json_(failure_("The request could not be completed.", "INTERNAL_ERROR"));
  }
}

function health_() {
  return { ok: true, service: "Ops Request Hub Backend", status: "healthy" };
}

function checkIp_(ip) {
  const candidate = cleanString_(ip, 64);
  if (!candidate || !isIpAddress_(candidate)) return { ok: true, allowed: false };

  const rows = readRows_(SHEETS.ALLOWED_IPS);
  const allowed = rows.some(function (row) {
    return isTrue_(row.Active) && cleanString_(row.IP_Address, 64) === candidate;
  });
  return { ok: true, allowed: allowed };
}

function brands_() {
  const cached = staticCacheGet_("BRANDS_V1");
  if (cached) return success_(cached);
  const data = readRows_(SHEETS.BRANDS)
    .filter(function (row) { return isTrue_(row.Active); })
    .sort(sortByNumber_("Sort_Order"))
    .map(function (row) {
      return { brandId: cleanString_(row.Brand_ID, 100), code: cleanString_(row.Brand_Code, 50), name: cleanString_(row.Brand_Name, 150) };
    });
  staticCachePut_("BRANDS_V1", data);
  return success_(data);
}

function requestTypes_() {
  const cached = staticCacheGet_("REQUEST_TYPES_V1");
  if (cached) return success_(cached);
  const data = readRows_(SHEETS.TYPES)
    .filter(function (row) { return isTrue_(row.Active); })
    .sort(sortByNumber_("Sort_Order"))
    .map(function (row) {
      return {
        typeId: cleanString_(row.Type_ID, 100),
        requestType: cleanString_(row.Request_Type, 150),
        requiredFields: parseFieldList_(row.Required_Fields),
        optionalFields: parseFieldList_(row.Optional_Fields),
      };
    });
  staticCachePut_("REQUEST_TYPES_V1", data);
  return success_(data);
}

function requestTypeFilters_(input) {
  requireSession_(input.token);
  const names = readRows_(SHEETS.TYPES).slice().sort(sortByNumber_("Sort_Order")).map(function(row){return cleanString_(row.Request_Type,150);}).filter(Boolean);
  ["Customer Available for Call", "Wrong Currency Signup", "High Balance Unlock / Verify", "High Balance Unlock", "MAC Signup", "Affiliate Change Full Name & DOB"].forEach(function(name){if(names.indexOf(name)===-1)names.push(name);});
  return { requestTypes: names };
}

function login_(input) {
  const username = cleanString_(input.username, 100).toLowerCase();
  const password = typeof input.password === "string" ? input.password : "";
  if (!username || !password) throw new ApiError_("Username and password are required.", "INVALID_CREDENTIALS");

  const found = findObjectRow_(SHEETS.USERS, "Username", username, false);
  const table = found.table;
  const user = found.row;

  if (!user || cleanString_(user.Status, 30).toLowerCase() !== "active" || !verifyPassword_(password, user.Password_Hash)) {
    throw new ApiError_("Invalid username or password.", "INVALID_CREDENTIALS");
  }

  const now = new Date();
  const loginUpdates = {};
  if (passwordHashNeedsUpgrade_(user.Password_Hash)) {
    loginUpdates.Password_Hash = hashPassword_(password);
    loginUpdates.Updated_At = now;
    loginUpdates.Last_Login = now;
    updateObjectRow_(table, user._row, loginUpdates);
  } else if (!user.Last_Login || now.getTime() - dateMs_(user.Last_Login) >= 15 * 60 * 1000) {
    writeCell_(table.sheet, user._row, table.index.Last_Login, now);
  }
  const session = {
    userId: cleanString_(user.User_ID, 100),
    name: cleanString_(user.Name, 150),
    username: cleanString_(user.Username, 100),
    team: cleanString_(user.Team, 50),
    role: cleanString_(user.Role, 50),
    expiry: now.getTime() + SESSION_SECONDS * 1000,
  };
  validateKnownRole_(session.role);
  const token = createSession_(session);
  return { token: token, user: publicSession_(session), expiresAt: new Date(session.expiry) };
}

function logout_(input) {
  const token = cleanToken_(input.token);
  if (token) deleteSession_(token);
  return { loggedOut: true };
}

function createRequest_(input) {
  const session = requireRole_(input.token, [ROLES.BDT, ROLES.SUPER]);
  const brand = cleanString_(input.brand, 50);
  const requestType = cleanString_(input.requestType, 150);
  if (!brand || !requestType) throw new ApiError_("Brand and request type are required.", "VALIDATION_ERROR");

  const brandRow = readRows_(SHEETS.BRANDS).find(function (row) {
    return isTrue_(row.Active) && cleanString_(row.Brand_Code, 50) === brand;
  });
  if (!brandRow) throw new ApiError_("The selected brand is not available.", "INVALID_BRAND");

  const typeRow = readRows_(SHEETS.TYPES).find(function (row) {
    return isTrue_(row.Active) && cleanString_(row.Request_Type, 150) === requestType;
  });
  if (!typeRow) throw new ApiError_("The selected request type is not available.", "INVALID_REQUEST_TYPE");

  const values = emptyRequest_();
  Object.keys(REQUEST_INPUTS).forEach(function (inputName) {
    if (Object.prototype.hasOwnProperty.call(input, inputName)) {
      values[REQUEST_INPUTS[inputName]] = cleanString_(input[inputName], fieldLimit_(REQUEST_INPUTS[inputName]));
    }
  });
  values.Brand = brand;
  values.Request_Type = requestType;

  const required = parseFieldList_(typeRow.Required_Fields);
  const missing = required.filter(function (fieldName) {
    const header = canonicalRequestField_(fieldName);
    return !header || !cleanString_(values[header], fieldLimit_(header));
  });
  if (missing.length) throw new ApiError_("Required request information is missing: " + missing.join(", ") + ".", "VALIDATION_ERROR");

  const requestsTable = getTable_(SHEETS.REQUESTS);
  if (duplicateCheckEnabled_()) {
    const similar = findSimilarRequests_(values, requestsTable.rows);
    if (similar.length && input.confirmDuplicate !== true) {
      return { created: false, duplicateWarning: true, similarRequests: similar };
    }
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // Recheck under the lock so a concurrent matching submission is visible.
    if (duplicateCheckEnabled_() && input.confirmDuplicate !== true) {
      requestTables_[SHEETS.REQUESTS] = null;
      const table = getTable_(SHEETS.REQUESTS);
      const concurrentSimilar = findSimilarRequests_(values, table.rows);
      if (concurrentSimilar.length) return { created: false, duplicateWarning: true, similarRequests: concurrentSimilar };
    } else requestTables_[SHEETS.REQUESTS] = null;
    const table = getTable_(SHEETS.REQUESTS);
    const now = new Date();
    values.Request_ID = nextRequestId_(table.rows);
    values.Status = "Pending";
    values.Requested_By_ID = session.userId;
    values.Requested_By_Name = session.name;
    values.Requested_At = now;
    values.Last_Updated_At = now;
    appendObjectRow_(table, values);
    appendHistory_(values.Request_ID, "Submitted", "", "Pending", session, "");
    return { created: true, duplicateWarning: false, ticket: values.Request_ID, request: projectRequest_(values) };
  } finally {
    lock.releaseLock();
  }
}

function myRequests_(input) {
  const session = requireRole_(input.token, [ROLES.BDT, ROLES.SUPER]);
  const rows = readRows_(SHEETS.REQUESTS).filter(function (row) { return cleanString_(row.Requested_By_ID, 100) === session.userId; });
  return listResponse_(filterRequests_(rows, input));
}

function teamRequests_(input) {
  requireRole_(input.token, [ROLES.BDT, ROLES.SUPER]);
  const bdtIds = {};
  readRows_(SHEETS.USERS).forEach(function (user) {
    if (cleanString_(user.Team, 50).toUpperCase() === "BDT") bdtIds[cleanString_(user.User_ID, 100)] = true;
  });
  const rows = readRows_(SHEETS.REQUESTS).filter(function (row) { return bdtIds[cleanString_(row.Requested_By_ID, 100)] === true; });
  return listResponse_(filterRequests_(rows, input));
}

function cspQueue_(input) {
  requireRole_(input.token, [ROLES.CSP, ROLES.CSP_ADMIN, ROLES.SUPER]);
  const status = cleanString_(input.status || "Active", 30);
  const cspCaseIds = cspCaseRequestIds_();
  const queue = filterRequestRows_(readRows_(SHEETS.REQUESTS), mergeObjects_(input, { status: "" }))
    .filter(function (row) { return !cspCaseIds[cleanString_(row.Request_ID, 100)]; })
    .filter(function (row) { return status === "All" || (status === "Active" ? ACTIVE_REQUEST_STATUSES.indexOf(cleanString_(row.Status, 30)) !== -1 : row.Status === status); })
    .sort(function (a, b) { return dateMs_(a.Requested_At) - dateMs_(b.Requested_At); })
    .map(projectQueueRequest_);
  return { requests: queue, count: queue.length };
}

function bdtQueue_(input) {
  requireRole_(input.token, [ROLES.BDT]);
  const status = cleanString_(input.status || "Active", 30);
  const cspCaseIds = cspCaseRequestIds_();
  const queue = filterRequestRows_(readRows_(SHEETS.REQUESTS), mergeObjects_(input, { status: "" }))
    .filter(function (row) { return cspCaseIds[cleanString_(row.Request_ID, 100)] === true; })
    .filter(function (row) { return status === "All" || (status === "Active" ? ACTIVE_REQUEST_STATUSES.indexOf(cleanString_(row.Status, 30)) !== -1 : row.Status === status); })
    .sort(function (a, b) { return dateMs_(a.Requested_At) - dateMs_(b.Requested_At); })
    .map(projectBdtQueueRequest_);
  return { requests: queue, count: queue.length };
}

function cspRequests_(input) {
  const session = requireRole_(input.token, [ROLES.CSP, ROLES.CSP_ADMIN, ROLES.SUPER]);
  const history = readRows_(SHEETS.HISTORY);
  const cspCaseIds = cspCaseRequestIds_(history);
  const resolutionRemarks = resolutionRemarksByRequest_(history);
  const visibleRows = readRows_(SHEETS.REQUESTS)
    .filter(function (row) { return cspCaseIds[cleanString_(row.Request_ID, 100)] === true; })
    .filter(function (row) { return session.role !== ROLES.CSP || cleanString_(row.Requested_By_ID, 100) === session.userId; });
  const requests = filterRequestRows_(visibleRows, mergeObjects_(input, { status: "" }))
    .map(function (row) {
      const request = projectListRequest_(row);
      request.Processing_Team = "BDT";
      request.Resolution_Remark = resolutionRemarks[cleanString_(row.Request_ID, 100)] || "";
      return request;
    });
  return { requests: requests, count: requests.length };
}

function reports_(input) {
  requireRole_(input.token, [ROLES.CSP_ADMIN, ROLES.SUPER]);
  const from = cleanString_(input.fromDate, 20), to = cleanString_(input.toDate, 20);
  const requestedBy = cleanString_(input.requestedBy, 150).toLowerCase();
  const handledBy = cleanString_(input.handledBy, 150).toLowerCase();
  const rows = filterRequestRows_(readRows_(SHEETS.REQUESTS), mergeObjects_(input, { limit: MAX_LIMIT })).filter(function (row) {
    const key = dateKey_(row.Requested_At);
    return (!from || key >= from) && (!to || key <= to) && (!requestedBy || cleanString_(row.Requested_By_Name,150).toLowerCase().indexOf(requestedBy) !== -1) && (!handledBy || cleanString_(row.Taken_By_Name,150).toLowerCase().indexOf(handledBy) !== -1);
  });
  const completed = rows.filter(function(r){return r.Status === "Completed";}).length;
  const unable = rows.filter(function(r){return r.Status === "Unable";}).length;
  function average(field){const values=rows.filter(function(r){return r[field] !== "" && r[field] !== null && r[field] !== undefined;}).map(function(r){return Number(r[field]);}).filter(function(v){return Number.isFinite(v)&&v>=0;});return values.length?Math.round(values.reduce(function(a,b){return a+b;},0)/values.length):"";}
  return { requests: rows.map(projectRequest_), metrics: { total: rows.length, completed: completed, unable: unable, pending: rows.filter(function(r){return r.Status==="Pending";}).length, averageWaiting: average("Waiting_Seconds"), averageHandling: average("Handling_Seconds"), averageTotal: average("Total_Seconds") } };
}

function searchTickets_(input) {
  requireRole_(input.token, [ROLES.CSP, ROLES.CSP_ADMIN, ROLES.SUPER]);
  const query = cleanString_(input.query, 150).toLowerCase();
  if (!query || (query.indexOf("req-") !== 0 && query.length < 2)) throw new ApiError_("Enter a ticket ID or at least 2 username characters.", "VALIDATION_ERROR");
  const exactTicket = query.indexOf("req-") === 0;
  const matches = readRows_(SHEETS.REQUESTS).filter(function (row) {
    if (exactTicket) return cleanString_(row.Request_ID, 100).toLowerCase() === query;
    return cleanString_(row.Player_Username, 150).toLowerCase().indexOf(query) !== -1 || cleanString_(row.Affiliate_Username, 150).toLowerCase().indexOf(query) !== -1 || cleanString_(row.Affiliate_Username_2, 150).toLowerCase().indexOf(query) !== -1;
  }).sort(newestFirst_).slice(0, 50).map(projectRequest_);
  return { requests: matches, count: matches.length, limit: 50 };
}

function createCspCase_(input) {
  const session = requireRole_(input.token, [ROLES.CSP, ROLES.CSP_ADMIN, ROLES.SUPER]);
  const requestType = cleanString_(input.requestType, 150);
  const brand = cleanString_(input.brand, 50);
  if (!CSP_CREATABLE_CASE_TYPES[requestType]) throw new ApiError_("The selected CSP case type is not available.", "INVALID_REQUEST_TYPE");
  const brandRow = readRows_(SHEETS.BRANDS).find(function (row) { return isTrue_(row.Active) && cleanString_(row.Brand_Code, 50) === brand; });
  if (!brandRow) throw new ApiError_("The selected brand is not available.", "INVALID_BRAND");

  const values = emptyRequest_();
  values.Brand = brand;
  values.Request_Type = requestType;
  const player = cleanString_(input.playerUsername, fieldLimit_("Player_Username"));
  const affiliate = cleanString_(input.affiliateUsername, fieldLimit_("Affiliate_Username"));
  const notes = cleanString_(input.notes, fieldLimit_("Notes"));
  const attachment = validateAttachment_(input.attachment);
  if (attachment && requestType !== "Affiliate Change Full Name & DOB") throw new ApiError_("Attachments are not available for this case type.", "VALIDATION_ERROR");
  if (requestType === "Wrong Currency Signup") {
    const currentCurrency = cleanString_(input.currentCurrency, 30), correctCurrency = cleanString_(input.correctCurrency, 30);
    if (!affiliate || !currentCurrency || !correctCurrency) throw new ApiError_("Affiliate username and both currencies are required.", "VALIDATION_ERROR");
    values.Affiliate_Username = affiliate;
    values.Notes = "Current Currency: " + currentCurrency + "\nCorrect Currency: " + correctCurrency + (notes ? "\n\n" + notes : "");
  } else if (requestType === "High Balance Unlock") {
    if (!player) throw new ApiError_("Player username is required.", "VALIDATION_ERROR");
    values.Player_Username = player;
    values.Notes = notes;
  } else if (requestType === "MAC Signup") {
    const affiliate2 = cleanString_(input.affiliateUsername2, fieldLimit_("Affiliate_Username_2"));
    if (!affiliate || !affiliate2) throw new ApiError_("Both affiliate usernames are required.", "VALIDATION_ERROR");
    values.Affiliate_Username = affiliate;
    values.Affiliate_Username_2 = affiliate2;
    values.Notes = structuredNotes_([
      ["Account 1 Email", input.account1Email], ["Account 1 Phone Number", input.account1Phone],
      ["Account 2 Email", input.account2Email], ["Account 2 Phone Number", input.account2Phone]
    ], notes);
  } else {
    const currentName = cleanString_(input.currentFullName, fieldLimit_("Current_Name"));
    const newName = cleanString_(input.newFullName, fieldLimit_("New_Full_Name"));
    const currentDob = validDateInput_(input.currentDob), newDob = validDateInput_(input.newDob);
    if (!affiliate || !currentName || !newName || !currentDob || !newDob) throw new ApiError_("Affiliate username, both full names, and both dates of birth are required.", "VALIDATION_ERROR");
    values.Affiliate_Username = affiliate;
    values.Current_Name = currentName;
    values.New_Full_Name = newName;
    values.Notes = structuredNotes_([["Current DOB", currentDob], ["New DOB", newDob]], notes);
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let uploadedFile = null, requestCreated = false;
  try {
    const table = getTable_(SHEETS.REQUESTS), now = new Date();
    if (attachment) {
      if (!table.index[ATTACHMENT_HEADER]) throw new ApiError_("Attachment storage is not configured. Contact an administrator.", "ATTACHMENT_CONFIGURATION_ERROR");
      const folder = attachmentFolder_();
      uploadedFile = folder.createFile(Utilities.newBlob(attachment.bytes, attachment.mimeType, attachment.fileName));
      values[ATTACHMENT_HEADER] = uploadedFile.getId();
    }
    values.Request_ID = nextRequestId_(table.rows);
    values.Status = "Pending";
    values.Requested_By_ID = session.userId; values.Requested_By_Name = session.name; values.Requested_At = now;
    values.Last_Updated_At = now;
    appendObjectRow_(table, values);
    requestCreated = true;
    appendHistory_(values.Request_ID, "CSP Case Created", "", "Pending", session, requestType);
    const projected = projectBdtRequest_(values);
    if (uploadedFile) projected.Has_Attachment = true;
    return { created: true, ticket: values.Request_ID, request: projected };
  } catch (error) {
    if (uploadedFile && !requestCreated) { try { uploadedFile.setTrashed(true); } catch (cleanupError) {} }
    throw error;
  } finally { lock.releaseLock(); }
}

function structuredNotes_(fields, notes) {
  const lines = fields.map(function (item) {
    const value = cleanString_(item[1], 500);
    return value ? item[0] + ": " + value : "";
  }).filter(Boolean);
  const context = cleanString_(notes, fieldLimit_("Notes"));
  return lines.join("\n") + (context ? (lines.length ? "\n\n" : "") + context : "");
}

function validDateInput_(value) {
  const date = cleanString_(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const parsed = new Date(date + "T00:00:00Z");
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : "";
}

function validateAttachment_(input) {
  if (input === undefined || input === null || input === "") return null;
  if (!input || typeof input !== "object") throw new ApiError_("The attachment is invalid.", "INVALID_ATTACHMENT");
  const originalName = cleanString_(input.fileName, 180).replace(/\\/g, "/").split("/").pop();
  const mimeType = cleanString_(input.mimeType, 100).toLowerCase();
  const base64 = typeof input.base64 === "string" ? input.base64 : "";
  const match = originalName.match(/\.([A-Za-z0-9]+)$/), extension = match ? match[1].toLowerCase() : "";
  const allowed = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
  if (!allowed[extension] || allowed[extension] !== mimeType) throw new ApiError_("Attachment must be a JPG, JPEG, PNG, or WEBP image.", "INVALID_ATTACHMENT_TYPE");
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new ApiError_("The attachment is invalid.", "INVALID_ATTACHMENT");
  if (Math.floor(base64.length * 3 / 4) > MAX_ATTACHMENT_BYTES + 2) throw new ApiError_("Attachment must be 5 MB or smaller.", "ATTACHMENT_TOO_LARGE");
  let bytes;
  try { bytes = Utilities.base64Decode(base64); } catch (error) { throw new ApiError_("The attachment is invalid.", "INVALID_ATTACHMENT"); }
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new ApiError_("Attachment must be 5 MB or smaller.", "ATTACHMENT_TOO_LARGE");
  const safeBase = originalName.slice(0, -(extension.length + 1)).replace(/[^A-Za-z0-9._ -]/g, "_").trim().slice(0, 120) || "attachment";
  return { fileName: safeBase + "." + extension, mimeType: mimeType, bytes: bytes };
}

function attachmentFolder_() {
  const folderId = cleanString_(PropertiesService.getScriptProperties().getProperty(ATTACHMENT_FOLDER_PROPERTY), 300);
  if (!folderId) throw new ApiError_("Attachment storage is not configured. Contact an administrator.", "ATTACHMENT_CONFIGURATION_ERROR");
  try { return DriveApp.getFolderById(folderId); }
  catch (error) { throw new ApiError_("Attachment storage is unavailable. Contact an administrator.", "ATTACHMENT_CONFIGURATION_ERROR"); }
}

function ensureInboxSheets_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  [SHEETS.INBOX, SHEETS.INBOX_READ].forEach(function (name) {
    if (spreadsheet.getSheetByName(name)) return;
    const sheet = spreadsheet.insertSheet(name), headers = HEADERS[name];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    requestTables_[name] = null;
  });
}

function inboxSession_(token) { return requireRole_(token, [ROLES.CSP, ROLES.CSP_ADMIN, ROLES.SUPER]); }
function isInboxAdmin_(session) { return session.role === ROLES.CSP_ADMIN || session.role === ROLES.SUPER; }
function visibleInboxMessage_(session, row) {
  if (!isTrue_(row.Active)) return false;
  if (isInboxAdmin_(session)) return true;
  return cleanString_(row.Recipient_Type, 30) === "ALL_CSP" || cleanString_(row.Recipient_User_ID, 100) === session.userId || cleanString_(row.Sender_User_ID, 100) === session.userId;
}
function projectInboxMessage_(row) {
  return selectFields_(row, ["Message_ID", "Thread_ID", "Parent_Message_ID", "Message_Type", "Subject", "Message", "Sender_User_ID", "Sender_Name", "Sender_Role", "Recipient_Type", "Recipient_User_ID", "Recipient_Name", "Priority", "Created_At"]);
}

function inboxList_(input) {
  const session = inboxSession_(input.token); ensureInboxSheets_();
  const rows = readRows_(SHEETS.INBOX).filter(function (row) { return visibleInboxMessage_(session, row); });
  const read = {};
  readRows_(SHEETS.INBOX_READ).forEach(function (row) { if (cleanString_(row.User_ID, 100) === session.userId) read[cleanString_(row.Message_ID, 100)] = true; });
  const threads = {};
  rows.forEach(function (row) {
    const threadId = cleanString_(row.Thread_ID, 100), current = threads[threadId];
    if (!current) threads[threadId] = { latest: row, unread: false };
    else if (dateMs_(row.Created_At) > dateMs_(current.latest.Created_At)) current.latest = row;
    if (cleanString_(row.Sender_User_ID, 100) !== session.userId && !read[cleanString_(row.Message_ID, 100)]) threads[threadId].unread = true;
  });
  const output = Object.keys(threads).map(function (id) {
    const item = projectInboxMessage_(threads[id].latest); item.unread = threads[id].unread; return item;
  }).sort(function (a,b) { return dateMs_(b.Created_At)-dateMs_(a.Created_At); }).slice(0, 100);
  return { threads: output, unreadCount: output.filter(function(item){return item.unread;}).length };
}

function inboxThread_(input) {
  const session = inboxSession_(input.token); ensureInboxSheets_();
  const threadId = cleanString_(input.threadId, 100);
  const all = readRows_(SHEETS.INBOX).filter(function (row) { return cleanString_(row.Thread_ID, 100) === threadId && isTrue_(row.Active); });
  if (!all.some(function (row) { return visibleInboxMessage_(session, row); })) throw new ApiError_("Conversation not found.", "NOT_FOUND");
  return { messages: all.filter(function(row){return visibleInboxMessage_(session,row);}).sort(function(a,b){return dateMs_(a.Created_At)-dateMs_(b.Created_At);}).map(projectInboxMessage_) };
}

function inboxRecipients_(input) {
  const session = inboxSession_(input.token);
  if (!isInboxAdmin_(session)) return { users: [] };
  const users = readRows_(SHEETS.USERS).filter(function(user){return cleanString_(user.Role,50)===ROLES.CSP&&cleanString_(user.Status,30)==="Active";}).map(function(user){return {userId:cleanString_(user.User_ID,100),name:cleanString_(user.Name,150)};});
  return { users: users };
}

function nextMessageId_(rows) {
  let maximum=0; rows.forEach(function(row){const match=cleanString_(row.Message_ID,100).match(/^MSG(\d+)$/);if(match)maximum=Math.max(maximum,Number(match[1]));});
  return "MSG"+String(maximum+1).padStart(6,"0");
}

function inboxSend_(input) {
  const session = inboxSession_(input.token); ensureInboxSheets_();
  const subject=cleanString_(input.subject,180), message=cleanString_(input.message,5000), priority=cleanString_(input.priority||"Normal",20);
  if(!subject||!message)throw new ApiError_("Subject and message are required.","VALIDATION_ERROR");
  if(["Normal","Important"].indexOf(priority)===-1)throw new ApiError_("Invalid priority.","VALIDATION_ERROR");
  let recipientType="SUPERVISORS",recipientUserId="",recipientName="",messageType="SUPERVISOR_MESSAGE";
  if(isInboxAdmin_(session)){
    messageType="ANNOUNCEMENT";recipientType=cleanString_(input.recipientType,30);
    if(recipientType==="ALL_CSP")recipientName="All CSP";
    else if(recipientType==="INDIVIDUAL_CSP"){
      recipientUserId=cleanString_(input.recipientUserId,100);
      const user=readRows_(SHEETS.USERS).find(function(row){return cleanString_(row.User_ID,100)===recipientUserId&&cleanString_(row.Role,50)===ROLES.CSP&&cleanString_(row.Status,30)==="Active";});
      if(!user)throw new ApiError_("Select an active CSP staff recipient.","VALIDATION_ERROR");recipientName=cleanString_(user.Name,150);
    }else throw new ApiError_("Select a valid CSP audience.","VALIDATION_ERROR");
  }
  const lock=LockService.getScriptLock();lock.waitLock(30000);
  try{const table=getTable_(SHEETS.INBOX),id=nextMessageId_(table.rows),now=new Date(),row={Message_ID:id,Thread_ID:id,Parent_Message_ID:"",Message_Type:messageType,Subject:subject,Message:message,Sender_User_ID:session.userId,Sender_Name:session.name,Sender_Role:session.role,Recipient_Type:recipientType,Recipient_User_ID:recipientUserId,Recipient_Name:recipientName,Priority:priority,Created_At:now,Active:true};appendObjectRow_(table,row);return {message:projectInboxMessage_(row)};}finally{lock.releaseLock();}
}

function inboxReply_(input) {
  const session=inboxSession_(input.token);ensureInboxSheets_();const threadId=cleanString_(input.threadId,100),message=cleanString_(input.message,5000);
  if(!message)throw new ApiError_("A reply is required.","VALIDATION_ERROR");
  const rows=readRows_(SHEETS.INBOX).filter(function(row){return cleanString_(row.Thread_ID,100)===threadId&&isTrue_(row.Active);});
  if(!rows.some(function(row){return visibleInboxMessage_(session,row);}))throw new ApiError_("Conversation not found.","NOT_FOUND");
  const root=rows[0],staffSender=rows.find(function(row){return cleanString_(row.Sender_Role,50)===ROLES.CSP;});
  let recipientType="SUPERVISORS",recipientUserId="",recipientName="Supervisors";
  if(isInboxAdmin_(session)&&staffSender){recipientType="INDIVIDUAL_CSP";recipientUserId=cleanString_(staffSender.Sender_User_ID,100);recipientName=cleanString_(staffSender.Sender_Name,150);}
  const lock=LockService.getScriptLock();lock.waitLock(30000);
  try{requestTables_[SHEETS.INBOX]=null;const table=getTable_(SHEETS.INBOX),id=nextMessageId_(table.rows),row={Message_ID:id,Thread_ID:threadId,Parent_Message_ID:cleanString_(rows[rows.length-1].Message_ID,100),Message_Type:"REPLY",Subject:cleanString_(root.Subject,180),Message:message,Sender_User_ID:session.userId,Sender_Name:session.name,Sender_Role:session.role,Recipient_Type:recipientType,Recipient_User_ID:recipientUserId,Recipient_Name:recipientName,Priority:cleanString_(root.Priority,20)||"Normal",Created_At:new Date(),Active:true};appendObjectRow_(table,row);return {message:projectInboxMessage_(row)};}finally{lock.releaseLock();}
}

function inboxMarkRead_(input) {
  const session=inboxSession_(input.token);ensureInboxSheets_();const thread=inboxThread_(input).messages,table=getTable_(SHEETS.INBOX_READ),known={};
  table.rows.forEach(function(row){if(cleanString_(row.User_ID,100)===session.userId)known[cleanString_(row.Message_ID,100)]=true;});
  thread.forEach(function(message){if(message.Sender_User_ID!==session.userId&&!known[message.Message_ID])appendObjectRow_(table,{Message_ID:message.Message_ID,User_ID:session.userId,Read_At:new Date()});});
  return { marked: true };
}

function takeRequest_(input) {
  const session = requireSession_(input.token);
  const requestId = requireRequestId_(input.requestId);
  return withRequestLock_(requestId, function (table, request) {
    requireHandlerRole_(session, request);
    if (request.Status !== "Pending") {
      throw new ApiError_("This request is no longer pending.", "REQUEST_CONFLICT", {
        status: request.Status,
        handler: cleanString_(request.Taken_By_Name, 150),
      });
    }
    const now = new Date();
    const updates = {
      Status: "Processing", Taken_By_ID: session.userId, Taken_By_Name: session.name,
      Taken_At: now, Last_Updated_At: now,
      Waiting_Seconds: elapsedSeconds_(request.Requested_At, now),
    };
    updateObjectRow_(table, request._row, updates);
    appendHistory_(requestId, "Taken", "Pending", "Processing", session, "");
    return { request: projectHandledRequest_(mergeObjects_(request, updates)) };
  });
}

function completeRequest_(input) {
  const session = requireSession_(input.token);
  const requestId = requireRequestId_(input.requestId);
  const remark = cleanString_(input.remark, 1000);
  return finalizeRequest_(requestId, session, "Completed", "", "Completed", remark);
}

function unableRequest_(input) {
  const session = requireSession_(input.token);
  const requestId = requireRequestId_(input.requestId);
  const reason = cleanString_(input.reason, 1000);
  if (!reason) throw new ApiError_("An unable reason is required.", "VALIDATION_ERROR");
  const remark = cleanString_(input.remark, 1000);
  return finalizeRequest_(requestId, session, "Unable", reason, "Unable", remark);
}

function finalizeRequest_(requestId, session, newStatus, reason, action, remark) {
  return withRequestLock_(requestId, function (table, request) {
    const cspCase = requireHandlerRole_(session, request);
    if (request.Status !== "Processing") throw new ApiError_("Only a processing request can be updated.", "REQUEST_CONFLICT", { status: request.Status });
    if ((cspCase || session.role === ROLES.CSP) && cleanString_(request.Taken_By_ID, 100) !== session.userId) {
      throw new ApiError_("This request is being handled by another user.", "FORBIDDEN");
    }
    const now = new Date();
    const updates = {
      Status: newStatus, Completed_By_ID: session.userId, Completed_By_Name: session.name,
      Completed_At: now, Last_Updated_At: now,
      Handling_Seconds: elapsedSeconds_(request.Taken_At, now),
      Total_Seconds: elapsedSeconds_(request.Requested_At, now),
    };
    if (newStatus === "Unable") updates.Unable_Reason = reason;
    updateObjectRow_(table, request._row, updates);
    appendHistory_(requestId, action, "Processing", newStatus, session, cspCase ? resolutionHistoryDetails_(reason, remark) : reason);
    return { request: projectHandledRequest_(mergeObjects_(request, updates)) };
  });
}

function cancelRequest_(input) {
  const session = requireRole_(input.token, [ROLES.BDT, ROLES.SUPER]);
  const requestId = requireRequestId_(input.requestId);
  return withRequestLock_(requestId, function (table, request) {
    if (request.Status !== "Pending") throw new ApiError_("Only a pending request can be cancelled.", "REQUEST_CONFLICT", { status: request.Status });
    if (session.role === ROLES.BDT && cleanString_(request.Requested_By_ID, 100) !== session.userId) {
      throw new ApiError_("You can cancel only your own request.", "FORBIDDEN");
    }
    const now = new Date();
    const updates = {
      Status: "Cancelled", Cancelled_By_ID: session.userId, Cancelled_At: now,
      Last_Updated_At: now, Total_Seconds: elapsedSeconds_(request.Requested_At, now),
    };
    updateObjectRow_(table, request._row, updates);
    appendHistory_(requestId, "Cancelled", "Pending", "Cancelled", session, "");
    return { request: projectRequest_(mergeObjects_(request, updates)) };
  });
}

function requestDetails_(input) {
  const session = requireSession_(input.token);
  const request = findRequest_(requireRequestId_(input.requestId));
  authorizeRequestView_(session, request);
  const history = findObjectRows_(SHEETS.HISTORY, "Request_ID", request.Request_ID, true)
    .sort(function (a, b) { return dateMs_(a.Created_At) - dateMs_(b.Created_At); })
    .map(function (row) {
      return selectFields_(row, ["History_ID", "Request_ID", "Action", "Old_Status", "New_Status", "Performed_By_ID", "Performed_By_Name", "Performed_By_Team", "Details", "Created_At"]);
    });
  const projected = projectHandledRequest_(request);
  if (projected.Processing_Team === "BDT") projected.Resolution_Remark = resolutionRemarkFromHistory_(history);
  if (cleanString_(request[ATTACHMENT_HEADER], 300)) projected.Has_Attachment = true;
  return { request: projected, history: history };
}

function requestAttachment_(input) {
  const session = requireSession_(input.token);
  const request = findRequest_(requireRequestId_(input.requestId));
  authorizeRequestView_(session, request);
  if (session.role === ROLES.CSP && cleanString_(request.Requested_By_ID, 100) !== session.userId) throw new ApiError_("You are not authorized to view this attachment.", "FORBIDDEN");
  const fileId = cleanString_(request[ATTACHMENT_HEADER], 300);
  if (!fileId) throw new ApiError_("This request has no attachment.", "NOT_FOUND");
  let file, blob;
  try { file = DriveApp.getFileById(fileId); blob = file.getBlob(); }
  catch (error) { throw new ApiError_("The attachment is unavailable.", "NOT_FOUND"); }
  const mimeType = cleanString_(blob.getContentType(), 100).toLowerCase();
  if (["image/jpeg", "image/png", "image/webp"].indexOf(mimeType) === -1) throw new ApiError_("The attachment is unavailable.", "INVALID_ATTACHMENT_TYPE");
  return { fileName: cleanString_(file.getName(), 180), mimeType: mimeType, base64: Utilities.base64Encode(blob.getBytes()) };
}

function dashboard_(input) {
  const session = requireSession_(input.token);
  let rows = readRows_(SHEETS.REQUESTS);
  if (session.role === ROLES.BDT) {
    rows = rows.filter(function (row) { return cleanString_(row.Requested_By_ID, 100) === session.userId; });
  } else if ([ROLES.CSP, ROLES.CSP_ADMIN, ROLES.SUPER].indexOf(session.role) === -1) {
    throw new ApiError_("You are not authorized for this action.", "FORBIDDEN");
  }

  const today = dateKey_(new Date());
  const counts = {
    pending: rows.filter(function (r) { return r.Status === "Pending"; }).length,
    processing: rows.filter(function (r) { return r.Status === "Processing"; }).length,
    completedToday: rows.filter(function (r) { return r.Status === "Completed" && dateKey_(r.Completed_At) === today; }).length,
    unableToday: rows.filter(function (r) { return r.Status === "Unable" && dateKey_(r.Completed_At) === today; }).length,
  };
  const recent = rows.slice().sort(newestFirst_).slice(0, 10).map(projectListRequest_);
  return { metrics: counts, recentRequests: recent };
}

function listUsers_(input) {
  requireRole_(input.token, [ROLES.SUPER]);
  const users = readRows_(SHEETS.USERS)
    .slice()
    .sort(function (a, b) { return cleanString_(a.User_ID, 100).localeCompare(cleanString_(b.User_ID, 100)); })
    .map(safeUser_);
  return { users: users, count: users.length };
}

function createUser_(input) {
  requireRole_(input.token, [ROLES.SUPER]);
  const name = cleanString_(input.name, 150);
  const username = normalizeUsername_(input.username);
  const password = typeof input.password === "string" ? input.password : "";
  const team = cleanString_(input.team, 50).toUpperCase();
  const role = cleanString_(input.role, 50).toUpperCase();
  if (!name || !username || !password) throw new ApiError_("Name, username, and password are required.", "VALIDATION_ERROR");
  validateUsername_(username);
  validateTeamRole_(team, role);
  validateApiPassword_(password);
  const passwordHash = hashPassword_(password);

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const table = getTable_(SHEETS.USERS);
    if (table.rows.some(function (user) { return normalizeUsername_(user.Username) === username; })) {
      throw new ApiError_("That username is already in use.", "DUPLICATE_USERNAME");
    }
    const now = new Date();
    const user = {
      User_ID: nextUserId_(table.rows), Name: name, Username: username,
      Password_Hash: passwordHash, Team: team, Role: role, Status: "Active",
      Created_At: now, Updated_At: now, Last_Login: "",
    };
    appendObjectRow_(table, user);
    return { user: safeUser_(user) };
  } finally {
    lock.releaseLock();
  }
}

function updateUser_(input) {
  const session = requireRole_(input.token, [ROLES.SUPER]);
  const userId = requireUserId_(input.userId);
  const name = cleanString_(input.name, 150);
  const team = cleanString_(input.team, 50).toUpperCase();
  const role = cleanString_(input.role, 50).toUpperCase();
  if (!name) throw new ApiError_("Name is required.", "VALIDATION_ERROR");
  validateTeamRole_(team, role);

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const table = getTable_(SHEETS.USERS);
    const user = findUserInTable_(table, userId);
    if (user.Role === ROLES.SUPER && user.Status === "Active" && role !== ROLES.SUPER) ensureAnotherActiveSuperAdmin_(table.rows, userId);
    const updates = { Name: name, Team: team, Role: role, Updated_At: new Date() };
    updateObjectRow_(table, user._row, updates);
    if (userId === session.userId && role !== session.role) invalidateUserSessions_(userId);
    return { user: safeUser_(mergeObjects_(user, updates)) };
  } finally {
    lock.releaseLock();
  }
}

function resetUserPassword_(input) {
  requireRole_(input.token, [ROLES.SUPER]);
  const userId = requireUserId_(input.userId);
  const password = typeof input.newPassword === "string" ? input.newPassword : "";
  validateApiPassword_(password);
  const passwordHash = hashPassword_(password);

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const table = getTable_(SHEETS.USERS);
    const user = findUserInTable_(table, userId);
    const updates = { Password_Hash: passwordHash, Updated_At: new Date() };
    updateObjectRow_(table, user._row, updates);
    invalidateUserSessions_(userId);
    return { message: "Password updated successfully." };
  } finally {
    lock.releaseLock();
  }
}

function setUserStatus_(input) {
  const session = requireRole_(input.token, [ROLES.SUPER]);
  const userId = requireUserId_(input.userId);
  const status = cleanString_(input.status, 20);
  if (["Active", "Inactive"].indexOf(status) === -1) throw new ApiError_("Status must be Active or Inactive.", "VALIDATION_ERROR");
  if (userId === session.userId && status === "Inactive") throw new ApiError_("You cannot deactivate your own account.", "SELF_DEACTIVATION");

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const table = getTable_(SHEETS.USERS);
    const user = findUserInTable_(table, userId);
    if (user.Role === ROLES.SUPER && user.Status === "Active" && status === "Inactive") ensureAnotherActiveSuperAdmin_(table.rows, userId);
    const updates = { Status: status, Updated_At: new Date() };
    updateObjectRow_(table, user._row, updates);
    if (status === "Inactive") invalidateUserSessions_(userId);
    return { user: safeUser_(mergeObjects_(user, updates)) };
  } finally {
    lock.releaseLock();
  }
}

function setUserPassword(username, newPassword) {
  const normalizedUsername = cleanString_(username, 100).toLowerCase();
  if (!normalizedUsername) throw new Error("A username is required.");
  validateNewPassword_(newPassword);

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const table = getTable_(SHEETS.USERS);
    const user = table.rows.find(function (row) { return cleanString_(row.Username, 100).toLowerCase() === normalizedUsername; });
    if (!user) throw new Error("User not found.");
    writeCell_(table.sheet, user._row, table.index.Password_Hash, hashPassword_(newPassword));
    writeCell_(table.sheet, user._row, table.index.Updated_At, new Date());
  } finally {
    lock.releaseLock();
  }
}

function setSamplePasswordsForTesting() {
  throw new Error("No sample passwords are embedded. Run setUserPassword(username, newPassword) manually for each test user.");
}

function safeUser_(user) {
  const passwordVersion = cleanString_(user.Password_Hash, 1000).split("$")[0];
  return {
    userId: cleanString_(user.User_ID, 100),
    name: cleanString_(user.Name, 150),
    username: cleanString_(user.Username, 100),
    team: cleanString_(user.Team, 50),
    role: cleanString_(user.Role, 50),
    status: cleanString_(user.Status, 30),
    createdAt: user.Created_At || "",
    updatedAt: user.Updated_At || "",
    lastLogin: user.Last_Login || "",
    passwordVersion: SUPPORTED_PASSWORD_VERSIONS.indexOf(passwordVersion) >= 0 ? passwordVersion : "unknown",
  };
}

function normalizeUsername_(value) {
  return cleanString_(value, 100).toLowerCase();
}

function validateUsername_(username) {
  if (!/^[a-z0-9][a-z0-9._-]{2,49}$/.test(username)) {
    throw new ApiError_("Username must be 3–50 characters and use only letters, numbers, dots, underscores, or hyphens.", "VALIDATION_ERROR");
  }
}

function validateApiPassword_(password) {
  try {
    validateNewPassword_(password);
  } catch (error) {
    throw new ApiError_("Password must be between 12 and 256 characters.", "VALIDATION_ERROR");
  }
}

function validateTeamRole_(team, role) {
  const expectedTeams = {};
  expectedTeams[ROLES.BDT] = "BDT";
  expectedTeams[ROLES.CSP] = "CSP";
  expectedTeams[ROLES.CSP_ADMIN] = "CSP";
  expectedTeams[ROLES.SUPER] = "ADMIN";
  if (!expectedTeams[role] || expectedTeams[role] !== team) {
    throw new ApiError_("The selected team and role combination is not valid.", "INVALID_TEAM_ROLE");
  }
}

function requireUserId_(value) {
  const userId = cleanString_(value, 100);
  if (!/^USR\d+$/.test(userId)) throw new ApiError_("A valid user ID is required.", "VALIDATION_ERROR");
  return userId;
}

function findUserInTable_(table, userId) {
  const user = table.rows.find(function (row) { return cleanString_(row.User_ID, 100) === userId; });
  if (!user) throw new ApiError_("User not found.", "NOT_FOUND");
  return user;
}

function nextUserId_(existingRows) {
  let maximum = 0;
  const used = {};
  existingRows.forEach(function (row) {
    const id = cleanString_(row.User_ID, 100);
    used[id] = true;
    const match = id.match(/^USR(\d+)$/);
    if (match) maximum = Math.max(maximum, Number(match[1]));
  });
  let number = Math.max(1, maximum + 1);
  let id = "USR" + String(number).padStart(3, "0");
  while (used[id]) {
    number += 1;
    id = "USR" + String(number).padStart(3, "0");
  }
  return id;
}

function ensureAnotherActiveSuperAdmin_(users, excludedUserId) {
  const anotherExists = users.some(function (user) {
    return cleanString_(user.User_ID, 100) !== excludedUserId &&
      cleanString_(user.Role, 50) === ROLES.SUPER &&
      cleanString_(user.Status, 30) === "Active";
  });
  if (!anotherExists) throw new ApiError_("At least one active Super Admin account must remain.", "LAST_SUPER_ADMIN");
}

function invalidateUserSessions_(userId) {
  const properties = PropertiesService.getScriptProperties();
  const all = properties.getProperties();
  Object.keys(all).forEach(function (key) {
    if (key.indexOf("SESSION_") !== 0) return;
    try {
      const session = JSON.parse(all[key]);
      if (session && session.userId === userId) {
        properties.deleteProperty(key);
        CacheService.getScriptCache().remove(key);
      }
    } catch (error) {
      properties.deleteProperty(key);
      CacheService.getScriptCache().remove(key);
    }
  });
}

function createSession_(session) {
  const token = randomToken_();
  const key = sessionKey_(token);
  const serialized = JSON.stringify(session);
  PropertiesService.getScriptProperties().setProperty(key, serialized);
  CacheService.getScriptCache().put(key, serialized, SESSION_CACHE_SECONDS);
  return token;
}

function requireSession_(tokenValue) {
  const token = cleanToken_(tokenValue);
  if (!token) throw new ApiError_("Authentication is required.", "UNAUTHORIZED");
  const key = sessionKey_(token);
  const cache = CacheService.getScriptCache();
  const properties = PropertiesService.getScriptProperties();
  const serialized = cache.get(key) || properties.getProperty(key);
  if (!serialized) throw new ApiError_("Your session is invalid or has expired.", "AUTH_EXPIRED");

  let session;
  try { session = JSON.parse(serialized); } catch (error) { deleteSession_(token); throw new ApiError_("Your session is invalid or has expired.", "AUTH_EXPIRED"); }
  if (!session || Number(session.expiry) <= Date.now()) {
    deleteSession_(token);
    throw new ApiError_("Your session is invalid or has expired.", "AUTH_EXPIRED");
  }

  validateKnownRole_(session.role);
  const user = findObjectRow_(SHEETS.USERS, "User_ID", session.userId, true).row;
  if (!user || cleanString_(user.Status, 30).toLowerCase() !== "active" || cleanString_(user.Role, 50) !== session.role) {
    deleteSession_(token);
    throw new ApiError_("Your session is invalid or has expired.", "AUTH_EXPIRED");
  }

  cache.put(key, serialized, Math.min(SESSION_CACHE_SECONDS, Math.max(1, Math.floor((session.expiry - Date.now()) / 1000))));
  return session;
}

function requireRole_(token, roles) {
  const session = requireSession_(token);
  if (roles.indexOf(session.role) === -1) throw new ApiError_("You are not authorized for this action.", "FORBIDDEN");
  return session;
}

function deleteSession_(token) {
  const key = sessionKey_(token);
  CacheService.getScriptCache().remove(key);
  PropertiesService.getScriptProperties().deleteProperty(key);
}

function sessionKey_(token) {
  return "SESSION_" + bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token, Utilities.Charset.UTF_8));
}

function randomToken_() {
  const entropy = Utilities.getUuid() + Utilities.getUuid() + new Date().getTime() + Math.random();
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, entropy, Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, "");
}

function hashPassword_(password) {
  validateNewPassword_(password);
  const saltBytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid(), Utilities.Charset.UTF_8);
  const salt = Utilities.base64EncodeWebSafe(saltBytes).replace(/=+$/g, "");
  const hash = derivePasswordHash_(password, salt, PASSWORD_ITERATIONS);
  return [PASSWORD_VERSION, PASSWORD_ITERATIONS, salt, hash].join("$");
}

function verifyPassword_(password, stored) {
  const parts = cleanString_(stored, 1000).split("$");
  if (parts.length !== 4 || SUPPORTED_PASSWORD_VERSIONS.indexOf(parts[0]) === -1) return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 250 || iterations > 100000) return false;
  const calculated = derivePasswordHash_(password, parts[2], iterations);
  return constantTimeEqual_(calculated, parts[3]);
}

function passwordHashNeedsUpgrade_(stored) {
  const parts = cleanString_(stored, 1000).split("$");
  return parts.length === 4 && (parts[0] !== PASSWORD_VERSION || Number(parts[1]) !== PASSWORD_ITERATIONS);
}

function derivePasswordHash_(password, salt, iterations) {
  let value = salt + ":" + password;
  for (let i = 0; i < iterations; i += 1) {
    value = bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8));
  }
  return value;
}

function constantTimeEqual_(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) difference |= (a.charCodeAt(i % Math.max(1, a.length)) || 0) ^ (b.charCodeAt(i % Math.max(1, b.length)) || 0);
  return difference === 0;
}

function validateNewPassword_(password) {
  if (typeof password !== "string" || password.length < 12 || password.length > 256) {
    throw new Error("Password must be between 12 and 256 characters.");
  }
}

function getTable_(sheetName) {
  if (requestTables_[sheetName] && requestTables_[sheetName].complete) return requestTables_[sheetName];
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) throw new ApiError_("Required data is unavailable.", "DATA_CONFIGURATION_ERROR");
  const expected = HEADERS[sheetName];
  if (!expected) throw new ApiError_("Required data is unavailable.", "DATA_CONFIGURATION_ERROR");
  const lastColumn = sheet.getLastColumn();
  if (lastColumn < expected.length) throw new ApiError_("Required data is unavailable.", "DATA_CONFIGURATION_ERROR");
  const actual = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(String);
  const index = {};
  actual.forEach(function (header, position) { if (header) index[header] = position + 1; });
  expected.forEach(function (header) { if (!index[header]) throw new ApiError_("Required data is unavailable.", "DATA_CONFIGURATION_ERROR"); });
  const rowCount = Math.max(0, sheet.getLastRow() - 1);
  const values = rowCount ? sheet.getRange(2, 1, rowCount, lastColumn).getValues() : [];
  const rows = values.map(function (row, offset) {
    const object = { _row: offset + 2 };
    actual.forEach(function (header, position) { if (header) object[header] = row[position]; });
    return object;
  }).filter(function (row) { return expected.some(function (header) { return row[header] !== ""; }); });
  const table = { sheet: sheet, headers: actual, index: index, rows: rows, complete: true };
  requestTables_[sheetName] = table;
  return table;
}

function readRows_(sheetName) {
  return getTable_(sheetName).rows;
}

function appendObjectRow_(table, object) {
  const row = table.headers.map(function (header) { return Object.prototype.hasOwnProperty.call(object, header) ? object[header] : ""; });
  table.sheet.getRange(table.sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
}

function updateObjectRow_(table, rowNumber, updates) {
  const current = table.rows.find(function(row){return row._row === rowNumber;});
  const values = table.headers.map(function(header){return Object.prototype.hasOwnProperty.call(updates,header)?updates[header]:(current&&Object.prototype.hasOwnProperty.call(current,header)?current[header]:"");});
  Object.keys(updates).forEach(function (header) {
    if (!table.index[header]) throw new ApiError_("Required data is unavailable.", "DATA_CONFIGURATION_ERROR");
  });
  table.sheet.getRange(rowNumber, 1, 1, values.length).setValues([values]);
}

function writeCell_(sheet, row, column, value) {
  if (!column) throw new ApiError_("Required data is unavailable.", "DATA_CONFIGURATION_ERROR");
  sheet.getRange(row, column).setValue(value);
}

function appendHistory_(requestId, action, oldStatus, newStatus, session, details) {
  const table = getWriteTable_(SHEETS.HISTORY);
  const now = new Date();
  appendObjectRow_(table, {
    History_ID: "HIS-" + now.getTime() + "-" + Utilities.getUuid().replace(/-/g, "").slice(0, 10),
    Request_ID: requestId,
    Action: action,
    Old_Status: oldStatus,
    New_Status: newStatus,
    Performed_By_ID: session.userId,
    Performed_By_Name: session.name,
    Performed_By_Team: session.team,
    Details: cleanString_(details, 1000),
    Created_At: now,
  });
}

function getWriteTable_(sheetName) {
  const cached = requestTables_[sheetName];
  if (cached) return cached;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  const expected = HEADERS[sheetName];
  if (!sheet || !expected) throw new ApiError_("Required data is unavailable.", "DATA_CONFIGURATION_ERROR");
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const index = {};
  headers.forEach(function(header, position){if(header) index[header]=position+1;});
  expected.forEach(function(header){if(!index[header]) throw new ApiError_("Required data is unavailable.", "DATA_CONFIGURATION_ERROR");});
  const table = { sheet: sheet, headers: headers, index: index, rows: [], complete: false };
  requestTables_[sheetName] = table;
  return table;
}

function objectFromSheetRow_(table, rowNumber) {
  const values = table.sheet.getRange(rowNumber, 1, 1, table.headers.length).getValues()[0];
  const object = { _row: rowNumber };
  table.headers.forEach(function (header, position) { if (header) object[header] = values[position]; });
  return object;
}

function findObjectRow_(sheetName, header, value, matchCase) {
  const table = getWriteTable_(sheetName);
  table.complete = false;
  const lastRow = table.sheet.getLastRow();
  if (lastRow < 2 || !table.index[header]) return { table: table, row: null };
  const match = table.sheet.getRange(2, table.index[header], lastRow - 1, 1)
    .createTextFinder(String(value)).matchEntireCell(true).matchCase(matchCase === true).findNext();
  const row = match ? objectFromSheetRow_(table, match.getRow()) : null;
  table.rows = row ? [row] : [];
  return { table: table, row: row };
}

function findObjectRows_(sheetName, header, value, matchCase) {
  const table = getWriteTable_(sheetName);
  table.complete = false;
  const lastRow = table.sheet.getLastRow();
  if (lastRow < 2 || !table.index[header]) return [];
  return table.sheet.getRange(2, table.index[header], lastRow - 1, 1)
    .createTextFinder(String(value)).matchEntireCell(true).matchCase(matchCase === true).findAll()
    .map(function (match) { return objectFromSheetRow_(table, match.getRow()); });
}

function withRequestLock_(requestId, callback) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const found = findObjectRow_(SHEETS.REQUESTS, "Request_ID", requestId, true);
    const table = found.table;
    const request = found.row;
    if (!request) throw new ApiError_("Request not found.", "NOT_FOUND");
    return callback(table, request);
  } finally {
    lock.releaseLock();
  }
}

function findRequest_(requestId) {
  const request = findObjectRow_(SHEETS.REQUESTS, "Request_ID", requestId, true).row;
  if (!request) throw new ApiError_("Request not found.", "NOT_FOUND");
  return request;
}

function nextRequestId_(existingRows) {
  const config = getConfig_();
  const prefix = cleanString_(config.TICKET_PREFIX || "REQ", 20).replace(/[^A-Za-z0-9_-]/g, "") || "REQ";
  const configuredStart = Math.max(1, parseInt(config.TICKET_START_NUMBER, 10) || 100001);
  let maximum = configuredStart - 1;
  const used = {};
  existingRows.forEach(function (row) {
    const id = cleanString_(row.Request_ID, 100);
    used[id] = true;
    const match = id.match(new RegExp("^" + escapeRegExp_(prefix) + "-(\\d+)$"));
    if (match) maximum = Math.max(maximum, Number(match[1]));
  });
  let number = Math.max(configuredStart, maximum + 1);
  while (used[prefix + "-" + number]) number += 1;
  return prefix + "-" + number;
}

function duplicateCheckEnabled_() {
  const value = getConfig_().DUPLICATE_CHECK_ENABLED;
  return value === undefined ? true : isTrue_(value);
}

function findSimilarRequests_(values, rows) {
  const identifiers = ["Player_Username", "Affiliate_Username", "Phone_Number", "Email", "Transaction_ID"]
    .filter(function (field) { return cleanString_(values[field], fieldLimit_(field)); });
  if (!identifiers.length) return [];
  return (rows || readRows_(SHEETS.REQUESTS)).filter(function (row) {
    if (ACTIVE_REQUEST_STATUSES.indexOf(cleanString_(row.Status, 30)) === -1) return false;
    if (cleanString_(row.Brand, 50) !== values.Brand || cleanString_(row.Request_Type, 150) !== values.Request_Type) return false;
    return identifiers.some(function (field) {
      return cleanString_(row[field], fieldLimit_(field)).toLowerCase() === cleanString_(values[field], fieldLimit_(field)).toLowerCase();
    });
  }).slice(0, 10).map(function (row) {
    return { requestId: row.Request_ID, brand: row.Brand, requestType: row.Request_Type, status: row.Status, requestedBy: row.Requested_By_Name, requestedAt: row.Requested_At };
  });
}

function filterRequests_(rows, input) {
  return filterRequestRows_(rows, input).map(projectListRequest_);
}

function filterRequestRows_(rows, input) {
  const status = cleanString_(input.status, 30);
  const brand = cleanString_(input.brand, 50);
  const requestType = cleanString_(input.requestType, 150);
  const search = cleanString_(input.search, 200).toLowerCase();
  const searchFields = ["Request_ID", "Player_Username", "Affiliate_Username", "Affiliate_Username_2", "Phone_Number", "Email", "Transaction_ID"];
  return rows.filter(function (row) {
    if (status && row.Status !== status) return false;
    if (brand && row.Brand !== brand) return false;
    if (requestType && row.Request_Type !== requestType) return false;
    if (search && !searchFields.some(function (field) { return cleanString_(row[field], 500).toLowerCase().indexOf(search) !== -1; })) return false;
    return true;
  }).sort(newestFirst_).slice(0, parseLimit_(input.limit));
}

function listResponse_(requests) {
  return { requests: requests, count: requests.length };
}

function authorizeRequestView_(session, request) {
  if (session.role === ROLES.SUPER || session.role === ROLES.CSP || session.role === ROLES.CSP_ADMIN) return;
  if (session.role === ROLES.BDT) {
    if (isCspCaseRequest_(request)) return;
    if (request.Requested_By_ID === session.userId) return;
    const requester = readRows_(SHEETS.USERS).find(function (user) { return cleanString_(user.User_ID, 100) === cleanString_(request.Requested_By_ID, 100); });
    if (requester && cleanString_(requester.Team, 50).toUpperCase() === "BDT") return;
  }
  throw new ApiError_("You are not authorized to view this request.", "FORBIDDEN");
}

function cspCaseRequestIds_(history) {
  const ids = {};
  (history || readRows_(SHEETS.HISTORY)).forEach(function (row) {
    if (cleanString_(row.Action, 100) === "CSP Case Created") ids[cleanString_(row.Request_ID, 100)] = true;
  });
  return ids;
}

function resolutionHistoryDetails_(reason, remark) {
  const context = cleanString_(remark, 1000);
  const unableReason = cleanString_(reason, 1000);
  return unableReason ? unableReason + (context ? "\nResolution Remark: " + context : "") : context;
}

function resolutionRemarkFromHistory_(history) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const row = history[index], action = cleanString_(row.Action, 100), details = cleanString_(row.Details, 2000);
    if (action === "Completed") return details;
    if (action === "Unable") {
      const marker = "Resolution Remark: ", position = details.indexOf(marker);
      return position === -1 ? "" : details.slice(position + marker.length);
    }
  }
  return "";
}

function resolutionRemarksByRequest_(history) {
  const grouped = {};
  (history || readRows_(SHEETS.HISTORY)).forEach(function (row) {
    const action = cleanString_(row.Action, 100);
    if (action === "Completed" || action === "Unable") grouped[cleanString_(row.Request_ID, 100)] = row;
  });
  const remarks = {};
  Object.keys(grouped).forEach(function (requestId) { remarks[requestId] = resolutionRemarkFromHistory_([grouped[requestId]]); });
  return remarks;
}

function isCspCaseRequest_(request) {
  if (!CSP_CASE_TYPES[cleanString_(request.Request_Type, 150)]) return false;
  return findObjectRows_(SHEETS.HISTORY, "Request_ID", cleanString_(request.Request_ID, 100), true)
    .some(function (row) { return cleanString_(row.Action, 100) === "CSP Case Created"; });
}

function requireHandlerRole_(session, request) {
  const cspCase = isCspCaseRequest_(request);
  const roles = cspCase ? [ROLES.BDT] : [ROLES.CSP, ROLES.CSP_ADMIN, ROLES.SUPER];
  if (roles.indexOf(session.role) === -1) throw new ApiError_("You are not authorized for this action.", "FORBIDDEN");
  return cspCase;
}

function projectHandledRequest_(row) {
  const request = projectRequest_(row);
  if (isCspCaseRequest_(row)) request.Processing_Team = "BDT";
  return request;
}

function projectBdtRequest_(row) {
  const request = projectRequest_(row);
  request.Processing_Team = "BDT";
  return request;
}

function projectRequest_(row) {
  return selectFields_(row, SAFE_REQUEST_FIELDS);
}

function projectListRequest_(row) {
  return selectFields_(row, ["Request_ID", "Brand", "Request_Type", "Player_Username", "Affiliate_Username", "Affiliate_Username_2", "Phone_Number", "Email", "Transaction_ID", "Status", "Requested_By_Name", "Requested_At", "Taken_By_Name", "Taken_At", "Completed_At", "Unable_Reason", "Last_Updated_At"]);
}

function projectQueueRequest_(row) {
  return selectFields_(row, ["Request_ID", "Brand", "Request_Type", "Player_Username", "Affiliate_Username", "Affiliate_Username_2", "Phone_Number", "Email", "Current_Email", "New_Email", "Current_Name", "New_Full_Name", "Current_Player_Username", "New_Player_Username", "Transaction_ID", "Amount", "Notes", "Requested_By_Name", "Requested_At", "Status", "Taken_By_ID", "Taken_By_Name", "Taken_At"]);
}

function projectBdtQueueRequest_(row) {
  const request = projectQueueRequest_(row);
  request.Processing_Team = "BDT";
  return request;
}

function selectFields_(row, fields) {
  const output = {};
  fields.forEach(function (field) { if (Object.prototype.hasOwnProperty.call(row, field)) output[field] = row[field]; });
  return output;
}

function emptyRequest_() {
  const object = {};
  HEADERS.Requests.forEach(function (header) { object[header] = ""; });
  return object;
}

function getConfig_() {
  const cached = staticCacheGet_("CONFIG_V1");
  if (cached) return cached;
  const config = {};
  readRows_(SHEETS.CONFIG).forEach(function (row) {
    const key = cleanString_(row.Config_Key, 100);
    if (key) config[key] = row.Config_Value;
  });
  staticCachePut_("CONFIG_V1", config);
  return config;
}

function staticCacheGet_(key) {
  if (Object.prototype.hasOwnProperty.call(requestStatic_, key)) return requestStatic_[key];
  const value = CacheService.getScriptCache().get(key);
  if (!value) return null;
  try { requestStatic_[key] = JSON.parse(value); return requestStatic_[key]; } catch (error) { return null; }
}

function staticCachePut_(key, value) {
  requestStatic_[key] = value;
  CacheService.getScriptCache().put(key, JSON.stringify(value), STATIC_CACHE_SECONDS);
}

function canonicalRequestField_(name) {
  const value = cleanString_(name, 100);
  if (HEADERS.Requests.indexOf(value) !== -1) return value;
  const normalized = value.replace(/[^a-z0-9]/gi, "").toLowerCase();
  const inputKey = Object.keys(REQUEST_INPUTS).find(function (key) { return key.toLowerCase() === normalized; });
  if (inputKey) return REQUEST_INPUTS[inputKey];
  return HEADERS.Requests.find(function (header) { return header.replace(/_/g, "").toLowerCase() === normalized; }) || "";
}

function parseFieldList_(value) {
  if (Array.isArray(value)) return value.map(function (item) { return cleanString_(item, 100); }).filter(Boolean);
  return cleanString_(value, 2000).split(/[;,|\n]/).map(function (item) { return item.trim(); }).filter(Boolean);
}

function parsePostBody_(e) {
  if (!e || !e.postData || typeof e.postData.contents !== "string") throw new ApiError_("A JSON request body is required.", "INVALID_JSON");
  try {
    const parsed = JSON.parse(e.postData.contents);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid object");
    return parsed;
  } catch (error) {
    throw new ApiError_("The request body must be valid JSON.", "INVALID_JSON");
  }
}

function requireRequestId_(value) {
  const requestId = cleanString_(value, 100);
  if (!requestId) throw new ApiError_("A request ID is required.", "VALIDATION_ERROR");
  return requestId;
}

function cleanString_(value, maxLength) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, maxLength || 1000);
}

function cleanToken_(value) {
  const token = cleanString_(value, 256);
  return /^[A-Za-z0-9_-]{40,256}$/.test(token) ? token : "";
}

function isIpAddress_(value) {
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) return value.split(".").every(function (part) { return Number(part) >= 0 && Number(part) <= 255; });
  return /^[0-9a-fA-F:]{2,45}$/.test(value) && value.indexOf(":") !== -1;
}

function isTrue_(value) {
  return value === true || String(value).trim().toLowerCase() === "true" || String(value).trim() === "1";
}

function fieldLimit_(header) {
  if (header === "Notes" || header === "Unable_Reason") return 2000;
  if (header === "Amount") return 100;
  return 500;
}

function parseLimit_(value) {
  const number = parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? Math.min(number, MAX_LIMIT) : 100;
}

function elapsedSeconds_(start, end) {
  const startMs = dateMs_(start);
  return startMs ? Math.max(0, Math.floor((dateMs_(end) - startMs) / 1000)) : "";
}

function dateMs_(value) {
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateKey_(value) {
  if (!value || !dateMs_(value)) return "";
  const timezone = cleanString_(getConfig_().DEFAULT_TIMEZONE, 100) || Session.getScriptTimeZone();
  return Utilities.formatDate(new Date(dateMs_(value)), timezone, "yyyy-MM-dd");
}

function newestFirst_(a, b) {
  return dateMs_(b.Requested_At) - dateMs_(a.Requested_At);
}

function sortByNumber_(field) {
  return function (a, b) { return (Number(a[field]) || 0) - (Number(b[field]) || 0); };
}

function publicSession_(session) {
  return { userId: session.userId, name: session.name, username: session.username, team: session.team, role: session.role, expiry: new Date(Number(session.expiry)) };
}

function validateKnownRole_(role) {
  if ([ROLES.BDT, ROLES.CSP, ROLES.CSP_ADMIN, ROLES.SUPER].indexOf(role) === -1) throw new ApiError_("Your account is not authorized.", "UNAUTHORIZED");
}

function bytesToHex_(bytes) {
  return bytes.map(function (byte) { return (byte < 0 ? byte + 256 : byte).toString(16).padStart(2, "0"); }).join("");
}

function escapeRegExp_(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function copyObject_(source) {
  const target = {};
  Object.keys(source).forEach(function (key) { target[key] = source[key]; });
  return target;
}

function mergeObjects_(base, updates) {
  const result = copyObject_(base);
  Object.keys(updates).forEach(function (key) { result[key] = updates[key]; });
  return result;
}

function success_(data) {
  return { ok: true, data: data };
}

function failure_(message, code, extra) {
  const output = { ok: false, error: message };
  if (code) output.code = code;
  if (extra) output.data = extra;
  return output;
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function ApiError_(message, code, extra) {
  this.name = "ApiError";
  this.message = message;
  this.code = code || "REQUEST_ERROR";
  this.extra = extra || null;
  this.isApiError = true;
}
