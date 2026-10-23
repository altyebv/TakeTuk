-- Supabase Storage bucket for driver verification documents (private).
-- Guarded: plain PostgreSQL test databases have no "storage" schema and skip this migration's effect.
-- No storage.objects RLS policies are created for this bucket, so anon/authenticated users cannot
-- read or write it; access happens only through backend-issued signed URLs (SECURITY.md section 6).

do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage')
     and exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('driver-documents', 'driver-documents', false, 10485760,
            array['image/jpeg', 'image/png', 'application/pdf'])
    on conflict (id) do update
      set public = false,
          file_size_limit = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types;
  end if;
end
$$;
