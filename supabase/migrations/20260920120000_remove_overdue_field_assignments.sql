-- The old overdue input fields (overdue_total_input, overdue_collected) were
-- removed from the daily entry form in favour of the detailed debt-aging
-- section. Drop their now-orphaned per-field assignments. The columns
-- themselves are kept so historical data and the dashboard/report metrics that
-- read overdue_collected continue to work.
delete from public.data_entry_field_assignments
where field_key in ('overdue_total_input','overdue_collected');
