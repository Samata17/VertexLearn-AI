-- =============================================================================
-- VertexLearn AI — initial schema
-- Follows PRD Section 7.2. Additions beyond the PRD are marked "ADDED:" with
-- the reason, so it is easy to see what was extended and why.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS vector;    -- pgvector for RAG embeddings

-- USERS & AUTH ----------------------------------------------------------------
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(180) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    avatar_url TEXT,
    bio TEXT,                                   -- ADDED: profile page
    is_active BOOLEAN DEFAULT TRUE,             -- FALSE = suspended
    deleted_at TIMESTAMPTZ,                     -- ADDED: soft delete keeps payments/audit history intact
    last_login_at TIMESTAMPTZ,                  -- ADDED: admin user list
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(30) UNIQUE NOT NULL -- student, instructor, admin
);

CREATE TABLE user_roles (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role_id INT REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);

-- ADDED: lets /auth/logout invalidate a refresh token (PRD 8.1). Only a hash is stored.
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(128) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ADDED: forgot/reset password flow. Only a hash of the emailed token is stored.
CREATE TABLE password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(128) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- COURSES ---------------------------------------------------------------------
CREATE TABLE courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instructor_id UUID REFERENCES users(id),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    category VARCHAR(80),
    difficulty VARCHAR(20), -- beginner/intermediate/advanced
    thumbnail_url TEXT,
    price NUMERIC(10,2) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'pending', -- pending/approved/rejected/archived
    learning_outcomes TEXT[] DEFAULT '{}',      -- ADDED: course detail page
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),       -- ADDED
    CONSTRAINT courses_status_chk CHECK (status IN ('draft','pending','approved','rejected','archived')),
    CONSTRAINT courses_difficulty_chk CHECK (difficulty IN ('beginner','intermediate','advanced'))
);

CREATE TABLE modules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    order_index INT NOT NULL
);

CREATE TABLE lectures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_id UUID REFERENCES modules(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    video_url TEXT,
    transcript TEXT,
    duration_seconds INT,
    order_index INT NOT NULL,
    resource_urls TEXT[] DEFAULT '{}', -- PDFs, slides
    ingest_status VARCHAR(20) DEFAULT 'none' -- ADDED: none/queued/processing/ready/failed (RAG indexing)
);

-- ADDED: PRD FR-S3 requires rating filters, but 7.2 has no ratings table.
CREATE TABLE course_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (course_id, user_id)
);

-- ENROLLMENT & PROGRESS -------------------------------------------------------
CREATE TABLE enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    enrolled_at TIMESTAMPTZ DEFAULT now(),
    progress_percent NUMERIC(5,2) DEFAULT 0,
    completed_at TIMESTAMPTZ,                   -- ADDED: certificates + completion rate
    last_lecture_id UUID REFERENCES lectures(id) ON DELETE SET NULL, -- ADDED: "continue learning"
    UNIQUE (user_id, course_id)
);

CREATE TABLE lecture_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enrollment_id UUID REFERENCES enrollments(id) ON DELETE CASCADE,
    lecture_id UUID REFERENCES lectures(id) ON DELETE CASCADE,
    watched_seconds INT DEFAULT 0,              -- last playback position (resume point)
    max_watched_seconds INT DEFAULT 0,          -- ADDED: furthest point reached (drop-off analytics)
    time_spent_seconds INT DEFAULT 0,           -- ADDED: time-on-task (FR-I5)
    completed BOOLEAN DEFAULT FALSE,
    last_watched_at TIMESTAMPTZ,
    UNIQUE (enrollment_id, lecture_id)          -- ADDED: one row per lecture per enrollment
);

CREATE TABLE notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    lecture_id UUID REFERENCES lectures(id) ON DELETE CASCADE,
    timestamp_seconds INT,
    content TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE bookmarks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    lecture_id UUID REFERENCES lectures(id) ON DELETE CASCADE,
    timestamp_seconds INT,
    label VARCHAR(200),                         -- ADDED: optional bookmark label
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ADDED: one row per user per active day. Powers DAU (FR-AD3), streaks and the activity chart.
CREATE TABLE user_activity_days (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    day DATE NOT NULL,
    minutes INT DEFAULT 0,
    PRIMARY KEY (user_id, day)
);

-- ASSIGNMENTS -------------------------------------------------------------------
CREATE TABLE assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    title VARCHAR(200),
    instructions TEXT,
    rubric JSONB,           -- [{ "criterion": "...", "points": 10 }]
    due_date TIMESTAMPTZ,
    max_score NUMERIC(5,2) DEFAULT 100,         -- ADDED
    created_at TIMESTAMPTZ DEFAULT now()        -- ADDED
);

CREATE TABLE assignment_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id UUID REFERENCES assignments(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    file_url TEXT,
    file_name TEXT,                             -- ADDED: original filename for download
    comment TEXT,                               -- ADDED: student note to instructor
    submitted_at TIMESTAMPTZ DEFAULT now(),
    grade NUMERIC(5,2),
    feedback TEXT,
    graded_at TIMESTAMPTZ,                      -- ADDED
    graded_by UUID REFERENCES users(id),        -- ADDED
    UNIQUE (assignment_id, user_id)             -- ADDED: resubmission replaces the previous file
);

-- QUIZZES ----------------------------------------------------------------------
CREATE TABLE quizzes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_id UUID REFERENCES modules(id) ON DELETE CASCADE,
    title VARCHAR(200),
    is_ai_generated BOOLEAN DEFAULT FALSE,
    generated_from_lecture_id UUID REFERENCES lectures(id) ON DELETE SET NULL,
    status VARCHAR(20) DEFAULT 'published',     -- ADDED: draft (AI, awaiting review) / published
    time_limit_minutes INT,                     -- ADDED: optional
    created_at TIMESTAMPTZ DEFAULT now()        -- ADDED
);

CREATE TABLE quiz_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id UUID REFERENCES quizzes(id) ON DELETE CASCADE,
    question_text TEXT,
    question_type VARCHAR(20), -- mcq/multi_select/short_answer
    order_index INT,
    explanation TEXT,          -- ADDED: shown after submission
    CONSTRAINT quiz_questions_type_chk CHECK (question_type IN ('mcq','multi_select','short_answer'))
);

-- For short_answer questions, rows with is_correct = TRUE are the accepted answers.
CREATE TABLE quiz_options (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID REFERENCES quiz_questions(id) ON DELETE CASCADE,
    option_text TEXT,
    is_correct BOOLEAN DEFAULT FALSE
);

CREATE TABLE quiz_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id UUID REFERENCES quizzes(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    score NUMERIC(5,2),
    started_at TIMESTAMPTZ DEFAULT now(),
    submitted_at TIMESTAMPTZ
);

CREATE TABLE quiz_answers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id UUID REFERENCES quiz_attempts(id) ON DELETE CASCADE,
    question_id UUID REFERENCES quiz_questions(id) ON DELETE CASCADE,
    selected_option_ids UUID[],
    text_answer TEXT,
    is_correct BOOLEAN
);

-- GAMIFICATION -------------------------------------------------------------------
CREATE TABLE certificates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    certificate_url TEXT,
    certificate_code VARCHAR(20) UNIQUE,        -- ADDED: public verification code
    issued_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (user_id, course_id)
);

CREATE TABLE badges (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE,                    -- ADDED: stable key used by award logic
    name VARCHAR(80),
    description TEXT,
    icon_url TEXT                               -- stores an icon name, e.g. "flame"
);

CREATE TABLE user_badges (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    badge_id INT REFERENCES badges(id) ON DELETE CASCADE,
    earned_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (user_id, badge_id)
);

CREATE TABLE streaks (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    current_streak INT DEFAULT 0,
    longest_streak INT DEFAULT 0,
    last_active_date DATE
);

-- AI TUTOR -----------------------------------------------------------------------
CREATE TABLE ai_chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    mode VARCHAR(20) DEFAULT 'intermediate',
    title VARCHAR(200),                         -- ADDED: sidebar label (first question)
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT ai_mode_chk CHECK (mode IN ('beginner','intermediate','advanced'))
);

CREATE TABLE ai_chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES ai_chat_sessions(id) ON DELETE CASCADE,
    sender VARCHAR(10), -- user/ai
    content TEXT,
    source_lecture_ids UUID[],
    sources JSONB,                              -- ADDED: full citation objects (title, timestamp, snippet)
    is_demo BOOLEAN DEFAULT FALSE,              -- ADDED: TRUE when produced by demo mode (no API key)
    created_at TIMESTAMPTZ DEFAULT now()
);

-- VECTOR STORE (pgvector) ---------------------------------------------------------
-- DEVIATION: 384 dimensions (local BAAI/bge-small-en-v1.5 model) instead of 1536,
-- because Anthropic does not offer an embeddings API and a local model needs no key.
CREATE TABLE document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    lecture_id UUID REFERENCES lectures(id) ON DELETE CASCADE,
    chunk_index INT DEFAULT 0,                  -- ADDED
    source_type VARCHAR(20) DEFAULT 'transcript', -- ADDED: transcript/pdf/text
    source_name TEXT,                           -- ADDED: e.g. PDF filename, for citations
    timestamp_seconds INT,                      -- ADDED: approximate video position, for citations
    chunk_text TEXT,
    embedding VECTOR(384),
    created_at TIMESTAMPTZ DEFAULT now()
);
-- DEVIATION: HNSW instead of ivfflat. ivfflat must be built after data exists;
-- HNSW works well on an empty, growing table.
CREATE INDEX document_chunks_embedding_idx ON document_chunks USING hnsw (embedding vector_cosine_ops);

-- ADDED: per-topic mastery (FR-A8). A "topic" is a course module.
CREATE TABLE topic_mastery (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    module_id UUID REFERENCES modules(id) ON DELETE CASCADE,
    score NUMERIC(5,2) DEFAULT 0,               -- 0-100, moving average of quiz results
    questions_asked INT DEFAULT 0,              -- AI tutor questions retrieved from this module
    updated_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (user_id, module_id)
);

-- RECOMMENDATIONS & STUDY PLANS ---------------------------------------------------
CREATE TABLE study_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    plan_json JSONB,
    is_demo BOOLEAN DEFAULT FALSE,              -- ADDED
    generated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE flashcards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_id UUID REFERENCES modules(id) ON DELETE CASCADE,
    question TEXT,
    answer TEXT,
    is_demo BOOLEAN DEFAULT FALSE,              -- ADDED
    created_at TIMESTAMPTZ DEFAULT now()        -- ADDED
);

CREATE TABLE recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    recommended_course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    reason TEXT,
    score NUMERIC(5,2),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- DISCUSSIONS, ANNOUNCEMENTS, NOTIFICATIONS ---------------------------------------
CREATE TABLE discussion_threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    created_by UUID REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(200),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE discussion_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id UUID REFERENCES discussion_threads(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    parent_post_id UUID REFERENCES discussion_posts(id) ON DELETE CASCADE, -- ADDED: threaded replies
    content TEXT,
    is_flagged BOOLEAN DEFAULT FALSE,
    flag_reason TEXT,                           -- ADDED: why it was reported
    flagged_by UUID REFERENCES users(id) ON DELETE SET NULL, -- ADDED
    is_hidden BOOLEAN DEFAULT FALSE,            -- ADDED: moderator hid it
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    posted_by UUID REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(200),                         -- ADDED
    content TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(150),
    body TEXT,
    type VARCHAR(30) DEFAULT 'info',            -- ADDED: info/announcement/grade/badge/course/system
    link TEXT,                                  -- ADDED: where clicking it goes
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ADMIN / GOVERNANCE ----------------------------------------------------------------
CREATE TABLE course_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    decision VARCHAR(20), -- approved/rejected
    comment TEXT,
    reviewed_at TIMESTAMPTZ DEFAULT now()
);

-- Payments are recorded by a DEMO checkout (real payment gateway is out of scope, PRD 3.2).
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
    amount NUMERIC(10,2),
    status VARCHAR(20), -- success/failed/refunded
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100),
    entity VARCHAR(50),
    entity_id UUID,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- INDEXES (PRD 7.3) ---------------------------------------------------------------
CREATE INDEX idx_courses_instructor ON courses(instructor_id);
CREATE INDEX idx_courses_pending ON courses(created_at) WHERE status = 'pending';
CREATE INDEX idx_courses_status_category ON courses(status, category);
CREATE INDEX idx_modules_course ON modules(course_id);
CREATE INDEX idx_lectures_module ON lectures(module_id);
CREATE INDEX idx_enrollments_course ON enrollments(course_id);
CREATE INDEX idx_lecture_progress_lecture ON lecture_progress(lecture_id);
CREATE INDEX idx_notes_user_lecture ON notes(user_id, lecture_id);
CREATE INDEX idx_bookmarks_user_lecture ON bookmarks(user_id, lecture_id);
CREATE INDEX idx_assignments_course ON assignments(course_id);
CREATE INDEX idx_submissions_assignment ON assignment_submissions(assignment_id);
CREATE INDEX idx_submissions_user ON assignment_submissions(user_id);
CREATE INDEX idx_quizzes_module ON quizzes(module_id);
CREATE INDEX idx_quiz_questions_quiz ON quiz_questions(quiz_id);
CREATE INDEX idx_quiz_options_question ON quiz_options(question_id);
CREATE INDEX idx_quiz_attempts_user ON quiz_attempts(user_id);
CREATE INDEX idx_quiz_attempts_quiz ON quiz_attempts(quiz_id);
CREATE INDEX idx_quiz_answers_attempt ON quiz_answers(attempt_id);
CREATE INDEX idx_certificates_user ON certificates(user_id);
CREATE INDEX idx_chat_sessions_user ON ai_chat_sessions(user_id);
CREATE INDEX idx_chat_messages_session ON ai_chat_messages(session_id, created_at);
CREATE INDEX idx_chunks_course ON document_chunks(course_id);
CREATE INDEX idx_chunks_lecture ON document_chunks(lecture_id);
CREATE INDEX idx_study_plans_user ON study_plans(user_id);
CREATE INDEX idx_flashcards_module ON flashcards(module_id);
CREATE INDEX idx_recommendations_user ON recommendations(user_id);
CREATE INDEX idx_threads_course ON discussion_threads(course_id);
CREATE INDEX idx_posts_thread ON discussion_posts(thread_id);
CREATE INDEX idx_posts_flagged ON discussion_posts(created_at) WHERE is_flagged = TRUE;
CREATE INDEX idx_announcements_course ON announcements(course_id);
CREATE INDEX idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX idx_course_approvals_course ON course_approvals(course_id);
CREATE INDEX idx_payments_created ON payments(created_at);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX idx_reviews_course ON course_reviews(course_id);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);

-- Base data every environment needs.
INSERT INTO roles (name) VALUES ('student'), ('instructor'), ('admin');
INSERT INTO badges (code, name, description, icon_url) VALUES
  ('first_lecture',   'First Steps',      'Completed your first lecture',            'footprints'),
  ('first_course',    'Course Conqueror', 'Completed your first course',             'trophy'),
  ('streak_7',        'On Fire',          'Kept a 7-day learning streak',            'flame'),
  ('streak_30',       'Unstoppable',      'Kept a 30-day learning streak',           'zap'),
  ('perfect_quiz',    'Perfectionist',    'Scored 100% on a quiz',                   'target'),
  ('curious_mind',    'Curious Mind',     'Asked the AI tutor 10 questions',         'sparkles'),
  ('helpful_peer',    'Helpful Peer',     'Posted 5 replies in discussions',         'message-circle'),
  ('first_submission','Go-Getter',        'Submitted your first assignment',         'upload');
