// Recipients, scopes, schedules and region maps for the operational reports
// that currently run via Claude-session triggers. Values mirror the existing
// triggers EXACTLY so the backend senders preserve each report's recipients
// and scope. Changing a recipient here is a deliberate, reviewed edit — the
// automation never adds destinations on its own.

// The five managers who receive company-wide / all-region reports.
const MANAGERS = [
  { email: 'salm77437@gmail.com', short: 'salm' },
  { email: 'ahmedattar88@gmail.com', short: 'ahmedattar' },
  { email: 'attar4334@gmail.com', short: 'attar4334' },
  { email: 'sayedattar300@gmail.com', short: 'sayedattar' },
  { email: 'ceo@hawafel.com', short: 'ceo' },
];

// Supervisors and the regions each one owns (only regions with activity are sent).
const SUPERVISORS = [
  { name: 'رامي عمر', email: 'ramyomar@hawafel.com', short: 'ramy', regions: ['الرياض', 'الرياض ٢ و٣'] },
  { name: 'يحي سعيد', email: 'yahiasaid8899@gmail.com', short: 'yehia', regions: ['جده واحد', 'جده اثنين', 'مكة والطائف'] },
  { name: 'وليد السيد', email: 'ws112021@gmail.com', short: 'walid', regions: ['جيزان وخميس مشيط', 'المدينه'] },
];

// Per-manager daily DEBT report (debt + collection only, no supervisor-visit data).
// Each entry mirrors one of the walid/ahmed/ramy triggers.
const MANAGER_DEBT = [
  { short: 'walid', to: 'ws112021@gmail.com', title: 'جيزان وخميس والمدينة', regions: ['جيزان وخميس مشيط', 'المدينه'] },
  { short: 'ahmed', to: 'ahmedattar88@gmail.com', title: 'جده واحد وجده اثنين', regions: ['جده واحد', 'جده اثنين'] },
  { short: 'ramy', to: 'ramyomar@hawafel.com', title: 'الرياض ١ و٢و٣', regions: ['الرياض', 'الرياض ٢ و٣'] },
];

// Non-field pseudo-regions/reps excluded from every operational report.
const EXCLUDED_REGIONS = ['المنطقة الغربية', 'مركز مبيعات'];
const EXCLUDED_REP_NAMES = ['مندوب المنطقة الغربية', 'مركز مبيعات'];

const CREDIT_CONTROL_TO = 'credit-control@hawafel.com';
const AYA_TO = 'attar2035@gmail.com';

module.exports = {
  MANAGERS, SUPERVISORS, MANAGER_DEBT,
  EXCLUDED_REGIONS, EXCLUDED_REP_NAMES,
  CREDIT_CONTROL_TO, AYA_TO,
};
