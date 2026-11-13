/**
 * All routes. Pages are lazy-loaded so each workspace only downloads the code it needs.
 *   /                public site (landing, catalog, course detail, auth)
 *   /app/*           student workspace (course player, tutor & discussions are shared with instructors)
 *   /instructor/*    instructor workspace
 *   /admin/*         admin panel
 */
import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom';
import { PageLoader } from '@/components/common/ui';
import { RouteError } from '@/components/common/RouteError';
import { importWithReload } from '@/utils/chunkReload';
import { AppLayout } from '@/layouts/AppLayout';
import { PublicLayout } from '@/layouts/PublicLayout';
import { GuestRoute, ProtectedRoute } from './ProtectedRoute';

// Lazy page. If its file is gone because the app was redeployed, the page reloads to get the new version.
const L = (factory: () => Promise<any>, name: string) => lazy(() => importWithReload(factory).then((m) => ({ default: m[name] })));

const Landing = L(() => import('@/pages/Landing'), 'Landing');
const Login = L(() => import('@/pages/auth/AuthPages'), 'Login');
const Register = L(() => import('@/pages/auth/AuthPages'), 'Register');
const ForgotPassword = L(() => import('@/pages/auth/AuthPages'), 'ForgotPassword');
const ResetPassword = L(() => import('@/pages/auth/AuthPages'), 'ResetPassword');
const Catalog = L(() => import('@/pages/course-catalog/Catalog'), 'Catalog');
const CourseDetail = L(() => import('@/pages/course-catalog/CourseDetail'), 'CourseDetail');
const VerifyCertificate = L(() => import('@/pages/shared/SharedPages'), 'VerifyCertificate');
const NotFound = L(() => import('@/pages/shared/SharedPages'), 'NotFound');
const SettingsPage = L(() => import('@/pages/shared/SharedPages'), 'SettingsPage');
const NotificationsPage = L(() => import('@/pages/shared/SharedPages'), 'NotificationsPage');

const StudentDashboard = L(() => import('@/pages/dashboard/StudentDashboard'), 'StudentDashboard');
const MyLearning = L(() => import('@/pages/student/MyLearning'), 'MyLearning');
const CoursePlayer = L(() => import('@/pages/course-player/CoursePlayer'), 'CoursePlayer');
const TutorPage = L(() => import('@/pages/ai-tutor/TutorPage'), 'TutorPage');
const AssignmentList = L(() => import('@/pages/student/Assignments'), 'AssignmentList');
const AssignmentDetail = L(() => import('@/pages/student/Assignments'), 'AssignmentDetail');
const QuizList = L(() => import('@/pages/quizzes/Quizzes'), 'QuizList');
const QuizTake = L(() => import('@/pages/quizzes/Quizzes'), 'QuizTake');
const QuizResult = L(() => import('@/pages/quizzes/Quizzes'), 'QuizResult');
const Flashcards = L(() => import('@/pages/student/StudyTools'), 'Flashcards');
const StudyPlan = L(() => import('@/pages/student/StudyTools'), 'StudyPlan');
const Notes = L(() => import('@/pages/student/StudyTools'), 'Notes');
const Achievements = L(() => import('@/pages/student/Achievements'), 'Achievements');
const Leaderboard = L(() => import('@/pages/student/Achievements'), 'Leaderboard');
const DiscussionHome = L(() => import('@/pages/discussions/Discussions'), 'DiscussionHome');
const CourseThreads = L(() => import('@/pages/discussions/Discussions'), 'CourseThreads');
const ThreadView = L(() => import('@/pages/discussions/Discussions'), 'ThreadView');

const InstructorDashboard = L(() => import('@/pages/instructor/InstructorDashboard'), 'InstructorDashboard');
const InstructorCourses = L(() => import('@/pages/instructor/InstructorCourses'), 'InstructorCourses');
const CourseCreate = L(() => import('@/pages/instructor/InstructorCourses'), 'CourseCreate');
const CourseEditor = L(() => import('@/pages/instructor/CourseEditor'), 'CourseEditor');
const QuizEditor = L(() => import('@/pages/instructor/QuizEditor'), 'QuizEditor');
const Grading = L(() => import('@/pages/instructor/Grading'), 'Grading');
const InstructorAnalytics = L(() => import('@/pages/instructor/InstructorDashboard'), 'InstructorAnalytics');

const AdminOverview = L(() => import('@/pages/admin-panel/AdminOverview'), 'AdminOverview');
const AdminRevenue = L(() => import('@/pages/admin-panel/AdminOverview'), 'AdminRevenue');
const AdminUsers = L(() => import('@/pages/admin-panel/AdminUsers'), 'AdminUsers');
const AdminCourses = L(() => import('@/pages/admin-panel/AdminCourses'), 'AdminCourses');
const AdminModeration = L(() => import('@/pages/admin-panel/AdminCourses'), 'AdminModeration');
const AdminBroadcast = L(() => import('@/pages/admin-panel/AdminUsers'), 'AdminBroadcast');
const AdminAudit = L(() => import('@/pages/admin-panel/AdminUsers'), 'AdminAudit');

const S = (el: ReactNode) => <Suspense fallback={<PageLoader />}>{el}</Suspense>;
const guard = (roles: ('student' | 'instructor' | 'admin')[] | undefined) => <ProtectedRoute roles={roles}><AppLayout /></ProtectedRoute>;

const routes: RouteObject[] = [
  {
    element: <PublicLayout />,
    children: [
      { path: '/', element: S(<Landing />) },
      { path: '/courses', element: S(<Catalog />) },
      { path: '/courses/:id', element: S(<CourseDetail />) },
      { path: '/verify/:code', element: S(<VerifyCertificate />) },
    ],
  },
  { path: '/login', element: <GuestRoute>{S(<Login />)}</GuestRoute> },
  { path: '/register', element: <GuestRoute>{S(<Register />)}</GuestRoute> },
  { path: '/forgot-password', element: S(<ForgotPassword />) },
  { path: '/reset-password', element: S(<ResetPassword />) },

  // Student workspace
  {
    path: '/app',
    element: guard(['student']),
    children: [
      { index: true, element: S(<StudentDashboard />) },
      { path: 'learning', element: S(<MyLearning />) },
      { path: 'assignments', element: S(<AssignmentList />) },
      { path: 'quizzes', element: S(<QuizList />) },
      { path: 'quizzes/results/:attemptId', element: S(<QuizResult />) },
      { path: 'flashcards', element: S(<Flashcards />) },
      { path: 'study-plan', element: S(<StudyPlan />) },
      { path: 'notes', element: S(<Notes />) },
      { path: 'achievements', element: S(<Achievements />) },
      { path: 'leaderboard', element: S(<Leaderboard />) },
    ],
  },
  // Shared by students and course managers (the API enforces enrollment/ownership)
  {
    path: '/app',
    element: guard(undefined),
    children: [
      { path: 'learn/:courseId/:lectureId?', element: S(<CoursePlayer />) },
      { path: 'tutor/:sessionId?', element: S(<TutorPage />) },
      { path: 'assignments/:id', element: S(<AssignmentDetail />) },
      { path: 'quizzes/:id', element: S(<QuizTake />) },
      { path: 'discussions', element: S(<DiscussionHome />) },
      { path: 'discussions/:courseId', element: S(<CourseThreads />) },
      { path: 'discussions/:courseId/:threadId', element: S(<ThreadView />) },
    ],
  },
  {
    element: guard(undefined),
    children: [
      { path: '/settings', element: S(<SettingsPage />) },
      { path: '/notifications', element: S(<NotificationsPage />) },
    ],
  },
  // Instructor workspace
  {
    path: '/instructor',
    element: guard(['instructor', 'admin']),
    children: [
      { index: true, element: S(<InstructorDashboard />) },
      { path: 'courses', element: S(<InstructorCourses />) },
      { path: 'courses/new', element: S(<CourseCreate />) },
      { path: 'courses/:id', element: S(<CourseEditor />) },
      { path: 'quizzes/:id', element: S(<QuizEditor />) },
      { path: 'grading', element: S(<Grading />) },
      { path: 'analytics', element: S(<InstructorAnalytics />) },
    ],
  },
  // Admin panel
  {
    path: '/admin',
    element: guard(['admin']),
    children: [
      { index: true, element: S(<AdminOverview />) },
      { path: 'users', element: S(<AdminUsers />) },
      { path: 'courses', element: S(<AdminCourses />) },
      { path: 'revenue', element: S(<AdminRevenue />) },
      { path: 'moderation', element: S(<AdminModeration />) },
      { path: 'notifications', element: S(<AdminBroadcast />) },
      { path: 'audit', element: S(<AdminAudit />) },
    ],
  },
  { path: '/dashboard', element: <Navigate to="/app" replace /> },
  { element: <PublicLayout />, children: [{ path: '*', element: S(<NotFound />) }] },
];

// Every route group gets a friendly error screen instead of React Router's raw one.
export const router = createBrowserRouter(routes.map((r) => ({ ...r, errorElement: <RouteError /> })));
