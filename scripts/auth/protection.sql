CREATE TABLE IF NOT EXISTS employee (
 auth_user_id text PRIMARY KEY REFERENCES "user"(id),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
 email text NOT NULL UNIQUE CHECK(email ~ '^[^@]+@example[.]com$'),
 role text NOT NULL CHECK(role IN ('admin','employee')),
 active boolean NOT NULL DEFAULT true,
 protected boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(NOT protected OR (active AND role='admin'))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_protected_admin ON employee(protected) WHERE protected;
CREATE TABLE IF NOT EXISTS app_rate_limit (key text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS app_rate_limit_expiry ON app_rate_limit(expires_at);
CREATE OR REPLACE FUNCTION protect_initial_admin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
   IF EXISTS(SELECT 1 FROM employee WHERE auth_user_id=NEW."userId" AND protected) THEN RAISE EXCEPTION 'protected identity'; END IF;
   RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='employee' THEN
   IF OLD.protected AND (TG_OP='DELETE' OR NEW IS DISTINCT FROM OLD) THEN RAISE EXCEPTION 'protected identity'; END IF;
 ELSIF TG_TABLE_NAME='user' THEN
   IF EXISTS(SELECT 1 FROM employee WHERE auth_user_id=OLD.id AND protected) THEN RAISE EXCEPTION 'protected identity'; END IF;
 ELSIF TG_TABLE_NAME='account' THEN
   IF EXISTS(SELECT 1 FROM employee WHERE auth_user_id=OLD."userId" AND protected) THEN RAISE EXCEPTION 'protected identity'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_initial_admin ON employee;
CREATE TRIGGER protect_initial_admin BEFORE UPDATE OR DELETE ON employee FOR EACH ROW EXECUTE FUNCTION protect_initial_admin();
DROP TRIGGER IF EXISTS protect_initial_admin ON "user";
CREATE TRIGGER protect_initial_admin BEFORE UPDATE OR DELETE ON "user" FOR EACH ROW EXECUTE FUNCTION protect_initial_admin();
DROP TRIGGER IF EXISTS protect_initial_admin ON account;
CREATE TRIGGER protect_initial_admin BEFORE INSERT OR UPDATE OR DELETE ON account FOR EACH ROW EXECUTE FUNCTION protect_initial_admin();
