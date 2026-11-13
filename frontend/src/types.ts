export type Role = 'student' | 'instructor' | 'admin';
export type Difficulty = 'beginner' | 'intermediate' | 'advanced';
export type Mode = Difficulty;

export interface User {
  id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
  bio?: string | null;
  roles: Role[];
  role: Role;
  created_at?: string;
}

export interface CourseCard {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  difficulty: Difficulty;
  thumbnail_url: string | null;
  price: number;
  status: 'pending' | 'approved' | 'rejected' | 'archived' | 'draft';
  created_at: string;
  instructor: { id: string; full_name: string; avatar_url: string | null; bio?: string; course_count?: number } | null;
  rating: number;
  review_count: number;
  enrollment_count: number;
  lecture_count: number;
  module_count: number;
  total_seconds: number;
}

export interface LectureSummary {
  id: string;
  title: string;
  duration_seconds: number | null;
  order_index: number;
  has_video: boolean;
  resource_count: number;
  has_transcript: boolean;
  ingest_status: string;
  completed?: boolean;
}

export interface ModuleSummary {
  id: string;
  title: string;
  order_index: number;
  lectures: LectureSummary[];
}

export interface CourseDetail extends CourseCard {
  learning_outcomes: string[];
  modules: ModuleSummary[];
  enrollment: { id: string; progress_percent: number; enrolled_at: string; completed_at: string | null; last_lecture_id: string | null } | null;
  is_manager: boolean;
  latest_review: { decision: string; comment: string | null; reviewed_at: string } | null;
  rating_breakdown: { rating: number; count: number }[];
}

export interface Enrollment {
  id: string;
  course_id: string;
  title: string;
  category: string;
  difficulty: Difficulty;
  thumbnail_url: string | null;
  instructor_name: string;
  progress_percent: number;
  completed_at: string | null;
  enrolled_at: string;
  lecture_count: number;
  completed_count: number;
  last_lecture_id: string | null;
  last_lecture_title: string | null;
  next_lecture: { id: string; title: string } | null;
  certificate_id: string | null;
  last_activity_at: string | null;
}

export interface Source {
  index: number;
  lecture_id: string;
  lecture_title: string;
  module_title: string;
  timestamp_seconds: number | null;
  source_type: string;
  source_name: string | null;
  snippet: string;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  content: string;
  sources?: Source[] | null;
  is_demo?: boolean;
  created_at: string;
  pending?: boolean;
}

export interface QuizOption { id: string; option_text: string; is_correct?: boolean }
export interface QuizQuestion {
  id: string;
  question_text: string;
  question_type: 'mcq' | 'multi_select' | 'short_answer';
  explanation?: string | null;
  order_index: number;
  options: QuizOption[];
}

export interface Paginated<T> { data: T[]; page: number; limit: number; total: number; total_pages: number }
