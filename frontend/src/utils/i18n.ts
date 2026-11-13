/**
 * i18n scaffolding (PRD 3.1: "basic i18n scaffolding"; full translation is out of scope).
 * Strings are looked up by key; missing keys fall back to English. Add a language by adding a dictionary.
 */
import { create } from 'zustand';

const en = {
  'nav.dashboard': 'Dashboard', 'nav.catalog': 'Browse courses', 'nav.myLearning': 'My learning', 'nav.tutor': 'AI Tutor',
  'nav.assignments': 'Assignments', 'nav.quizzes': 'Quizzes', 'nav.flashcards': 'Flashcards', 'nav.studyPlan': 'Study plan',
  'nav.achievements': 'Achievements', 'nav.leaderboard': 'Leaderboard', 'nav.discussions': 'Discussions', 'nav.notes': 'Notes & bookmarks',
  'nav.courses': 'My courses', 'nav.grading': 'Grading', 'nav.analytics': 'Analytics', 'nav.overview': 'Overview', 'nav.users': 'Users',
  'nav.approvals': 'Course approvals', 'nav.revenue': 'Revenue', 'nav.moderation': 'Moderation', 'nav.broadcast': 'Notifications',
  'nav.audit': 'Audit log', 'nav.settings': 'Settings',
  'greeting.morning': 'Good morning', 'greeting.afternoon': 'Good afternoon', 'greeting.evening': 'Good evening',
};
type Key = keyof typeof en;
const hi: Partial<Record<Key, string>> = {
  'nav.dashboard': 'डैशबोर्ड', 'nav.catalog': 'कोर्स देखें', 'nav.myLearning': 'मेरी पढ़ाई', 'nav.tutor': 'एआई ट्यूटर',
  'nav.assignments': 'असाइनमेंट', 'nav.quizzes': 'क्विज़', 'nav.achievements': 'उपलब्धियाँ', 'nav.discussions': 'चर्चाएँ',
  'nav.settings': 'सेटिंग्स', 'greeting.morning': 'सुप्रभात', 'greeting.afternoon': 'नमस्ते', 'greeting.evening': 'शुभ संध्या',
};
const dictionaries: Record<string, Partial<Record<Key, string>>> = { en, hi };
export const LANGUAGES = [{ code: 'en', label: 'English' }, { code: 'hi', label: 'हिन्दी (partial)' }];

const initial = (() => { try { return localStorage.getItem('vl-lang') || 'en'; } catch { return 'en'; } })();

export const useI18n = create<{ lang: string; setLang: (l: string) => void }>((set) => ({
  lang: initial,
  setLang: (lang) => {
    try { localStorage.setItem('vl-lang', lang); } catch { /* ignore */ }
    document.documentElement.lang = lang;
    set({ lang });
  },
}));

export function useT() {
  const lang = useI18n((s) => s.lang);
  return (key: Key) => dictionaries[lang]?.[key] ?? en[key] ?? key;
}
