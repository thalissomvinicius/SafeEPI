begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Buckets privados exigem caminhos persistentes, nunca URLs publicas que
-- deixam de funcionar quando a politica do bucket e endurecida.
update public.deliveries
set signature_url = split_part(signature_url, '/storage/v1/object/public/ppe_signatures/', 2)
where signature_url like '%/storage/v1/object/public/ppe_signatures/%';

update public.signed_documents
set document_url = split_part(document_url, '/storage/v1/object/public/ppe_signatures/', 2)
where document_url like '%/storage/v1/object/public/ppe_signatures/%';

update public.signed_documents
set signature_url = split_part(signature_url, '/storage/v1/object/public/ppe_signatures/', 2)
where signature_url like '%/storage/v1/object/public/ppe_signatures/%';

notify pgrst, 'reload schema';

commit;
