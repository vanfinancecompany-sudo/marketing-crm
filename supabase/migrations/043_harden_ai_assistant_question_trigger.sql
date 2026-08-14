-- Harden the server-side assistant question capture trigger function.
-- It is invoked only by the database trigger and must not be callable through PostgREST RPC.

revoke all on function public.capture_ai_assistant_event_question() from public;
revoke all on function public.capture_ai_assistant_event_question() from anon;
revoke all on function public.capture_ai_assistant_event_question() from authenticated;
grant execute on function public.capture_ai_assistant_event_question() to service_role;
