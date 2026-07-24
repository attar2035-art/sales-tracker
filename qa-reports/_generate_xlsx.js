// QA spreadsheet generator. Reads JSON (test cases + bugs) and writes .xlsx
// using the SheetJS (xlsx) dependency already in the project.
// Usage: node qa-reports/_generate_xlsx.js
const path = require('path');
const XLSX = require(path.join(__dirname, '..', 'node_modules', 'xlsx'));
const testCases = require('./_test_cases.json');
const bugs = require('./_bugs.json');

function autoWidth(rows, headers) {
  return headers.map(h => {
    const maxCell = rows.reduce((m, r) => Math.max(m, String(r[h] ?? '').length), h.length);
    return { wch: Math.min(60, Math.max(10, maxCell + 2)) };
  });
}

function sheetFrom(rows, headers) {
  const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
  ws['!cols'] = autoWidth(rows, headers);
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: headers.length - 1 } }) };
  return ws;
}

// ---- 04-test-cases.xlsx ----
const tcHeaders = [
  'Test Case ID', 'Module', 'Feature', 'User Role', 'Test Scenario', 'Preconditions',
  'Test Steps', 'Test Data', 'Expected Result', 'Actual Result', 'Status', 'Priority',
  'Severity', 'Test Type', 'Environment', 'Bug ID', 'Notes',
];
const tcWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(tcWb, sheetFrom(testCases, tcHeaders), 'Test Cases');
// Summary sheet
const byStatus = testCases.reduce((a, t) => { a[t.Status] = (a[t.Status] || 0) + 1; return a; }, {});
const byType = testCases.reduce((a, t) => { a[t['Test Type']] = (a[t['Test Type']] || 0) + 1; return a; }, {});
const summaryRows = [
  { Metric: 'Total Test Cases', Value: testCases.length },
  ...Object.entries(byStatus).map(([k, v]) => ({ Metric: `Status: ${k}`, Value: v })),
  ...Object.entries(byType).map(([k, v]) => ({ Metric: `Type: ${k}`, Value: v })),
];
XLSX.utils.book_append_sheet(tcWb, sheetFrom(summaryRows, ['Metric', 'Value']), 'Summary');
XLSX.writeFile(tcWb, path.join(__dirname, '04-test-cases.xlsx'));

// ---- 06-bug-report.xlsx ----
const bugHeaders = [
  'Bug ID', 'Bug Title', 'Module', 'Environment', 'Preconditions', 'Steps to Reproduce',
  'Expected Result', 'Actual Result', 'Severity', 'Priority', 'Screenshot or Log',
  'Suspected Root Cause', 'Recommended Fix', 'Related File or Function', 'Related Test Case ID', 'Status',
];
const bugWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(bugWb, sheetFrom(bugs, bugHeaders), 'Bugs');
const bugBySev = bugs.reduce((a, b) => { a[b.Severity] = (a[b.Severity] || 0) + 1; return a; }, {});
const bugSummary = [
  { Metric: 'Total Bugs', Value: bugs.length },
  ...Object.entries(bugBySev).map(([k, v]) => ({ Metric: `Severity: ${k}`, Value: v })),
];
XLSX.utils.book_append_sheet(bugWb, sheetFrom(bugSummary, ['Metric', 'Value']), 'Summary');
XLSX.writeFile(bugWb, path.join(__dirname, '06-bug-report.xlsx'));

console.log(`Wrote 04-test-cases.xlsx (${testCases.length} cases) and 06-bug-report.xlsx (${bugs.length} bugs)`);
