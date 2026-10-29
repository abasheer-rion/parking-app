-- Public sign-up: anyone can make their own page, so each page carries its own property and unit.
-- Pages made before this keep NULL and fall back to the PROPERTY and UNIT Worker settings.
ALTER TABLE friends ADD COLUMN property TEXT;
ALTER TABLE friends ADD COLUMN unit TEXT;
ALTER TABLE friends ADD COLUMN created_ts REAL;
