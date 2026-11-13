/**
 * Walks every major screen for all three roles using the seeded demo accounts.
 * Fails on uncaught JS errors, failed API calls (5xx) or Content-Security-Policy violations; saves a screenshot of each page
 * to SCREENSHOT_DIR when that env var is set.
 */
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const SHOTS = process.env.SCREENSHOT_DIR;
const PASSWORD = 'Password123!';

function watch(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
  // Anything blocked by the Content-Security-Policy set in infra/nginx/security-headers.conf
  page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) errors.push(`csp: ${m.text()}`); });
  return errors;
}

async function shot(page: Page, name: string) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(400);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

async function visit(page: Page, url: string, name: string, expectText?: string | RegExp) {
  await page.goto(url);
  if (expectText) await expect(page.getByText(expectText).first()).toBeVisible();
  await expect(page.getByText("Couldn't load this")).toHaveCount(0);
  await shot(page, name);
}

test('public pages', async ({ page }) => {
  const errors = watch(page);
  await visit(page, '/', '01-landing', /tutor that never sleeps/i);
  await visit(page, '/courses', '02-catalog', 'Explore courses');
  await page.getByRole('link', { name: /Data Structures & Algorithms Masterclass/ }).first().click();
  await expect(page.getByText('Course content')).toBeVisible();
  await shot(page, '03-course-detail');
  await visit(page, '/register', '04-register', 'Create your account');
  expect(errors).toEqual([]);
});

test('student workspace', async ({ page }) => {
  const errors = watch(page);
  await login(page, 'ananya@example.com');
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByText(/day streak/)).toBeVisible();
  await shot(page, '10-student-dashboard');

  await visit(page, '/app/learning', '11-my-learning', 'My learning');

  // Course player: open the quicksort lecture, check transcript + notes tabs
  await page.getByRole('link', { name: /Continue/ }).first().click();
  await expect(page.getByRole('tab', { name: 'Transcript' })).toBeVisible();
  await shot(page, '12-course-player');
  await page.getByRole('tab', { name: 'Transcript' }).click();
  await shot(page, '13-player-transcript');

  // AI tutor: ask the PRD's sample question and expect cited sources
  await page.goto('/app/tutor');
  await page.locator('#course-pick').selectOption({ label: 'Data Structures & Algorithms Masterclass' });
  await page.getByLabel('Message the AI tutor').fill('Why does quicksort degrade to O(n^2) on sorted input?');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Sources:').first()).toBeVisible({ timeout: 60_000 });
  await shot(page, '14-ai-tutor');

  await visit(page, '/app/assignments', '15-assignments', 'Assignments');
  await visit(page, '/app/quizzes', '16-quizzes', 'Score history');
  await page.getByRole('link', { name: /Complexity Check/ }).first().click();
  await page.getByRole('button', { name: /Start quiz|Retake quiz/ }).click();
  await expect(page.getByText(/Question 1 of/)).toBeVisible();
  await shot(page, '17-quiz-take');
  await visit(page, '/app/flashcards', '18-flashcards', 'Flashcards');
  await visit(page, '/app/study-plan', '19-study-plan', 'Personalized study plan');
  await visit(page, '/app/notes', '20-notes', 'Notes & bookmarks');
  await visit(page, '/app/achievements', '21-achievements', 'Certificates');
  await visit(page, '/app/leaderboard', '22-leaderboard', 'Leaderboard');
  await visit(page, '/app/discussions', '23-discussions', 'Discussions');
  await page.getByRole('link', { name: /Data Structures/ }).first().click();
  await page.getByRole('link', { name: /median-of-three/ }).first().click();
  await expect(page.getByText('Great question!')).toBeVisible();
  await shot(page, '24-thread');
  await visit(page, '/notifications', '25-notifications', 'Notifications');
  await visit(page, '/settings', '26-settings', 'Change password');

  // Dark mode
  await page.goto('/app');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await shot(page, '27-dashboard-dark');
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  expect(errors).toEqual([]);
});

test('instructor workspace', async ({ page }) => {
  const errors = watch(page);
  await login(page, 'rohit@vertexlearn.ai');
  await expect(page).toHaveURL(/\/instructor$/);
  await expect(page.getByText('Needs your attention')).toBeVisible();
  await shot(page, '30-instructor-dashboard');
  await visit(page, '/instructor/courses', '31-instructor-courses', 'My courses');
  await page.getByRole('link', { name: /Data Structures & Algorithms Masterclass/ }).first().click();
  await expect(page.getByRole('tab', { name: /Curriculum/ })).toBeVisible();
  await shot(page, '32-editor-details');
  for (const [tab, name] of [['Curriculum', '33-editor-curriculum'], ['Quizzes', '34-editor-quizzes'], ['Assignments', '35-editor-assignments'], ['Analytics', '36-editor-analytics']] as const) {
    await page.getByRole('tab', { name: new RegExp(tab) }).click();
    await shot(page, name);
  }
  await page.getByRole('tab', { name: /Quizzes/ }).click();
  await page.getByRole('link', { name: /AI draft/ }).first().click();
  await expect(page.getByText('Review this AI draft before publishing')).toBeVisible();
  await shot(page, '37-quiz-editor');
  await visit(page, '/instructor/grading?status=all', '38-grading', 'Grading');
  await visit(page, '/instructor/analytics', '39-analytics', 'Lecture drop-off');
  expect(errors).toEqual([]);
});

test('admin panel', async ({ page }) => {
  const errors = watch(page);
  await login(page, 'meera@vertexlearn.ai');
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText('Platform overview')).toBeVisible();
  await shot(page, '40-admin-overview');
  await visit(page, '/admin/users', '41-admin-users', 'User management');
  await visit(page, '/admin/courses', '42-admin-approvals', 'Course approvals');
  await visit(page, '/admin/revenue', '43-admin-revenue', 'Revenue overview');
  await visit(page, '/admin/moderation', '44-admin-moderation', 'Discussion moderation');
  await visit(page, '/admin/notifications', '45-admin-broadcast', 'Recent broadcasts');
  await visit(page, '/admin/audit', '46-admin-audit', 'Audit log');
  expect(errors).toEqual([]);
});

test('mobile layout', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = watch(page);
  await login(page, 'ananya@example.com');
  await expect(page.getByText(/day streak/)).toBeVisible();
  await shot(page, '50-mobile-dashboard');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await shot(page, '51-mobile-menu');
  await page.goto('/courses');
  await shot(page, '52-mobile-catalog');
  expect(errors).toEqual([]);
});
