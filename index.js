// const express = require("express");
// const fs = require("fs");
// const bodyParser = require("body-parser");
// const { execSync } = require("child_process");

// const app = express();
// app.use(bodyParser.json());

// const DOMAIN_CONFIG_DIR = "/etc/pmta/domains";
// const DKIM_DIR = "/etc/pmta/dkim";

// // Ensure required folders exist
// function ensureDirectories() {
//     if (!fs.existsSync(DOMAIN_CONFIG_DIR)) {
//         fs.mkdirSync(DOMAIN_CONFIG_DIR, { recursive: true });
//     }
//     if (!fs.existsSync(DKIM_DIR)) {
//         fs.mkdirSync(DKIM_DIR, { recursive: true });
//         fs.chmodSync(DKIM_DIR, 0o700);
//     }
// }

// ensureDirectories();

// function updateDomainConfig(domain, dkimValue) {
//     const domainConfigPath = `${DOMAIN_CONFIG_DIR}/${domain}.conf`;
//     const pemPath = `${DKIM_DIR}/${domain}.pem`;

//     // Save DKIM private key to PEM file
//     fs.writeFileSync(pemPath, dkimValue.trim(), "utf8");
//     fs.chmodSync(pemPath, 0o600);

//     // Create domain config block
//     const domainBlock = `
// <domain ${domain}>
//     dkim-sign yes
//     domain-key-file ${pemPath}
// </domain>
//     `.trim();

//     // Write or replace domain config file (each domain has its own file)
//     fs.writeFileSync(domainConfigPath, domainBlock, "utf8");

//     // Reload PowerMTA
//     execSync("pmta reload");

//     return true;
// }

// app.get("/", (req, res) => {
//     res.send("Hello World");
// });
// app.post("/update-dkim", (req, res) => {
//     const { domain, dkim_value } = req.body;

//     if (!domain || !dkim_value) {
//         return res.status(400).json({
//             error: "domain and dkim_value are required"
//         });
//     }

//     try {
//         updateDomainConfig(domain.toLowerCase(), dkim_value);
//         res.json({
//             status: "success",
//             message: `DKIM updated for ${domain}`
//         });
//     } catch (err) {
//         console.error("Error:", err);
//         res.status(500).json({
//             status: "error",
//             message: "Unable to update DKIM",
//             details: err.message
//         });
//     }
// });

// app.listen(3000, "0.0.0.0", () => {
//     console.log("PMTA DKIM API running on port 3000");
// });
/********************************************************************
 *           POWERMTA WARMUP ENGINE - SINGLE FILE VERSION
 ********************************************************************/

const express = require("express");
const fs = require("fs");
const { execSync } = require("child_process");
const nodemailer = require("nodemailer");
const cron = require("node-cron");
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
let warmupAccounts = [];   // No DB. Stored in RAM only.

// ====================================================================
//                           EXPRESS SETUP
// ====================================================================
const app = express();
app.use(bodyParser.json());

app.get("/", (req, res) => {
    res.send("🔥 PMTA Warmup Engine Running (No Database Mode)");
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

        // Write DKIM private key
        fs.writeFileSync(pemPath, dkim_value.trim());
        fs.chmodSync(pemPath, 0o600);

        // Write domain config
        const domainConf = `
<domain ${domain}>
  dkim-sign yes
  domain-key-file ${pemPath}
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
//                     ADD WARMUP PLAN (CREATE)
// ====================================================================

app.post("/warmup/add", (req, res) => {
    try {
        const data = req.body;

        if (!data.email || !data.smtp_user || !data.smtp_pass)
            return res.status(400).json({ error: "email, smtp_user, smtp_pass required" });

        const plan = {
            id: Date.now(),
            email: data.email,
            smtp_user: data.smtp_user,
            smtp_pass: data.smtp_pass,
            warmup_plan: data.warmup_plan || [],
            receivers: data.receivers || [],
            current_day: 1,
            status: "active"
        };

        warmupAccounts.push(plan);

        res.json({ status: "success", warmup: plan });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ====================================================================
//                     UPDATE WARMUP PLAN
// ====================================================================

app.post("/warmup/update/:id", (req, res) => {
    const id = Number(req.params.id);
    const updates = req.body;

    const idx = warmupAccounts.findIndex(a => a.id === id);
    if (idx === -1)
        return res.status(404).json({ error: "Warmup plan not found" });

    warmupAccounts[idx] = {
        ...warmupAccounts[idx],
        ...updates
    };

    res.json({ status: "success", updated: warmupAccounts[idx] });
});

// ====================================================================
//                     DELETE WARMUP PLAN
// ====================================================================

app.delete("/warmup/delete/:id", (req, res) => {
    const id = Number(req.params.id);

    const before = warmupAccounts.length;
    warmupAccounts = warmupAccounts.filter(acc => acc.id !== id);

    if (warmupAccounts.length === before)
        return res.status(404).json({ error: "Warmup plan not found" });

    res.json({ status: "success", message: "Warmup plan deleted" });
});

// ====================================================================
//                     LIST WARMUP PLANS
// ====================================================================

app.get("/warmup/list", (req, res) => {
    res.json(warmupAccounts);
});

// ====================================================================
//                      SEND SINGLE WARMUP EMAIL
// ====================================================================

async function sendWarmupEmail(account, receiver) {
    const transporter = nodemailer.createTransport({
        host: "127.0.0.1",
        port: 2525,
        secure: false,
        auth: {
            user: account.smtp_user,
            pass: account.smtp_pass
        }
    });

    return transporter.sendMail({
        from: account.email,
        to: receiver,
        subject: "Warmup Email",
        text: "This is an automated warmup email."
    });
}

// ====================================================================
//               CRON JOB — SEND WARMUP EMAILS EVERY 5 MIN
// ====================================================================

cron.schedule("*/5 * * * *", async () => {
    console.log("⚡ Warmup Cron Triggered...");

    for (let acc of warmupAccounts) {
        if (acc.status !== "active") continue;

        const today = acc.warmup_plan.find(p => p.day === acc.current_day);
        if (!today) continue;

        const totalSend = today.send;

        console.log(`📨 Sending ${totalSend} warmup emails for ${acc.email}`);

        for (let i = 0; i < totalSend; i++) {
            const receiver = acc.receivers[i % acc.receivers.length];
            try {
                await sendWarmupEmail(acc, receiver);
                console.log(`✔ Sent to ${receiver}`);
            } catch (err) {
                console.log("❌ Send Error:", err.message);
            }
        }

        acc.current_day += 1;
    }
});

// ====================================================================
//                        START EXPRESS SERVER
// ====================================================================

app.listen(3001, () => {
    console.log("🔥 PMTA Warmup API running on port 3001");
});
