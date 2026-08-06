"use strict";
const fs = require("node:fs");
const unit = process.env.NUSA_UNIT || "deploy/oracle/nusa.service";
const source = fs.readFileSync(unit, "utf8");
for (const required of ["User=nusa", "Group=nusa", "NoNewPrivileges=true", "ProtectSystem=strict", "Restart=on-failure"]) if (!source.includes(required)) throw new Error(`missing ${required}`);
if (/User=root|Group=root/.test(source)) throw new Error("root service execution is forbidden");
console.log(JSON.stringify({ status: "PASS", unit }));
