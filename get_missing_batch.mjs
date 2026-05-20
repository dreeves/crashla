import fs from 'fs';
const raw = fs.readFileSync('data/incidents.js', 'utf8');
const dataStr = raw.substring(raw.indexOf('['), raw.lastIndexOf(']')+1);
const incidents = JSON.parse(dataStr);

const TARGET_START = new Date("2025-06-01");

const faultMissing = incidents.filter(i => {
    if (new Date(i.date) < TARGET_START) return false;
    return !i.fault;
});
console.log("Total missing:", faultMissing.length);
for (const row of faultMissing.slice(0, 20)) {
    console.log(`ID: ${row.reportId}`);
    console.log(`Speed: ${row.speed}`);
    console.log(`Crash With: ${row.crashWith}`);
    console.log(`Severity: ${row.severity}`);
    console.log(`Narrative: ${row.narrative}`);
    console.log(`SV Hit: ${row.svHit} | CP Hit: ${row.cpHit}`);
    console.log("---");
}
