from pathlib import Path

RENAMES = {
    "supabase/migrations/20260806231500_course_name_aliases.sql": "supabase/migrations/20260806232722_course_name_aliases.sql",
    "supabase/migrations/20260806231600_course_alias_search.sql": "supabase/migrations/20260806232737_course_alias_search.sql",
    "supabase/migrations/20260806231650_course_alias_actor_safety.sql": "supabase/migrations/20260806232847_course_alias_actor_safety.sql",
    "supabase/migrations/20260806231700_import_alias_learning.sql": "supabase/migrations/20260806232911_import_alias_learning_v2.sql",
    "supabase/migrations/20260806231675_course_alias_audit_targets.sql": "supabase/migrations/20260806233258_course_alias_audit_targets.sql",
    "supabase/migrations/20260806231800_course_alias_indexes.sql": "supabase/migrations/20260806233705_course_alias_indexes.sql",
}

for source, destination in RENAMES.items():
    source_path = Path(source)
    destination_path = Path(destination)
    if not source_path.exists():
        raise FileNotFoundError(source)
    if destination_path.exists():
        raise FileExistsError(destination)
    source_path.rename(destination_path)

Path("scripts/align_course_alias_migrations.py").unlink()
Path(".github/workflows/align-course-alias-migrations.yml").unlink()
