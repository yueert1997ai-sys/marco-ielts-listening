import json
import unittest
from scripts.build_807_meanings import ROOT, build


class GlossaryTests(unittest.TestCase):
    def test_generated_snapshot_and_full_coverage(self):
        result = build()
        self.assertEqual(result, json.loads((ROOT / '807/data/meanings.json').read_text(encoding='utf-8')))
        self.assertEqual(len(result['entries']), 1854)
        for entry in result['entries'].values():
            self.assertTrue(entry['pos'])
            self.assertRegex(entry['meaning'], r'[\u3400-\u9fff]')
            self.assertNotIn('\\n', entry['meaning'])

    def test_screenshot_word_and_uncertain_source(self):
        entries = build()['entries']
        self.assertEqual(entries['herbivorous']['pos'], 'adj.')
        self.assertIn('食草', entries['herbivorous']['meaning'])
        self.assertIn('疑似误拼', entries['out on load']['meaning'])
        self.assertIn('n.', entries['major']['pos'])

    def test_offline_and_no_automatic_advance(self):
        sw = (ROOT / '807/sw.js').read_text(encoding='utf-8')
        self.assertIn('./data/meanings.json', sw)
        app = (ROOT / '807/app.js').read_text(encoding='utf-8')
        self.assertNotIn('QUICK_PASS_DELAY_MS', app)
        self.assertNotIn('下一题马上开始', app)


if __name__ == '__main__':
    unittest.main()
