-- Run in Supabase SQL editor after enabling pg_cron + pg_net extensions
-- Schedule: every Sunday at 23:00 UTC
select cron.schedule(
  'update-f1-scores',
  '0 23 * * 0',
  $$
  select net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/update-scores',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body    := '{}'::jsonb
  )
  $$
);
-- To view jobs: select * from cron.job;
-- To remove:   select cron.unschedule('update-f1-scores');
