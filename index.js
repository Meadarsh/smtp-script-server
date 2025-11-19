const express = require("express");
const fs = require("fs");
const bodyParser = require("body-parser");
const { execSync } = require("child_process");

const app = express();
app.use(bodyParser.json());

const DOMAIN_CONFIG_DIR = "/etc/pmta/domains";
const DKIM_DIR = "/etc/pmta/dkim";

// Ensure required folders exist
function ensureDirectories() {
    if (!fs.existsSync(DOMAIN_CONFIG_DIR)) {
        fs.mkdirSync(DOMAIN_CONFIG_DIR, { recursive: true });
    }
    if (!fs.existsSync(DKIM_DIR)) {
        fs.mkdirSync(DKIM_DIR, { recursive: true });
        fs.chmodSync(DKIM_DIR, 0o700);
    }
}

ensureDirectories();

function updateDomainConfig(domain, dkimValue) {
    const domainConfigPath = `${DOMAIN_CONFIG_DIR}/${domain}.conf`;
    const pemPath = `${DKIM_DIR}/${domain}.pem`;

    // Save DKIM private key to PEM file
    fs.writeFileSync(pemPath, dkimValue.trim(), "utf8");
    fs.chmodSync(pemPath, 0o600);

    // Create domain config block
    const domainBlock = `
<domain ${domain}>
    dkim-sign yes
    domain-key-file ${pemPath}
</domain>
    `.trim();

    // Write or replace domain config file (each domain has its own file)
    fs.writeFileSync(domainConfigPath, domainBlock, "utf8");

    // Reload PowerMTA
    execSync("pmta reload");

    return true;
}

app.get("/", (req, res) => {
    res.send("Hello World");
});
app.post("/update-dkim", (req, res) => {
    const { domain, dkim_value } = req.body;

    if (!domain || !dkim_value) {
        return res.status(400).json({
            error: "domain and dkim_value are required"
        });
    }

    try {
        updateDomainConfig(domain.toLowerCase(), dkim_value);
        res.json({
            status: "success",
            message: `DKIM updated for ${domain}`
        });
    } catch (err) {
        console.error("Error:", err);
        res.status(500).json({
            status: "error",
            message: "Unable to update DKIM",
            details: err.message
        });
    }
});

app.listen(3000, "0.0.0.0", () => {
    console.log("PMTA DKIM API running on port 3000");
});
