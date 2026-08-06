begin;
select plan(13);

insert into public.course_names (id, name, normalized_name, source)
values
  ('97000000-0000-4000-8000-000000000001', 'Alias Canonical Regression', 'alias canonical regression', 'admin'),
  ('97000000-0000-4000-8000-000000000002', 'Alias Duplicate Regression', 'alias duplicate regression', 'admin');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select lives_ok(
  $$select public.admin_add_course_name_alias('97000000-0000-4000-8000-000000000001', 'Alternate Canonical Name', 'database alias test')$$,
  'an administrator can add a possible course name'
);
select is(
  (select course_name_id::text from public.course_name_aliases where normalized_alias = 'alternate canonical name'),
  '97000000-0000-4000-8000-000000000001',
  'the alias points to the canonical course'
);
select is(
  (select source from public.course_name_aliases where normalized_alias = 'alternate canonical name'),
  'admin',
  'manual aliases record their source'
);
select is(
  (select course_name from public.search_course_names('Alternate Canonical Name', 5) limit 1),
  'Alias Canonical Regression',
  'authenticated catalogue search resolves an alias to the canonical name'
);
select is(
  (select course_name from public.guest_search_course_names('Alternate Canonical Name', 5) limit 1),
  'Alias Canonical Regression',
  'guest catalogue search resolves an alias to the canonical name'
);
select throws_ok(
  $$select public.admin_add_course_name_alias('97000000-0000-4000-8000-000000000001', 'Alternate Canonical Name', 'duplicate alias test')$$,
  '23505', 'course_alias_already_exists',
  'the same normalized alias cannot be added twice'
);
select throws_ok(
  $$select public.admin_add_course_name_alias('97000000-0000-4000-8000-000000000001', 'Alias Duplicate Regression', 'canonical collision test')$$,
  '23505', 'alias_conflicts_with_course_name',
  'an alias cannot take another active canonical course name'
);
select lives_ok(
  $$select public.admin_rename_course_name('97000000-0000-4000-8000-000000000001', 'Alias Canonical Renamed', 'rename alias test')$$,
  'renaming a course succeeds'
);
select is(
  (select course_name_id::text from public.course_name_aliases where normalized_alias = 'alias canonical regression'),
  '97000000-0000-4000-8000-000000000001',
  'renaming preserves the previous canonical name as an alias'
);
select lives_ok(
  $$select public.admin_add_course_name_alias('97000000-0000-4000-8000-000000000002', 'Duplicate Legacy Label', 'merge alias test')$$,
  'a duplicate course can have its own alias before merging'
);
select lives_ok(
  $$select public.admin_merge_course_names('97000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000002', 'merge alias regression test')$$,
  'merging courses succeeds with aliases present'
);
select is(
  (select count(*)::integer from public.course_name_aliases where course_name_id = '97000000-0000-4000-8000-000000000001' and normalized_alias in ('alias duplicate regression', 'duplicate legacy label')),
  2,
  'merge moves existing aliases and preserves the duplicate canonical name'
);
select ok(
  exists (
    select 1
    from public.admin_list_course_names() row
    cross join lateral jsonb_array_elements(row.aliases) alias_record
    where row.course_name_id = '97000000-0000-4000-8000-000000000001'
      and alias_record ->> 'alias' = 'Alternate Canonical Name'
  ),
  'the admin catalogue response exposes possible names'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select throws_ok(
  $$insert into public.course_name_aliases (course_name_id, alias, normalized_alias)
    values ('97000000-0000-4000-8000-000000000001', 'Unauthorized Alias', 'unauthorized alias')$$,
  '42501', null,
  'normal users cannot write aliases directly'
);

select * from finish();
rollback;
