const express = require("express");
const path = require("path");
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "dashboard")));

const { handleAlert } = require("./routes/alert");
const { getState, setContractSize } = require("./utils/state");
const { scheduleDailyReauth, ensureLoggedIn } = require("./utils/reauth");
const { validateLicense, getLicenseState, scheduleDailyLicenseCheck } = require("./utils/license");

// ── License gate middleware — blocks all trading if license invalid
function requireValidLicense(req, res, next) {
  if (!getLicenseState().valid) {
    return res.status(403).json({
      error: "Invalid or expired license. Visit whop.com to manage your subscription.",
      license: getLicenseState()
    });
  }
  next();
}

app.get("/health", (req, res) => {
  res.json({
    status: "running",
    time: new Date().toISOString(),
    license: getLicenseState().valid ? "valid" : "invalid"
  });
});

app.get("/api/state", (req, res) => {
  var s = getState();
  s.license = getLicenseState();
  res.json(s);
});

app.post("/api/reauth", async (req, res) => {
  const ok = await ensureLoggedIn();
  res.json({ ok: ok, message: ok ? "Logged in" : "Login failed" });
});

app.post("/api/contracts", (req, res) => {
  const { spy, iwm } = req.body;
  if (!spy || !iwm) return res.status(400).json({ error: "spy and iwm required" });
  setContractSize(spy, iwm);
  res.json({ ok: true, contracts: getState().contracts });
});

// License activation endpoint — customer pastes their Whop license key into dashboard
app.post("/api/license", async (req, res) => {
  const { licenseKey } = req.body;
  if (!licenseKey) return res.status(400).json({ error: "licenseKey required" });
  const valid = await validateLicense(licenseKey);
  res.json({ ok: valid, license: getLicenseState() });
});

// Webhook — license gated
app.post("/webhook", requireValidLicense, async (req, res) => {
  console.log("[WEBHOOK]", JSON.stringify(req.body));
  try {
    const result = await handleAlert(req.body);
    res.json(result);
  } catch (err) {
    console.error("[ERROR]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log("ORB server listening on port " + PORT);

  // Validate license on startup
  var licenseKey = process.env.WHOP_LICENSE_KEY;
  if (licenseKey) {
    await validateLicense(licenseKey);
  } else {
    console.log("[LICENSE] WHOP_LICENSE_KEY not set — trading disabled until activated");
  }

  // Schedule daily license recheck at 8:55 AM ET
  scheduleDailyLicenseCheck();

  // Connect Robinhood
  await ensureLoggedIn();
  scheduleDailyReauth();
});
