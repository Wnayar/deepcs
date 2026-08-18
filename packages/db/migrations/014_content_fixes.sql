-- Corrections found by checking the lessons rather than reading them.
--
-- Two blocks are Cassandra, and were fenced as `sql`. Both are valid CQL and
-- neither is valid SQL, so a reader who tried them in Postgres would get a
-- syntax error from material that is correct. The prose around each already
-- says Cassandra; only the label was wrong.
--
-- Found by extracting every ```sql block and running it against a real Postgres
-- in a rolled-back transaction, which is the only way a fenced block gets
-- checked at all: nothing compiles the inside of a code fence.

UPDATE questions.bank SET lesson_md = replace(lesson_md,
  $body$```sql
CREATE TABLE sensor_data ($body$,
  $body$```cql
CREATE TABLE sensor_data ($body$)
WHERE title = 'NoSQL, CAP Theorem & When to Use What';

UPDATE questions.bank SET lesson_md = replace(lesson_md,
  $body$```sql
CREATE TABLE messages ($body$,
  $body$```cql
CREATE TABLE messages ($body$)
WHERE title = 'More Systems + LLD + Trade-offs';
