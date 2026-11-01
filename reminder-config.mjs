// Whether calendar DM reminders are switched on for this deployment. Off unless DM_REMINDERS=on and everything the
// worker needs is configured, so the dashboard never offers reminders the server cannot send.
export const remindersConfigured = (env = process.env) => env.DM_REMINDERS === 'on' && Boolean(env.CRON_SECRET
  && env.SUPABASE_URL && env.SUPABASE_SECRET_KEY && env.META_APP_SECRET && env.BLOB_READ_WRITE_TOKEN && env.PUBLIC_URL);
