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
  ALLOWED_IPS: "Allowed_IPs",
};

const HEADERS = {
  Users: ["User_ID", "Name", "Username", "Password_Hash", "Team", "Role", "Status", "Created_At", "Updated_At", "Last_Login"],
  Requests: ["Request_ID", "Brand", "Request_Type", "Player_Username", "Affiliate_Username", "Phone_Number", "Email", "Current_Email", "New_Email", "Current_Name", "New_Full_Name", "Current_Player_Username", "New_Player_Username", "Transaction_ID", "Amount", "Notes", "Status", "Requested_By_ID", "Requested_By_Name", "Requested_At", "Taken_By_ID", "Taken_By_Name", "Taken_At", "Completed_By_ID", "Completed_By_Name", "Completed_At", "Unable_Reason", "Cancelled_By_ID", "Cancelled_At", "Waiting_Seconds", "Handling_Seconds", "Total_Seconds", "Last_Updated_At"],
  Request_History: ["History_ID", "Request_ID", "Action", "Old_Status", "New_Status", "Performed_By_ID", "Performed_By_Name", "Performed_By_Team", "Details", "Created_At"],
  Request_Types: ["Type_ID", "Request_Type", "Required_Fields", "Optional_Fields", "Active", "Sort_Order"],
  Brands: ["Brand_ID", "Brand_Code", "Brand_Name", "Active", "Sort_Order"],
  Config: ["Config_Key", "Config_Value", "Description", "Updated_At"],
  Allowed_IPs: ["IP_ID", "IP_Address", "Label", "Team", "Active", "Created_At", "Notes"],
};

const ROLES = {
  BDT: "BDT_STAFF",
  CSP: "CSP_STAFF",
  CSP_ADMIN: "CSP_ADMIN",
  SUPER: "SUPER_ADMIN",
};

const SESSION_SECONDS = 8 * 60 * 60;
const SESSION_CACHE_SECONDS = 6 * 60 * 60;
const PASSWORD_VERSION = "v1";
const PASSWORD_ITERATIONS = 10000;
const MAX_LIMIT = 500;
const ACTIVE_REQUEST_STATUSES = ["Pending", "Processing"];

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
  "Request_ID", "Brand", "Request_Type", "Player_Username", "Affiliate_Username",
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
      takeRequest: function () { return success_(takeRequest_(input)); },
      completeRequest: function () { return success_(completeRequest_(input)); },
      unableRequest: function () { return success_(unableRequest_(input)); },
      cancelRequest: function () { return success_(cancelRequest_(input)); },
      requestDetails: function () { return success_(requestDetails_(input)); },
      dashboard: function () { return success_(dashboard_(input)); },
      listUsers: function () { return success_(listUsers_(input)); },
      createUser: function () { return success_(createUser_(input)); },
      updateUser: function () { return success_(updateUser_(input)); },
      resetUserPassword: function () { return success_(resetUserPassword_(input)); },
      setUserStatus: function () { return success_(setUserStatus_(input)); },
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
  const data = readRows_(SHEETS.BRANDS)
    .filter(function (row) { return isTrue_(row.Active); })
    .sort(sortByNumber_("Sort_Order"))
    .map(function (row) {
      return { brandId: cleanString_(row.Brand_ID, 100), code: cleanString_(row.Brand_Code, 50), name: cleanString_(row.Brand_Name, 150) };
    });
  return success_(data);
}

function requestTypes_() {
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
  return success_(data);
}

function login_(input) {
  const username = cleanString_(input.username, 100).toLowerCase();
  const password = typeof input.password === "string" ? input.password : "";
  if (!username || !password) throw new ApiError_("Username and password are required.", "INVALID_CREDENTIALS");

  const table = getTable_(SHEETS.USERS);
  const user = table.rows.find(function (row) {
    return cleanString_(row.Username, 100).toLowerCase() === username;
  });

  if (!user || cleanString_(user.Status, 30).toLowerCase() !== "active" || !verifyPassword_(password, user.Password_Hash)) {
    throw new ApiError_("Invalid username or password.", "INVALID_CREDENTIALS");
  }

  const now = new Date();
  writeCell_(table.sheet, user._row, table.index.Last_Login, now);
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

  if (duplicateCheckEnabled_()) {
    const similar = findSimilarRequests_(values);
    if (similar.length && input.confirmDuplicate !== true) {
      return { created: false, duplicateWarning: true, similarRequests: similar };
    }
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // Recheck under the lock so a concurrent matching submission is visible.
    if (duplicateCheckEnabled_() && input.confirmDuplicate !== true) {
      const concurrentSimilar = findSimilarRequests_(values);
      if (concurrentSimilar.length) return { created: false, duplicateWarning: true, similarRequests: concurrentSimilar };
    }

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
  const queue = readRows_(SHEETS.REQUESTS)
    .filter(function (row) { return ACTIVE_REQUEST_STATUSES.indexOf(cleanString_(row.Status, 30)) !== -1; })
    .sort(function (a, b) { return dateMs_(a.Requested_At) - dateMs_(b.Requested_At); })
    .map(projectQueueRequest_);
  return { requests: queue, count: queue.length };
}

function takeRequest_(input) {
  const session = requireRole_(input.token, [ROLES.CSP, ROLES.CSP_ADMIN, ROLES.SUPER]);
  const requestId = requireRequestId_(input.requestId);
  return withRequestLock_(requestId, function (table, request) {
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
    return { request: projectRequest_(mergeObjects_(request, updates)) };
  });
}

function completeRequest_(input) {
  const session = requireRole_(input.token, [ROLES.CSP, ROLES.CSP_ADMIN, ROLES.SUPER]);
  const requestId = requireRequestId_(input.requestId);
  return finalizeRequest_(requestId, session, "Completed", "", "Completed");
}

function unableRequest_(input) {
  const session = requireRole_(input.token, [ROLES.CSP, ROLES.CSP_ADMIN, ROLES.SUPER]);
  const requestId = requireRequestId_(input.requestId);
  const reason = cleanString_(input.reason, 1000);
  if (!reason) throw new ApiError_("An unable reason is required.", "VALIDATION_ERROR");
  return finalizeRequest_(requestId, session, "Unable", reason, "Unable");
}

function finalizeRequest_(requestId, session, newStatus, reason, action) {
  return withRequestLock_(requestId, function (table, request) {
    if (request.Status !== "Processing") throw new ApiError_("Only a processing request can be updated.", "REQUEST_CONFLICT", { status: request.Status });
    if (session.role === ROLES.CSP && cleanString_(request.Taken_By_ID, 100) !== session.userId) {
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
    appendHistory_(requestId, action, "Processing", newStatus, session, reason);
    return { request: projectRequest_(mergeObjects_(request, updates)) };
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
  const history = readRows_(SHEETS.HISTORY)
    .filter(function (row) { return cleanString_(row.Request_ID, 100) === request.Request_ID; })
    .sort(function (a, b) { return dateMs_(a.Created_At) - dateMs_(b.Created_At); })
    .map(function (row) {
      return selectFields_(row, ["History_ID", "Request_ID", "Action", "Old_Status", "New_Status", "Performed_By_ID", "Performed_By_Name", "Performed_By_Team", "Details", "Created_At"]);
    });
  return { request: projectRequest_(request), history: history };
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
  if (!serialized) throw new ApiError_("Your session is invalid or has expired.", "UNAUTHORIZED");

  let session;
  try { session = JSON.parse(serialized); } catch (error) { deleteSession_(token); throw new ApiError_("Your session is invalid or has expired.", "UNAUTHORIZED"); }
  if (!session || Number(session.expiry) <= Date.now()) {
    deleteSession_(token);
    throw new ApiError_("Your session is invalid or has expired.", "UNAUTHORIZED");
  }

  validateKnownRole_(session.role);
  const user = readRows_(SHEETS.USERS).find(function (row) { return cleanString_(row.User_ID, 100) === session.userId; });
  if (!user || cleanString_(user.Status, 30).toLowerCase() !== "active" || cleanString_(user.Role, 50) !== session.role) {
    deleteSession_(token);
    throw new ApiError_("Your session is invalid or has expired.", "UNAUTHORIZED");
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
  if (parts.length !== 4 || parts[0] !== PASSWORD_VERSION) return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 100000) return false;
  const calculated = derivePasswordHash_(password, parts[2], iterations);
  return constantTimeEqual_(calculated, parts[3]);
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
  return { sheet: sheet, headers: actual, index: index, rows: rows };
}

function readRows_(sheetName) {
  return getTable_(sheetName).rows;
}

function appendObjectRow_(table, object) {
  const row = table.headers.map(function (header) { return Object.prototype.hasOwnProperty.call(object, header) ? object[header] : ""; });
  table.sheet.appendRow(row);
}

function updateObjectRow_(table, rowNumber, updates) {
  Object.keys(updates).forEach(function (header) {
    if (!table.index[header]) throw new ApiError_("Required data is unavailable.", "DATA_CONFIGURATION_ERROR");
    writeCell_(table.sheet, rowNumber, table.index[header], updates[header]);
  });
}

function writeCell_(sheet, row, column, value) {
  if (!column) throw new ApiError_("Required data is unavailable.", "DATA_CONFIGURATION_ERROR");
  sheet.getRange(row, column).setValue(value);
}

function appendHistory_(requestId, action, oldStatus, newStatus, session, details) {
  const table = getTable_(SHEETS.HISTORY);
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

function withRequestLock_(requestId, callback) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const table = getTable_(SHEETS.REQUESTS);
    const request = table.rows.find(function (row) { return cleanString_(row.Request_ID, 100) === requestId; });
    if (!request) throw new ApiError_("Request not found.", "NOT_FOUND");
    return callback(table, request);
  } finally {
    lock.releaseLock();
  }
}

function findRequest_(requestId) {
  const request = readRows_(SHEETS.REQUESTS).find(function (row) { return cleanString_(row.Request_ID, 100) === requestId; });
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

function findSimilarRequests_(values) {
  const identifiers = ["Player_Username", "Affiliate_Username", "Phone_Number", "Email", "Transaction_ID"]
    .filter(function (field) { return cleanString_(values[field], fieldLimit_(field)); });
  if (!identifiers.length) return [];
  return readRows_(SHEETS.REQUESTS).filter(function (row) {
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
  const status = cleanString_(input.status, 30);
  const brand = cleanString_(input.brand, 50);
  const requestType = cleanString_(input.requestType, 150);
  const search = cleanString_(input.search, 200).toLowerCase();
  const searchFields = ["Request_ID", "Player_Username", "Affiliate_Username", "Phone_Number", "Email", "Transaction_ID"];
  return rows.filter(function (row) {
    if (status && row.Status !== status) return false;
    if (brand && row.Brand !== brand) return false;
    if (requestType && row.Request_Type !== requestType) return false;
    if (search && !searchFields.some(function (field) { return cleanString_(row[field], 500).toLowerCase().indexOf(search) !== -1; })) return false;
    return true;
  }).sort(newestFirst_).slice(0, parseLimit_(input.limit)).map(projectListRequest_);
}

function listResponse_(requests) {
  return { requests: requests, count: requests.length };
}

function authorizeRequestView_(session, request) {
  if (session.role === ROLES.SUPER || session.role === ROLES.CSP || session.role === ROLES.CSP_ADMIN) return;
  if (session.role === ROLES.BDT) {
    if (request.Requested_By_ID === session.userId) return;
    const requester = readRows_(SHEETS.USERS).find(function (user) { return cleanString_(user.User_ID, 100) === cleanString_(request.Requested_By_ID, 100); });
    if (requester && cleanString_(requester.Team, 50).toUpperCase() === "BDT") return;
  }
  throw new ApiError_("You are not authorized to view this request.", "FORBIDDEN");
}

function projectRequest_(row) {
  return selectFields_(row, SAFE_REQUEST_FIELDS);
}

function projectListRequest_(row) {
  return selectFields_(row, ["Request_ID", "Brand", "Request_Type", "Player_Username", "Affiliate_Username", "Phone_Number", "Email", "Transaction_ID", "Status", "Requested_By_Name", "Requested_At", "Taken_By_Name", "Taken_At", "Completed_At", "Unable_Reason", "Last_Updated_At"]);
}

function projectQueueRequest_(row) {
  return selectFields_(row, ["Request_ID", "Brand", "Request_Type", "Player_Username", "Affiliate_Username", "Phone_Number", "Email", "Current_Email", "New_Email", "Current_Name", "New_Full_Name", "Current_Player_Username", "New_Player_Username", "Transaction_ID", "Amount", "Notes", "Requested_By_Name", "Requested_At", "Status", "Taken_By_ID", "Taken_By_Name", "Taken_At"]);
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
  const config = {};
  readRows_(SHEETS.CONFIG).forEach(function (row) {
    const key = cleanString_(row.Config_Key, 100);
    if (key) config[key] = row.Config_Value;
  });
  return config;
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
