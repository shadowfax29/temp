-- OPTIONAL: database-level protection for the ticketing audit tables. Not part of migration 025.
-- Creating triggers needs the SUPER privilege (or `SET GLOBAL log_bin_trust_function_creators = 1` by a DBA) when binary logging is on.
-- Run once by a DBA on the database that holds the tkt_* tables. Without them the application still writes only through TicketService
-- and every event carries the hash of the previous one (the History tab shows if the chain is broken).

CREATE TRIGGER IF NOT EXISTS tkt_event_no_update BEFORE UPDATE ON tkt_event FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'tkt_event is insert-only';
CREATE TRIGGER IF NOT EXISTS tkt_event_no_delete BEFORE DELETE ON tkt_event FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'tkt_event is insert-only';
CREATE TRIGGER IF NOT EXISTS tkt_period_no_delete BEFORE DELETE ON tkt_period FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'tkt_period rows cannot be deleted';
CREATE TRIGGER IF NOT EXISTS tkt_period_close_once BEFORE UPDATE ON tkt_period FOR EACH ROW IF OLD.ended_at IS NOT NULL OR NEW.ticket_id <> OLD.ticket_id OR NEW.started_at <> OLD.started_at OR NOT (NEW.team_id <=> OLD.team_id) OR NOT (NEW.assignee_id <=> OLD.assignee_id) OR NEW.status <> OLD.status THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'tkt_period can only be closed once'; END IF;

-- Note: with these in place, `npx tsx src/scripts/ticketingCheck.ts` can no longer clean up its temporary rows (it deletes events and periods).
