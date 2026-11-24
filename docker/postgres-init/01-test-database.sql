-- Runs once, when the muzikhub-db volume is first created.
-- Separate database for automated tests (wiped freely by Vitest and Playwright).
CREATE DATABASE muzikhub_test;
