const fs = require("node:fs");
const firebase = JSON.parse(fs.readFileSync("firebase.json", "utf8"));
if (firebase.firestore?.rules !== "firestore.rules" || firebase.firestore?.indexes !== "firestore.indexes.json") throw new Error("Firebase Firestore files are not canonical");
const rules = fs.readFileSync("firestore.rules", "utf8");
for (const required of ["allow delete: if false", "allow update, delete: if false", "match /{document=**} { allow read, write: if false; }"]) if (!rules.includes(required)) throw new Error(`Missing fail-closed rule: ${required}`);
if (/private_key|serviceAccount|apiKey/i.test(rules)) throw new Error("Credential-shaped material found");
console.log("Firebase readiness configuration PASS");
