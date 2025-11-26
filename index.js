/********************************************************************
 *           POWERMTA WARMUP ENGINE - SINGLE FILE VERSION
 ********************************************************************/

const express = require("express");
const fs = require("fs");
const { execSync } = require("child_process");
const nodemailer = require("nodemailer");
const bodyParser = require("body-parser");

// ====================================================================
//                     PMTA CONFIG DIRECTORIES
// ====================================================================
const DOMAIN_DIR = "/etc/pmta/domains";
const DKIM_DIR = "/etc/pmta/dkim";

// Ensure directories exist
if (!fs.existsSync(DOMAIN_DIR)) fs.mkdirSync(DOMAIN_DIR, { recursive: true });
if (!fs.existsSync(DKIM_DIR)) fs.mkdirSync(DKIM_DIR, { recursive: true });

// ====================================================================
//                    IN-MEMORY WARMUP STORAGE
// ====================================================================
let warmupAccounts = []; // No DB. Stored in RAM only.

// ====================================================================
//                           EXPRESS SETUP
// ====================================================================
const app = express();
app.use(bodyParser.json());

app.get("/", (req, res) => {
  res.send("🔥 PMTA Warmup Engine Running (No Database Mode)");
});

// ====================================================================
//                       GET IP FROM PMTA CONFIG
// ====================================================================

app.get("/get-ip", (req, res) => {
  try {
    const config = fs.readFileSync("/etc/pmta/config", "utf8");
    const match = config.match(/smtp-listener\s+([0-9\.]+):/);

    if (!match || !match[1]) {
      return res.status(404).json({
        error: "IP address not found in config",
        message: "Could not find smtp-listener IP in /etc/pmta/config",
      });
    }

    res.json({
      status: "success",
      ip: match[1],
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
      details: "Failed to read config file or extract IP address",
    });
  }
});

app.get("/send-mail", async (req, res) => {
  try {
    const transporter = nodemailer.createTransport({
      host: "107.175.67.25",
      port: 2525,
      secure: false,
      tls: {
        rejectUnauthorized: false,
      },
      auth: {
        user: "admin",
        pass: "Nikhil1234$$",
      },
    });
    const info = await transporter.sendMail({
      from: "admin@autometa.in",
      to: "insanedragon77@gmail.com",
      subject: "Test Email",
      text: "This is a test email",
    });
    res.json({
      status: "success",
      message: "Email sent successfully",
      info: info,
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
      details: "Failed to read config file or extract IP address",
    });
  }
});

// ====================================================================
//                       DKIM UPDATE API
// ====================================================================
app.post("/update-dkim", (req, res) => {
  try {
    const { domain, dkim_value } = req.body;

    if (!domain || !dkim_value)
      return res.status(400).json({ error: "domain and dkim_value required" });

    const pemPath = `${DKIM_DIR}/${domain}.pem`;
    const confPath = `${DOMAIN_DIR}/${domain}.conf`;

    // FIX ❗: Convert escaped "\\n" to actual newlines
    const fixedKey = dkim_value.replace(/\\n/g, "\n").trim();

    // Write DKIM private key correctly
    fs.writeFileSync(pemPath, fixedKey);
    fs.chmodSync(pemPath, 0o600);

    // Write domain config
    const domainConf = `
<domain ${domain}>
</domain>
        `.trim();

    fs.writeFileSync(confPath, domainConf);

    execSync("pmta reload");

    res.json({ status: "success", message: "DKIM updated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ====================================================================
//                        START EXPRESS SERVER
// ====================================================================

app.listen(3000, "0.0.0.0", () => {
  console.log("🔥 PMTA Warmup API running on port 3000");
});
