-- Serialize every release-visible project child mutation with the matching
-- project release.  The barrier is project-scoped: unrelated projects remain
-- writable while one project is being released.
CREATE OR REPLACE FUNCTION acquire_project_release_state_lock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_project_id text;
  new_project_id text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    old_project_id := OLD."projectId";
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_project_id := NEW."projectId";
  END IF;

  -- A direct UPDATE may move a row between projects. Lock both projects in a
  -- deterministic order so neither release can observe a half-moved row.
  IF old_project_id IS NOT NULL
     AND new_project_id IS NOT NULL
     AND old_project_id IS DISTINCT FROM new_project_id THEN
    IF old_project_id < new_project_id THEN
      PERFORM pg_advisory_xact_lock(hashtext('release-state:' || old_project_id));
      PERFORM pg_advisory_xact_lock(hashtext('release-state:' || new_project_id));
    ELSE
      PERFORM pg_advisory_xact_lock(hashtext('release-state:' || new_project_id));
      PERFORM pg_advisory_xact_lock(hashtext('release-state:' || old_project_id));
    END IF;
  ELSE
    PERFORM pg_advisory_xact_lock(hashtext(
      'release-state:' || COALESCE(new_project_id, old_project_id)
    ));
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'project_members',
    'project_phases',
    'project_tasks',
    'project_deliverable_reviews',
    'project_issues',
    'project_test_plans',
    'project_test_cases',
    'project_test_reports',
    'project_npi_readiness_checks',
    'project_sample_signoffs',
    'project_gate_blockers',
    'project_gate_reviews',
    'project_gate_signoff_rounds',
    'project_gate_signoff_additions',
    'project_gate_signoffs',
    'project_tailoring',
    'project_deliverable_overrides',
    'project_change_scope_declarations',
    'project_module_baselines',
    'project_changelog'
  ]
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS project_release_state_barrier ON %I',
      table_name
    );
    EXECUTE format(
      'CREATE TRIGGER project_release_state_barrier '
      'BEFORE INSERT OR UPDATE OR DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION acquire_project_release_state_lock()',
      table_name
    );
  END LOOP;
END;
$$;
