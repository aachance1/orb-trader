// Whop license key validation
// Called on server startup and every 24 hours
// If license is invalid or subscription cancelled, server refuses to trade

var stateModule = require("./state");

var WHOP_API = "https://api.whop.com/api/v2";
var WHOP_API_KEY = process.env.WHOP_API_KEY;       // your Whop API key (set in Railway)
var WHOP_PRODUCT_ID = process.env.WHOP_PRODUCT_ID; // your product ID e.g. prod_xxxxxxxx

var licenseState = {
  valid: false,
  licenseKey: null,
  checkedAt: null,
  error: null
};

function getLicenseState() {
  return licenseState;
}

async function validateLicense(licenseKey) {
  if (!WHOP_API_KEY) {
    stateModule.logEvent("LICENSE_ERROR", "WHOP_API_KEY env var not set");
    licenseState.valid = false;
    licenseState.error = "WHOP_API_KEY not configured";
    return false;
  }

  if (!licenseKey) {
    stateModule.logEvent("LICENSE_ERROR", "No license key provided");
    licenseState.valid = false;
    licenseState.error = "No license key provided";
    return false;
  }

  try {
    // Validate license key against Whop API
    var res = await fetch(WHOP_API + "/memberships/validate_license", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + WHOP_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ license_key: licenseKey })
    });

    var data = await res.json();

    if (res.ok && data.valid === true) {
      // Optionally check it's for the right product
      if (WHOP_PRODUCT_ID && data.product_id && data.product_id !== WHOP_PRODUCT_ID) {
        stateModule.logEvent("LICENSE_ERROR", "License key is for wrong product: " + data.product_id);
        licenseState.valid = false;
        licenseState.error = "License key does not match this product";
        return false;
      }

      licenseState.valid = true;
      licenseState.licenseKey = licenseKey;
      licenseState.checkedAt = new Date().toISOString();
      licenseState.error = null;
      stateModule.logEvent("LICENSE_OK", "License valid. Status: " + data.status + " Expires: " + (data.expires_at ? new Date(data.expires_at * 1000).toDateString() : "never"));
      return true;
    } else {
      var reason = data.error || data.message || ("status: " + data.status) || "invalid";
      stateModule.logEvent("LICENSE_INVALID", "License rejected: " + reason);
      licenseState.valid = false;
      licenseState.licenseKey = licenseKey;
      licenseState.checkedAt = new Date().toISOString();
      licenseState.error = reason;
      return false;
    }
  } catch (err) {
    stateModule.logEvent("LICENSE_ERROR", "Whop API error: " + err.message);
    // On network error, allow trading to continue if previously validated
    // (avoids killing live trades due to a transient API outage)
    if (licenseState.valid) {
      stateModule.logEvent("LICENSE_WARN", "Network error — using cached valid state");
      return true;
    }
    licenseState.error = "Network error: " + err.message;
    return false;
  }
}

// Schedule daily license recheck at 8:55 AM ET (before market open)
function scheduleDailyLicenseCheck() {
  function msUntilNext855amET() {
    var now = new Date();
    var target = new Date();
    target.setUTCHours(12, 55, 0, 0); // 8:55 AM ET = 12:55 UTC (EDT)
    if (target <= now) target.setUTCDate(target.getUTCDate() + 1);
    return target - now;
  }
  function scheduleNext() {
    var delay = msUntilNext855amET();
    stateModule.logEvent("LICENSE", "Next license check in " + Math.round(delay / 60000) + " min");
    setTimeout(async function() {
      var key = process.env.WHOP_LICENSE_KEY;
      if (key) await validateLicense(key);
      scheduleNext();
    }, delay);
  }
  scheduleNext();
}

module.exports = {
  validateLicense: validateLicense,
  getLicenseState: getLicenseState,
  scheduleDailyLicenseCheck: scheduleDailyLicenseCheck
};
