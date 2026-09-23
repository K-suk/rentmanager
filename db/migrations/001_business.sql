-- Foundation-owned. Applied transactionally once; never edit after integration.
ALTER TABLE employee ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE employee ADD CONSTRAINT employee_normalized_email CHECK (email=lower(btrim(email)) AND length(email)<=254);

CREATE TABLE equipment (
 id uuid PRIMARY KEY,
 asset_number text NOT NULL UNIQUE CHECK(asset_number ~ '^[A-Z0-9-]{1,32}$'),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 100),
 category text NOT NULL CHECK(category IN ('パソコン','モニター','カメラ','周辺機器','その他')),
 description text NOT NULL DEFAULT '' CHECK(length(description)<=1000),
 deleted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE loan (
 id uuid PRIMARY KEY,
 equipment_id uuid NOT NULL REFERENCES equipment(id) ON DELETE RESTRICT,
 borrower_id text NOT NULL REFERENCES employee(auth_user_id) ON DELETE RESTRICT,
 borrowed_at timestamptz NOT NULL DEFAULT now(),
 due_date date NOT NULL CHECK(due_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
 returned_at timestamptz,
 returned_by_name_snapshot text,
 initial_due_date date NOT NULL,
 returned_by text REFERENCES employee(auth_user_id) ON DELETE RESTRICT,
 asset_number_snapshot text NOT NULL,
 equipment_name_snapshot text NOT NULL,
 borrower_name_snapshot text NOT NULL,
 CHECK ((returned_at IS NULL) = (returned_by IS NULL)),
 CHECK ((returned_at IS NULL) = (returned_by_name_snapshot IS NULL)),
 CHECK (returned_at IS NULL OR returned_at >= borrowed_at)
);
CREATE UNIQUE INDEX loan_one_open_per_equipment ON loan(equipment_id) WHERE returned_at IS NULL;
CREATE INDEX loan_borrower_open ON loan(borrower_id, borrowed_at DESC) WHERE returned_at IS NULL;
CREATE INDEX loan_history ON loan(borrowed_at DESC,id);
CREATE TABLE loan_extension (
 id uuid PRIMARY KEY,
 loan_id uuid NOT NULL REFERENCES loan(id) ON DELETE RESTRICT,
 old_due_date date NOT NULL,
 new_due_date date NOT NULL CHECK(new_due_date <= DATE '9999-12-31'),
 actor_id text NOT NULL REFERENCES employee(auth_user_id) ON DELETE RESTRICT,
 actor_name_snapshot text NOT NULL,
 changed_at timestamptz NOT NULL DEFAULT now(),
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 16 AND 128),
 CHECK(new_due_date > old_due_date),
 UNIQUE(loan_id,old_due_date),
 UNIQUE(loan_id,new_due_date),
 UNIQUE(actor_id,idempotency_key)
);
CREATE INDEX loan_extension_history ON loan_extension(loan_id,changed_at,id);
CREATE TABLE app_operation (
 actor_id text NOT NULL REFERENCES employee(auth_user_id) ON DELETE RESTRICT,
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 16 AND 128),
 kind text NOT NULL CHECK(kind IN ('borrow','return','extend')),
 request jsonb NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_id,idempotency_key)
);
-- #9 uses the exclusive advisory lock 741000, preserves protected identity,
-- and records resumable phases here. This table exposes no public reset endpoint.
CREATE TABLE app_reset_run (
 id uuid PRIMARY KEY,
 environment text NOT NULL,
 phase text NOT NULL CHECK(phase IN ('started','auth_cleanup','data_loaded','complete','failed')),
 started_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 failure_trace_id uuid
);
CREATE TABLE app_fixture_identity (
 fixture_key text PRIMARY KEY,
 auth_user_id text NOT NULL UNIQUE REFERENCES employee(auth_user_id) ON DELETE RESTRICT
);

CREATE FUNCTION guard_employee_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(741001);
 IF TG_OP='INSERT' THEN
  IF (SELECT count(*) FROM employee)>=20 THEN RAISE EXCEPTION 'EMPLOYEE_LIMIT'; END IF;
 ELSE
  IF NEW.auth_user_id<>OLD.auth_user_id OR NEW.email<>OLD.email OR NEW.protected<>OLD.protected THEN RAISE EXCEPTION 'immutable employee identity'; END IF;
  IF NOT OLD.active AND NEW.active THEN RAISE EXCEPTION 'REACTIVATION_DISABLED'; END IF;
  IF OLD.active AND OLD.role='admin' AND (NOT NEW.active OR NEW.role<>'admin') AND (SELECT count(*) FROM employee WHERE active AND role='admin')<=1 THEN RAISE EXCEPTION 'LAST_ADMIN'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_employee_rules BEFORE INSERT OR UPDATE ON employee FOR EACH ROW EXECUTE FUNCTION guard_employee_rules();

CREATE FUNCTION guard_equipment_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'use soft deletion'; END IF;
 IF TG_OP='INSERT' THEN
  PERFORM pg_advisory_xact_lock(741003);
  IF NEW.deleted_at IS NULL AND (SELECT count(*) FROM equipment WHERE deleted_at IS NULL)>=100 THEN RAISE EXCEPTION 'EQUIPMENT_LIMIT'; END IF;
 ELSE
  IF NEW.id<>OLD.id OR NEW.asset_number<>OLD.asset_number THEN RAISE EXCEPTION 'immutable asset number'; END IF;
  IF OLD.deleted_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'deleted equipment'; END IF;
  IF NEW.deleted_at IS NOT NULL AND EXISTS(SELECT 1 FROM loan WHERE equipment_id=OLD.id AND returned_at IS NULL) THEN RAISE EXCEPTION 'open loan'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_equipment_rules BEFORE INSERT OR UPDATE OR DELETE ON equipment FOR EACH ROW EXECUTE FUNCTION guard_equipment_rules();

CREATE FUNCTION guard_loan_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item equipment; person employee;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'retain history'; END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO item FROM equipment WHERE id=NEW.equipment_id FOR UPDATE;
  IF NOT FOUND OR item.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'unavailable equipment'; END IF;
  SELECT * INTO person FROM employee WHERE auth_user_id=NEW.borrower_id;
  IF NOT FOUND OR NOT person.active THEN RAISE EXCEPTION 'unknown or inactive borrower'; END IF;
  NEW.initial_due_date:=NEW.due_date;
  IF NEW.returned_at IS NOT NULL THEN SELECT name INTO NEW.returned_by_name_snapshot FROM employee WHERE auth_user_id=NEW.returned_by; END IF;
  NEW.asset_number_snapshot:=item.asset_number;
  NEW.equipment_name_snapshot:=item.name;
  NEW.borrower_name_snapshot:=person.name;
 ELSE
  IF (NEW.id,NEW.equipment_id,NEW.borrower_id,NEW.borrowed_at,NEW.initial_due_date,NEW.asset_number_snapshot,NEW.equipment_name_snapshot,NEW.borrower_name_snapshot) IS DISTINCT FROM (OLD.id,OLD.equipment_id,OLD.borrower_id,OLD.borrowed_at,OLD.initial_due_date,OLD.asset_number_snapshot,OLD.equipment_name_snapshot,OLD.borrower_name_snapshot) THEN RAISE EXCEPTION 'immutable loan snapshot'; END IF;
  IF NEW.due_date<OLD.due_date THEN RAISE EXCEPTION 'due date must increase'; END IF;
  IF OLD.returned_at IS NULL AND NEW.returned_at IS NOT NULL THEN SELECT name INTO NEW.returned_by_name_snapshot FROM employee WHERE auth_user_id=NEW.returned_by; END IF;
  IF OLD.returned_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'returned loan immutable'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_loan_rules BEFORE INSERT OR UPDATE OR DELETE ON loan FOR EACH ROW EXECUTE FUNCTION guard_loan_rules();
CREATE FUNCTION retain_extension() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'retain extension history'; END $$;
CREATE TRIGGER retain_extension BEFORE UPDATE OR DELETE ON loan_extension FOR EACH ROW EXECUTE FUNCTION retain_extension();
-- At commit, every due-date change must have exactly its matching history entry;
-- every inserted history entry must match the current loan and its prior history.
CREATE FUNCTION check_loan_extension() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM loan_extension WHERE loan_id=NEW.id AND old_due_date=OLD.due_date AND new_due_date=NEW.due_date) THEN RAISE EXCEPTION 'extension history required'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER check_loan_extension AFTER UPDATE ON loan DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (OLD.due_date IS DISTINCT FROM NEW.due_date) EXECUTE FUNCTION check_loan_extension();
CREATE FUNCTION check_extension_target() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target loan;
BEGIN
 SELECT * INTO target FROM loan WHERE id=NEW.loan_id;
 IF NOT EXISTS(SELECT 1 FROM loan_extension WHERE loan_id=target.id AND new_due_date=target.due_date)
 OR EXISTS(SELECT 1 FROM loan_extension e WHERE e.loan_id=target.id AND (e.new_due_date>target.due_date OR (e.old_due_date<>target.initial_due_date AND NOT EXISTS(SELECT 1 FROM loan_extension p WHERE p.loan_id=e.loan_id AND p.new_due_date=e.old_due_date))))
 THEN RAISE EXCEPTION 'extension chain mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER check_extension_target AFTER INSERT ON loan_extension DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_extension_target();
