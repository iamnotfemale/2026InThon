import importlib.util
import json
import re
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('dashboard_build', Path(__file__).with_name('build-dashboard.py'))
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class DashboardBuildChecks(unittest.TestCase):
    def test_landing_register_keep_original_styles_logic_assets_and_production_links(self):
        for name, filename, model in [('landing', 'Landing.dc.html', 'LandingModel'), ('register', 'Signup.dc.html', 'RegisterModel')]:
            source = (build.ROOT / f'frontend/{name}/{filename}').read_text(encoding='utf-8')
            self.assertEqual((build.ROOT / f'public/css/{name}.css').read_text(encoding='utf-8'), re.search(r'<style>(.*?)</style>', source, re.S).group(1))
            logic = re.search(r'<script type="text/x-dc"[^>]*>(.*?)</script>', source, re.S).group(1)
            self.assertEqual((build.ROOT / f'public/js/{name}-model.js').read_text(encoding='utf-8'),
                "import { DCLogic } from './dashboard-runtime.js';\n" + logic.replace('class Component extends DCLogic', f'export default class {model} extends DCLogic', 1).replace('서비스명이에요', '디미예요').replace('서비스명', '디미').replace('inthon2team', 'dimi_in'))
            template = (build.ROOT / f'public/data/{name}-template.json').read_text(encoding='utf-8')
            self.assertNotRegex(template, r'(?:Main|Signup|Landing)\.dc\.html|\./assets/')
            self.assertIn('/dashboard', template)
            self.assertNotIn('서비스명', template)
            self.assertNotIn('inthon2team', template)
            self.assertIn('dimi-mark', template)
        self.assertIn('/register', (build.ROOT / 'public/data/landing-template.json').read_text(encoding='utf-8'))
        self.assertEqual((build.ROOT / 'frontend/assets/onboarding-mascot.png').read_bytes(), (build.ROOT / 'public/assets/onboarding-mascot.png').read_bytes())
        for filename, page in [('index.html', 'landing'), ('register.html', 'register'), ('dashboard.html', 'dashboard')]:
            shell = (build.ROOT / f'public/{filename}').read_text(encoding='utf-8')
            self.assertIn(f'/js/{page}-app.js', shell)
            self.assertIn(f'/css/{page}.css', shell)
        routes = json.loads((build.ROOT / 'vercel.json').read_text(encoding='utf-8'))['rewrites']
        self.assertTrue(all(r['destination'] == '/dashboard' for r in routes if r['source'] in ['/home', '/library', '/taste', '/settings', '/items/:id']))

    def test_supplied_css_and_model_logic_are_preserved(self):
        source = (build.ROOT / 'frontend/design/Main.dc.html').read_text(encoding='utf-8')
        css = re.search(r'<style>(.*?)</style>', source, re.S).group(1)
        self.assertEqual((build.ROOT / 'public/css/dashboard.css').read_text(encoding='utf-8'), css)
        logic = re.search(r'<script type="text/x-dc"[^>]*>(.*?)</script>', source, re.S).group(1)
        actual = (build.ROOT / 'public/js/dashboard-model.js').read_text(encoding='utf-8')
        self.assertEqual(actual, "import { DCLogic } from './dashboard-runtime.js';\n" + logic.replace(
            'class Component extends DCLogic', 'export default class DashboardModel extends DCLogic', 1).replace('서비스명이에요', '디미예요').replace('서비스명', '디미').replace('inthon2team', 'dimi_in'))

    def test_brand_icon_replacement_keeps_the_adjacent_name_and_layout(self):
        parser = build.TemplateParser()
        parser.feed('<span><span style="width:28px;height:28px;background:#0A0A0A"><svg><path d="M7 5v14M12 8v8M17 5v14"/></svg></span><span>디미</span></span>')
        build.brand_marks(parser.roots)
        children = parser.roots[0]['children']
        self.assertEqual(len(children), 2)
        self.assertEqual(children[1]['children'], ['디미'])
        self.assertEqual(children[0]['attrs']['class'], 'dimi-mark')
        self.assertEqual(children[0]['attrs']['style'], 'width:28px;height:28px')
        self.assertEqual((build.ROOT / 'frontend/assets/mascot.png').read_bytes(), (build.ROOT / 'public/assets/mascot.png').read_bytes())

    def test_nested_conditions_svg_case_and_boolean_attributes_survive_compilation(self):
        parser = build.TemplateParser()
        parser.feed('<sc-if value="{{show}}"><sc-for list="{{items}}" as="item"><input checked="{{item.checked}}"><svg viewBox="0 0 24 24"><defs><linearGradient id="test"><stop offset="0%"/></linearGradient></defs></svg></sc-for></sc-if>')
        children = parser.roots[0]['children'][0]['children']
        self.assertEqual(children[0]['attrs']['checked'], '{{item.checked}}')
        self.assertEqual(children[1]['attrs']['viewBox'], '0 0 24 24')
        self.assertEqual(children[1]['children'][0]['children'][0]['tag'], 'linearGradient')
        self.assertEqual(parser.tags, [])

    def test_invalid_nesting_fails_instead_of_silently_rearranging_design(self):
        parser = build.TemplateParser()
        with self.assertRaises(ValueError):
            parser.feed('<div><span></div>')


if __name__ == '__main__':
    unittest.main()
