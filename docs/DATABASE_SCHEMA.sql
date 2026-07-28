-- FCEI production database outline
CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT UNIQUE, password_hash TEXT, role TEXT, created_at TIMESTAMP);
CREATE TABLE courses (id TEXT PRIMARY KEY, code TEXT, title TEXT, description TEXT, level TEXT, audience TEXT);
CREATE TABLE modules (id TEXT PRIMARY KEY, course_id TEXT REFERENCES courses(id), module_order INT, title TEXT, scope TEXT, aim TEXT);
CREATE TABLE products (id TEXT PRIMARY KEY, type TEXT, title TEXT, price INT, currency TEXT, access TEXT);
CREATE TABLE orders (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), product_id TEXT, status TEXT, amount INT, currency TEXT);
CREATE TABLE payments (id TEXT PRIMARY KEY, order_id TEXT REFERENCES orders(id), status TEXT, provider TEXT, provider_ref TEXT);
CREATE TABLE entitlements (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), product_id TEXT, status TEXT, course_ids JSONB, toolkit_ids JSONB);
CREATE TABLE enrolments (id TEXT PRIMARY KEY, user_id TEXT, course_id TEXT, status TEXT);
CREATE TABLE progress (id TEXT PRIMARY KEY, user_id TEXT, course_id TEXT, module_id TEXT, status TEXT, percent INT, content_opened BOOL, resources_accessed BOOL, quiz_passed BOOL, action_task_submitted BOOL, evidence_submitted BOOL, reflection_submitted BOOL, transferability_submitted BOOL, checklist_completed BOOL);
CREATE TABLE evidence_submissions (id TEXT PRIMARY KEY, user_id TEXT, module_id TEXT, title TEXT, text_response TEXT, file_urls JSONB, status TEXT);
CREATE TABLE transferability_filter_responses (id TEXT PRIMARY KEY, user_id TEXT, module_id TEXT, responses JSONB, complete BOOL);
CREATE TABLE certificates (id TEXT PRIMARY KEY, user_id TEXT, course_id TEXT, verification_code TEXT UNIQUE, status TEXT, issued_at TIMESTAMP);
CREATE TABLE scorm_runtime (id TEXT PRIMARY KEY, user_id TEXT, module_id TEXT, lesson_status TEXT, score INT, suspend_data TEXT, updated_at TIMESTAMP);
CREATE TABLE audit_logs (id TEXT PRIMARY KEY, action TEXT, actor_id TEXT, meta JSONB, at TIMESTAMP);
